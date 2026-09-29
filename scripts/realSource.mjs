/**
 * Sourcing plans for the real set from archive.org (datasets/README.md,
 * "Sourcing plans"): find house-plan books and Wayback captures of builder
 * sites, look through their pages, choose crops, and log what was drafted and
 * what was left out. Drafting itself is `node scripts/realDrafts.mjs "<URL>"
 * --name NAME --crop X,Y,W,H`.
 *
 * Usage:  node scripts/realSource.mjs COMMAND ...      (--help prints this)
 *
 * The rules of the road (they are enforced, not requested):
 *  - Only archive.org and its subdomains (web.archive.org, ia*.us.archive.org)
 *    are ever fetched, redirects included; anything else is refused.
 *  - One request at a time across every process on the machine, with a gap of
 *    1000 ms between requests to web.archive.org (a trailing dot on the host
 *    changes nothing) and 300 ms elsewhere. A 429, a 5xx or a timeout backs
 *    off (Retry-After honoured) for every process, and after four tries the
 *    command fails with a message. A process waiting for the lock sleeps
 *    between looks; it fails with a message after about six minutes, or after
 *    30 s of not being able to create or move the lock file (Google Drive or
 *    an antivirus holding it).
 *  - Nothing is fetched twice. Pages are cached under datasets/archive-cache/
 *    of the main checkout (items/<id>/n<leaf>.jpg, urls/<hash>.<ext>; API
 *    answers for a day under api/). A cached image counts only if it starts
 *    with an image's magic bytes: an HTML error page is never cached as one.
 *  - Writes go to the cache, to datasets/zz-scratch/views/<TAG>/ of this
 *    checkout, and (log, report) to <set>/orchestration/. Nothing is deleted.
 *  Every command that writes a file prints its absolute path.
 *
 *   search QUERY [--rows N] [--year FROM-TO] [--page N] [--sort "downloads desc"] [--raw] [--refresh]
 *       archive.org advanced search over texts. Plain words must all be in the
 *       title or the subject (`house plans` is searched as title:(house AND
 *       plans) OR subject:(house AND plans); typed as is, archive.org matches
 *       any word anywhere and the first hits are memos that mention a house).
 *       Anything with Lucene syntax (a quote, field:, parentheses, AND/OR/NOT)
 *       is sent as typed, and so is anything with --raw. The query sent is
 *       printed. Prints identifier, year, leaf count (blank when the search
 *       lacks it: `meta` counts), title, creator, and [borrow-only] where the
 *       search says so. Try: "home plans", "house plans", bungalows,
 *       "small homes", "plan book", with --year 1915-1965.
 *   meta ID [--refresh]
 *       The item's title, year, publisher, LEAF COUNT, collections, and whether
 *       ANYONE CAN VIEW ITS PAGES: the borrow-only flag (access-restricted-item),
 *       lending collections, and a test of one page image (about 40% through
 *       the book; it says which leaf, the URL and what came back, and keeps the
 *       page in the cache). Prints the page URL pattern
 *       https://archive.org/download/ID/page/n<leaf> (full resolution, for
 *       example 2072x2973; a width suffix does not make it smaller). Exit 1 if
 *       the pages are not viewable, with the reasons.
 *   leaf ID N [--ext jpg]
 *       Downloads leaf N (or takes it from the cache); prints its path, its
 *       pixel size, and the source URL to record for a plan drawn from it.
 *       Leaves are numbered from 0. archive.org answers a leaf past the end of
 *       a book with HTTP 200 and the last page, so a mistyped leaf looks real:
 *       when the book's leaf count is in the cache (`meta ID` puts it there)
 *       leaf, contact, grid ID:LEAF and screen --leaves refuse or skip a leaf
 *       past it and fetch nothing (contact skips them with a WARNING and draws
 *       the rest); with no cached count they say so in a note.
 *   contact ID FROM TO [--step S] [--cols C] [--rows R] [--tag T]
 *       A contact sheet PNG of leaves FROM..TO (every S-th), each shrunk to a
 *       cell and labelled with its leaf number: 12 to a sheet by default (4
 *       across, 3 down, about 1,600 px each way), so a run of pages can be
 *       scanned for plan pages at a glance. More leaves than fit make more
 *       sheets. At most 96 leaves a call. Uses the cache: a second call costs no
 *       requests. Written to datasets/zz-scratch/views/<TAG>/ (TAG defaults to
 *       "default"; use your own).
 *   grid IMAGE|ID:LEAF [--crop X0,Y0,X1,Y1] [--grid STEP] [--tag T]
 *       A gridded view of a page to choose a crop from: the key tool's view,
 *       grid labelled in the page's own pixels on all four edges. ID:LEAF names
 *       a cached leaf (fetched if it is not cached). Read crop coordinates from
 *       views of 300-500 px with a grid of 10-25 px, never from a whole page.
 *       Prints the PNG's path, then `crop x0,y0->x1,y1  scale N px/px  grid S`.
 *   screen ID [--samples 5] [--leaves n1,n2,...]
 *       Runs the app's own scan (Tesseract path) on sampled pages of a book and
 *       prints the number of labels read per page and per book.
 *       WARNING: the label count may help find books that print room sizes in
 *       type. It must never be used to drop a page that qualifies (integrity
 *       rule 6): pages the app reads badly are the point. One scan at a time
 *       on the machine (it is CPU-heavy, and a scan that loses a CPU race drops
 *       labels silently), so never run it beside a benchmark or a draft.
 *   cdx URL_PREFIX [--from 2020] [--to 2022] [--mime image/] [--status 200]
 *       [--collapse urlkey] [--limit N] [--match prefix|exact|domain]
 *       [--min-length BYTES] [--pattern REGEX] [--scan N] [--refresh]
 *       Wayback CDX search. Prints each capture's timestamp, mime type, length
 *       and original URL, then the ready-to-use original-bytes URL
 *       https://web.archive.org/web/<timestamp>id_/<original> (record that as
 *       a modern plan's source). Defaults are the project's: captures from 2020
 *       to 2022, status 200, images (--mime image/ is every image type; all is
 *       no filter). --collapse urlkey keeps one capture per URL (digest: per
 *       distinct image). --pattern is a regular expression on the original URL
 *       (applied by the index). --min-length drops small rows (thumbnails); the
 *       length is the archived record's size, close to the image's; the index
 *       cuts at --limit before that filter, so it reads --scan rows (10x the
 *       limit by default) and keeps what passes.
 *   fetch URL [--name N]
 *       Downloads any archive.org URL (an id_ Wayback URL, or a page URL) into
 *       the cache; prints its path, mime type and pixel size. Refuses a
 *       response that is not an image and caches nothing. --name also keeps a
 *       copy as <cache>/named/N.<ext> (never over a different image).
 *   log plan --name N --book B --era vintage|2020-2022 --year Y --url U
 *       --crop X,Y,W,H --line "<the builder line>" [--publisher P] [--leaf L]
 *       [--size W,H] [--decade D] [--tag T] [--unit CODE] [--site NAME]
 *       [--replace] [--no-verify]
 *   log reject --book B (--leaf L | --url U) --reason R [--tag T]
 *   log book --book B [--id ID] [--publisher P] [--year Y] [--leaves N] [--note "..."]
 *       Appends an event to <set>/orchestration/sources.jsonl (one JSON object a
 *       line, under a lock, retrying while Google Drive holds the file) and
 *       regenerates sources.md. Events are checked:
 *         plan    name is <book><yy>-n<leaf>[a|b] (vintage) or <site><yy>-<id>
 *                 (modern), its yy is the year's, its leaf is --leaf; era and
 *                 year agree (modern: 2020-2022, and --url is the capture's
 *                 https://web.archive.org/web/<timestamp>id_/... in that year);
 *                 crop is X,Y,W,H whole numbers (x, y >= 0); --line is the
 *                 builder line, whole (labels, cut-off regions and scale are
 *                 read from it); a name already logged is refused unless
 *                 --replace (the old entry stays, marked superseded). --book
 *                 must look like the name's stem (pacific25: "Pacific 1925")
 *                 or name a `log book` entry, and a stem already logged under
 *                 one spelling is not logged under another: one book, one
 *                 spelling. A vintage leaf at or past the book's leaf count
 *                 (cached metadata, else a `log book --leaves` entry) is
 *                 refused. --size
 *                 defaults to what the plan itself records. When the plan is in
 *                 the set folder its recorded source (url, crop, size) must
 *                 match the log (--no-verify skips that). A plan under ~1,000 px
 *                 across, cut-off regions or no labels print a WARNING, and so
 *                 does a plan that takes its book, unit or site over a cap.
 *                 The cap unit is a book, or the name's stem, or --unit (the
 *                 designer code of a plan on an aggregator site such as
 *                 houseplans.net; 12 per unit); --site (default: the book)
 *                 groups a site's plans (60 per site). A plan with a --unit
 *                 does not count toward its --book's 12.
 *         reject  the reason is one of: 3d, elevation, site-plan, too-small,
 *                 hand-lettered, not-us-home, duplicate-house, not-a-plan, or
 *                 other:<text>. How well the app traces a page is NOT a reason:
 *                 a page qualifies before it is drafted (integrity rule 6), and
 *                 an other: text about the tracer, the scan or the labels is
 *                 refused.
 *         book    a book or site looked at, for the report's headings.
 *   report
 *       Regenerates sources.md (plans by book or site, rejected pages, totals)
 *       and prints per-book and per-era counts and every cap broken: a book,
 *       name stem or --unit over 12 plans (the spellings it was typed as are
 *       shown), a site over 60.
 *
 * Where things live: the set folder is datasets/real/ of the main checkout
 * (FLOORTRACE_REAL_DIR overrides it: point it at a scratch folder to try `log`).
 * The cache is datasets/archive-cache/ of the main checkout
 * (FLOORTRACE_ARCHIVE_CACHE overrides it). FLOORTRACE_SOURCE_GAP_WAYBACK_MS and
 * FLOORTRACE_SOURCE_GAP_MS set the gaps; _TRIES, _TIMEOUT_MS, _BACKOFF_MS and
 * _MAX_WAIT_MS the retries; _LOCK_WAIT_MS and _LOCK_FAULT_MS how long a process
 * waits for the request lock.
 *
 * Exit status: 0 on success; 1 on a well formed request that fails (the
 * network, a refused URL, a log entry the validators refuse, a book whose pages
 * are not viewable; one line says why); 2 on a command line that cannot be
 * read (an unknown command or option, a missing argument, a value of the wrong
 * form such as `cdx --from soon`, `--match banana` or `grid --crop 1,2,3`).
 */
import fs from 'fs';
import { fileURLToPath } from 'url';
import { COMMANDS, UsageError } from './lib/sourceCommands.mjs';
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
    console.error(`unknown command "${command}" (${Object.keys(COMMANDS).join(', ')}; --help for the manual)`);
    return 2;
  }
  const ctx = {
    dir: realDir(), root: ROOT, env: process.env, out: (line) => console.log(line), err: (line) => console.error(line),
  };
  try {
    return await run(rest, ctx);
  } catch (error) {
    console.error(`${command}: ${error.message}`);
    return error instanceof UsageError ? 2 : 1;
  }
};

process.exitCode = await main(process.argv.slice(2));
