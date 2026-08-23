import { useState } from 'react';
import { ChevronDown, ChevronRight, Crosshair } from 'lucide-react';
import useAppStore, { selectActiveAreaByType } from '../store/appStore';
import { qualitySummary, rankedWarnings, scaleQualitySummary } from '../utils/boundaryQuality';
import { liveVoids, staleVoidCount, summariseIssues } from '../utils/traceIssues';
import { resolveAnchor } from '../utils/warningAnchors';
import Card from './DockCard';

/* ── one place to read how good the answer is ─────────────────────────────
   The confidence chip, the scale's agreement chip, the "areas may be off by
   ~84%" line and the detector's reasons were four separate marks scattered
   down a panel whose other cards are the workflow. Read one at a time none of
   them said how much there was to check; read together they crowded the very
   numbers they were qualifying. They live here now, and the cards above carry
   the measurement alone. */

const SEVERITY_DOT = { error: 'bg-crit', warn: 'bg-warn', info: 'bg-fg-dim' };

const CHIP_TONE = {
  ok: 'text-ok bg-ok/12 border-ok/35',
  warn: 'text-warn bg-warn/12 border-warn/35',
  error: 'text-crit bg-crit/12 border-crit/35',
};

/* ── warnings ─────────────────────────────────────────────────────────────
   Full-size prose, not 9px grey, and the detail is on the page rather than in
   a `title`: the scale note used to keep its whole explanation in a tooltip,
   which on a phone is nowhere at all. */
const WarningRow = ({ label, detail, severity = 'warn', anchor, active, onFocus }) => (
  <div className="grid grid-cols-[auto_1fr_auto] items-start gap-2 py-2 border-t border-line-soft first:border-t-0">
    <span className={`mt-[6px] w-[7px] h-[7px] rounded-full shrink-0 ${SEVERITY_DOT[severity] ?? SEVERITY_DOT.warn}`} />
    <div className="min-w-0">
      <p className="text-[12.5px] font-semibold leading-snug text-fg">{label}</p>
      <p className="text-[12px] leading-snug text-fg-3 mt-0.5">{detail}</p>
    </div>
    {anchor && (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onFocus(); }}
        aria-pressed={active}
        title={active ? 'Hide on the plan' : 'Show on the plan'}
        className={`inline-flex items-center gap-1 h-[26px] px-2 rounded border text-[12px]
          shrink-0 transition-colors cursor-pointer
          ${active
            ? 'bg-accent text-accent-ink border-accent'
            : 'bg-panel-2 text-fg-3 border-line hover:text-accent hover:border-accent/50'}`}
      >
        <Crosshair className="w-3 h-3" aria-hidden="true" />
        Show
      </button>
    )}
  </div>
);

const Section = ({ title, children }) => (
  <div className="mt-3 pt-2.5 border-t border-line">
    <p className="text-[10.5px] font-bold uppercase tracking-[.07em] text-fg-dim">{title}</p>
    <div className="mt-1.5">{children}</div>
  </div>
);

const StatRow = ({ label, value, tone }) => (
  <div className="flex items-baseline justify-between gap-3 py-[3px]">
    <span className="text-[12px] leading-snug text-fg-3 min-w-0">{label}</span>
    <span className={`font-mono tabular-nums text-[12.5px] shrink-0 ${tone ?? 'text-fg-2'}`}>
      {value}
    </span>
  </div>
);

/**
 * One outline's confidence and the detector's reasons for it. The collapsed
 * line is the first entry of the same ranked list the expansion shows, so the
 * two cannot disagree about which warning is worst. Severity is read from the
 * warning rather than from the trace: `label-outside` is deliberately gentler
 * on a hand-drawn outline and has to keep reading as a warning there.
 */
