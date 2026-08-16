import React from 'react';
import { Rect, Line, Circle } from 'react-konva';
import { useIsTouch } from '../../hooks/useViewport';

// Same rule as the perimeter vertex handles: what is drawn stays small enough
// to read the rectangle under it, what is grabbable is a fingertip wide. This
// overlay is what the whole project's scale is measured from, so a corner that
// cannot be adjusted on a phone is a scale that cannot be corrected there.
const TOUCH_HIT_RADIUS = 24;

const circleHit = (radius) => (ctx, shape) => {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStrokeShape(shape);
};

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
  const isTouch = useIsTouch();

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
        onMouseDown={onRoomMouseDown}
        onTouchStart={onRoomMouseDown}
        perfectDrawEnabled={false}
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
          radius={(isTouch ? 8 : 5) / scale}
          fill="#50FA7B"
          stroke="#fff"
          strokeWidth={1.5 / scale}
          hitFunc={isTouch ? circleHit(TOUCH_HIT_RADIUS / scale) : undefined}
          onMouseDown={(e) => onRoomCornerMouseDown(handle.corner, e)}
          onTouchStart={(e) => onRoomCornerMouseDown(handle.corner, e)}
        />
      ))}
    </>
  );
};

export default React.memo(RoomOverlayLayer);
