import React from 'react';
import { Group, Rect, Text } from 'react-konva';
import { setCursor, tabSize, SIDE_LEN_FONT_FAMILY, SIDE_LEN_FONT_STYLE } from './canvasUtils';
import { PAPER } from './overlayStyle';

/**
 * A figure on the plan: a small white label, upright whatever way the plan is
 * turned, with its text in the colour of the thing it measures. White with a
 * hairline rather than a dark slab — the plan's own print is black, and a dark
 * label on it reads as part of the drawing.
 *
 * `solid` inverts it, for the figure that is changing under the user's hand.
 *
 * With `onMoved` it can be dragged to somewhere else; it is handed the new
 * middle, in the plan's own coordinates, when it is let go.
 */
const CanvasTab = ({
  x, y, text, fontSize, scale,
  rotation = 0,
  color,
  edge,
  solid = false,
  opacity = 1,
  width, height,
  name,
  listening = false,
  onMoved,
}) => {
  const size = width && height ? { width, height } : tabSize(text, fontSize, scale);
  return (
    <Group
      x={x}
      y={y}
      rotation={-rotation}
      opacity={opacity}
      listening={listening || !!onMoved}
      draggable={!!onMoved}
      onDragEnd={onMoved ? (e) => onMoved({ x: e.target.x(), y: e.target.y() }) : undefined}
      onMouseEnter={onMoved ? (e) => setCursor(e, 'move') : undefined}
      onMouseLeave={onMoved ? (e) => setCursor(e, 'default') : undefined}
    >
      <Rect
        name={name}
        x={-size.width / 2}
        y={-size.height / 2}
        width={size.width}
        height={size.height}
        fill={solid ? color : PAPER}
        stroke={solid ? color : (edge ?? color)}
        strokeWidth={1 / scale}
        cornerRadius={Math.min(6 / scale, size.height / 2)}
        perfectDrawEnabled={false}
      />
      <Text
        x={-size.width / 2}
        y={-size.height / 2}
        width={size.width}
        height={size.height}
        text={text}
        fontSize={fontSize}
        fill={solid ? PAPER : color}
        fontFamily={SIDE_LEN_FONT_FAMILY}
        fontStyle={SIDE_LEN_FONT_STYLE}
        align="center"
        verticalAlign="middle"
        listening={false}
      />
    </Group>
  );
};

export default React.memo(CanvasTab);
