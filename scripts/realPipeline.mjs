/**
 * The mechanical steps between the agents' steps of the key protocol
 * (datasets/README.md, "Running the key pipeline"): blind packets, the
 * comparison of two annotations, finalizing the keys that agree, the freeze,
 * and the numbers a milestone report needs. Each command works on a set of
 * plans, prints one line per plan and a summary, exits non-zero when any plan
 * ended in an error or a failed check, and can be run again: it does what is
 * still to do and never deletes anything. It reads the plans, so it is for the
 * orchestrator; a role that draws or checks a key blind uses realKeyTool.
 *
 * Usage:  node scripts/realPipeline.mjs COMMAND [selector] [options]   (--help prints this)
 *
 * Selectors, which every command but `adjudicated` (one plan, by name) and
 * `backup` (the whole folder) needs, and `stats` takes to narrow: --names A,B
 * (repeatable, or the names bare), --book X (a book or site unit, as the
 * manifest's `book`; the book as logged, or the site, match too), --split
 * dev|test (from the manifest, else splits.json), --all. They combine as
 * filters: --names picks exactly those plans, else every plan; --book and
 * --split then keep what is in that book and that split. With none of the
 * four the command refuses and lists them.
 *
 *   status [selector] [--json] [--no-check | --recheck]
 *       One row per plan: packet (ok, STALE when the plan's image is no longer
 *       the packet's, -), A and B (ok = snapped; `existing` = A is the imported
 *       draft; unsnapped = a spec but no snapped file), compare (agree,
 *       DISAGREE with the criteria that failed, stale = a key changed since,
 *       -), final, check (PASS, FAIL, ? = never run, (old) = of another key),
 *       review (approved, rejected(n), revised(n) = the key changed after a
 *       rejection, approved-STALE = the key or its notes changed after the
 *       approval, -), rnd (review rounds), frozen (yes = the plan's answerKey
 *       is checked, draft = it holds an unchecked stored key). Then one summary
 *       line per stage. The check result is cached beside the key
 *       (keys-wip/NAME.check.json) under a fingerprint of the key, its spec, the
 *       plan and the packet's labels: a check is about a second, so a status of
 *       400 plans runs one only for a final key that has none for its current
 *       fingerprint (and writes that file: the one thing status writes).
 *       --no-check runs none and writes nothing; --recheck runs them all again.
 *       --json is the same for a machine.
 *   packets [selector]
 *       `realKeyTool blind` for each plan: the annotator's packet
 *       keys-wip/packets/NAME/ (the plan's image, the scan's labels, the size),
 *       and nothing about the trace. Run again any time.
 *   import-existing [selector | --all-existing]
 *       For plans whose stored key is a draft nobody checked (answerKey.by
 *       starts with "Claude", no `checked`): writes keys-wip/NAME.a.json (the
 *       stored outlines as `v` with every edge in `fix`, since an earlier snap
 *       placed them; the record's notes; author "existing-draft";
 *       "existingDraft": true) and NAME.a.snapped.json, so annotation A of the
 *       first 75 plans is the existing key. The plan is not touched. A plan whose
 *       key is checked is refused; so is one whose A someone else drew, and a key
 *       with holes (a spec cannot hold them). Naming a plan that is not such a
 *       draft is a refusal; reaching it through --all, --book or --split skips it.
 *   compare-all [selector] [--redo]
 *       `realKeyTool compare NAME` for every plan with A and B snapped: writes
 *       NAME.compare.json and prints one line per plan (agree or DISAGREE, the
 *       smallest per-type IoU, the worst boundary distance, the criteria that
 *       failed), then the tally: how many were compared, the agreement rate, and
 *       how many failed types, building IoU, non-GLA IoU and distance. A
 *       comparison newer than both keys is kept ("(kept)"); --redo recomputes.
 *   finalize-agreed [selector]
 *       For every plan whose fresh comparison says agree and that has no final
 *       key yet: NAME.final.json and NAME.final.snapped.json as copies of A's,
 *       NAME.record.json {annotators [A's author, B's], adjudicator null,
 *       verifiedBy "blind double annotation", agreement {the compare figures}},
 *       then `check` on the final key. A plan whose check FAILs is marked "needs
 *       adjudication" (its final is kept). Refuses when A and B name one author,
 *       or either names none: the reviewer's independence rests on it.
 *   finalize-single [selector]
 *       For dev plans that have A and no B: the same, with verifiedBy "single
 *       annotation" and annotators [A's author]. Refuses a plan whose split is
 *       not dev (every test plan gets a B) and one whose A is the existing draft
 *       (every existing plan needs an independent B).
 *   adjudicated NAME --adjudicator TAG
 *       After an adjudicator wrote the final key with `snap --role final`:
 *       NAME.record.json {annotators (the A and B specs' authors), adjudicator
 *       TAG, verifiedBy "blind double annotation", agreement (from
 *       NAME.compare.json), adjudicated true}, then `check`. Refuses an
 *       adjudicator who drew A or B.
 *   sample selector --fraction F --seed N [--exclude-existing]
 *       A deterministic random sample of the selected plans (sorted, then a
 *       seeded shuffle: the same plans and seed give the same sample). Prints the
 *       seed, the size and the names comma-separated. Writes nothing. This is
 *       "30% of the rest of dev get a B" (--split dev --fraction 0.3
 *       --exclude-existing). --exclude-existing leaves out the plans that were in
 *       the set before the sourcing log: no line in sources.jsonl and no source
 *       of their own, or an existing draft as A.
 *   stats [selector] [--json]
 *       The four numbers of a milestone report, from the files: agreement rate
 *       (overall, by era, by book), adjudication rate (adjudicated of finalized),
 *       the final review's send-back rate (rejections of reviews) with the rounds
 *       per plan, and the disputes tally from orchestration/disputes.md, whose
 *       machine-readable line is
 *           DISPUTE <id> plan=NAME status=decided|open outcome=changed|kept direction=toward-tracer|away|neutral
 *       (latest line per id wins; outcome only when decided; direction for a
 *       changed key; a line that starts DISPUTE and is not that is reported and
 *       exits 1). Warns when every changed key moved toward the tracer.
 *   freeze selector [--dry] [--backup | --backup-name NAME]
 *       For plans whose latest review approved this very final key and spec, that
 *       pass `check`, and are not yet frozen: the key tool's `apply` (which writes
 *       the key and the record into the plan). Refuses, by name, a plan whose
 *       approval is stale (the final key or its notes changed after it) or that
 *       has no record; says why the rest are not ready. After the batch it runs
 *       `realKeys export` and, with --backup, `backup`. --dry says what would be
 *       frozen and writes nothing. Then: node scripts/realManifest.mjs build.
 *   backup [--name real-backup-YYYY-MM-DD]
 *       Copies the set folder to <set folder>/../<name>/ (everything but folders
 *       named zz-*), never over an existing folder (the name becomes NAME-2, ...),
 *       and verifies the copy: file count, bytes, and the SHA-256 of
 *       answer-keys.json and of orchestration/manifest.json.
 *
 * Where things live: the set folder is datasets/real/ of the main checkout
 * (FLOORTRACE_REAL_DIR overrides it: point it at a scratch copy to try a
 * command). Work files are in <set>/keys-wip/ as realKeyTool defines them, plus
 * NAME.check.json (the cached check). Every write into the set goes through the
 * key tool's retrying, atomic writer (Google Drive holds files it syncs).
 *
 * Exit status: 0 on success; 1 when a plan ended in an error, a refusal or a
 * failed check, or the request failed; 2 on a command line that cannot be read.
 */
import fs from 'fs';
import { fileURLToPath } from 'url';
import { COMMANDS } from './lib/pipelineCommands.mjs';
import { UsageError } from './lib/keyCommands.mjs';
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
  const ctx = { dir: realDir(), root: ROOT, out: (line) => console.log(line) };
  try {
    return await run(rest, ctx);
  } catch (error) {
    console.error(`${command}: ${error.message}`);
    return error instanceof UsageError ? 2 : 1;
  }
};

process.exitCode = await main(process.argv.slice(2));
