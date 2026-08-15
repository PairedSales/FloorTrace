import React from 'react';
import { Line, Rect, Circle } from 'react-konva';

// The warning the user picked in the panel, drawn over the trace it describes.
// Non-interactive by construction: it marks where to look and must never take
// a click away from the vertex handles underneath it.
const COLOR = '#FFB86C';

const WarningHighlightLayer = ({ anchor, scale }) => {
  if (!anchor || !(scale > 0)) return null;
  const stroke = 2 / scale;
  const dash = [8 / scale, 5 / scale];

  if (anchor.kind === 'ring') {
    return (
      <>
        {(anchor.rings ?? []).map((ring, i) => (
          <Line
            key={`warning-ring-${i}`}
            points={ring.flatMap((v) => [v.x, v.y])}
            stroke={COLOR}
            strokeWidth={stroke}
            dash={dash}
            closed
            listening={false}
            perfectDrawEnabled={false}
          />
        ))}
      </>
    );
  }

  if (anchor.kind === 'rect') {
    return (
      <Rect
        x={anchor.x}
        y={anchor.y}
        width={anchor.width}
        height={anchor.height}
        stroke={COLOR}
        strokeWidth={stroke}
        dash={dash}
        fill="rgba(255, 184, 108, 0.12)"
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  }

  // Open polylines, not closed rings: a bridged opening is a gap across the
  // outline and a run of weak support is a stretch along it. Drawn solid and
  // thicker than the dashed shapes above — these point at a specific place,
  // and the whole-outline anchors do not.
  if (anchor.kind === 'segment') {
    const runs = anchor.runs ?? (anchor.points ? [anchor.points] : []);
    return (
      <>
        {runs.map((run, i) => (
          <Line
            key={`warning-run-${i}`}
            points={(run ?? []).flatMap((v) => [v.x, v.y])}
            stroke={COLOR}
            strokeWidth={4 / scale}
            lineCap="round"
            lineJoin="round"
            listening={false}
            perfectDrawEnabled={false}
          />
        ))}
      </>
    );
  }

  if (anchor.kind === 'point') {
    return (
      <>
        {(anchor.points ?? []).map((p, i) => (
          <React.Fragment key={`warning-point-${i}`}>
            <Circle
              x={p.x}
              y={p.y}
              radius={14 / scale}
              stroke={COLOR}
              strokeWidth={stroke}
              listening={false}
              perfectDrawEnabled={false}
            />
            <Circle
              x={p.x}
              y={p.y}
              radius={3 / scale}
              fill={COLOR}
              listening={false}
              perfectDrawEnabled={false}
            />
          </React.Fragment>
        ))}
      </>
    );
  }

  return null;
};

export default React.memo(WarningHighlightLayer);