const TraceBlock = ({ trace, quality, expanded, onToggle, anchorCtx, focusedWarning, onFocus }) => {
  const [showNotes, setShowNotes] = useState(false);
  const ranked = rankedWarnings(quality.warnings);
  const notes = ranked.filter((w) => w.severity === 'info');
  const reasons = ranked.filter((w) => w.severity !== 'info');
  const perFloor = reasons.filter((w) => w.scope !== 'result');
  const wholeDrawing = reasons.filter((w) => w.scope === 'result');
  const stale = staleVoidCount(trace);
  const expandable = ranked.length > 0;

  const chipTone = quality.level === 'good' ? CHIP_TONE.ok
    : quality.level === 'fair' ? CHIP_TONE.warn : CHIP_TONE.error;
  const tone = reasons.length === 0 || quality.level === 'good' ? 'text-fg-3'
    : quality.level === 'fair' ? 'text-warn' : 'text-crit';
  const headline = reasons.length === 0
    ? (notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : 'No warnings')
    : `${reasons.length} to check · ${reasons[0].detail}`;

  const row = (warning) => (
    <WarningRow
      key={warning.index}
      label={warning.label}
      detail={warning.detail}
      severity={warning.severity}
      anchor={resolveAnchor(quality.warnings[warning.index], anchorCtx)}
      active={focusedWarning?.traceId === trace.id && focusedWarning?.index === warning.index}
      onFocus={() => onFocus(warning.index)}
    />
  );

  return (
    <div className="py-2 border-t border-line-soft first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: trace.color }} />
        <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium text-fg-2">
          {trace.name}
        </span>
        <span className={`chip ${chipTone}`}>
          <span className="chip-dot" />
          {quality.percent !== null ? `${quality.percent}% confidence` : 'unverified'}
        </span>
      </div>

      {/* Not one of the detector's warnings — it is the user's own edit having
          moved the outline out from under a subtraction — so it is stated on
          its own rather than folded into the ranked list. */}
      {stale > 0 && (
        <p className="mt-1 pl-[18px] text-[12px] leading-snug text-crit">
          {stale === 1
            ? '1 void is no longer inside this outline, so it is not subtracted.'
            : `${stale} voids are no longer inside this outline, so they are not subtracted.`}
          {' Retrace the outline, or delete the void.'}
        </p>
      )}

      {expandable ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className={`flex w-full items-start gap-1 mt-1 text-left text-[12px] leading-snug
                      cursor-pointer hover:opacity-80 ${tone}`}
        >
          {expanded
            ? <ChevronDown className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
            : <ChevronRight className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />}
          <span className="min-w-0">{headline}</span>
        </button>
      ) : (
        <p className="mt-1 pl-[18px] text-[12px] leading-snug text-fg-3">{headline}</p>
      )}

      {expandable && expanded && (
        <div className="mt-1 pl-1">
          {perFloor.map(row)}
          {wholeDrawing.length > 0 && (
            <>
              <p className="pt-2.5 mt-1.5 border-t border-line text-[10.5px] font-bold uppercase tracking-[.07em] text-fg-dim">
                This drawing
              </p>
              {wholeDrawing.map(row)}
            </>
          )}
          {notes.length > 0 && (
            <button
              type="button"
              onClick={() => setShowNotes((v) => !v)}
              className="mt-1.5 text-[12px] text-fg-3 hover:text-fg cursor-pointer"
            >
              {showNotes ? '· hide notes' : `· ${notes.length} note${notes.length === 1 ? '' : 's'}`}
            </button>
          )}
          {showNotes && notes.map(row)}
        </div>
      )}
    </div>
  );
};

/**
 * The quality, accuracy and status of the trace, in one card at the foot of
 * the dock. It subscribes to the store rather than taking a dozen props: every
 * figure on it is read straight from the same state the cards above measure
 * from, so there is no path by which the two can drift.
 */
