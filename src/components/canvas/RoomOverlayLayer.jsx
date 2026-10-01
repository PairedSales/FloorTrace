import React from 'react';
import { Rect, Line } from 'react-konva';

/**
 * The room the scale was taken from, as a green box. Shown, not edited: a
 * different room is picked from the room sizes on the plan, and a misread size
 * is corrected in the panel.
 */
const RoomOverlayLayer = ({ roomOverlay, scale }) => {
  if (!roomOverlay) return null;

  return (
    <>
      {Array.isArray(roomOverlay.polygon) && roomOverlay.polygon.length > 2 && (
        <Line
          points={roomOverlay.polygon.flatMap((point) => [point.x, point.y])}
          closed
          stroke="rgba(80, 250, 123, 0.85)"
          strokeWidth={1.5 / scale}
          fill="rgba(80, 250, 123, 0.1)"
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      <Rect
        x={Math.min(roomOverlay.x1, roomOverlay.x2)}
        y={Math.min(roomOverlay.y1, roomOverlay.y2)}
        width={Math.abs(roomOverlay.x2 - roomOverlay.x1)}
        height={Math.abs(roomOverlay.y2 - roomOverlay.y1)}
        stroke="#50FA7B"
        strokeWidth={2 / scale}
        fill="rgba(80, 250, 123, 0.15)"
        listening={false}
        perfectDrawEnabled={false}
      />
    </>
  );
};

export default React.memo(RoomOverlayLayer);
