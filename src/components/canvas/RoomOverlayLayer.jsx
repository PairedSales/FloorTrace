import React, { useState } from 'react';
import { Rect, Line, Group, Text } from 'react-konva';
import useAppStore from '../../store/appStore';
import { useIsTouch } from '../../hooks/useViewport';
import { measureSideLenWidth, SIDE_LEN_FONT_FAMILY, SIDE_LEN_FONT_STYLE } from './canvasUtils';
import { PAPER, SCALE, withAlpha } from './overlayStyle';

// Same rule as the perimeter vertex handles: what is drawn stays small enough
// to read the rectangle under it, what is grabbable is a fingertip wide. This
// overlay is what the whole project's scale is measured from, so a corner that
// cannot be adjusted on a phone is a scale that cannot be corrected there.
const TOUCH_HIT_RADIUS = 24;

const LABEL = 'Scale room';

/**
 * The room the scale was taken from — "the green box" the panel's scale step
 * talks about — with its name on it, so the box explains itself on the plan.
 *
 * It is a tinted box with a label and a solid corner bracket on each corner,
 * always drawn: the corners are how the scale is corrected, and the brackets
 * keep them apart from the outline's ring-shaped corners.
 */
const RoomOverlayLayer = ({
  roomOverlay,
  scale,
  onRoomMouseDown,
  onRoomCornerMouseDown,
}) => {
  const isTouch = useIsTouch();
  const canvasRotation = useAppStore((s) => s.canvasRotation);
  const [over, setOver] = useState(false);

  if (!roomOverlay) return null;

  const x = Math.min(roomOverlay.x1, roomOverlay.x2);
  const y = Math.min(roomOverlay.y1, roomOverlay.y2);
  const width = Math.abs(roomOverlay.x2 - roomOverlay.x1);
  const height = Math.abs(roomOverlay.y2 - roomOverlay.y1);
  const shown = over || isTouch;

  // The label hangs from whichever corner is top-left on screen, which under a
  // turned plan is not the image's top-left.
  const rad = ((canvasRotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const corners = [
    { x, y }, { x: x + width, y }, { x, y: y + height }, { x: x + width, y: y + height },
  ];
  const anchor = corners.reduce((best, p) => {
    const rank = (q) => (q.x * cos - q.y * sin) + (q.x * sin + q.y * cos);
    return rank(p) < rank(best) ? p : best;
  });
  const fontSize = 13 / scale;
  const labelWidth = measureSideLenWidth(LABEL, fontSize) + 16 / scale;
  const labelHeight = fontSize * 1.55;

  const enter = () => setOver(true);
  const leave = () => setOver(false);

  return (
    <>
      {Array.isArray(roomOverlay.polygon) && roomOverlay.polygon.length > 2 && (
        <Line
          points={roomOverlay.polygon.flatMap((point) => [point.x, point.y])}
          closed
          stroke={withAlpha(SCALE, 0.7)}
          strokeWidth={1.25 / scale}
          dash={[4 / scale, 4 / scale]}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        stroke={SCALE}
        strokeWidth={(shown ? 2.25 : 1.75) / scale}
        // Always tinted, so the room reads as the scale's at a glance — and never
        // empty: the whole room is the handle for moving it, and a shape with no
        // fill is only its stroke to a press.
        fill={withAlpha(SCALE, 0.07)}
        onMouseDown={onRoomMouseDown}
        onTouchStart={onRoomMouseDown}
        onMouseEnter={enter}
        onMouseLeave={leave}
        perfectDrawEnabled={false}
      />

      <Group x={anchor.x} y={anchor.y} rotation={-canvasRotation} listening={false}>
        <Rect
          width={labelWidth}
          height={labelHeight}
          fill={SCALE}
          cornerRadius={[0, 0, 7 / scale, 0]}
          perfectDrawEnabled={false}
        />
        <Text
          width={labelWidth}
          height={labelHeight}
          text={LABEL}
          fontSize={fontSize}
          fill={PAPER}
          fontFamily={SIDE_LEN_FONT_FAMILY}
          fontStyle={SIDE_LEN_FONT_STYLE}
          align="center"
          verticalAlign="middle"
        />
      </Group>

      {/* Room Corner Handles: an L of solid green on each corner, always drawn,
          running along the two walls it joins. Brackets, not the outline's
          rings, so a scale corner is never mistaken for an outline corner. */}
      {[
        { x: roomOverlay.x1, y: roomOverlay.y1, dx: roomOverlay.x2 - roomOverlay.x1, dy: roomOverlay.y2 - roomOverlay.y1, corner: 'tl' },
        { x: roomOverlay.x2, y: roomOverlay.y1, dx: roomOverlay.x1 - roomOverlay.x2, dy: roomOverlay.y2 - roomOverlay.y1, corner: 'tr' },
        { x: roomOverlay.x1, y: roomOverlay.y2, dx: roomOverlay.x2 - roomOverlay.x1, dy: roomOverlay.y1 - roomOverlay.y2, corner: 'bl' },
        { x: roomOverlay.x2, y: roomOverlay.y2, dx: roomOverlay.x1 - roomOverlay.x2, dy: roomOverlay.y1 - roomOverlay.y2, corner: 'br' }
      ].map((handle) => {
        // The arms point into the room and never run past a third of a side.
        const arm = Math.min((isTouch ? 22 : 16) / scale, width / 3, height / 3);
        const ax = Math.sign(handle.dx) * arm;
        const ay = Math.sign(handle.dy) * arm;
        const points = [ax, 0, 0, 0, 0, ay];
        const reach = (isTouch ? TOUCH_HIT_RADIUS : 14) / scale;
        return (
          <Group
            key={handle.corner}
            x={handle.x}
            y={handle.y}
            onMouseDown={(e) => onRoomCornerMouseDown(handle.corner, e)}
            onTouchStart={(e) => onRoomCornerMouseDown(handle.corner, e)}
            onMouseEnter={enter}
            onMouseLeave={leave}
          >
            {/* The grabbable region: a fingertip around the corner, invisible. */}
            <Rect x={-reach} y={-reach} width={reach * 2} height={reach * 2} fill="rgba(0,0,0,0.001)" />
            {/* A white casing keeps the bracket readable over the plan's ink. */}
            <Line points={points} stroke={PAPER} strokeWidth={6 / scale} lineCap="square" lineJoin="miter" listening={false} perfectDrawEnabled={false} />
            <Line points={points} stroke={SCALE} strokeWidth={3.5 / scale} lineCap="square" lineJoin="miter" listening={false} perfectDrawEnabled={false} />
          </Group>
        );
      })}
    </>
  );
};

export default React.memo(RoomOverlayLayer);
