// The exhibit as a display list, composed before anything is drawn.
//
// Composing and painting are separate so the page can be asserted without a
// canvas: what the exhibit claims is the part that matters, and a test that
// needs a real 2D context can only check that *something* was drawn. The
// measuring context passed in is used for text width alone.

const FONT_SANS = '"Fira Sans", system-ui, -apple-system, sans-serif';
const FONT_MONO = '"Fira Code", ui-monospace, SFMono-Regular, monospace';

// The exhibit is paper, not chrome: it is pasted into a workfile, printed and
// read next to other documents, so it is light in every app theme. These are
// the app's own light tokens rather than a second palette.
export const PAPER = {
  bg: '#FFFFFF',
  panel: '#F7F8FA',
  ink: '#171C22',
  ink2: '#454F5A',
  ink3: '#626C79',
  rule: '#D3D8DF',
  ruleSoft: '#E6E9ED',
  warn: '#A65200',
  crit: '#B42318',
  pill: 'rgba(40, 42, 54, 0.92)',
  pillInk: '#FFFFFF',
};

const MIN_CONTENT_WIDTH = 900;
const MAX_PLAN_WIDTH = 2400;

const sans = (size, weight = 400) => `${weight} ${size}px ${FONT_SANS}`;
const mono = (size, weight = 500) => `${weight} ${size}px ${FONT_MONO}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Greedy word wrap. Exported because it is the one part of layout that can be wrong. */
export function wrapLines(measure, text, maxWidth) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const next = `${line} ${words[i]}`;
    if (measure(next) <= maxWidth) {
      line = next;
    } else {
      lines.push(line);
      line = words[i];
    }
  }
  lines.push(line);
  return lines;
}

/**
 * The axis-aligned box a rotated plan needs, and the scale that fits it in
 * `maxWidth`. The plan is never enlarged — upscaling a scan to fill a page
 * makes a blurry exhibit out of a sharp one.
 */
export function planFrame(imageWidth, imageHeight, rotationDeg = 0, maxWidth = MAX_PLAN_WIDTH) {
  const rad = ((rotationDeg || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const boxW = imageWidth * cos + imageHeight * sin;
  const boxH = imageWidth * sin + imageHeight * cos;
  const scale = Math.min(1, maxWidth / boxW);
  return { width: boxW * scale, height: boxH * scale, scale, rad };
}

// Image space -> page space. Built once per exhibit so every overlay is placed
// by the same transform as the image under it, and so labels can be drawn
// upright in page space instead of counter-rotated inside a rotated context.
const projector = (frame, imageWidth, imageHeight, originX, originY) => {
  const cos = Math.cos(frame.rad);
  const sin = Math.sin(frame.rad);
  const cx = originX + frame.width / 2;
  const cy = originY + frame.height / 2;
  return (p) => {
    const dx = p.x - imageWidth / 2;
    const dy = p.y - imageHeight / 2;
    return {
      x: cx + frame.scale * (dx * cos - dy * sin),
      y: cy + frame.scale * (dx * sin + dy * cos),
    };
  };
};

const text = (t, x, y, font, color, opts = {}) => ({
  op: 'text', text: t, x, y, font, color,
  align: opts.align ?? 'left', baseline: opts.baseline ?? 'top',
});

// Takes the size as a number rather than digging it back out of the font
// string: `parseFloat('500 13px …')` is 500, and a pill 775px tall covered the
// whole page in a dark bar per label.
const pill = (t, x, y, size, weight, measure, ui) => {
  const font = sans(size, weight);
  const padX = 5 * ui;
  const h = Math.round(size * 1.55);
  const w = measure(t, font) + padX * 2;
  return [
    { op: 'roundRect', x: x - w / 2, y: y - h / 2, w, h, r: h / 2, fill: PAPER.pill },
    text(t, x, y, font, PAPER.pillInk, { align: 'center', baseline: 'middle' }),
  ];
};

/**
 * Compose the whole page. `ctx` is used only through `measureText`.
 * Returns `{ width, height, ops }` in device-independent page pixels.
 */
export function composeExhibit(ctx, model, {
  imageWidth,
  imageHeight,
  maxPlanWidth = MAX_PLAN_WIDTH,
  minContentWidth = MIN_CONTENT_WIDTH,
} = {}) {
  const measure = (t, font) => {
    ctx.font = font;
    return ctx.measureText(String(t ?? '')).width;
  };

  const frame = planFrame(imageWidth, imageHeight, model.plan.rotation, maxPlanWidth);
  const contentW = Math.max(frame.width, minContentWidth);
  const ui = clamp(contentW / 1000, 1, 1.9);
  const pad = Math.round(28 * ui);
  const pageW = Math.round(contentW + pad * 2);
  const left = pad;
  const right = pad + contentW;

  const ops = [];
  let y = pad;

  // ── header ────────────────────────────────────────────────────────────────
  const titleSize = Math.round(25 * ui);
  ops.push(text(model.title || 'Floor plan measurement', left, y, sans(titleSize, 600), PAPER.ink));
  const dateFont = sans(Math.round(13 * ui), 500);
  ops.push(text(model.date, right, y + Math.round(6 * ui), dateFont, PAPER.ink3, { align: 'right' }));
  y += Math.round(titleSize * 1.25);
  ops.push(text(
    model.title ? 'Floor plan measurement · FloorTrace' : 'Traced with FloorTrace',
    left, y, sans(Math.round(13 * ui), 400), PAPER.ink3,
  ));
  y += Math.round(26 * ui);
  ops.push({ op: 'line', x1: left, y1: y, x2: right, y2: y, color: PAPER.rule, width: Math.max(1, ui) });
  y += Math.round(20 * ui);

  // ── the plan ──────────────────────────────────────────────────────────────
  const planX = left + (contentW - frame.width) / 2;
  const planY = y;
  const project = projector(frame, imageWidth, imageHeight, planX, planY);
  // Heavier than the on-screen 2px: the traced outline is the subject of the
  // page, and it has to read against the plan's own printed walls at a glance.
  const strokeW = clamp(frame.width / 380, 2.5, 7);

  ops.push({
    op: 'image',
    x: planX, y: planY, width: frame.width, height: frame.height,
    scale: frame.scale, rad: frame.rad, imageWidth, imageHeight,
  });

  const alpha = (hex, a) => {
    const clean = String(hex).replace('#', '');
    const n = parseInt(clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };

  for (const trace of model.plan.traces) {
    ops.push({
      op: 'poly',
      points: trace.vertices.map(project),
      fill: alpha(trace.color, 0.13),
      stroke: trace.color,
      width: strokeW,
      close: true,
    });
    for (const hole of trace.holes) {
      ops.push({
        op: 'poly',
        points: hole.ring.map(project),
        fill: hole.stale ? alpha('#FF5555', 0.16) : 'rgba(40, 42, 54, 0.45)',
        stroke: hole.stale ? '#B42318' : trace.color,
        width: strokeW * 0.75,
        dash: [strokeW * 4, strokeW * 3],
        close: true,
      });
    }
  }

  // Labels after every outline, so a second floor's fill never lands on top of
  // the first floor's lengths.
  const edgeFontBase = clamp(frame.width / 78, 11, 26);
  for (const trace of model.plan.traces) {
    for (const edge of trace.edges) {
      const room = edge.lengthPx * frame.scale * 0.92;
      let size = edgeFontBase;
      while (size > 8 && measure(edge.text, sans(size, 500)) + 10 * ui > room) size -= 1;
      if (size <= 8) continue;
      const mid = project({ x: edge.x, y: edge.y });
      const n = project({ x: edge.x + edge.nx, y: edge.y + edge.ny });
      const len = Math.hypot(n.x - mid.x, n.y - mid.y) || 1;
      const off = size * 0.95;
      ops.push(...pill(
        edge.text,
        mid.x + ((n.x - mid.x) / len) * off,
        mid.y + ((n.y - mid.y) / len) * off,
        size, 500, measure, ui,
      ));
    }
  }

  for (const trace of model.plan.traces) {
    if (!trace.badge) continue;
    const at = project(trace.badge);
    ops.push(...pill(trace.badge.text, at.x, at.y, clamp(frame.width / 68, 12, 28), 600, measure, ui));
  }

  const annotationSize = clamp(frame.width / 85, 11, 22);
  for (const line of model.plan.lines) {
    const a = project(line.start);
    const b = project(line.end);
    ops.push({ op: 'poly', points: [a, b], stroke: '#FF79C6', width: strokeW, close: false });
    if (line.text) {
      ops.push(...pill(line.text, (a.x + b.x) / 2, (a.y + b.y) / 2,
        annotationSize, 500, measure, ui));
    }
  }

  for (const shape of model.plan.shapes) {
    const points = shape.vertices.map(project);
    ops.push({
      op: 'poly', points, fill: 'rgba(255, 121, 198, 0.15)',
      stroke: '#FF79C6', width: strokeW, close: true,
    });
    if (shape.text) {
      const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
      const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
      ops.push(...pill(shape.text, cx, cy, annotationSize, 500, measure, ui));
    }
  }

  y = planY + frame.height + Math.round(22 * ui);

  // ── summary ───────────────────────────────────────────────────────────────
  if (model.options.summary) {
    ops.push({ op: 'line', x1: left, y1: y, x2: right, y2: y, color: PAPER.rule, width: Math.max(1, ui) });
    y += Math.round(20 * ui);

    const gutter = Math.round(34 * ui);
    const colW = Math.round((contentW - gutter) * 0.36);
    const rightX = left + colW + gutter;
    const headFont = sans(Math.round(11 * ui), 700);
    const bodyFont = sans(Math.round(13 * ui), 400);
    const rowFont = sans(Math.round(13.5 * ui), 400);
    const numFont = mono(Math.round(13.5 * ui), 500);

    // left column — the number, and where the number came from
    let ly = y;
    ops.push(text(model.headline.label.toUpperCase(), left, ly, headFont, PAPER.ink3));
    ly += Math.round(18 * ui);
    const bigSize = Math.round(clamp(46 - Math.max(0, model.headline.value.length - 5) * 4, 26, 46) * ui);
    ops.push(text(model.headline.value, left, ly, mono(bigSize, 700), PAPER.ink));
    ops.push(text(
      model.headline.suffix,
      left + measure(model.headline.value, mono(bigSize, 700)) + 8 * ui,
      ly + bigSize * 0.42,
      sans(Math.round(16 * ui), 500), PAPER.ink3,
    ));
    ly += Math.round(bigSize * 1.16);
    for (const l of wrapLines((t) => measure(t, bodyFont), model.headline.caption, colW)) {
      ops.push(text(l, left, ly, bodyFont, PAPER.ink2));
      ly += Math.round(18 * ui);
    }

    ly += Math.round(18 * ui);
    ops.push(text('SCALE', left, ly, headFont, PAPER.ink3));
    ly += Math.round(18 * ui);
    ops.push(text(model.scale.value, left, ly, mono(Math.round(17 * ui), 600), PAPER.ink));
    ly += Math.round(25 * ui);
    for (const l of wrapLines((t) => measure(t, bodyFont), model.scale.provenance, colW)) {
      ops.push(text(l, left, ly, bodyFont, PAPER.ink2));
      ly += Math.round(18 * ui);
    }

    // right column — the tables
    let ry = y;
    const rowH = Math.round(24 * ui);
    const swatch = Math.round(9 * ui);

    if (model.showBreakdown) {
      ops.push(text('BREAKDOWN', rightX, ry, headFont, PAPER.ink3));
      ry += Math.round(19 * ui);
      for (const row of model.rows) {
        ops.push({
          op: 'roundRect', x: rightX, y: ry + (rowH - swatch) / 2 - 2 * ui,
          w: swatch, h: swatch, r: 2 * ui, fill: row.color,
        });
        ops.push(text(row.label, rightX + swatch + 9 * ui, ry, rowFont, PAPER.ink2));
        ops.push(text(row.value, right, ry, numFont, PAPER.ink, { align: 'right' }));
        ry += rowH;
        ops.push({
          op: 'line', x1: rightX, y1: ry - 4 * ui, x2: right, y2: ry - 4 * ui,
          color: PAPER.ruleSoft, width: 1,
        });
      }
      ops.push(text('Total', rightX, ry + 3 * ui, sans(Math.round(13.5 * ui), 600), PAPER.ink));
      ops.push(text(
        `${model.total} ${model.totalSuffix}`, right, ry + 3 * ui,
        mono(Math.round(13.5 * ui), 700), PAPER.ink, { align: 'right' },
      ));
      ry += Math.round(rowH + 16 * ui);
    }

    // The property, when this plan is one of several. A workfile keeps every
    // page, and a page stating one plan's figure with nothing to place it reads
    // as the whole house — which is the number the report actually needs.
    if (model.property) {
      ops.push(text('PROPERTY', rightX, ry, headFont, PAPER.ink3));
      ry += Math.round(19 * ui);
      for (const plan of model.property.plans) {
        ops.push(text(
          plan.isActive ? `${plan.label} (this plan)` : plan.label,
          rightX, ry, rowFont, PAPER.ink2,
        ));
        ops.push(text(plan.value, right, ry, numFont, PAPER.ink, { align: 'right' }));
        ry += rowH;
        ops.push({
          op: 'line', x1: rightX, y1: ry - 4 * ui, x2: right, y2: ry - 4 * ui,
          color: PAPER.ruleSoft, width: 1,
        });
      }
      const propertyLabel = model.property.levels > 0
        ? `Property GLA · ${model.property.levels} level${model.property.levels === 1 ? '' : 's'}`
        : 'Property total';
      const propertyValue = model.property.levels > 0
        ? model.property.gla
        : model.property.total;
      ops.push(text(propertyLabel, rightX, ry + 3 * ui, sans(Math.round(13.5 * ui), 600), PAPER.ink));
      ops.push(text(
        `${propertyValue.value} ${propertyValue.suffix}`, right, ry + 3 * ui,
        mono(Math.round(13.5 * ui), 700), PAPER.ink, { align: 'right' },
      ));
      ry += Math.round(rowH + 16 * ui);
    }

    if (model.outlines.length) {
      ops.push(text('OUTLINES', rightX, ry, headFont, PAPER.ink3));
      ry += Math.round(19 * ui);
      for (const outline of model.outlines) {
        ops.push({
          op: 'roundRect', x: rightX, y: ry + (rowH - swatch) / 2 - 2 * ui,
          w: swatch, h: swatch, r: 2 * ui, fill: outline.color,
        });
        ops.push(text(outline.name, rightX + swatch + 9 * ui, ry, rowFont, PAPER.ink2));
        ops.push(text(outline.areaText, right, ry, numFont, PAPER.ink, { align: 'right' }));
        ry += Math.round(17 * ui);
        const notes = [
          outline.typeLabel,
          // How it was reached, before how much of it sat on drawn wall. A
          // reviewer opening this in a workfile could not tell an outline the
          // appraiser painted from one the app traced, and the two deserve
          // different amounts of trust.
          outline.provenance,
          outline.quality
            ? (outline.quality.edited ? null
              : outline.quality.percent === null ? 'unverified'
                : `${outline.quality.percent}% wall match`)
            : null,
          outline.voids,
        ].filter(Boolean).join(' · ');
        ops.push(text(
          notes, rightX + swatch + 9 * ui, ry,
          sans(Math.round(11.5 * ui), 400),
          outline.quality && outline.quality.level !== 'good' ? PAPER.warn : PAPER.ink3,
        ));
        ry += Math.round(16 * ui);
        ops.push({
          op: 'line', x1: rightX, y1: ry - 3 * ui, x2: right, y2: ry - 3 * ui,
          color: PAPER.ruleSoft, width: 1,
        });
        ry += Math.round(6 * ui);
      }
    }

    y = Math.max(ly, ry) + Math.round(14 * ui);
  }

  // ── what the numbers cannot be trusted about ──────────────────────────────
  // Never fine print and never omitted for a tidier page: a doubtful area that
  // looks clean on the exhibit is exactly the failure this app is built against.
  if (model.flags.length) {
    const flagFont = sans(Math.round(13 * ui), 500);
    const boxTop = y;
    const inner = contentW - Math.round(54 * ui);
    // Collected rather than pushed: the panel is drawn behind the text it
    // frames, and its height is only known once the text has been wrapped.
    const flagOps = [];
    let fy = y + Math.round(13 * ui);
    for (const flag of model.flags) {
      // A finding somebody checked against the plan and accepted still prints,
      // in the resting tone rather than a warning one — the record is the
      // point, and colouring it amber would have it read as outstanding.
      const color = flag.severity === 'reviewed' ? PAPER.ink2
        : flag.severity === 'error' ? PAPER.crit : PAPER.warn;
      flagOps.push({ op: 'dot', x: left + 14 * ui, y: fy + 7 * ui, r: 3.5 * ui, fill: color });
      wrapLines((t) => measure(t, flagFont), flag.text, inner).forEach((l, i) => {
        flagOps.push(text(l, left + 26 * ui, fy, flagFont, i === 0 ? color : PAPER.ink2));
        fy += Math.round(18 * ui);
      });
      fy += Math.round(6 * ui);
    }
    const boxH = fy - boxTop + Math.round(6 * ui);
    ops.push({
      op: 'roundRect', x: left, y: boxTop, w: contentW, h: boxH, r: 8 * ui,
      fill: PAPER.panel, stroke: PAPER.rule, width: 1,
    });
    ops.push(...flagOps);
    y = boxTop + boxH + Math.round(16 * ui);
  }

  // ── footer ────────────────────────────────────────────────────────────────
  ops.push({ op: 'line', x1: left, y1: y, x2: right, y2: y, color: PAPER.ruleSoft, width: 1 });
  y += Math.round(12 * ui);
  const footFont = sans(Math.round(11.5 * ui), 400);
  for (const l of wrapLines((t) => measure(t, footFont), model.disclaimer, contentW)) {
    ops.push(text(l, left, y, footFont, PAPER.ink3));
    y += Math.round(16 * ui);
  }

  return { width: pageW, height: Math.round(y + pad), ops, ui, scale: frame.scale };
}
