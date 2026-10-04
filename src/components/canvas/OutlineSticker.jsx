import React from 'react';
import { Group, Rect, Text } from 'react-konva';
import { measureSideLenWidth, SIDE_LEN_FONT_FAMILY } from './canvasUtils';
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
 */
const OutlineSticker = ({
  x, y, roomy, name, areaText, note, counted, color, scale, rotation = 0,
}) => {
  const hue = color;
  const full = [
    { text: name, size: 14 / scale, style: 'normal' },
    { text: areaText, size: (counted ? 24 : 19) / scale, style: '600' },
    ...(note ? [{ text: note, size: 13 / scale, style: 'normal' }] : []),
  ];
  const padX = 16 / scale;
  const padY = 7 / scale;
  const fullWidth = Math.max(...full.map((l) => measureSideLenWidth(l.text, l.size))) + padX * 2;
  const fullHeight = full.reduce((sum, l) => sum + l.size * 1.2, 0) + padY * 2;
  const fits = roomy;

  // One line still says whether the outline counts: that is the half of the
  // label a reader cannot work out from the figure.
  const lines = fits ? full : [{
    text: [name, areaText === '—' ? null : areaText, counted ? null : 'not in GLA']
      .filter(Boolean).join(' · '),
    size: 13 / scale,
    style: '600',
  }];
  const width = fits ? fullWidth : measureSideLenWidth(lines[0].text, lines[0].size) + 16 / scale;
  const height = fits ? fullHeight : lines[0].size * 1.2 + 8 / scale;

  let cursor = -height / 2 + (fits ? padY : 4 / scale);
  return (
    <Group x={x} y={y} rotation={-rotation} listening={false}>
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
