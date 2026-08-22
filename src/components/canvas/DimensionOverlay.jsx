import React from 'react';
import { Line, Circle, Text, Rect } from 'react-konva';
import useAppStore from '../../store/appStore';
import { formatLength, getUnitStyleFromDimensions } from '../../utils/unitConverter';
import { measureTextWidth, OCR_PILL_FONT_FAMILY, OCR_PILL_FONT_STYLE, OCR_DOT_BASE_RADIUS, OCR_DOT_MIN_RADIUS } from './canvasUtils';
import { useIsTouch } from '../../hooks/useViewport';

// A pill is ~19 screen px tall at every zoom, because its type is sized in
// `/scale`. Wide enough for a finger, less than half as tall as one — and
// tapping a pill is how a room gets placed and the scale gets pinned to it, so
// a miss is the most expensive miss in the app. The drawn pill stays as it is;
// only the hit box grows, and only vertically, where it is actually short.
const TOUCH_PILL_HEIGHT = 44;
const pillHit = (w, h, minH) => (ctx, shape) => {
  const height = Math.max(h, minH);
  ctx.beginPath();
  ctx.rect(0, (h - height) / 2, w, height);
  ctx.closePath();
  ctx.fillStrokeShape(shape);
};

/**
 * DimensionOverlay renders OCR-detected dimension pills, anchor dots, and connector
 * lines in manual mode.
 */
const DimensionOverlay = ({
  mode,
  detectedDimensions,
  scale,
  unit,
  stageRef,
  onDimensionSelect,
}) => {
  const canvasRotation = useAppStore((s) => s.canvasRotation);
  const isTouch = useIsTouch();

  if (mode !== 'manual' || !detectedDimensions || detectedDimensions.length === 0) return null;

  const unitStyle = getUnitStyleFromDimensions(detectedDimensions, unit);

  return (
    <>
      {detectedDimensions.map((dim, i) => {
        const cx = dim.bbox.x + dim.bbox.width / 2;
        const cy = dim.bbox.y + dim.bbox.height / 2;
        const labelText = dim.text 
          ? dim.text.replace(/x/g, '×') 
          : `${formatLength(dim.width, unit, unitStyle)} × ${formatLength(dim.height, unit, unitStyle)}`;
        const fs = 12 / scale;
        const padX = 7 / scale;
        const padY = 3.5 / scale;
        const labelW = measureTextWidth(labelText, fs) + padX * 2;
        const labelH = fs + padY * 2;
        const cornerR = labelH / 2;
        const gap = 5 / scale;
        const tailH = 5 / scale;
        const labelY = Math.max(0, dim.bbox.y - labelH - tailH - gap);
        const labelX = cx - labelW / 2;
        const labelCx = labelX + labelW / 2;
        const labelCy = labelY + labelH / 2;
        const dotR = Math.max(OCR_DOT_MIN_RADIUS, OCR_DOT_BASE_RADIUS / scale);
        const handleClick = () => onDimensionSelect && onDimensionSelect(dim);
        const handlePointerEnter = () => { if (stageRef.current) stageRef.current.container().style.cursor = 'pointer'; };
        const handlePointerLeave = () => { if (stageRef.current) stageRef.current.container().style.cursor = 'default'; };

        return (
          <React.Fragment key={i}>
            <Circle
              x={cx}
              y={cy}
              radius={dotR}
              fill="#FFB86C"
              onClick={handleClick}
              onTap={handleClick}
              onMouseEnter={handlePointerEnter}
              onMouseLeave={handlePointerLeave}
            />
            <Line
              points={[cx, cy - dotR, cx, labelY + labelH]}
              stroke="#FFB86C"
              strokeWidth={1.5 / scale}
              opacity={0.6}
              listening={false}
            />
            <Rect
              x={labelCx}
              y={labelCy}
              width={labelW}
              height={labelH}
              offsetX={labelW / 2}
              offsetY={labelH / 2}
              rotation={-canvasRotation}
              fill="#FFB86C"
              cornerRadius={cornerR}
              hitFunc={isTouch ? pillHit(labelW, labelH, TOUCH_PILL_HEIGHT / scale) : undefined}
              onClick={handleClick}
              onTap={handleClick}
              onMouseEnter={handlePointerEnter}
              onMouseLeave={handlePointerLeave}
            />
            <Text
              x={labelCx}
              y={labelCy}
              width={labelW}
              height={labelH}
              offsetX={labelW / 2}
              offsetY={labelH / 2}
              rotation={-canvasRotation}
              text={labelText}
              fontSize={fs}
              // Dracula Background on Dracula Orange, 8.36:1. White on this pill
              // was 1.70:1 — the least legible label in the app, on the tap
              // target the project's scale is taken from.
              fill="#282A36"
              fontFamily={OCR_PILL_FONT_FAMILY}
              fontStyle={OCR_PILL_FONT_STYLE}
              align="center"
              verticalAlign="middle"
              listening={false}
            />
          </React.Fragment>
        );
      })}
    </>
  );
};

export default React.memo(DimensionOverlay);
