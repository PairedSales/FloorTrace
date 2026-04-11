import React from 'react';
import { Layer, Group, Line, Circle, Text } from 'react-konva';
import { sqFeetToSqMeters } from '../../utils/unitConverter';
import { calculateArea, getCentroid } from '../../utils/areaCalculator';
import { SQ_M_TO_SQ_CM, MIN_SQ_M_DISPLAY, LINE_COLORS } from './canvasUtils';

/**
 * ShapeLayer renders completed custom shapes (closed polygons with area labels)
 * and the preview shape being drawn.
 */
const ShapeLayer = ({
  customShapes,
  currentCustomShape,
  currentMousePos,
  drawAreaActive,
  scale,
  pixelsPerFoot,
  unit,
  selectedCustomShapeIndex,
  onCustomShapeSelect,
  onCustomShapeDragEnd,
}) => {
  return (
    <>
      {/* Completed Custom Areas */}
      {customShapes && customShapes.length > 0 && (
        <Layer>
          {customShapes.map((shape, shapeIndex) => {
            const colors = LINE_COLORS[shapeIndex % LINE_COLORS.length];
            const strokeColor = selectedCustomShapeIndex === shapeIndex ? colors.selected : colors.normal;
            const labelColor = colors.label;
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
                fill={shape.closed ? `${colors.normal}26` : 'transparent'}
                stroke={strokeColor}
                strokeWidth={(selectedCustomShapeIndex === shapeIndex ? 3 : 2) / scale}
              />
              {shape.closed && shape.vertices.map((vertex, vertexIndex) => (
                <Circle
                  key={`shape-${shapeIndex}-vertex-${vertexIndex}`}
                  name="custom-shape"
                  x={vertex.x}
                  y={vertex.y}
                  radius={5 / scale}
                  fill={strokeColor}
                  stroke="#6272A4"
                  strokeWidth={1 / scale}
                />
              ))}
              {shape.closed && shape.vertices.length >= 3 && (() => {
                const centroid = getCentroid(shape.vertices);
                const areaValue = calculateArea(shape.vertices, pixelsPerFoot);
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
                  <Text
                    name="custom-shape"
                    x={centroid.x}
                    y={centroid.y}
                    text={areaText}
                    fontSize={14 / scale}
                    fill={labelColor}
                    fontStyle="bold"
                    offsetX={0}
                    offsetY={0}
                    align="center"
                    ref={(node) => {
                      if (node) {
                        node.offsetX(node.width() / 2);
                        node.offsetY(node.height() / 2);
                      }
                    }}
                  />
                );
              })()}
            </Group>
            );
          })}
        </Layer>
      )}
      
      {/* Custom Shape (Draw Area Tool) Preview */}
      {drawAreaActive && currentCustomShape && currentMousePos && (
        <Layer>
          <Line
            points={currentCustomShape.vertices.flatMap(v => [v.x, v.y]).concat(currentCustomShape.vertices.length > 0 ? [currentMousePos.x, currentMousePos.y] : [])}
            closed={false}
            stroke={LINE_COLORS[customShapes ? customShapes.length % LINE_COLORS.length : 0].normal}
            strokeWidth={2 / scale}
            dash={[6 / scale, 3 / scale]}
          />
          {currentCustomShape.vertices.map((vertex, index) => (
            <Circle
              key={`current-shape-vertex-${index}`}
              x={vertex.x}
              y={vertex.y}
              radius={5 / scale}
              fill={index === 0 ? '#FFB86C' : '#8BE9FD'}
              stroke="#6272A4"
              strokeWidth={1 / scale}
            />
          ))}
        </Layer>
      )}
    </>
  );
};

export default React.memo(ShapeLayer);
