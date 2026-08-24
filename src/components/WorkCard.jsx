import { Copy } from 'lucide-react';
import useAppStore from '../store/appStore';
import useWorkspaceStore from '../store/workspaceStore';
import { buildAreaDerivation } from '../utils/areaDerivation';
import { formatAreaValue, formatAreaTenths, formatLength } from '../utils/unitConverter';
import { derivationText } from '../utils/derivationText';
import Card from './DockCard';

/* ── the arithmetic, written out ──────────────────────────────────────────
   An appraisal report has to show its working for the area sketch, and the
   form the trade shows it in is a column of multiplies: the outline cut into
   rectangles and right triangles, one line each, adding to the level. That is
   what a reviewer can check, because a piece's two lengths are lengths of the
   building and can be read off against the dimensions printed on the plan.

   This is the area calculation and only that. The figure of record is total
   GLA, so there is no room schedule here and nothing is drawn: the whole card
   is the sum that produces the number above it.

   Off by default (`workspaceStore.showWork`) and rendered only when there is
   an area to explain. */

const SKIPPED_REASON = {
  hidden: 'hidden, so it is out of every total',
  open: 'fewer than three corners, so it encloses nothing',
};

const Row = ({ label, value, tone, strong }) => (
  <div className="flex items-baseline justify-between gap-3 py-[3px]">
    <span className={`text-[12px] leading-snug min-w-0 ${strong ? 'text-fg font-semibold' : 'text-fg-3'}`}>
      {label}
    </span>
    <span className={`font-mono tabular-nums text-[12.5px] shrink-0
                      ${strong ? 'text-fg font-semibold' : (tone ?? 'text-fg-2')}`}>
      {value}
    </span>
  </div>
);

const Section = ({ title, children }) => (
  <div className="mt-3 pt-2.5 border-t border-line first:mt-0 first:pt-0 first:border-t-0">
    <p className="text-[10.5px] font-bold uppercase tracking-[.07em] text-fg-dim">{title}</p>
    <div className="mt-1.5">{children}</div>
  </div>
);

// One line of the column: `13.7 × 11.8 = 161.7`, or `0.5 × 2.9 × 2.9 = 4.2`
// for a right triangle, which is how the trade writes one.
const Piece = ({ piece, unit }) => (
  <div className="flex items-baseline gap-2 py-[1px]">
    <span className="flex-1 min-w-0 truncate font-mono tabular-nums text-[11.5px] text-fg-3">
      {piece.kind === 'void'
        ? 'a void, taken off whole'
        : `${piece.half ? '0.5 × ' : ''}${piece.lengths[0]} × ${piece.lengths[1]}`}
    </span>
    <span className={`shrink-0 font-mono tabular-nums text-[11.5px]
                      ${piece.deducted ? 'text-warn' : 'text-fg-2'}`}>
      = {piece.deducted ? '−' : ''}{formatAreaTenths(piece.displayed, unit).value}
    </span>
  </div>
);

// One outline: its name and its area, then the pieces it is made of. The
// pieces are apportioned to add up to the figure on the header row, so the
// column can be added by hand and reach it.
const Level = ({ level, unit, single }) => (
  <div className="py-2 border-t border-line-soft first:border-t-0 first:pt-0">
    <div className="flex items-baseline justify-between gap-2">
      <span className="flex items-center gap-2 min-w-0">
        {!single && (
          <span className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: level.color || '#BD93F9' }} />
        )}
        <span className="min-w-0 truncate text-[12.5px] font-medium text-fg-2">
          {single ? 'Outline' : level.name}
        </span>
      </span>
      <span className="shrink-0 font-mono tabular-nums text-[12.5px] font-semibold text-fg">
        {formatAreaTenths(level.subtotal, unit).value} {formatAreaTenths(0, unit).suffix}
      </span>
    </div>

    {/* How a footprint is read against a sketch: two lengths. Suppressed when
        the outline came apart into one rectangle, because that piece is
        already this sentence with an area on the end of it. */}
    {level.dimensions && level.working?.pieces.length !== 1 && (
      <p className="mt-0.5 text-[11.5px] leading-snug text-fg-dim">
        overall {formatLength(level.dimensions.width, unit)}
        {' × '}{formatLength(level.dimensions.height, unit)}
      </p>
    )}

    {level.working ? (
      <div className="mt-1 pl-2 border-l border-line-soft">
        {level.working.pieces.map((piece) => (
          <Piece key={piece.key} piece={piece} unit={unit} />
        ))}
        {/* The pieces are lengths along the walls, not across the page, so the
            reader is told why they do not match a ruler held to the image. */}
        {level.working.rotation > 0 && (
          <p className="mt-1 text-[11px] leading-snug text-fg-dim">
            Measured along the walls, which run {level.working.rotation.toFixed(0)}° off the page.
          </p>
        )}
      </div>
    ) : (
      // An outline that crosses itself has an area but no partition. Saying so
      // beats printing a column that cannot reach the figure above it.
      <p className="mt-1 text-[11.5px] leading-snug text-warn">
        This outline cannot be broken into pieces — it crosses itself, so the
        area above is the shoelace of the whole ring.
      </p>
    )}

    {/* A void the outline has moved out from under is still drawn and still
        the user's assertion, but it is not deducted — so it is named here
        rather than left to look like an omission. */}
    {level.holes.filter((h) => !h.subtracted).map((hole) => (
      <p key={hole.key} className="mt-1 text-[11.5px] leading-snug text-warn">
        A void outside this outline was not deducted.
      </p>
    ))}
  </div>
);

