import React from 'react';
import { Group, Line, Circle } from 'react-konva';
import useAppStore from '../../store/appStore';
import { getMeasurementLineLayout } from './canvasUtils';
import { PAPER, PENDING, SCALE, SCALE_INK } from './overlayStyle';
import CanvasTab from './CanvasTab';

// Scale lines get their own colour rather than the ink of a measurement: they
// are not measurements of the drawing, they are the assertion the drawing is
// measured by. It is the green of the scale room, because the two say the same
// thing — "the scale came from here".

// The one thing this adds over the measurement renderer: before a scale exists
// `feetPerPixel` still defaults to {x:1, y:1}, so a length in feet would read
// as a confident and completely wrong number. Until then the line states what
// it actually knows, which is pixels.
const relabel = (layout, text) => ({ ...layout, textStr: text });

const endsOf = (line) => [line.start.x, line.start.y, line.end.x, line.end.y];

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
            const color = selected
              ? SCALE_INK
              : line.feet > 0 ? SCALE : PENDING;
            return (
              <Group
                key={line.id ?? `scale-${index}`}
                onClick={(e) => onScaleLineSelect?.(index, e)}
                onTap={(e) => onScaleLineSelect?.(index, e)}
              >
                <Line
                  name="scale-line"
                  points={endsOf(line)}
                  stroke={PAPER}
                  strokeWidth={7 / scale}
                  lineCap="round"
                  hitStrokeWidth={16 / scale}
                  perfectDrawEnabled={false}
                />
                <Line
                  name="scale-line"
                  points={endsOf(line)}
                  stroke={color}
                  strokeWidth={(selected ? 3.5 : 2.5) / scale}
                  hitStrokeWidth={16 / scale}
                  perfectDrawEnabled={false}
                />
                {[line.start, line.end].map((end, i) => (
                  <Circle
                    key={i}
                    name="scale-line"
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
                  name="scale-line"
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
          <Group listening={false}>
            <Line
              points={endsOf(currentScaleLine)}
              stroke={PAPER}
              strokeWidth={6 / scale}
              lineCap="round"
              perfectDrawEnabled={false}
            />
            <Line
              points={endsOf(currentScaleLine)}
              stroke={SCALE}
              strokeWidth={2 / scale}
              dash={[6 / scale, 4 / scale]}
              perfectDrawEnabled={false}
            />
            {layout && (
              <CanvasTab
                x={layout.labelX}
                y={layout.labelY}
                text={layout.textStr}
                fontSize={layout.fontSize}
                scale={scale}
                rotation={canvasRotation}
                color={SCALE}
              />
            )}
          </Group>
        );
      })()}
    </>
  );
};

export default React.memo(ScaleLineLayer);
