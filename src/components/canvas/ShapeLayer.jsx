import React from 'react';
import { Group, Line, Circle } from 'react-konva';
import useAppStore from '../../store/appStore';
import { sqFeetToSqMeters } from '../../utils/unitConverter';
import { calculateArea, getCentroid } from '../../utils/areaCalculator';
import { SQ_M_TO_SQ_CM, MIN_SQ_M_DISPLAY } from './canvasUtils';
import { ACCENT, INK, PAPER, withAlpha } from './overlayStyle';
import CanvasTab from './CanvasTab';

/**
 * ShapeLayer renders completed custom shapes (closed polygons with area labels)
 * and the preview shape being drawn. In ink, like a measured length: an area
 * the user measured is not an outline and adds nothing to the total.
 */
const ShapeLayer = ({
  customShapes,
  currentCustomShape,
  currentMousePos,
  drawAreaActive,
  scale,
  feetPerPixel,
  unit,
  selectedCustomShapeIndex,
  onCustomShapeSelect,
  onCustomShapeDragEnd,
}) => {
  const canvasRotation = useAppStore((s) => s.canvasRotation);

  return (
    <>
      {/* Completed Custom Areas */}
      {customShapes && customShapes.length > 0 && (
        <Group>
          {customShapes.map((shape, shapeIndex) => {
            const selected = selectedCustomShapeIndex === shapeIndex;
            const color = selected ? ACCENT : INK;
            return (
            <Group
              key={`shape-${shapeIndex}`}
              x={0}
              y={0}
              draggable={shape.closed}
              onClick={(e) => onCustomShapeSelect(shapeIndex, e)}
              onTap={(e) => onCustomShapeSelect(shapeIndex, e)}
              onDragStart={(e) => onCustomShapeSelect(shapeIndex, e)}
              onDragEnd={(e) => onCustomShapeDragEnd(shapeIndex, e)}
            >
              <Line
                name="custom-shape"
                points={shape.vertices.flatMap(v => [v.x, v.y])}
                closed={shape.closed}
                fill={shape.closed ? withAlpha(color, 0.07) : 'transparent'}
                stroke={color}
                strokeWidth={(selected ? 3 : 2) / scale}
                dash={[8 / scale, 4 / scale]}
                perfectDrawEnabled={false}
              />
              {shape.closed && shape.vertices.map((vertex, vertexIndex) => (
                <Circle
                  key={`shape-${shapeIndex}-vertex-${vertexIndex}`}
                  name="custom-shape"
                  x={vertex.x}
                  y={vertex.y}
                  radius={4.5 / scale}
                  fill={PAPER}
                  stroke={color}
                  strokeWidth={2 / scale}
                />
              ))}
              {shape.closed && shape.vertices.length >= 3 && (() => {
                const centroid = getCentroid(shape.vertices);
                const areaValue = calculateArea(shape.vertices, feetPerPixel);
                let areaText;
                if (unit === 'metric') {
                  const sqMeters = sqFeetToSqMeters(areaValue);
                  areaText = sqMeters >= MIN_SQ_M_DISPLAY
                    ? `${sqMeters.toFixed(2)} m²`
                    : `${(sqMeters * SQ_M_TO_SQ_CM).toFixed(0)} cm²`;
                } else {
                  areaText = areaValue >= 1
                    ? `${areaValue.toFixed(1)} sq ft`
                    : `${(areaValue * 144).toFixed(0)} sq in`;
                }
                return (
                  <CanvasTab
                    name="custom-shape"
                    listening
                    x={centroid.x}
                    y={centroid.y}
                    text={areaText}
                    fontSize={14 / scale}
                    scale={scale}
                    rotation={canvasRotation}
                    color={color}
                  />
                );
              })()}
            </Group>
            );
          })}
        </Group>
      )}

      {/* Custom Shape (Draw Area Tool) Preview */}
      {drawAreaActive && currentCustomShape && currentMousePos && (
        <Group>
          <Line
            points={currentCustomShape.vertices.flatMap(v => [v.x, v.y]).concat(currentCustomShape.vertices.length > 0 ? [currentMousePos.x, currentMousePos.y] : [])}
            closed={false}
            stroke={INK}
            strokeWidth={2 / scale}
            dash={[6 / scale, 4 / scale]}
            perfectDrawEnabled={false}
          />
          {currentCustomShape.vertices.map((vertex, index) => (
            <Circle
              key={`current-shape-vertex-${index}`}
              x={vertex.x}
              y={vertex.y}
              radius={(index === 0 ? 6 : 4.5) / scale}
              // The first corner is the one to click again to finish.
              fill={index === 0 ? INK : PAPER}
              stroke={index === 0 ? PAPER : INK}
              strokeWidth={2 / scale}
            />
          ))}
        </Group>
      )}
    </>
  );
};

export default React.memo(ShapeLayer);
