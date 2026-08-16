import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Copy, Download, Loader2, FileJson, AlertTriangle } from 'lucide-react';
import useAppStore from '../store/appStore';
import { notify, flash } from '../utils/notify';
import { readExportOptions, writeExportOptions } from '../utils/exhibit/options';

/**
 * The end of the job. Almost nobody reopens a trace — they trace once for one
 * appraisal and need a picture of every number for the workfile — so the
 * terminal action is an image of the plan *with its measurements on it*, and
 * the editable `.floorplan` is the second door out rather than the only one.
 *
 * The preview is the very canvas that gets copied or saved, scaled down. A
 * preview drawn by a second code path is a preview that can disagree with the
 * file, which on a document somebody files is the worst kind of bug.
 */

const Toggle = ({ checked, onChange, label, hint, disabled }) => (
  <label className={`flex items-start gap-2.5 py-1.5 group
    ${disabled ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-[3px] w-[15px] h-[15px] accent-accent shrink-0
                 cursor-pointer disabled:cursor-default"
    />
    <span className="min-w-0">
      <span className="block text-[12.5px] leading-snug text-fg-2 group-hover:text-fg">{label}</span>
      {hint && <span className="block text-[11.5px] leading-snug text-fg-dim mt-px">{hint}</span>}
    </span>
  </label>
);

const ExportDialog = ({ onClose, onSaveProject }) => {
  const projectName = useAppStore((s) => s.projectName);
  const setProjectName = useAppStore((s) => s.setProjectName);
  const measurementLines = useAppStore((s) => s.measurementLines);
  const customShapes = useAppStore((s) => s.customShapes);
  const calibrated = useAppStore((s) => s.calibration?.calibrated);

  const [options, setOptions] = useState(readExportOptions);
  const [result, setResult] = useState(null);   // { canvas, model, layout }
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);       // 'copy' | 'save' | null

  const dialogRef = useRef(null);
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
  // Debounced because the subject line re-renders the page on every keystroke,
  // and the page is a full-size canvas.
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

  // ── keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // A modal that lets Tab wander into the canvas behind it is a modal only
      // for the mouse.
      const focusable = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // ── actions ───────────────────────────────────────────────────────────────
  const withBusy = async (kind, fn) => {
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      console.error('Export failed:', err);
      notify(err.message || 'The export failed.', { type: 'error', id: 'export' });
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = () => withBusy('copy', async () => {
    const { copyExhibit } = await import('../utils/exhibit');
    await copyExhibit(result.canvas);
    flash('Measurement image copied to the clipboard');
    onClose();
  });

  const handleSave = () => withBusy('save', async () => {
    const { saveExhibit, exhibitFilename } = await import('../utils/exhibit');
    const saved = await saveExhibit(result.canvas, exhibitFilename(result.model));
    if (saved) {
      flash('Measurement image saved');
      onClose();
    }
  });

  const ready = !!result && !rendering && !error;
  const size = result ? `${result.canvas.width} × ${result.canvas.height} px` : '—';

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-6"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Export for your workfile"
        className="flex flex-col w-full max-w-[1040px] max-h-[90vh] bg-panel border border-line
                   rounded-xl shadow-2xl animate-fade-in overflow-hidden"
      >
        <header className="flex items-center gap-3 px-4 py-3 border-b border-line shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-[13.5px] font-semibold text-fg">Export for your workfile</h2>
            <p className="text-[11.5px] text-fg-3 mt-px">
              One image with the plan, the outlines and every number on it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="grid place-items-center w-7 h-7 rounded-md text-fg-3
                       hover:bg-sunken hover:text-fg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex flex-1 min-h-0">
          {/* preview */}
          <div
            ref={previewBoxRef}
            className="relative flex-1 min-w-0 grid place-items-center p-4 bg-sunken overflow-hidden"
          >
            {error ? (
              <div className="max-w-[320px] text-center">
                <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-crit" aria-hidden="true" />
                <p className="text-[12.5px] text-fg-2">{error}</p>
              </div>
            ) : (
              <canvas
                ref={previewCanvasRef}
                className={`shadow-sheet rounded-[2px] transition-opacity duration-150
                            ${rendering ? 'opacity-40' : 'opacity-100'}`}
              />
            )}
            {rendering && (
              <span className="absolute bottom-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5
                               px-2.5 h-6 rounded-full bg-panel-2 border border-line
                               text-[11.5px] text-fg-3">
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                Drawing the page…
              </span>
            )}
          </div>

          {/* options */}
          <div className="w-[286px] shrink-0 border-l border-line overflow-y-auto p-3.5">
            <label htmlFor="export-subject" className="card-heading block mb-1.5">Subject</label>
            <input
              id="export-subject"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="123 Main St"
              autoComplete="off"
              // The one thing still to type on an unnamed measurement; once it
              // has a subject, the primary action is what should be under the
              // cursor instead.
              autoFocus={!projectName}
              className="w-full px-2.5 py-1.5 text-[12.5px] rounded-md bg-panel-2 border border-line
                         text-fg placeholder-fg-dim select-text
                         focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent"
            />
            <p className="mt-1.5 text-[11.5px] leading-snug text-fg-dim">
              Titles the image and names the file. Saved with the project.
            </p>

            <h3 className="card-heading mt-4 mb-1">On the page</h3>
            <Toggle
              checked={options.summary}
              onChange={(v) => setOption('summary', v)}
              label="Measurement summary"
              hint="Area, breakdown, scale and every outline"
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
              hint={calibrated ? undefined : 'Needs a scale'}
              disabled={!calibrated}
            />
            <Toggle
              checked={options.annotations}
              onChange={(v) => setOption('annotations', v)}
              label="Your measure lines and areas"
              hint={hasAnnotations ? undefined : 'None drawn'}
              disabled={!hasAnnotations}
            />

            <div className="mt-4 pt-3 border-t border-line-soft">
              <h3 className="card-heading mb-1.5">Image</h3>
              <p className="text-[12px] text-fg-3 font-mono tabular-nums">{size}</p>
              <p className="mt-1 text-[11.5px] leading-snug text-fg-dim">
                PNG at the plan’s own resolution.
              </p>
            </div>

            {result?.model?.flags?.length > 0 && (
              <div className="mt-4 p-2.5 rounded-md bg-warn/12 border border-warn/35">
                <p className="text-[11.5px] leading-snug text-fg-2">
                  <b className="text-warn font-semibold">
                    {result.model.flags.length} thing{result.model.flags.length === 1 ? '' : 's'} to check
                  </b>
                  {' — printed on the page so the workfile carries them too.'}
                </p>
              </div>
            )}
          </div>
        </div>

        <footer className="flex items-center gap-2 px-4 py-3 border-t border-line bg-panel-2 shrink-0">
          <button
            type="button"
            onClick={() => { onClose(); onSaveProject(); }}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12.5px]
                       text-fg-3 hover:text-fg hover:bg-sunken transition-colors cursor-pointer"
            title="Save a .floorplan file you can reopen and keep editing"
          >
            <FileJson className="w-[15px] h-[15px]" aria-hidden="true" />
            Save editable project instead
          </button>

          <div className="flex-1" />

          <button
            type="button"
            onClick={handleCopy}
            disabled={!ready || !!busy}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line
                       bg-panel-2 text-[12.5px] font-medium text-fg-2 hover:text-fg
                       hover:border-accent/50 transition-colors cursor-pointer
                       disabled:opacity-40 disabled:cursor-default"
          >
            {busy === 'copy'
              ? <Loader2 className="w-[15px] h-[15px] animate-spin" aria-hidden="true" />
              : <Copy className="w-[15px] h-[15px]" aria-hidden="true" />}
            Copy image
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={!ready || !!busy}
            autoFocus={!!projectName}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-md bg-accent
                       text-accent-ink text-[12.5px] font-semibold hover:brightness-110
                       transition-[filter] cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            {busy === 'save'
              ? <Loader2 className="w-[15px] h-[15px] animate-spin" aria-hidden="true" />
              : <Download className="w-[15px] h-[15px]" aria-hidden="true" />}
            Save PNG
          </button>
        </footer>
      </div>
    </div>
  );
};

export default ExportDialog;
