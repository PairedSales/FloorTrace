/**
 * The real set's manifest: which book is in which split, and the file that
 * names, for every plan, its split, era, source and the fingerprint of the key it
 * was frozen with (datasets/README.md, "Running the key pipeline"). `bench:real`
 * reads it; every scoreboard number names its hash.
 *
 * Usage:  node scripts/realManifest.mjs COMMAND ...      (--help prints this)
 *
 *   assign-splits --seed N [--roster FILE | (the set folder's own plans)]
 *                 [--pin-dev BOOK,BOOK... | --pin-existing] [--target-test 150]
 *                 [--total 400] [--write [--replace]] [--created-at ISO]
 *       Assigns whole books (the sourcing log's cap units: a plan-book, or a
 *       designer code on an aggregator site) to dev or test, with a fixed seed,
 *       stratified by era x decade. Books named in --pin-dev are dev first, and
 *       their plans count toward dev (--pin-existing pins every book none of
 *       whose plans is in sources.jsonl: the 17 that predate it). In each stratum
 *       the other books are sorted by name and shuffled by a stream seeded from
 *       --seed and the stratum; a book goes to test when that brings the running
 *       count of test plans closer to the running share --target-test/--total of
 *       all the plans so far. Whole books mean a stratum ends up to about one book
 *       off its share, the running target carries the rest forward, and the total
 *       lands within about half a book of --target-test. The roster is read from
 *       the set folder (sources.jsonl for logged plans, else the plan's name:
 *       book, era, decade, publisher, plans per book) or from --roster FILE, a
 *       JSON array [{"book","era","decade","publisher","plans"}]. Prints plans
 *       per era x decade and split with the deviation from the target, then per
 *       split x era, then each book's split. --write writes
 *       orchestration/splits.json {seed, createdAt, params, books: {<book>: {split,
 *       era, decade, publisher, plans}}}; the same roster and seed give the same
 *       file byte for byte (an existing file that would not change is left as it
 *       is, its createdAt included; --created-at fixes the time for a
 *       reproduction). A splits.json holding another assignment is not replaced
 *       without --replace, which keeps the old one as splits-superseded-<hash>.json.
 *   build [--allow-partial] [--reason TEXT]
 *       Assembles orchestration/manifest.json from the plan files, splits.json,
 *       sources.jsonl and each plan's answerKey record and keys-wip/NAME.record.json.
 *       Only plans whose record is `checked` enter; a plan that is not is listed
 *       and fails the build unless --allow-partial leaves it out. Per plan: book,
 *       site, publisher, era, decade, year, split, source ({url, crop, size}, or
 *       {embedded: true} for the plans whose image lives in the plan), keySha256
 *       (of what realKeys keyOf returns) and annotation {annotators, adjudicator,
 *       adjudicated, agreement, verifiedBy, checked[, disputeId]}. The file is a
 *       pure function of those inputs, with keys sorted and a fixed layout, so the
 *       same inputs are the same bytes and hash (nothing in it says when it was
 *       built). A new manifest is archived as manifest-versions/manifest-<first 12
 *       digits of the hash>.json and a row {version, hash, date, reason, counts} is
 *       appended to manifest-log.md; one that would not change the file logs
 *       nothing. Prints the SHA-256, the manifest hash every run of bench:real
 *       names.
 *   verify [--final] [--allow-partial]
 *       Checks the manifest against the folder, each rule PASS, FAIL or INFO:
 *       every manifest plan has its file and its key still hashes to its
 *       keySha256; every plan file is in the manifest (--allow-partial: INFO);
 *       every record is checked; each plan sits in the split splits.json gives its
 *       book; no book is in both splits. --final adds the finished set's rules:
 *       exactly 400 plans; at most 12 per book (unit) and 60 per site; at least 34
 *       books; test and dev sizes (INFO, aimed at 150 / 250); both splits hold
 *       both eras; at least 90% of the plans have a detected room size; no plan
 *       name looks like an address (three or more digits, then a street word);
 *       every new plan has a source; the 2020-2022 count (INFO, aimed at about 160
 *       of the 325 new). Exit 1 on any FAIL.
 *   hash
 *       Prints the SHA-256 of orchestration/manifest.json.
 *   amend PLAN --reason TEXT
 *       After a dispute changed a key (realKeyTool apply PLAN --dispute ID marks
 *       the plan's record with disputeId): rebuilds that plan's entry, keeping its
 *       book, era and split and every other entry as they are, writes the new
 *       manifest (a new hash, archived, a log row naming the dispute). Refuses a
 *       plan whose record has no disputeId, or that the manifest does not hold.
 *
 * Where things live: the set folder is datasets/real/ of the main checkout
 * (FLOORTRACE_REAL_DIR overrides it: point it at a scratch folder to try a
 * command). Everything written is under <set>/orchestration/, through the key
 * tool's retrying, atomic writer.
 *
 * Exit status: 0 on success; 1 on a failure or a failed rule; 2 on a command line
 * that cannot be read.
 */
import fs from 'fs';
import { fileURLToPath } from 'url';
import { COMMANDS } from './lib/manifestCommands.mjs';
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
