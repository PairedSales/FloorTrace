import { useState } from 'react';
import { ChevronRight, Crosshair } from 'lucide-react';
import useAppStore from '../store/appStore';
import { rankedWarnings } from '../utils/boundaryQuality';
import { liveVoids, staleVoidCount } from '../utils/traceIssues';
import { resolveAnchor } from '../utils/warningAnchors';
import { usePlanIssues } from '../hooks/usePlanIssues';
import PanelSection from './PanelSection';

/* ── one place to read how far to trust the answer ────────────────────────
   Directly under the area it qualifies. Every row it lists is one entry of
   `summariseIssues`, and the chip counts that same list — so the number beside
   the title and the rows under it cannot disagree.

   Folded, it is one line: "All clear", or how many things there are to check.
   It opens by itself when there is something, because an area offered clean
   while the detector doubts it is the failure this app is most prone to.

   **A row says what to do, and where it can, does it.** A remedy that ends in
   "paint the outline" used to leave the user to go and find the brush; the row
   now carries the button, and a doubt about the scale opens Scale. The words
   stay on the page as well, for the shell that passes no handler and for the
   reader who wants to know why.

   What is not here: a "92% wall match" on every outline. The number is the
   share of the outline sitting on drawn wall — evidence about the tracing,
   blind to whether the enclosed area is the right area — and a percentage
   beside a green dot reads as "92% accurate" to anyone who has not read that
   sentence. Measured across the results the app presents, its correlation with
   area error is +0.117. The doubts it stands for are still here, as rows, in
   words.

   The statistics — labels read, rooms measured, corners — are under Details.
   They are how a reviewer checks the working, not how anyone reads a result. */

const SEVERITY_DOT = { error: 'bg-crit', warn: 'bg-warn', info: 'bg-fg-dim' };

// A finding's detail is written to follow a colon in a toast ("…check it: a gap
// in the wall was bridged"), so it arrives without a capital or a full stop.
// On a row of its own it is a sentence, and reads as one.
const asSentence = (text) => {
  const s = String(text ?? '').trim();
  if (!s) return null;
  return s[0].toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? '' : '.');
};

const CHIP_TONE = { ok: 'chip-ok', warn: 'chip-warn', error: 'chip-crit', pending: 'chip-quiet' };

// Detector findings whose remedy is to draw the outline by hand. Listed by
// code rather than matched out of the remedy's wording, which is prose and is
// free to be reworded.
const PAINT_REMEDY = new Set([
  'unsealed', 'annexation', 'wall-left-outside', 'incomplete-enclosure', 'heavy-closing',
  'room-outside', 'floors-rejected', 'outlines-dropped', 'brush-mismatch', 'no-boundary',
  'floor-empty', 'covers-page',
]);

/* ── one row ──────────────────────────────────────────────────────────────
   Full-size prose, and the detail is on the page rather than in a `title`:
   a tooltip is nowhere at all on a phone. */
const IssueRow = ({
  label, detail, remedy, severity = 'warn', where, anchor, active, onFocus, action,
}) => (
  <div className="issue-row grid grid-cols-[auto_1fr] gap-x-3 py-3 border-t border-line-soft first:border-t-0 first:pt-0">
    <span className={`mt-[7px] w-2 h-2 rounded-full shrink-0 ${SEVERITY_DOT[severity] ?? SEVERITY_DOT.warn}`} />
    <div className="min-w-0">
      {where && <p className="text-[12.5px] text-fg-3 mb-0.5">{where}</p>}
      <p className="text-[14px] font-semibold leading-snug text-fg">{label}</p>
      {detail && <p className="text-[13.5px] leading-snug text-fg-3 mt-0.5">{asSentence(detail)}</p>}
      {/* What to do about it. A code with no remedy renders no line rather than
          a filler one. */}
      {remedy && (
        <p className="text-[13.5px] leading-snug text-fg-2 mt-1">{remedy}</p>
      )}
      {(anchor || action) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {action && (
            <button type="button" onClick={action.onClick} disabled={action.disabled}
                    className="btn btn-secondary btn-sm">
              {action.label}
            </button>
          )}
          {anchor && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onFocus(); }}
              aria-pressed={active}
              title={active ? 'Stop highlighting this on the plan' : 'Highlight where this is on the plan'}
              className={`btn btn-sm ${active ? 'btn-primary' : 'btn-secondary'}`}
            >
              <Crosshair className="w-4 h-4" aria-hidden="true" />
              Show
            </button>
          )}
        </div>
      )}
    </div>
  </div>
);

const StatRow = ({ label, value, tone }) => (
  <div className="flex items-baseline justify-between gap-3 py-[3px]">
    <span className="text-[13.5px] leading-snug text-fg-3 min-w-0">{label}</span>
    <span className={`tabular-nums text-[13.5px] shrink-0 ${tone ?? 'text-fg-2'}`}>
      {value}
    </span>
  </div>
);

const SubHeading = ({ children }) => (
  <p className="mt-3.5 mb-1 text-[13px] font-semibold text-fg-2 first:mt-0">{children}</p>
);

