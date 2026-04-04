import React from 'react';
import { Line, Circle, Text, Rect } from 'react-konva';
import { formatLength } from '../../utils/unitConverter';
import { measureTextWidth, OCR_PILL_FONT_FAMILY, OCR_PILL_FONT_STYLE, OCR_DOT_BASE_RADIUS, OCR_DOT_MIN_RADIUS } from './canvasUtils';

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
  if (mode !== 'manual' || !detectedDimensions || detectedDimensions.length === 0) return null;

  return (
    <>
      {detectedDimensions.map((dim, i) => {
        const cx = dim.bbox.x + dim.bbox.width / 2;
        const cy = dim.bbox.y + dim.bbox.height / 2;
        const labelText = `${formatLength(dim.width, unit)} × ${formatLength(dim.height, unit)}`;
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
              x={labelX}
              y={labelY}
              width={labelW}
              height={labelH}
              fill="#FFB86C"
              cornerRadius={cornerR}
              onClick={handleClick}
              onTap={handleClick}
              onMouseEnter={handlePointerEnter}
              onMouseLeave={handlePointerLeave}
            />
            <Text
              x={labelX + padX}
              y={labelY + padY}
              text={labelText}
              fontSize={fs}
              fill="#ffffff"
              fontFamily={OCR_PILL_FONT_FAMILY}
              fontStyle={OCR_PILL_FONT_STYLE}
              listening={false}
            />
          </React.Fragment>
        );
      })}
    </>
  );
};

export default React.memo(DimensionOverlay);
