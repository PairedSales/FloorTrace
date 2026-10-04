import { measureSideLenWidth } from './canvasUtils';

/**
 * The label's lines and its box, in image units at `scale`. Pass 1 for pixels on
 * screen: the layout of the other labels keeps off this one, so it needs the
 * size the sticker will really be drawn at, from the one place that works it out.
 */
export const stickerLayout = ({ roomy, name, areaText, note, counted }, scale) => {
  const full = [
    { text: name, size: 14 / scale, style: 'normal' },
    { text: areaText, size: (counted ? 24 : 19) / scale, style: '600' },
    ...(note ? [{ text: note, size: 13 / scale, style: 'normal' }] : []),
  ];
  const padX = 16 / scale;
  const padY = 7 / scale;
  const fullWidth = Math.max(...full.map((l) => measureSideLenWidth(l.text, l.size))) + padX * 2;
  const fullHeight = full.reduce((sum, l) => sum + l.size * 1.2, 0) + padY * 2;

  // One line still says whether the outline counts: that is the half of the
  // label a reader cannot work out from the figure.
  const lines = roomy ? full : [{
    text: [name, areaText === '—' ? null : areaText, counted ? null : 'not in GLA']
      .filter(Boolean).join(' · '),
    size: 13 / scale,
    style: '600',
  }];
  const width = roomy ? fullWidth : measureSideLenWidth(lines[0].text, lines[0].size) + 16 / scale;
  const height = roomy ? fullHeight : lines[0].size * 1.2 + 8 / scale;
  return { lines, width, height, padY };
};
