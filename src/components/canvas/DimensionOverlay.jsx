import React, { useState } from 'react';
import { Group, Line, Text, Rect } from 'react-konva';
import useAppStore from '../../store/appStore';
import { formatLength, getUnitStyleFromDimensions } from '../../utils/unitConverter';
import { measureTextWidth, OCR_PILL_FONT_FAMILY, OCR_PILL_FONT_STYLE } from './canvasUtils';
import { PAPER, SCALE, SCALE_INK, SCALE_TINT } from './overlayStyle';
import { useIsTouch } from '../../hooks/useViewport';

// A button is 28 screen px tall at every zoom, because its type is sized in
// `/scale`. Wide enough for a finger, not tall enough for one — and tapping a
// button is how a room gets placed and the scale gets pinned to it, so a miss
// is the most expensive miss in the app. The drawn button stays as it is; only
// the hit box grows, and only vertically, where it is actually short.
const TOUCH_PILL_HEIGHT = 44;
const pillHit = (w, h, minH) => (ctx, shape) => {
  const height = Math.max(h, minH);
  ctx.beginPath();
  ctx.rect(0, (h - height) / 2, w, height);
  ctx.closePath();
  ctx.fillStrokeShape(shape);
};

/**
 * The room sizes FloorTrace read, drawn on the plan as buttons while the user
 * is choosing which room to take the scale from (`selectPickingRoom`).
 *
 * Each button sits directly under the size the plan prints, and says what was
 * read from it. Under, not over and not on top: with the print and the reading
 * one above the other a misread is seen before it is clicked, and a button
 * that covered the print would hide the only thing it can be checked against.
 * The room the scale is taken from now is the filled one, with a tick.
 */
const DimensionOverlay = ({
  visible,
  detectedDimensions,
  roomOverlay,
  scale,
  unit,
  stageRef,
  onDimensionSelect,
}) => {
  const canvasRotation = useAppStore((s) => s.canvasRotation);
  const isTouch = useIsTouch();
  const [overIndex, setOverIndex] = useState(null);

  if (!visible || !detectedDimensions || detectedDimensions.length === 0) return null;

  const unitStyle = getUnitStyleFromDimensions(detectedDimensions, unit);

  // "Under" on screen, which under a turned plan is not +y in the image.
  const rad = ((canvasRotation || 0) * Math.PI) / 180;
  const down = { x: Math.sin(rad), y: Math.cos(rad) };

  const room = roomOverlay ? {
    x1: Math.min(roomOverlay.x1, roomOverlay.x2),
    y1: Math.min(roomOverlay.y1, roomOverlay.y2),
    x2: Math.max(roomOverlay.x1, roomOverlay.x2),
    y2: Math.max(roomOverlay.y1, roomOverlay.y2),
  } : null;

  return (
    <>
      {detectedDimensions.map((dim, i) => {
        const cx = dim.bbox.x + dim.bbox.width / 2;
        const cy = dim.bbox.y + dim.bbox.height / 2;
        const labelText = dim.text
          ? dim.text.replace(/x/g, '×')
          : `${formatLength(dim.width, unit, unitStyle)} × ${formatLength(dim.height, unit, unitStyle)}`;
        const current = !!room && cx >= room.x1 && cx <= room.x2 && cy >= room.y1 && cy <= room.y2;
        const over = overIndex === i;

        const fs = 14 / scale;
        const padX = 12 / scale;
        const tick = current ? 16 / scale : 0;
        const labelW = measureTextWidth(labelText, fs) + padX * 2 + tick;
        const labelH = 28 / scale;
        // The print's own half-extent along the screen's vertical, then a gap.
        const reach = (Math.abs(down.x) * dim.bbox.width + Math.abs(down.y) * dim.bbox.height) / 2
          + 5 / scale + labelH / 2;
        const labelCx = cx + down.x * reach;
        const labelCy = cy + down.y * reach;

        const handleClick = () => onDimensionSelect && onDimensionSelect(dim);
        const handlePointerEnter = () => {
          setOverIndex(i);
          if (stageRef.current) stageRef.current.container().style.cursor = 'pointer';
        };
        const handlePointerLeave = () => {
          setOverIndex((held) => (held === i ? null : held));
          if (stageRef.current) stageRef.current.container().style.cursor = 'default';
        };

        return (
          <Group key={i} x={labelCx} y={labelCy} rotation={-canvasRotation}>
            <Rect
              x={-labelW / 2}
              y={-labelH / 2}
              width={labelW}
              height={labelH}
              fill={current ? SCALE : over ? SCALE_TINT : PAPER}
              stroke={SCALE}
              strokeWidth={(current || over ? 2 : 1.5) / scale}
              cornerRadius={labelH / 2}
              hitFunc={isTouch ? pillHit(labelW, labelH, TOUCH_PILL_HEIGHT / scale) : undefined}
              onClick={handleClick}
              onTap={handleClick}
              onMouseEnter={handlePointerEnter}
              onMouseLeave={handlePointerLeave}
            />
            {current && (
              <Line
                points={[
                  -labelW / 2 + padX, 0,
                  -labelW / 2 + padX + 3.5 / scale, 3.5 / scale,
                  -labelW / 2 + padX + 10 / scale, -4 / scale,
                ]}
                stroke={PAPER}
                strokeWidth={2 / scale}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            )}
            <Text
              x={-labelW / 2 + tick}
              y={-labelH / 2}
              width={labelW - tick}
              height={labelH}
              text={labelText}
              fontSize={fs}
              fill={current ? PAPER : SCALE_INK}
              fontFamily={OCR_PILL_FONT_FAMILY}
              fontStyle={OCR_PILL_FONT_STYLE}
              align="center"
              verticalAlign="middle"
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
};

export default React.memo(DimensionOverlay);