const WorkCard = ({ unit }) => {
  const showWork = useWorkspaceStore((s) => s.showWork);
  const perimeterTraces = useAppStore((s) => s.perimeterTraces);
  const calibration = useAppStore((s) => s.calibration);
  const flashStatus = useWorkspaceStore((s) => s.flashStatus);

  // Before the derivation, not after: the preference is off for everyone who
  // has not asked for this, and cutting every outline into pieces to then
  // render nothing is work no such user should pay for on each set().
  if (!showWork) return null;

  // Built from the fields it reads rather than from the whole store, so it
  // re-derives when the geometry moves and not on every unrelated set().
  const d = buildAreaDerivation({ perimeterTraces, calibration, unit }, unit);

  // Nothing measured is not a working of zero — the Area card already says so.
  if (!d.gla.levels.length && !d.excluded.length) return null;

  const { scale, gla } = d;
  // Every area figure carries its unit: the card is copied into a document
  // where a bare number in a column has nothing to say what it measures. The
  // running figures are to the tenth, like the pieces they add; only the
  // reported total below is a whole unit, and it says so.
  const area = (value) => {
    const { value: v, suffix } = formatAreaTenths(value, unit);
    return `${v} ${suffix}`;
  };
  const headline = gla.measured
    ? formatAreaValue(gla.reported, unit)
    : formatAreaValue(d.grand.printed, unit);
  // The tenths add to one figure and the reported total rounds the raw sum
  // once, so the two can land a unit apart. Said out loud rather than left for
  // a reviewer to find with a calculator.
  const levelsDisagree = gla.measured && Math.round(gla.sumOfSubtotals) !== gla.reported;

  const copy = () => {
    navigator.clipboard.writeText(derivationText(d));
    flashStatus('Working copied to the clipboard');
  };

  return (
    <div id="dock-work">
      <Card title="How this area was calculated">
        <Section title="Scale">
          <p className="text-[12px] leading-snug text-fg-2">{scale.provenance}</p>
          {/* With no scale set the app falls back to a foot per pixel and goes
              on printing areas, so the assumption is named rather than denied.
              Saying "the figures are pixels only" over a column that is not
              pixels — and in metric is not the pixel count either — put two
              contradictory claims on the one card that must be checkable. */}
          {!scale.calibrated && (
            <p className="mt-1.5 text-[12px] leading-snug text-warn">
              The figures below therefore assume 1 pixel = 1 foot. They are not a
              measurement of the building.
            </p>
          )}
          <div className="mt-1.5">
            <Row
              label="Scale in force"
              value={scale.anisotropic
                ? `${scale.display.pxPerUnit.x.toFixed(2)} × ${scale.display.pxPerUnit.y.toFixed(2)} px/${scale.display.lengthUnit}`
                : `1 ${scale.display.lengthUnit} = ${scale.display.pxPerUnit.x.toFixed(2)} px`}
            />
          </div>
          {scale.note?.level === 'check' && (
            <p className="mt-2 text-[12px] leading-snug text-warn">{scale.note.detail}</p>
          )}
        </Section>

        {gla.levels.length > 0 && (
          <Section title={gla.levels.length === 1 ? 'Living area' : `Living area · ${gla.levels.length} levels`}>
            <div className="-mt-1">
              {gla.levels.map((level) => (
                <Level key={level.id ?? level.name} level={level} unit={unit}
                       single={gla.levels.length === 1} />
              ))}
            </div>
            {gla.levels.length > 1 && (
              <div className="pt-1.5 mt-1 border-t border-line">
                <Row label="Levels added" value={area(gla.sumOfSubtotals)} strong />
              </div>
            )}
          </Section>
        )}

        {/* Considered and left out, with its own working — a garage carved off
            the footprint is a figure somebody will be asked to justify, and
            silence here would read as if the outline had never been measured.
        */}
        {d.excluded.length > 0 && (
          <Section title="Not living area">
            <div className="-mt-1">
              {d.excluded.map((o) => (
                <Level key={o.id ?? o.name} level={{ ...o, name: `${o.name} · ${o.typeLabel}` }}
                       unit={unit} single={false} />
              ))}
            </div>
          </Section>
        )}

        {d.skipped.length > 0 && (
          <Section title="Not counted">
            {d.skipped.map((o) => (
              <p key={o.id ?? o.name} className="text-[12px] leading-snug text-fg-dim py-[3px]">
                {o.name} — {SKIPPED_REASON[o.skipped]}.
              </p>
            ))}
          </Section>
        )}

        <div className="mt-3 pt-2.5 border-t border-line">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] font-semibold text-fg">
              {gla.measured
                ? 'Total living area (rounded)'
                : 'Total · no living-area outline'}
            </span>
            <span className="font-mono tabular-nums text-[15px] font-bold text-fg">
              {headline.value} {headline.suffix}
            </span>
          </div>
          {levelsDisagree && (
            <p className="mt-1.5 text-[11.5px] leading-snug text-fg-dim">
              The levels above add to {formatAreaTenths(gla.sumOfSubtotals, unit).value}. The
              figure reported is the unrounded sum, {gla.unrounded.toFixed(1)}, rounded once —
              that is the one the Area card states.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={copy}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-md
                     border border-line bg-panel-2 text-[12.5px] text-fg-2 font-medium
                     hover:text-fg hover:border-accent/50 transition-colors cursor-pointer"
        >
          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
          Copy the working as text
        </button>
      </Card>
    </div>
  );
};

export default WorkCard;
