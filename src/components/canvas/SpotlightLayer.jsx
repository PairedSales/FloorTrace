import React, { useCallback } from 'react';
import { Shape } from 'react-konva';
import { VEIL, BAND } from './overlayStyle';

// Far enough that the veil has no edge at any zoom or pan. The canvas clips it.
const FAR = 1e5;

const trace = (c, ring) => {
  c.beginPath();
  c.moveTo(ring[0].x, ring[0].y);
  for (let i = 1; i < ring.length; i += 1) c.lineTo(ring[i].x, ring[i].y);
  c.closePath();
};

/**
 * The veil and the bands: the two things that are laid *onto* the plan rather
 * than drawn over it, so they live in the image's own layer.
 *
 * That is forced, not chosen. A band is a highlighter — it multiplies with the
 * ink under it so a wall stays black inside it — and a blend mode only reaches
 * what is already on the same canvas. Konva gives each layer its own, so from
 * the overlay layer a multiply would have nothing but transparency to blend
 * with.
 *
 * The veil is not a path with holes in it. Two GLA outlines can overlap (the
 * panel says so when they do), and under either fill rule an overlap of two
 * holes comes back filled. Instead the veil goes over everything and the plan
 * is drawn again inside each lit outline, which has no such case.
 *
 * `outlines` is `[{ vertices, holes, color, lit, emphasis }]` in image px:
 * `holes` only the cut-outs that are taken off, `emphasis` the walls a held
 * corner moves, as `[a, b]` pairs.
 */
const SpotlightLayer = ({ image, outlines, veil, scale }) => {
  const sceneFunc = useCallback((context) => {
    // The native context: Konva's wrapper has no clip-and-redraw, and nothing
    // here goes through its fill/stroke bookkeeping.
    const c = context._context;
    const lit = outlines.filter((o) => o.lit);

    if (veil && lit.length > 0) {
      c.save();
      c.globalAlpha = VEIL.opacity;
      c.fillStyle = VEIL.color;
      // Over the plan only: the canvas around it is paper, and a veil out
      // there greys it against the white toolbar row above.
      c.fillRect(0, 0, image.width, image.height);
      c.restore();

      for (const outline of lit) {
        c.save();
        trace(c, outline.vertices);
        c.clip();
        // Paper first: an outline can reach past the image's edge, and there
        // the veil has to come off as well.
        c.fillStyle = '#FFFFFF';
        c.fillRect(-FAR, -FAR, image.width + 2 * FAR, image.height + 2 * FAR);
        c.drawImage(image, 0, 0);
        c.restore();
      }

      // After every lit outline, so a cut-out is never re-lit by a neighbour
      // drawn later.
      for (const outline of lit) {
        for (const ring of outline.holes) {
          c.save();
          trace(c, ring);
          c.clip();
          c.globalAlpha = VEIL.opacity;
          c.fillStyle = VEIL.color;
          c.fillRect(0, 0, image.width, image.height);
          c.restore();
        }
      }
    }

    for (const outline of outlines) {
      const width = (outline.lit ? BAND.lit : BAND.other) / scale;
      c.save();
      // Clipped to the outline, so a stroke twice the band's width leaves the
      // inner half: the band sits on the wall and the paper outside stays clean.
      trace(c, outline.vertices);
      c.clip();
      c.globalCompositeOperation = 'multiply';
      c.strokeStyle = outline.color;
      c.lineJoin = 'miter';
      c.lineWidth = width * 2;
      c.globalAlpha = BAND.opacity;
      trace(c, outline.vertices);
      c.stroke();
      if (outline.emphasis?.length) {
        c.globalAlpha = BAND.emphasis;
        c.lineCap = 'butt';
        c.beginPath();
        for (const [a, b] of outline.emphasis) {
          c.moveTo(a.x, a.y);
          c.lineTo(b.x, b.y);
        }
        c.stroke();
      }
      c.restore();
    }
  }, [image, outlines, veil, scale]);

  if (!image || !outlines?.length) return null;
  return <Shape sceneFunc={sceneFunc} listening={false} perfectDrawEnabled={false} />;
};

export default React.memo(SpotlightLayer);
