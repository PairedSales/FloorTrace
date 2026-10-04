import React from 'react';
import { Group, Rect, Text } from 'react-konva';
import { setCursor, SIDE_LEN_FONT_FAMILY } from './canvasUtils';
import { stickerLayout } from './stickerLayout';
import { PAPER, lineColor, solidColor, inkColor } from './overlayStyle';

/**
 * An outline's name and area, on the plan.
 *
 * Filled in the outline's colour when the outline counts toward GLA, white
 * with that colour's edge when it does not — and then it says so, because a
 * garage outlined beside the house is the easiest thing on the plan to take
 * for living area.
 *
 * `roomy` is whether the place it was given has room for all of it, clear of
 * the walls and of the room sizes the plan prints. When it has not, the label
 * becomes one line: a porch four feet deep cannot carry three lines of type,
 * and on a plan with a size printed in every room a big label would cover one.
 *
 * With `onMoved` it can be dragged elsewhere.
 */
const OutlineSticker = ({
  x, y, roomy, name, areaText, note, counted, color, scale, rotation = 0, onMoved,
}) => {
  const hue = color;
  const fits = roomy;
  const { lines, width, height, padY } = stickerLayout({ roomy, name, areaText, note, counted }, scale);

  let cursor = -height / 2 + (fits ? padY : 4 / scale);
  return (
    <Group
      x={x}
      y={y}
      rotation={-rotation}
      listening={!!onMoved}
      draggable={!!onMoved}
      onDragEnd={onMoved ? (e) => onMoved({ x: e.target.x(), y: e.target.y() }) : undefined}
      onMouseEnter={onMoved ? (e) => setCursor(e, 'move') : undefined}
      onMouseLeave={onMoved ? (e) => setCursor(e, 'default') : undefined}
    >
      <Rect
        x={-width / 2}
        y={-height / 2}
        width={width}
        height={height}
        fill={counted ? solidColor(hue) : PAPER}
        stroke={counted ? solidColor(hue) : lineColor(hue)}
        strokeWidth={(counted ? 1 : 2) / scale}
        cornerRadius={(fits ? 12 : 6) / scale}
        perfectDrawEnabled={false}
      />
      {lines.map((line, i) => {
        const top = cursor;
        cursor += line.size * 1.2;
        return (
          <Text
            key={i}
            x={-width / 2}
            y={top}
            width={width}
            height={line.size * 1.2}
            text={line.text}
            fontSize={line.size}
            fill={counted ? PAPER : inkColor(hue)}
            fontFamily={SIDE_LEN_FONT_FAMILY}
            fontStyle={line.style}
            align="center"
            verticalAlign="middle"
          />
        );
      })}
    </Group>
  );
};

export default React.memo(OutlineSticker);