const ChecksCard = () => {
  const image = useAppStore((s) => s.image);
  const perimeterTraces = useAppStore((s) => s.perimeterTraces) || [];
  const rooms = useAppStore((s) => s.rooms);
  const detectedDimensions = useAppStore((s) => s.detectedDimensions);
  const calibrated = useAppStore((s) => s.calibration?.calibrated);
  const scaleQuality = useAppStore((s) => s.calibration?.quality);
  const areas = useAppStore(selectActiveAreaByType);
  const focusedWarning = useAppStore((s) => s.focusedWarning);
  const setFocusedWarning = useAppStore((s) => s.setFocusedWarning);

  // `undefined` means nobody has chosen yet and the outline most worth reading
  // opens itself; `null` means it was closed by hand and must stay closed. A
  // plain `useState(worstId)` would freeze whichever outline was worst at mount
  // and never open the one a later re-trace went wrong on.
  const [openTraceId, setOpenTraceId] = useState(undefined);

  if (!image) return null;

  const scaleNote = scaleQualitySummary(scaleQuality);
  const issues = summariseIssues(perimeterTraces, scaleNote, areas.doubleCounted);

  const traced = perimeterTraces.filter((t) => t.vertices?.length >= 3);
  const corners = traced.reduce((n, t) => n + t.vertices.length, 0);
  const voids = traced.flatMap(liveVoids);
  const mine = voids.filter((h) => h?.source === 'user').length;
  const stale = perimeterTraces.reduce((n, t) => n + staleVoidCount(t), 0);
  const labelCount = detectedDimensions?.length ?? 0;
  const measuredRooms = rooms?.length ?? 0;

  const withQuality = perimeterTraces
    .map((trace) => ({ trace, quality: trace.quality ? qualitySummary(trace.quality) : null }))
    .filter((t) => t.quality);
  const autoOpen = withQuality.find(({ trace, quality }) =>
    quality.level === 'poor' || quality.level === 'failed' || staleVoidCount(trace) > 0
  )?.trace.id ?? null;
  const openId = openTraceId === undefined ? autoOpen : openTraceId;

  const nothingMeasured = !calibrated && traced.length === 0;
  const chipLabel = issues.count === 0
    ? (nothingMeasured ? 'Nothing yet' : 'All clear')
    : `${issues.count} to check`;

  return (
    <div id="dock-checks">
      <Card
        title="Checks"
        action={(
          <span className={`chip ${CHIP_TONE[issues.level] ?? CHIP_TONE.ok}`}>
            <span className="chip-dot" />
            {chipLabel}
          </span>
        )}
      >
        <div>
          {issues.count === 0 && (
            <p className="text-[12px] leading-snug text-fg-3 pb-0.5">
              {nothingMeasured
                ? 'Nothing measured yet — read the dimensions, or set the scale from a length you know.'
                : 'Nothing to check. The scale and every outline came back clean.'}
            </p>
          )}

          {/* The scale, whatever it has to say. A scale that agrees is worth
              stating too: the area is read long after any toast has gone, and
              "where did this number come from" stays asked. */}
          {scaleNote && (
            <WarningRow
              label={scaleNote.short}
              detail={scaleNote.detail}
              severity={scaleNote.level === 'check' ? 'warn' : 'info'}
            />
          )}

          {/* Stated, never auto-corrected — which of the two outlines is wrong
              is the user's call. */}
          {areas.doubleCounted?.map((d) => (
            <WarningRow
              key={d.innerId}
              label={`${d.innerName} sits inside ${d.outerName}`}
              detail="Its area is counted twice in the total. Retrace whichever outline is wrong, or change one of their types."
            />
          ))}
        </div>

        <Section title="Measurements">
          <StatRow label="Dimension labels read" value={labelCount} />
          <StatRow label="Rooms measured" value={measuredRooms} />
          <StatRow
            label="Outlines traced"
            value={perimeterTraces.length > traced.length
              ? `${traced.length} of ${perimeterTraces.length}`
              : traced.length}
          />
          <StatRow label="Corners plotted" value={corners} />
          {(voids.length > 0 || stale > 0) && (
            <StatRow
              label="Voids subtracted"
              value={mine > 0 && mine < voids.length
                ? `${voids.length} (${mine} yours)`
                : voids.length}
            />
          )}
          {stale > 0 && (
            <StatRow label="Voids left outside" value={stale} tone="text-crit font-semibold" />
          )}
        </Section>

        {withQuality.length > 0 && (
          <Section title="Outline quality">
            {withQuality.map(({ trace, quality }) => (
              <TraceBlock
                key={trace.id}
                trace={trace}
                quality={quality}
                expanded={openId === trace.id}
                onToggle={() => setOpenTraceId(openId === trace.id ? null : trace.id)}
                anchorCtx={{ trace, traces: perimeterTraces, rooms, detectedDimensions }}
                focusedWarning={focusedWarning}
                onFocus={(index) => setFocusedWarning(
                  focusedWarning?.traceId === trace.id && focusedWarning?.index === index
                    ? null
                    : { traceId: trace.id, index }
                )}
              />
            ))}
          </Section>
        )}
      </Card>
    </div>
  );
};

export default ChecksCard;
