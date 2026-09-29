/**
 * Drawing, comparing and checking the real set's answer keys (datasets/README.md,
 * "Drawing and checking keys").
 *
 * A key is drawn blind, from crops of the plan at full zoom (the picture tool
 * shrinks a whole page and loses the wall faces), written roughly as a spec,
 * and snapped to the outer face of the wall bands the ink shows. Two
 * annotators draw it apart, `compare` finds where they differ, an adjudicator
 * settles it, `check` tests the result, a reviewer approves it, `apply` freezes
 * it into the plan. Blind roles use `blind`, `labels`, `view` (without --keys
 * and --trace), `probe`, `snap`, `compare` and `check`, and never the app's
 * trace, a benchmark result or another agent's opinion of the tracer. (`check`
 * reads the plan's scale, to put the key's area in sq ft for the stated-area
 * check, and prints it and the areas to whoever runs it, blind roles included:
 * the orchestrator accepted that.)
 *
 * A blind role never has to name keys-wip/ (its guard forbids it): `snap`,
 * `compare` and `check` take --tag T and then print, and copy their outputs
 * to, datasets/zz-scratch/T/ of the checkout (see each command). Where a
 * command prints "use this with --poly: PATH", `view --poly PATH` draws it.
 *
 * Usage:  node scripts/realKeyTool.mjs COMMAND ...      (--help prints this)
 *
 *   view IMAGE|NAME [--crop X0,Y0,X1,Y1] [--grid STEP] [--poly FILE]... [--tag T]
 *                   [--labels] [--bare] [--keys] [--trace] [--no-verts]
 *       A PNG of the page or of the crop, the long side scaled to about 1,400
 *       px, under datasets/zz-scratch/views/<TAG>/ of this checkout (TAG
 *       defaults to "default"; use your own so two agents on one plan never
 *       overwrite each other). The grid is in IMAGE PIXELS, labelled on all four
 *       edges (a crop of 300-500 px reads well with --grid 10 to 25; the
 *       default grid is chosen from the zoom); the legend says what each line
 *       is. Prints the PNG's path, then `crop x0,y0→x1,y1  scale N.NN px/px  grid S`.
 *         IMAGE  an image file (the blind packet's image.png, a cached page):
 *                the ink only, plus any --poly.
 *         NAME   a plan in the set: the bare image only, by default. This is
 *                what blind roles use.
 *         --poly FILE   outlines from a spec or snapped file (or a ring
 *                [[x, y], ...]); repeat it and each file gets its own line style
 *                (solid magenta, dashed blue, dotted orange, dash-dot black),
 *                so two keys compare visibly. Vertices are numbered
 *                "outline.vertex", the numbers `fix`/`in` and edge indexes use.
 *         --labels   the scan's labels as boxes with their ids (blind-safe).
 *         --bare     accepted, and does nothing more: a plan NAME is drawn as
 *                the bare image already, and the protocol's line reads "view
 *                --bare". With --keys or --trace it is an error.
 *         A crop that misses the page or shows under 2 px of it is an error;
 *                one reaching past the page is cut back to it (a note on stderr).
 *         --keys     the plan's stored key, by type. NOT for blind roles: it is
 *                for the orchestrator, the app checker and engineers.
 *         --trace    the app's own draft trace, dashed red (the tracer is run
 *                again on the plan). NOT for blind roles, for the same reason.
 *   blind NAME
 *       Writes the annotator's packet <set>/keys-wip/packets/NAME/: image.<ext>
 *       (the plan's exact bytes, so coordinates match the key's), labels.json
 *       (what the scan read: room sizes, garage/porch/patio names, level names,
 *       each with an id, a box in image px and a kind of room, nonGla or level),
 *       meta.json {name, width, height}. Nothing about the trace, the scale or
 *       any quality figure goes in. Run it again any time; it never refuses.
 *   labels NAME [--json]
 *       Prints the packet's labels: id, kind, box x,y,w,h, text, printed size.
 *       (The plan's own scan when the plan has no packet.)
 *   probe IMAGE|NAME --from X,Y --to X,Y [--step 0.5]
 *   probe IMAGE|NAME --across X,Y,ANGLE_DEG --half 12 [--step 0.5]
 *       The luminance along a segment at pixel centres, the page's ink
 *       threshold, and the runs: `dark 12.0-17.5 (5.5 px)`. Settles "which line
 *       is the wall face". --across reads through a point at an angle (0 = along
 *       +x, 90 = down the page) with distances from that point. A segment that
 *       leaves the image is an error.
 *   snap NAME --role a|b|final --spec FILE [--tag T] [--replace] [--dry]
 *       Validates the spec you wrote in your scratch folder, copies it to
 *       <set>/keys-wip/NAME.<role>.json, moves every edge to the outer face of
 *       the wall band the ink shows, prints each edge's move and flag, and
 *       writes NAME.<role>.snapped.json {outlines: [{type, v}], flagged, ...}.
 *       It reads the plan for its image only (the packet's image when there is
 *       one), never its trace or key, and never writes into the plan. --dry is
 *       accepted and changes nothing (it is not a preview: snap always writes
 *       keys-wip/, and says so). --tag T also writes copies, NAME.<role>.snapped.json
 *       and NAME.<role>.json (the spec), into datasets/zz-scratch/T/ of the
 *       checkout, prints their paths instead of the set's, and prints
 *       `use this with --poly: <the snapped copy>`. A vertex more than 2 px outside the
 *       image is an error. Role a or b already holding a spec is not replaced
 *       without --replace unless the new spec names the same "author" (a spec
 *       with no author cannot show it is anyone's): only your own spec is yours
 *       to snap again. A replaced spec is said so; role final is the
 *       adjudicator's, whoever it is.
 *         {"author": "a-<plan>", "notes": "...",
 *          "outlines": [{"type": "gla", "v": [[x, y], ...], "name": "first floor",
 *                        "fix": [edge...], "in": [edge...], "R": 14, "tilt": false,
 *                        "bridge": 2.5}],
 *          "waive": [{"label": "d3", "reason": "..."}],
 *          "stated": [{"sqft": 1250, "of": "first floor", "explained": "..."}]}
 *       type: gla, below-grade, garage, porch or unfinished. Edge i runs from
 *       v[i] to v[i+1]. `fix` edges stay where drawn, `in` edges take the band's
 *       inner face (a garage or porch edge along the house wall), `R` is the
 *       search reach in px, `tilt` follows a scan-tilted wall, `bridge` (px)
 *       is the gap a hatched or double-line wall may have without ending its
 *       band (default 2.5; 0 reads the stroke nearest your line alone). A vertex written ["ref", k, i] is vertex i of outline
 *       k after it snapped, so two outlines share a boundary exactly.
 *       `waive` excuses a label from the label check with a reason the reviewer
 *       reads; `stated` gives areas the page prints, for the stated-area check.
 *       Flags: no-band, reaches-end, far (moved over 4 px), ink-beyond (another
 *       band within 10 px past the face used: hatched or double-line wall, a
 *       dimension line, or a window frame or sill drawn proud of the wall that a
 *       bridge was refused for covering too little of the edge), bridged (the face
 *       is the end of a stroke joined across a gap, not of the stroke nearest your
 *       line: it says by how many px), partial (the stroke the face is read from
 *       covers under 60% as much of the edge as the strongest stroke on it: a
 *       frame you drew on), unstable (the face moves over 1 px more when read
 *       again from where the edge landed). A gap is bridged only between strokes
 *       that are each at least 60% as continuous as the wall, so a window frame
 *       is never joined to the wall silently. Look at every flagged edge at full
 *       zoom. The flags are kept in the snapped file for `check`.
 *   compare NAME | A_SNAPPED B_SNAPPED [--json] [--draw OUT.png] [--tag T]
 *                [--image IMAGE|NAME] [--crop X0,Y0,X1,Y1]
 *       NAME compares keys-wip/NAME.a.snapped.json with NAME.b.snapped.json and
 *       writes NAME.compare.json. Prints per-type IoU, outline-type counts, the
 *       largest and 95th-percentile boundary distance (both directions), and the
 *       protocol's verdict (IoU is exact, from the polygons, not a raster): AGREE
 *       when the outline types match, building IoU is
 *       at least 99%, garage and porch IoU each at least 97%, and no boundary
 *       point is over 3 px from the other key's; else DISAGREE with each failed
 *       criterion and the disagreement regions (bbox in image px and largest
 *       distance, worst first) to crop at. Unfinished space is not scored, so
 *       it is in neither the IoUs nor the boundary distance, and an unfinished
 *       outline under 2% of ITS OWN key's building area (gla + below-grade,
 *       summed) is not counted as an outline type: it is listed under
 *       "informational" (compare.json's `informational`) and does not decide
 *       agreement. A larger unfinished outline in one key only fails the types.
 *       --draw writes A solid, B dashed with
 *       the regions boxed and numbered; a bare file name goes to the views
 *       folder of --tag, a path is used as given; two files need --image.
 *       With NAME, --tag T also copies both keys (NAME.a.snapped.json,
 *       NAME.b.snapped.json, and their specs NAME.a.json, NAME.b.json) and
 *       NAME.compare.json into datasets/zz-scratch/T/, prints those paths
 *       instead of the set's, and `use this with --poly: PATH` for each key.
 *   check NAME [--role a|b|final] [--feet-per-pixel X] [--tag T] [--json]
 *       The automatic checks on keys-wip/NAME.<role>.snapped.json (role defaults
 *       to final) with its spec: closed and not self-crossing; building and
 *       non-GLA outlines not overlapping beyond a shared boundary (tolerance
 *       max(2 px x shared boundary, 0.2% of the smaller outline)); every room
 *       label inside a gla, below-grade or unfinished outline and every nonGla
 *       label inside a garage, porch or unfinished one (a label's spot is its
 *       box's centre; a spec `waive` reports it waived, a label in no outline
 *       warns); every edge not in `fix` within 2 px of a wall face on a fresh
 *       snap, and a warning for each such edge the first snap flagged far,
 *       reaches-end, ink-beyond, bridged, partial or unstable (a snapped key lies
 *       on its band, so only those flags show that a thin line beside the wall
 *       captured an edge); the page the key was snapped on is the plan's size (a
 *       plan drafted again is another page: a fail); stated areas within 5% of
 *       the key at the plan's scale unless `explained`. The labels are the blind packet's when there is one (the ids
 *       and kinds the annotators saw), else the plan's scan; a packet that no
 *       longer matches the scan is a warning. Prints a table, the areas in sq ft,
 *       then CHECK PASS or CHECK FAIL (n); exits non-zero on a fail. A stated
 *       area's `of` names an outline (its `name`), a type (all of that type),
 *       or is compared with total GLA (the gla outlines only). --tag T names
 *       the `snap --tag T` copy, not the set's file, where a path is printed
 *       (--json's `snappedFile`, left out when there is no copy). It prints the
 *       plan's own scale and areas to whoever runs it, blind roles included.
 *   review NAME --approve|--reject --agent ID [--region X0,Y0,X1,Y1 --reason "..."]
 *          [--note "..."]
 *       Records the final reviewer's decision in keys-wip/NAME.review-<n>.json
 *       (n counts up; two reviewers at once take two numbers) with the hash of
 *       the final key and of the final spec (its notes, waivers and stated
 *       figures) it looked at. A rejection needs a reason. Refuses an agent that
 *       drew or adjudicated the key.
 *   apply NAME [--dispute ID]
 *       The freeze for one plan. Needs NAME.final.snapped.json, a passing check,
 *       NAME.record.json ({"annotators": [...], "adjudicator": null|"...",
 *       "verifiedBy": "blind double annotation"|"single annotation"}, written by
 *       the orchestrator) and a latest review that approved this very key and
 *       this very spec (the notes it records). Writes
 *       the key into the plan with the record {by, verifiedBy, checked: {by: "AI
 *       review", at, via: "final review"}, at, notes[, disputeId]}, and nothing
 *       else. A plan whose record is already checked is refused unless --dispute,
 *       and a --dispute whose final key is the key the plan already holds is
 *       refused too: a dispute id marks a change, so a dispute the key survived is
 *       logged, not applied. Run `node scripts/realKeys.mjs export` afterwards.
 *   sheet NAME... --out FILE [--per N]
 *       Review sheets: each plan whole with its stored key, its record and its
 *       notes, N plans to an image (default 4). Shows the stored key, so it is
 *       not for blind roles.
 *   score NAME FILE [--json]
 *       The verdict of the outlines in FILE against the plan's stored key, by
 *       the code `bench:real` judges by (lib/realScore.mjs, lib/verdict.mjs).
 *       For the app checker, which reads the outlines from the running app; it
 *       reads the stored key, so it is never for a role that draws or checks a
 *       key blind. A plan with no key yet is refused ("no answer key yet"), and
 *       a test-split plan (per the manifest) needs FLOORTRACE_TEST_SPLIT_OK=1,
 *       the orchestrator's, as in bench:real.
 *       FILE is JSON, in one of two shapes:
 *         {"outlines": [{"type": "gla", "vertices": [{"x": 1, "y": 2}, ...]
 *                        or "points": [[1, 2], ...], "holes": [...], "closed": true}, ...],
 *          "confidence": 0.93, "warnings": ["code", ...]}      or a bare array of outlines
 *         {"rings": [[[x, y], ...], ...], "confidence": 0.93}   each ring a traced
 *                        floor's outer polygon, as a bench:real run file's app.rings
 *       Coordinates are image px of the plan's own image. The traced area is the
 *       union of the gla and below-grade outlines (no type is gla) less their
 *       holes, filled as bench:real fills a trace's floors; garage, porch and
 *       unfinished outlines are left out, and an outline with closed: false or
 *       under 3 points is skipped, each said. Prints the verdict, IoU, area
 *       error, the error by cause (non-GLA kept, other taken in, living space
 *       missed) and its largest regions; with a confidence, the confidence and
 *       whether the outline is WRONG BUT SHOWN AS GOOD (verdict wrong and
 *       confidence at least 75%). --json prints the same as JSON. Exit 0 whatever
 *       the verdict; 1 on an error.
 *
 * Where things live: the set folder is datasets/real/ of the main checkout
 * (FLOORTRACE_REAL_DIR overrides it: point it at a scratch copy to try `apply`).
 * Work files are in <set>/keys-wip/: NAME.a.json, NAME.a.snapped.json (also b,
 * final), NAME.compare.json, NAME.review-<n>.json, NAME.record.json, packets/.
 * Every write into the set retries while Google Drive holds a file. A command
 * that writes into the set takes its input from a file in your own scratch folder
 * (datasets/zz-scratch/<tag>/ of the checkout), because an agent's file writer
 * cannot reach the set; the tool does the copying.
 *
 * Exit status: 0 on success, 1 on an error or a failed check (one line says why),
 * 2 on a usage error.
 */
import fs from 'fs';
import { fileURLToPath } from 'url';
import { COMMANDS, UsageError } from './lib/keyCommands.mjs';
import { ROOT, realDir } from './lib/keyFiles.mjs';

const helpText = () => {
  const source = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const block = /^\/\*\*([\s\S]*?)\*\//.exec(source)?.[1] ?? '';
  return block.split('\n').map((line) => line.replace(/^ ?\* ?/, '')).join('\n').trim();
};

const main = async (argv) => {
  const [command, ...rest] = argv;
  if (!command || ['--help', '-h', 'help'].includes(command) || rest.includes('--help')) {
    console.log(helpText());
    return command ? 0 : 2;
  }
  const run = COMMANDS[command];
  if (!run) {
    console.error(`unknown command "${command}" (view, blind, labels, probe, snap, compare, check, review, apply, sheet, score; --help for the manual)`);
    return 2;
  }
  const ctx = { dir: realDir(), root: ROOT, out: (line) => console.log(line) };
  try {
    return await run(rest, ctx);
  } catch (error) {
    console.error(`${command}: ${error.message}`);
    return error instanceof UsageError ? 2 : 1;
  }
};

process.exitCode = await main(process.argv.slice(2));
