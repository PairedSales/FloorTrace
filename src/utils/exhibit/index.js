// Turning the composed exhibit into a file the user can keep.
//
// One canvas serves the dialog's preview, the clipboard and the saved PNG, so
// what the user approves is byte-for-byte what they get — a preview rendered by
// a second path is a preview that can lie.

import { composeExhibit, PAPER } from './compose';
import { buildExhibitModel, exhibitFilename, exhibitDate, EXHIBIT_DEFAULTS } from './model';
import { loadImageElement } from '../../components/canvas/imageCache';

export { buildExhibitModel, exhibitFilename, exhibitDate, EXHIBIT_DEFAULTS };

// An <img>, deliberately, and not the bitmap the stage draws from: the plan is
// drawn here well under full size, where the two are resampled differently, and
// this is the page the user keeps. The cache loads it from the image's bytes,
// so opening the dialog on a large plan does not parse its data URL again.
const loadImage = (src) => loadImageElement(src).catch(() => {
  throw new Error('The plan image could not be read.');
});

const roundRectPath = (ctx, x, y, w, h, r) => {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

function paintExhibit(ctx, ops, image) {
  for (const op of ops) {
    switch (op.op) {
      case 'image':
        ctx.save();
        ctx.translate(op.x + op.width / 2, op.y + op.height / 2);
        ctx.rotate(op.rad);
        ctx.scale(op.scale, op.scale);
        ctx.drawImage(image, -op.imageWidth / 2, -op.imageHeight / 2);
        ctx.restore();
        break;

      case 'text':
        ctx.font = op.font;
        ctx.fillStyle = op.color;
        ctx.textAlign = op.align;
        ctx.textBaseline = op.baseline;
        ctx.fillText(op.text, op.x, op.y);
        break;

      case 'line':
        ctx.save();
        ctx.strokeStyle = op.color;
        ctx.lineWidth = op.width;
        ctx.beginPath();
        ctx.moveTo(op.x1, op.y1);
        ctx.lineTo(op.x2, op.y2);
        ctx.stroke();
        ctx.restore();
        break;

      case 'poly': {
        if (!op.points?.length) break;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(op.points[0].x, op.points[0].y);
        for (let i = 1; i < op.points.length; i += 1) ctx.lineTo(op.points[i].x, op.points[i].y);
        if (op.close) ctx.closePath();
        if (op.fill) {
          ctx.fillStyle = op.fill;
          ctx.fill('evenodd');
        }
        if (op.stroke) {
          ctx.strokeStyle = op.stroke;
          ctx.lineWidth = op.width;
          ctx.lineJoin = 'round';
          if (op.dash) ctx.setLineDash(op.dash);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }

      case 'roundRect':
        ctx.save();
        roundRectPath(ctx, op.x, op.y, op.w, op.h, op.r ?? 0);
        if (op.fill) { ctx.fillStyle = op.fill; ctx.fill(); }
        if (op.stroke) { ctx.strokeStyle = op.stroke; ctx.lineWidth = op.width ?? 1; ctx.stroke(); }
        ctx.restore();
        break;

      case 'dot':
        ctx.save();
        ctx.fillStyle = op.fill;
        ctx.beginPath();
        ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;

      default:
        break;
    }
  }
}

/**
 * Render the exhibit for `state` and hand back the canvas plus the model that
 * produced it. `now` is a parameter so a caller can date the page and the
 * filename from the same instant.
 */
export async function renderExhibit(state, { now = Date.now(), options, maxPlanWidth } = {}) {
  if (!state.image) throw new Error('There is no plan to export.');

  const [image] = await Promise.all([
    loadImage(state.image),
    // Without this the first export can be laid out in a fallback face and
    // painted in Fira Sans, which puts every pill background off its text.
    document.fonts?.ready ?? Promise.resolve(),
  ]);

  const model = buildExhibitModel(state, { now, options });
  const measureCtx = document.createElement('canvas').getContext('2d');
  const layout = composeExhibit(measureCtx, model, {
    imageWidth: image.naturalWidth || image.width,
    imageHeight: image.naturalHeight || image.height,
    ...(maxPlanWidth ? { maxPlanWidth } : {}),
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(layout.width));
  canvas.height = Math.max(1, Math.round(layout.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAPER.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  paintExhibit(ctx, layout.ops, image);

  return { canvas, model };
}

const exhibitBlob = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob(
    (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))),
    'image/png',
  );
});

const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/**
 * Save the exhibit. The file picker is opened *before* the PNG is encoded:
 * encoding a large page takes long enough to spend the click's user activation,
 * and a picker that silently refuses to open reads as a broken Save button.
 * Returns false when the user cancels.
 */
export async function saveExhibit(canvas, filename) {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }],
      });
      const blob = await exhibitBlob(canvas);
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') return false;
      // A blocked picker (no activation left, sandboxed iframe) is not a
      // failure to report — the download path does the same job.
      if (err?.name !== 'SecurityError' && err?.name !== 'NotAllowedError') throw err;
    }
  }
  downloadBlob(await exhibitBlob(canvas), filename);
  return true;
}

/**
 * The exhibit as a `File`, ready for the share sheet.
 *
 * Built ahead of the tap on purpose. `navigator.share` requires transient user
 * activation, and encoding a full-resolution PNG takes long enough to spend it
 * — the same trap `saveExhibit` avoids by opening the picker first. Here there
 * is nothing to open first, so the encode has to have already happened.
 */
export async function exhibitFile(canvas, filename) {
  const blob = await exhibitBlob(canvas);
  return new File([blob], filename, { type: 'image/png' });
}

/**
 * Whether this browser has a share sheet to ask at all. Cheap, and asked
 * before the page is encoded for it: `canShareExhibit` needs the file in hand,
 * and making one is a full PNG encode of the page.
 */
export const hasShareSheet = () => (
  typeof navigator !== 'undefined'
  && typeof navigator.share === 'function'
  && typeof navigator.canShare === 'function'
);

/** Whether this browser can put `file` into a share sheet. */
export const canShareExhibit = (file) => (
  hasShareSheet()
  && !!file
  && navigator.canShare({ files: [file] })
);

/**
 * Hand the exhibit to the operating system's share sheet — mail, Files, a
 * messaging app, whatever the phone has. This is the mobile counterpart of
 * "Copy image": a phone browser will not write a PNG to the clipboard, and a
 * download lands in a folder the user then has to go and find. Returns false
 * when the user dismisses the sheet.
 */
export async function shareExhibit(file, title) {
  try {
    await navigator.share({ files: [file], title, text: title });
    return true;
  } catch (err) {
    // Dismissing the sheet is a decision, not a failure. Safari reports it as
    // AbortError; some Android builds report NotAllowedError for the same act.
    if (err?.name === 'AbortError' || err?.name === 'NotAllowedError') return false;
    throw err;
  }
}

export async function copyExhibit(canvas) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('This browser cannot copy images to the clipboard — save the PNG instead.');
  }
  try {
    // The blob is handed over as a promise on purpose: Safari resolves it
    // inside the same user gesture, and awaiting it first loses the gesture.
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': exhibitBlob(canvas) }),
    ]);
  } catch (err) {
    // The browser's own wording here is "Document is not focused", which tells
    // the user nothing about what to do next.
    if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
      throw new Error('The browser blocked the clipboard — click the page and try again, '
        + 'or save the PNG instead.');
    }
    throw err;
  }
}
