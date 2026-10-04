import React from 'react';
import { Group, Line, Circle } from 'react-konva';
import useAppStore from '../../store/appStore';
import { getMeasurementLineLayout } from './canvasUtils';
import { ACCENT, INK, PAPER } from './overlayStyle';
import CanvasTab from './CanvasTab';

// A length the user measured is drawn in ink, every one of them. They used to
// cycle through five colours, two of which were the colours of outline types —
// and a measurement must never be taken for an outline. What tells it from the
// plan's own black lines is the white casing under it and the round ends.
const endsOf = (line) => [line.start.x, line.start.y, line.end.x, line.end.y];

/**
 * MeasurementLayer renders completed measurement lines and their labels,
 * plus the preview line being drawn.
 */
const MeasurementLayer = ({
  measurementLines,
  currentMeasurementLine,
  lineToolActive,
  scale,
  feetPerPixel,
  unit,
  unitStyle,
  selectedMeasurementLineIndex,
  onMeasurementLineSelect,
  onMeasurementLineDragEnd,
  onMeasurementLinesChange,
}) => {
  const canvasRotation = useAppStore((s) => s.canvasRotation);

  return (
    <>
      {/* Completed Measurement Lines */}
      {measurementLines && measurementLines.length > 0 && (
        <Group>
          {measurementLines.map((line, index) => {
            const layout = getMeasurementLineLayout(line, scale, feetPerPixel, unit, { unitStyle });
            const selected = selectedMeasurementLineIndex === index;
            const color = selected ? ACCENT : INK;
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
                points={endsOf(line)}
                stroke={PAPER}
                strokeWidth={7 / scale}
                lineCap="round"
                hitStrokeWidth={16 / scale}
                perfectDrawEnabled={false}
              />
              <Line
                name="measurement-line"
                points={endsOf(line)}
                stroke={color}
                strokeWidth={(selected ? 3.5 : 2.5) / scale}
                hitStrokeWidth={16 / scale}
                perfectDrawEnabled={false}
              />
              {[line.start, line.end].map((end, i) => (
                <Circle
                  key={i}
                  name="measurement-line"
                  x={end.x}
                  y={end.y}
                  radius={4.5 / scale}
                  fill={PAPER}
                  stroke={color}
                  strokeWidth={2 / scale}
                  perfectDrawEnabled={false}
                />
              ))}
              <CanvasTab
                name="measurement-line"
                listening
                x={layout.labelX}
                y={layout.labelY}
                text={layout.textStr}
                fontSize={layout.fontSize}
                scale={scale}
                rotation={canvasRotation}
                color={color}
              />
            </Group>
            );
          })}
        </Group>
      )}

      {/* Measurement Line Preview */}
      {lineToolActive && currentMeasurementLine && (() => {
        const dx = currentMeasurementLine.end.x - currentMeasurementLine.start.x;
        const dy = currentMeasurementLine.end.y - currentMeasurementLine.start.y;
        const minPreviewLength = 1;
        const hasLength = Math.sqrt(dx * dx + dy * dy) > minPreviewLength;
        const previewLayout = hasLength && feetPerPixel
          ? getMeasurementLineLayout(currentMeasurementLine, scale, feetPerPixel, unit, { forceAbove: true, unitStyle })
          : null;
        return (
          <Group listening={false}>
            <Line
              points={endsOf(currentMeasurementLine)}
              stroke={PAPER}
              strokeWidth={6 / scale}
              lineCap="round"
              perfectDrawEnabled={false}
            />
            <Line
              points={endsOf(currentMeasurementLine)}
              stroke={INK}
              strokeWidth={2 / scale}
              dash={[6 / scale, 4 / scale]}
              perfectDrawEnabled={false}
            />
            {previewLayout && (
              <CanvasTab
                x={previewLayout.labelX}
                y={previewLayout.labelY}
                text={previewLayout.textStr}
                fontSize={previewLayout.fontSize}
                scale={scale}
                rotation={canvasRotation}
                color={INK}
              />
            )}
          </Group>
        );
      })()}
    </>
  );
};

export default React.memo(MeasurementLayer);
