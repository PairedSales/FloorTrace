import React from 'react';
import { Rect, Line, Circle } from 'react-konva';

/**
 * RoomOverlayLayer renders the room detection rectangle, its corner drag handles,
 * and the optional polygon outline.
 */
const RoomOverlayLayer = ({
  roomOverlay,
  scale,
  onRoomMouseDown,
  onRoomCornerMouseDown,
}) => {
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
        onMouseDown={onRoomMouseDown}
      />
      
      {/* Room Corner Handles */}
      {[
        { x: roomOverlay.x1, y: roomOverlay.y1, corner: 'tl' },
        { x: roomOverlay.x2, y: roomOverlay.y1, corner: 'tr' },
        { x: roomOverlay.x1, y: roomOverlay.y2, corner: 'bl' },
        { x: roomOverlay.x2, y: roomOverlay.y2, corner: 'br' }
      ].map((handle, i) => (
        <Circle
          key={i}
          x={handle.x}
          y={handle.y}
          radius={5 / scale}
          fill="#50FA7B"
          stroke="#fff"
          strokeWidth={1.5 / scale}
          onMouseDown={(e) => onRoomCornerMouseDown(handle.corner, e)}
        />
      ))}
    </>
  );
};

export default React.memo(RoomOverlayLayer);
