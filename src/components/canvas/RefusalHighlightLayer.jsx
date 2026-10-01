import React from 'react';
import { Line } from 'react-konva';

// Where an edit was refused, drawn over the plan: the two edges that would
// have crossed. "That would make the outline cross itself" is unactionable on
// its own — the user has to find the crossing — so the words go to the action
// bar and the place goes here.
//
// Non-interactive by construction: it marks where to look and must never take
// a click away from the corner handles underneath it.
const COLOR = '#FFB86C';

const RefusalHighlightLayer = ({ anchor, scale }) => {
  if (!anchor || !(scale > 0)) return null;
  // Open polylines, one per edge involved (`findSelfIntersection`).
  const runs = anchor.runs ?? (anchor.points ? [anchor.points] : []);
  return (
    <>
      {runs.map((run, i) => (
        <Line
          key={`refusal-run-${i}`}
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
};

export default React.memo(RefusalHighlightLayer);