// Remedies the issue kinds that are not detector warnings need; a warning
// carries its own from `boundaryQuality.remedyText`.
const TRACE_OUTCOME_REMEDY = 'Paint over the outside walls and FloorTrace will draw the outline from your painting.';
const STALE_VOID_DETAIL = 'It is no longer taken off the area. Redraw the outline, or delete the cut-out.';
const DOUBLE_COUNTED_DETAIL = 'Its area is counted twice in the total. Redraw whichever outline is wrong, '
  + 'or change what one of them counts as.';

/**
 * How far to trust the plan's numbers. It subscribes to the store rather than
 * taking a dozen props: every figure on it is read straight from the same
 * state the sections around it measure from, so there is no path by which the
 * two can drift. The handlers are optional — a row without one says what to do
 * in words and offers no button.
 */
const ChecksSection = ({ open, onToggle, onPaintOutline, onRescan, onShowScale }) => {
  const image = useAppStore((s) => s.image);
  const perimeterTraces = useAppStore((s) => s.perimeterTraces) || [];
  const rooms = useAppStore((s) => s.rooms);
  const detectedDimensions = useAppStore((s) => s.detectedDimensions);
  const areaRatio = useAppStore((s) => s.calibration?.quality?.areaRatio);
  const calibrated = useAppStore((s) => s.calibration?.calibrated);
  const isProcessing = useAppStore((s) => s.isProcessing);
  const focusedWarning = useAppStore((s) => s.focusedWarning);
  const setFocusedWarning = useAppStore((s) => s.setFocusedWarning);
  const switchPerimeterTrace = useAppStore((s) => s.switchPerimeterTrace);
  const issues = usePlanIssues();

  const [showDetails, setShowDetails] = useState(false);

  if (!image) return null;

  const { scaleNote } = issues;
  const traced = perimeterTraces.filter((t) => t.vertices?.length >= 3);
  const corners = traced.reduce((n, t) => n + t.vertices.length, 0);
  const voids = traced.flatMap(liveVoids);
  const mine = voids.filter((h) => h?.source === 'user').length;
  const stale = perimeterTraces.reduce((n, t) => n + staleVoidCount(t), 0);
  const labelCount = detectedDimensions?.length ?? 0;
  const measuredRooms = rooms?.length ?? 0;
  const traceById = new Map(perimeterTraces.map((t) => [t.id, t]));
  const manyOutlines = perimeterTraces.length > 1;

  // With no outline there is nothing to call clean, whatever the scale says —
  // and nothing to list either, so the section stands aside until there is.
  const nothingMeasured = traced.length === 0;
  if (nothingMeasured && issues.count === 0) return null;
  // An outline with no scale has nothing wrong with it and no area either;
  // "All clear" beside a figure asking for a scale says two things at once.
  const unscaled = !calibrated && !nothingMeasured;
  const chipLabel = issues.count > 0 ? `${issues.count} to check`
    : unscaled ? 'No scale yet' : 'All clear';
  const chipTone = issues.count > 0 ? (CHIP_TONE[issues.level] ?? CHIP_TONE.warn)
    : unscaled ? CHIP_TONE.pending : CHIP_TONE.ok;

  // Notes: how an outline was reached rather than a reason to doubt it, and
  // warnings a person has already checked against the plan and accepted.
  // Neither is counted; both are listed under Details, where the record stays.
  const notes = traced.flatMap((trace) => rankedWarnings(trace.quality?.warnings)
    .filter((w) => w.severity === 'info' || w.acknowledged)
    .map((w) => ({ trace, w })));

  const focusProps = (trace, index) => {
    const anchor = trace ? resolveAnchor(trace.quality?.warnings?.[index], {
      trace, traces: perimeterTraces, rooms, detectedDimensions,
    }) : null;
    return {
      anchor,
      active: focusedWarning?.traceId === trace?.id && focusedWarning?.index === index,
      onFocus: () => setFocusedWarning(
        focusedWarning?.traceId === trace.id && focusedWarning?.index === index
          ? null
          : { traceId: trace.id, index },
      ),
    };
  };

  // Painting redraws the outline that is selected, so the one the finding is
  // about comes forward first.
  const paintAction = (traceId) => (onPaintOutline ? {
    label: 'Paint the outline',
    onClick: () => {
      if (traceId) switchPerimeterTrace(traceId);
      onPaintOutline();
    },
  } : null);

  const row = (issue, i) => {
    const trace = issue.traceId ? traceById.get(issue.traceId) : null;
    // Which outline, when there is more than one — but never on a finding
    // about the whole drawing, which belongs to none of them.
    const where = manyOutlines && trace && issue.scope !== 'result' ? trace.name : null;
    const key = `${issue.kind}-${issue.traceId ?? ''}-${issue.index ?? i}`;

    switch (issue.kind) {
      case 'warning':
        return (
          <IssueRow key={key} label={issue.label} detail={issue.detail} remedy={issue.remedy}
                    severity={issue.severity} where={where}
                    action={PAINT_REMEDY.has(issue.code) ? paintAction(issue.traceId) : null}
                    {...focusProps(trace, issue.index)} />
        );
      case 'double-counted':
        return (
          <IssueRow key={key} severity="warn"
                    label={issue.pair ? `${issue.pair.innerName} sits inside ${issue.pair.outerName}` : issue.label}
                    detail={DOUBLE_COUNTED_DETAIL} />
        );
      case 'trace-outcome':
        return (
          <IssueRow key={key} severity="error" label={issue.label}
                    detail={issue.detail ?? 'Nothing on this plan read as a closed outside wall.'}
                    remedy={TRACE_OUTCOME_REMEDY} action={paintAction(null)} />
        );
      case 'stale-void':
        return (
          <IssueRow key={key} severity="error" label={issue.label} detail={STALE_VOID_DETAIL} where={where} />
        );
      // A doubt about the scale is settled by looking at the room it came
      // from, which Scale draws on the plan and gives the size of.
      case 'scale':
        return (
          <IssueRow key={key} severity={issue.severity} label={issue.label} detail={issue.detail}
                    remedy={issue.remedy}
                    action={onShowScale ? { label: 'Open Scale', onClick: onShowScale } : null} />
        );
      case 'rescale':
        return (
          <IssueRow key={key} severity={issue.severity} label={issue.label} detail={issue.detail}
                    remedy={issue.remedy}
                    action={onRescan
                      ? { label: 'Read the room sizes again', onClick: onRescan, disabled: isProcessing }
                      : null} />
        );
      default:
        return (
          <IssueRow key={key} severity={issue.severity} label={issue.label} detail={issue.detail}
                    remedy={issue.remedy} where={where} />
        );
    }
  };

  return (
    <PanelSection
      id="panel-checks"
      title="Things to check"
      open={open}
      onToggle={onToggle}
      badge={(
        <span className={`chip ${chipTone}`}>
          <span className="chip-dot" />
          {chipLabel}
        </span>
      )}
    >
      {issues.count === 0 && (
        <p className="text-[14px] leading-snug text-fg-2">
          {nothingMeasured
            ? 'Nothing measured yet.'
            : unscaled
              ? 'Nothing wrong with the outline, but there is no scale yet, so there is no area to check. Set it under Scale.'
              : 'No problems found. It’s still worth comparing the outline with the plan before you use the area.'}
        </p>
      )}

      {issues.count > 0 && <div>{issues.issues.map(row)}</div>}

      <div className="mt-3.5 pt-2.5 border-t border-line-soft">
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          className="flex items-center gap-1 text-[13.5px] font-medium text-fg-3 hover:text-fg cursor-pointer"
        >
          <ChevronRight className={`w-4 h-4 ${showDetails ? 'rotate-90' : ''}`} aria-hidden="true" />
          Details
        </button>

        {showDetails && (
          <div className="mt-2.5">
            {scaleNote && scaleNote.level !== 'check' && (
              <>
                <SubHeading>How the scale was set</SubHeading>
                <p className="text-[13.5px] leading-snug text-fg-3">
                  <span className="font-medium text-fg-2">{scaleNote.short}.</span> {scaleNote.detail}
                  {scaleNote.remedy && <> {scaleNote.remedy}</>}
                </p>
              </>
            )}

            <SubHeading>What was measured</SubHeading>
            <StatRow label="Room sizes read on the plan" value={labelCount} />
            <StatRow label="Rooms measured" value={measuredRooms} />
            {/* The one number the app holds that can see an *area* error
                rather than a tracing error: the traced building against what
                its own labels add up to. Stated rather than only flagged,
                because a reviewer who knows the plan can judge it far better
                than a threshold can. */}
            {areaRatio > 0 && (
              <StatRow
                label="Outline area vs. the rooms’ printed sizes"
                value={`${areaRatio.toFixed(1)}×`}
                tone={areaRatio > 2.5 || areaRatio < 0.7 ? 'text-warn' : undefined}
              />
            )}
            <StatRow
              label="Outlines drawn"
              value={perimeterTraces.length > traced.length
                ? `${traced.length} of ${perimeterTraces.length}`
                : traced.length}
            />
            <StatRow label="Corners" value={corners} />
            {(voids.length > 0 || stale > 0) && (
              <StatRow
                label="Areas cut out"
                value={mine > 0 && mine < voids.length
                  ? `${voids.length} (${mine} yours)`
                  : voids.length}
              />
            )}
            {stale > 0 && (
              <StatRow label="Cut-outs left outside" value={stale} tone="text-crit font-semibold" />
            )}

            {notes.length > 0 && (
              <>
                <SubHeading>Notes</SubHeading>
                {notes.map(({ trace, w }) => (
                  <IssueRow
                    key={`${trace.id}-${w.index}`}
                    severity="info"
                    where={manyOutlines ? trace.name : null}
                    label={w.acknowledged && w.severity !== 'info' ? `${w.label} (reviewed)` : w.label}
                    detail={w.detail}
                    remedy={w.remedy}
                    {...focusProps(trace, w.index)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </PanelSection>
  );
};

export default ChecksSection;
