import { useState, useEffect, useRef, useCallback } from 'react';
import { Copy, Download, Loader2, FileJson, AlertTriangle, Share2 } from 'lucide-react';
import useAppStore from '../store/appStore';
import { flash } from '../utils/notify';
import { readExportOptions, writeExportOptions } from '../utils/exhibit/options';
import { useIsMobile } from '../hooks/useViewport';
import Dialog from './Dialog';

/**
 * The end of the job. Almost nobody reopens a trace — they trace once for one
 * appraisal and need a picture of every number for the workfile — so the
 * terminal action is an image of the plan *with its measurements on it*, and
 * the editable `.floorplan` is the second door out rather than the only one.
 *
 * It is called "Save image" everywhere, because that is what it does. "Export"
 * was the app's word for it; nobody asks a floor plan to be exported.
 *
 * The preview is the very canvas that gets copied or saved, scaled down. A
 * preview drawn by a second code path is a preview that can disagree with the
 * file, which on a document somebody files is the worst kind of bug.
 */

const Toggle = ({ checked, onChange, label, hint, disabled }) => (
  <label className={`flex items-start gap-3 py-2 group
    ${disabled ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-[3px] w-4 h-4 accent-accent shrink-0
                 cursor-pointer disabled:cursor-default"
    />
    <span className="min-w-0">
      <span className="block text-[16px] leading-snug text-fg-2 group-hover:text-fg">{label}</span>
      {hint && <span className="block text-[15.5px] leading-snug text-fg-3 mt-px">{hint}</span>}
    </span>
  </label>
);

const ExportDialog = ({ onClose, onSaveProject }) => {
  const isMobile = useIsMobile();
  const projectName = useAppStore((s) => s.projectName);
  const setProjectName = useAppStore((s) => s.setProjectName);
  const measurementLines = useAppStore((s) => s.measurementLines);
  const customShapes = useAppStore((s) => s.customShapes);
  const calibrated = useAppStore((s) => s.calibration?.calibrated);

  const [options, setOptions] = useState(readExportOptions);
  const [result, setResult] = useState(null);   // { canvas, model }
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);       // 'copy' | 'save' | 'share' | null
  // A save, copy or share that failed. Said here, beside the buttons that were
  // pressed, and not over the plan behind this dialog.
  const [actionError, setActionError] = useState(null);
  // Encoded ahead of the tap, because `navigator.share` needs the click's user
  // activation and a full-resolution PNG encode outlives it.
  const [shareFile, setShareFile] = useState(null);

  const previewBoxRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  const hasAnnotations = (measurementLines?.length ?? 0) > 0 || (customShapes?.length ?? 0) > 0;

  const setOption = useCallback((key, value) => {
    setOptions((prev) => {
      const next = { ...prev, [key]: value };
      writeExportOptions(next);
      return next;
    });
  }, []);

  // ── render ────────────────────────────────────────────────────────────────
  // Debounced because the title re-renders the page on every keystroke, and
  // the page is a full-size canvas.
  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    const timer = setTimeout(async () => {
      try {
        const { renderExhibit } = await import('../utils/exhibit');
        const next = await renderExhibit(useAppStore.getState(), { options });
        if (cancelled) return;
        setResult(next);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        console.error('Exhibit render failed:', err);
        setError(err.message || 'The preview could not be drawn.');
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [options, projectName]);

  // ── preview ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    // Measured directly first, so the preview does not depend on an observer
    // firing at all — without it there is no fallback and the canvas stays the
    // browser's default 300x150 forever.
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const source = result?.canvas;
    if (!canvas || !source || box.width < 8 || box.height < 8) return;

    const fit = Math.min(box.width / source.width, box.height / source.height, 1);
    const w = Math.max(1, Math.floor(source.width * fit));
    const h = Math.max(1, Math.floor(source.height * fit));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  }, [result, box]);

  // ── actions ───────────────────────────────────────────────────────────────
  const withBusy = async (kind, fn) => {
    setBusy(kind);
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      console.error('Saving the image failed:', err);
      setActionError(err.message || (kind === 'copy'
        ? 'The image could not be copied.'
        : kind === 'share' ? 'The image could not be shared.' : 'The image could not be saved.'));
    } finally {
      setBusy(null);
    }
  };

  // Kept in step with the preview, so the file the share sheet hands over is
  // always the page the user is looking at.
  useEffect(() => {
    if (!result?.canvas) { setShareFile(null); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const { exhibitFile, exhibitFilename, canShareExhibit, hasShareSheet } = await import('../utils/exhibit');
        // Asked first: where there is no share sheet the encode below is a
        // fifth of a second of frozen page, on every change to the dialog, for
        // a file nothing will ever be handed.
        if (!hasShareSheet()) {
          if (!cancelled) setShareFile(null);
          return;
        }
        const file = await exhibitFile(result.canvas, exhibitFilename(result.model));
        if (cancelled) return;
        setShareFile(canShareExhibit(file) ? file : null);
      } catch {
        // Sharing is an extra route out, never the only one — Save image stands.
        if (!cancelled) setShareFile(null);
      }
    })();
    return () => { cancelled = true; };
  }, [result]);

  const handleShare = () => withBusy('share', async () => {
    const { shareExhibit } = await import('../utils/exhibit');
    const shared = await shareExhibit(shareFile, projectName || 'FloorTrace measurement');
    if (shared) {
      flash('Image shared');
      onClose();
    }
  });

  const handleCopy = () => withBusy('copy', async () => {
    const { copyExhibit } = await import('../utils/exhibit');
    await copyExhibit(result.canvas);
    flash('Image copied — paste it into your report');
    onClose();
  });

  const handleSave = () => withBusy('save', async () => {
    const { saveExhibit, exhibitFilename } = await import('../utils/exhibit');
    const saved = await saveExhibit(result.canvas, exhibitFilename(result.model));
    if (saved) {
      flash('Image saved');
      onClose();
    }
  });

  const saveProjectInstead = () => { onClose(); onSaveProject(); };

  const ready = !!result && !rendering && !error;
  const spinner = <Loader2 className="w-[18px] h-[18px] animate-spin" aria-hidden="true" />;

  // On a phone the share sheet leads: it is the one route that reaches mail,
  // Files and a messaging app in one tap, where the clipboard usually refuses
  // PNGs outright and a download lands somewhere the user then has to go and
  // find. Save stays, demoted, and Copy drops off the row entirely rather
  // than sitting there failing.
  const footer = isMobile ? (
    <>
      <div className="flex items-center gap-2">
        {shareFile && (
          <button
            type="button"
            onClick={handleShare}
            disabled={!ready || !!busy}
            className="btn btn-primary btn-lg flex-1"
          >
            {busy === 'share' ? spinner : <Share2 className="w-[18px] h-[18px]" aria-hidden="true" />}
            Share image
          </button>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={!ready || !!busy}
          className={`btn btn-lg ${shareFile ? 'btn-secondary' : 'btn-primary flex-1'}`}
        >
          {busy === 'save' ? spinner : <Download className="w-[18px] h-[18px]" aria-hidden="true" />}
          {shareFile ? 'Save' : 'Save image'}
        </button>
      </div>
      <button type="button" onClick={saveProjectInstead} className="btn btn-quiet btn-sm">
        <FileJson className="w-4 h-4" aria-hidden="true" />
        Save a project file instead
      </button>
    </>
  ) : (
    <>
      <button
        type="button"
        onClick={saveProjectInstead}
        className="btn btn-quiet"
        title="A file you can open in FloorTrace later and keep working on"
      >
        <FileJson className="w-[18px] h-[18px]" aria-hidden="true" />
        Save a project file instead
      </button>

      <button
        type="button"
        onClick={handleCopy}
        disabled={!ready || !!busy}
        className="btn btn-secondary ml-auto"
      >
        {busy === 'copy' ? spinner : <Copy className="w-[18px] h-[18px]" aria-hidden="true" />}
        Copy image
      </button>

      <button
        type="button"
        onClick={handleSave}
        disabled={!ready || !!busy}
        // Once the image has a title, the way out is what should be under the
        // cursor; until then the title field below has the focus.
        autoFocus={!!projectName}
        className="btn btn-primary px-5"
      >
        {busy === 'save' ? spinner : <Download className="w-[18px] h-[18px]" aria-hidden="true" />}
        Save image
      </button>
    </>
  );

  return (
    // Full-bleed on a phone. A centred card with a backdrop wastes the two
    // dimensions the preview most needs, and there is nothing behind it worth
    // showing through.
    <Dialog
      id="save-image"
      title="Save image"
      subtitle="The plan with its outline and every measurement on it, ready for your report."
      size="lg"
      mobile="full"
      onClose={onClose}
      // Side by side where there is width; stacked where there is only
      // height, with the preview taking whatever the options do not.
      bodyClassName={`flex !overflow-hidden ${isMobile ? 'flex-col' : ''}`}
      footerClassName={isMobile ? 'flex flex-col gap-2 px-4 py-3' : 'flex items-center gap-2.5 px-6 py-3.5'}
      footer={footer}
    >
      {/* preview */}
      <div
        ref={previewBoxRef}
        className="relative flex-1 min-w-0 min-h-[220px] grid place-items-center p-5 bg-sunken overflow-hidden"
      >
        {error ? (
          <div className="max-w-[320px] text-center">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-crit" aria-hidden="true" />
            <p className="text-[16px] text-fg-2">{error}</p>
          </div>
        ) : (
          <canvas
            ref={previewCanvasRef}
            className={`shadow-sheet rounded-[2px] transition-opacity duration-150
                        ${rendering ? 'opacity-40' : 'opacity-100'}`}
          />
        )}
        {rendering && (
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-2
                           px-3.5 h-8 rounded-full bg-panel-2 border border-line
                           text-[15.5px] text-fg-3">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            Preparing the image…
          </span>
        )}
      </div>

      {/* options */}
      <div
        className={`shrink-0 overflow-y-auto overscroll-contain px-5 py-5 touch-dense
          ${isMobile
            ? 'border-t border-line-soft max-h-[42%]'
            : 'w-[330px] border-l border-line-soft'}`}
      >
        <label htmlFor="export-subject" className="card-heading block mb-1.5">Title</label>
        <input
          id="export-subject"
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="123 Main St"
          autoComplete="off"
          // The one thing still to type on an unnamed measurement. Never on a
          // phone: autofocus raises the keyboard over the preview the dialog
          // exists to show, before the user has decided to type anything.
          autoFocus={!projectName && !isMobile}
          className="field-input text-left"
        />
        <p className="mt-1.5 text-[15.5px] leading-snug text-fg-3">
          Usually the property address. It is printed at the top of the image and
          used as the file name.
        </p>

        <h3 className="card-heading mt-6 mb-1">Show on the image</h3>
        <Toggle
          checked={options.summary}
          onChange={(v) => setOption('summary', v)}
          label="Summary of the measurements"
          hint="The area, its breakdown and where the scale came from"
        />
        <Toggle
          checked={options.outlineLabels}
          onChange={(v) => setOption('outlineLabels', v)}
          label="Name and area on each outline"
        />
        <Toggle
          checked={options.sideLengths}
          onChange={(v) => setOption('sideLengths', v)}
          label="Wall lengths"
          hint={calibrated ? undefined : 'Needs a scale first'}
          disabled={!calibrated}
        />
        <Toggle
          checked={options.annotations}
          onChange={(v) => setOption('annotations', v)}
          label="Your own measurements"
          hint={hasAnnotations ? 'Distances and areas you measured' : 'You haven’t measured anything'}
          disabled={!hasAnnotations}
        />

        {actionError && (
          <p role="alert" className="note note-crit mt-5">{actionError}</p>
        )}

        {/* What a picture cannot show — a doubtful scale, an area counted
            twice — is printed on the image, and said here so it is not a
            surprise in the report. */}
        {result?.model?.flags?.length > 0 && (
          <p className="note note-warn mt-5 font-normal text-fg-2">
            <b className="text-warn font-semibold">
              {result.model.flags.length === 1
                ? 'One note about this measurement'
                : `${result.model.flags.length} notes about this measurement`}
            </b>
            {result.model.flags.length === 1
              ? ' is printed on the image, so whoever reads it sees it.'
              : ' are printed on the image, so whoever reads it sees them.'}
          </p>
        )}
      </div>
    </Dialog>
  );
};

export default ExportDialog;
