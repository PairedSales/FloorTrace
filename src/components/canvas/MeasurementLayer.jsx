import React from 'react';
import { Layer, Group, Line, Text } from 'react-konva';
import { getMeasurementLineLayout, LINE_COLORS } from './canvasUtils';

/**
 * MeasurementLayer renders completed measurement lines and their labels,
 * plus the preview line being drawn.
 */
const MeasurementLayer = ({
  measurementLines,
  currentMeasurementLine,
  lineToolActive,
  scale,
  pixelsPerFoot,
  unit,
  selectedMeasurementLineIndex,
  onMeasurementLineSelect,
  onMeasurementLineDragEnd,
  onMeasurementLinesChange,
}) => {
  return (
    <>
      {/* Completed Measurement Lines */}
      {measurementLines && measurementLines.length > 0 && (
        <Layer>
          {measurementLines.map((line, index) => {
            const layout = getMeasurementLineLayout(line, scale, pixelsPerFoot, unit);
            const colors = LINE_COLORS[index % LINE_COLORS.length];
            const strokeColor = selectedMeasurementLineIndex === index ? colors.selected : colors.normal;
            const strokeW = (selectedMeasurementLineIndex === index ? 3 : 2) / scale;
            return (
            <Group
              key={`line-${index}`}
              x={0}
              y={0}
              draggable
              onClick={(e) => onMeasurementLineSelect(index, e)}
              onTap={(e) => onMeasurementLineSelect(index, e)}
              onDragStart={(e) => onMeasurementLineSelect(index, e)}
              onDragEnd={(e) => onMeasurementLineDragEnd(index, e)}
              onContextMenu={(e) => {
                e.evt.preventDefault();
                e.cancelBubble = true;
                if (onMeasurementLinesChange) {
                  onMeasurementLinesChange(measurementLines.filter((_, i) => i !== index));
                }
              }}
            >
              <Line
                name="measurement-line"
                points={layout.line1Points}
                stroke={strokeColor}
                strokeWidth={strokeW}
                hitStrokeWidth={16 / scale}
              />
              <Line
                name="measurement-line"
                points={layout.line2Points}
                stroke={strokeColor}
                strokeWidth={strokeW}
                hitStrokeWidth={16 / scale}
              />
              <Text
                name="measurement-line"
                x={layout.labelX}
                y={layout.labelY}
                text={layout.textStr}
                fontSize={layout.fontSize}
                fill={strokeColor}
                fontStyle="bold"
                offsetX={layout.approxTextWidth / 2}
                offsetY={layout.approxTextHeight / 2}
              />
            </Group>
            );
          })}
        </Layer>
      )}

      {/* Measurement Line Preview */}
      {lineToolActive && currentMeasurementLine && (() => {
        const previewColors = LINE_COLORS[measurementLines.length % LINE_COLORS.length];
        const previewColor = previewColors.normal;
        const dx = currentMeasurementLine.end.x - currentMeasurementLine.start.x;
        const dy = currentMeasurementLine.end.y - currentMeasurementLine.start.y;
        const minPreviewLength = 1;
        const hasLength = Math.sqrt(dx * dx + dy * dy) > minPreviewLength;
        const previewLayout = hasLength && pixelsPerFoot
          ? getMeasurementLineLayout(currentMeasurementLine, scale, pixelsPerFoot, unit, { forceAbove: true })
          : null;
        return (
          <Layer>
            <Line
              points={[
                currentMeasurementLine.start.x,
                currentMeasurementLine.start.y,
                currentMeasurementLine.end.x,
                currentMeasurementLine.end.y
              ]}
              stroke={previewColor}
              strokeWidth={2 / scale}
              dash={[6 / scale, 3 / scale]}
              opacity={0.7}
            />
            {previewLayout && (
              <Text
                x={previewLayout.labelX}
                y={previewLayout.labelY}
                text={previewLayout.textStr}
                fontSize={previewLayout.fontSize}
                fill={previewColor}
                fontStyle="bold"
                offsetX={previewLayout.approxTextWidth / 2}
                offsetY={previewLayout.approxTextHeight / 2}
                opacity={0.9}
              />
            )}
          </Layer>
        );
      })()}
    </>
  );
};

export default React.memo(MeasurementLayer);
