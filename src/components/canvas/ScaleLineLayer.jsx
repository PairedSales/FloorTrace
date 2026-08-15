import React from 'react';
import { Group, Line, Text, Circle } from 'react-konva';
import useAppStore from '../../store/appStore';
import { getMeasurementLineLayout } from './canvasUtils';

// Scale lines get their own colour rather than a slot in LINE_COLORS: they are
// not measurements of the drawing, they are the assertion the drawing is
// measured by, and cycling them alongside measurement lines made the two
// indistinguishable.
const SCALE_COLOR = '#F1FA8C';
const SCALE_COLOR_SELECTED = '#FFFFC2';
const SCALE_COLOR_PENDING = '#6272A4';

// The one thing this adds over the measurement renderer: before a scale exists
// `feetPerPixel` still defaults to {x:1, y:1}, so a length in feet would read
// as a confident and completely wrong number. Until then the line states what
// it actually knows, which is pixels.
const relabel = (layout, text) => {
  const approxTextWidth = Math.max(text.length * layout.fontSize * 0.58, layout.fontSize * 2.5);
  return { ...layout, textStr: text, approxTextWidth };
};

const ScaleLineLayer = ({
  scaleLines,
  currentScaleLine,
  scaleToolActive,
  calibrated,
  scale,
  feetPerPixel,
  unit,
  unitStyle,
  selectedScaleLineIndex,
  onScaleLineSelect,
}) => {
  const canvasRotation = useAppStore((s) => s.canvasRotation);
  const fpp = feetPerPixel || { x: 1, y: 1 };

  const labelFor = (line, layout) => {
    const lenPx = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
    if (line.feet > 0) return relabel(layout, `${Number(line.feet.toFixed(2))} ft`);
    if (!calibrated) return relabel(layout, `${Math.round(lenPx)} px`);
    return layout;
  };

  return (
    <>
      {scaleLines && scaleLines.length > 0 && (
        <Group>
          {scaleLines.map((line, index) => {
            const base = getMeasurementLineLayout(line, scale, fpp, unit, { unitStyle });
            const layout = labelFor(line, base);
            const selected = selectedScaleLineIndex === index;
            const strokeColor = selected
              ? SCALE_COLOR_SELECTED
              : line.feet > 0 ? SCALE_COLOR : SCALE_COLOR_PENDING;
            const strokeW = (selected ? 3 : 2) / scale;
            return (
              <Group
                key={line.id ?? `scale-${index}`}
                onClick={(e) => onScaleLineSelect?.(index, e)}
                onTap={(e) => onScaleLineSelect?.(index, e)}
              >
                <Line
                  name="scale-line"
                  points={layout.line1Points}
                  stroke={strokeColor}
                  strokeWidth={strokeW}
                  hitStrokeWidth={16 / scale}
                  perfectDrawEnabled={false}
                />
                <Line
                  name="scale-line"
                  points={layout.line2Points}
                  stroke={strokeColor}
                  strokeWidth={strokeW}
                  hitStrokeWidth={16 / scale}
                  perfectDrawEnabled={false}
                />
                <Circle
                  name="scale-line"
                  x={line.start.x}
                  y={line.start.y}
                  radius={3.5 / scale}
                  fill={strokeColor}
                  perfectDrawEnabled={false}
                />
                <Circle
                  name="scale-line"
                  x={line.end.x}
                  y={line.end.y}
                  radius={3.5 / scale}
                  fill={strokeColor}
                  perfectDrawEnabled={false}
                />
                <Text
                  name="scale-line"
                  x={layout.labelX}
                  y={layout.labelY}
                  text={layout.textStr}
                  fontSize={layout.fontSize}
                  fill={strokeColor}
                  fontStyle="bold"
                  offsetX={layout.approxTextWidth / 2}
                  offsetY={layout.approxTextHeight / 2}
                  rotation={-canvasRotation}
                />
              </Group>
            );
          })}
        </Group>
      )}

      {scaleToolActive && currentScaleLine && (() => {
        const dx = currentScaleLine.end.x - currentScaleLine.start.x;
        const dy = currentScaleLine.end.y - currentScaleLine.start.y;
        const lenPx = Math.hypot(dx, dy);
        const base = lenPx > 1
          ? getMeasurementLineLayout(currentScaleLine, scale, fpp, unit, { forceAbove: true, unitStyle })
          : null;
        const layout = base
          ? (calibrated ? base : relabel(base, `${Math.round(lenPx)} px`))
          : null;
        return (
          <Group>
            <Line
              points={[
                currentScaleLine.start.x,
                currentScaleLine.start.y,
                currentScaleLine.end.x,
                currentScaleLine.end.y
              ]}
              stroke={SCALE_COLOR}
              strokeWidth={2 / scale}
              dash={[6 / scale, 3 / scale]}
              opacity={0.8}
              perfectDrawEnabled={false}
            />
            {layout && (
              <Text
                x={layout.labelX}
                y={layout.labelY}
                text={layout.textStr}
                fontSize={layout.fontSize}
                fill={SCALE_COLOR}
                fontStyle="bold"
                offsetX={layout.approxTextWidth / 2}
                offsetY={layout.approxTextHeight / 2}
                opacity={0.9}
                rotation={-canvasRotation}
              />
            )}
          </Group>
        );
      })()}
    </>
  );
};

export default React.memo(ScaleLineLayer);
