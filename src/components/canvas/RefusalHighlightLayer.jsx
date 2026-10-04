import React from 'react';
import { Circle, Line } from 'react-konva';
import { CRIT, PAPER, withAlpha } from './overlayStyle';

// Where an edit was refused, drawn over the plan: the two edges that would
// have crossed. "That would make the outline cross itself" is unactionable on
// its own — the user has to find the crossing — so the words go to the action
// bar and the place goes here.
//
// Non-interactive by construction: it marks where to look and must never take
// a click away from the corner handles underneath it.

// Where two runs meet, when they are two plain segments that do. That point is
// the answer to "where?", and two long red lines across a plan do not give it.
const crossingOf = (runs) => {
  if (runs.length !== 2 || runs.some((run) => run?.length !== 2)) return null;
  const [[a, b], [c, d]] = runs;
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
};

const RefusalHighlightLayer = ({ anchor, scale }) => {
  if (!anchor || !(scale > 0)) return null;
  // Open polylines, one per edge involved (`findSelfIntersection`).
  const runs = anchor.runs ?? (anchor.points ? [anchor.points] : []);
  const at = crossingOf(runs);
  const arm = 4 / scale;
  return (
    <>
      {runs.map((run, i) => {
        const points = (run ?? []).flatMap((v) => [v.x, v.y]);
        return (
          <React.Fragment key={`refusal-run-${i}`}>
            <Line
              points={points}
              stroke={withAlpha(CRIT, 0.3)}
              strokeWidth={12 / scale}
              lineCap="round"
              lineJoin="round"
              listening={false}
              perfectDrawEnabled={false}
            />
            <Line
              points={points}
              stroke={CRIT}
              strokeWidth={2.5 / scale}
              lineCap="round"
              lineJoin="round"
              listening={false}
              perfectDrawEnabled={false}
            />
          </React.Fragment>
        );
      })}
      {at && (
        <>
          <Circle
            x={at.x}
            y={at.y}
            radius={10 / scale}
            fill={CRIT}
            stroke={PAPER}
            strokeWidth={2 / scale}
            listening={false}
            perfectDrawEnabled={false}
          />
          <Line
            points={[at.x - arm, at.y - arm, at.x + arm, at.y + arm]}
            stroke={PAPER}
            strokeWidth={2 / scale}
            lineCap="round"
            listening={false}
          />
          <Line
            points={[at.x + arm, at.y - arm, at.x - arm, at.y + arm]}
            stroke={PAPER}
            strokeWidth={2 / scale}
            lineCap="round"
            listening={false}
          />
        </>
      )}
    </>
  );
};

export default React.memo(RefusalHighlightLayer);
