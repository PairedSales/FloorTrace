// The rules of the real-plan set's roles (.claude/hooks/blindRules.mjs), the
// PreToolUse guard the blind roles run (.claude/hooks/blind-guard.mjs), the role
// files that wire it up (.claude/agents/), and the transcript audit
// (scripts/auditBlind.mjs). A tool call that would show an annotator,
// adjudicator, reviewer or sourcer the app's trace, a benchmark result or
// another key is refused; the calls their work needs are not. The paths below
// are made up: the tests need no set folder.
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';
import { BLIND_ROLES, ROLES, SCANNED_TOOLS, normalise, violation } from '../../../.claude/hooks/blindRules.mjs';
import { ROLE_OF_PREFIX, auditDir, auditRecords, main } from '../../auditBlind.mjs';
import { parseBuilderLine } from '../sourceLog.mjs';

// A few tests start node (and bash) a dozen times: seconds each on a busy machine.
vi.setConfig({ testTimeout: 60000 });

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const HOOKS = path.join(ROOT, '.claude/hooks');
const GUARD = path.join(HOOKS, 'blind-guard.mjs');
const AGENTS = path.join(ROOT, '.claude/agents');
const AUDIT = path.join(ROOT, 'scripts/auditBlind.mjs');

// The set folder as a Windows path with a space in it (the usual trouble), and
// as a POSIX path; the datasets folder that holds it.
const SET = 'C:\\Work Space\\FloorTrace\\datasets\\real';
const SETF = 'C:/Work Space/FloorTrace/datasets/real';
const POSIX = '/home/dev/FloorTrace/datasets/real';
const DATASETS = 'C:\\Work Space\\FloorTrace\\datasets';
const PACKET = `${SET}\\keys-wip\\packets\\aladdin62-n15`;

const bash = (command) => ({ command, description: 'a call' });
const read = (file) => ({ file_path: file });
const grep = (pattern, where, glob) => ({ pattern, ...(where ? { path: where } : {}), ...(glob ? { glob } : {}) });
const glob = (pattern, where) => ({ pattern, ...(where ? { path: where } : {}) });
const tool = (name) => `node scripts/${name}`;
const KEYTOOL = tool('realKeyTool.mjs');

// Every call of `calls` for `role` is refused (with a reason matching `reason`
// when given) or every one is allowed.
const refused = (role, calls, { reason, ...options } = {}) => {
  for (const [what, input] of Object.entries(calls)) {
    const why = violation(role, input, options);
    expect(why, `${role} should be refused: ${what}`).not.toBeNull();
    if (reason) expect(why, `${role}, ${what}`).toMatch(reason);
  }
};
const allowed = (role, calls, options) => {
  for (const [what, input] of Object.entries(calls)) {
    expect(violation(role, input, options), `${role} should be allowed: ${what}`).toBeNull();
  }
};

describe('normalise', () => {
  it('reads a quoted, backslashed, dotted path as the path it is', () => {
    expect(normalise({ command: 'node "C:\\a b\\scripts\\realKeyTool.mjs" view x' })).toBe('node c:/a b/scripts/realkeytool.mjs view x');
    expect(normalise({ command: "cat keys-'wip'/x" })).toBe('cat keys-wip/x');
    expect(normalise({ p: 'C:\\d\\datasets\\real\\keys-wip\\packets\\..\\x.json' })).toBe('c:/d/datasets/real/keys-wip/x.json');
    expect(normalise({ p: 'datasets/zz-scratch/../real/keys-wip/x' })).toBe('datasets/real/keys-wip/x');
    expect(normalise({ p: 'datasets/real//keys-wip/./x' })).toBe('datasets/real/keys-wip/x');
    expect(normalise({ p: '../../datasets/real' })).toBe('../../datasets/real');
  });

  it('reads a JSON-encoded payload that would not parse, and skips only the call\'s description', () => {
    expect(normalise('{"command":"node \\"C:\\\\a b\\\\realKeyTool.mjs\\" view"}')).toContain('c:/a b/realkeytool.mjs view');
    expect(normalise({ command: 'ls', description: 'real_runs' })).toBe('ls');
    expect(normalise({ nested: { description: 'real_runs' } })).toContain('real_runs');
  });
});

describe('what no blind role may see', () => {
  const EVERYONE = {
    'a plan file': bash(`cat "${SET}\\aladdin62-n15.floorplan" | head -c 100`),
    'a plan file by Read': read(`${POSIX}/aladdin62-n15.floorplan`),
    'the run folder through ..': read(`${SET}\\keys-wip\\..\\..\\real_runs\\master-43d42e6.json`),
    'the answer keys': read(`${SET}\\answer-keys.json`),
    'the benchmark command': bash('npm run bench:real -- --only aladdin62-n15'),
    'the plan-scale benchmark': bash('npm run bench:scale'),
    'the tracer': bash('node scripts/traceDebug.mjs aladdin62-n15'),
    'the key tool with the trace': bash(`${KEYTOOL} view aladdin62-n15 --trace`),
    'the key tool with the keys': bash(`${KEYTOOL} view aladdin62-n15 --keys --crop 0,0,9,9`),
    'the key tool with the keys after other flags': bash(`${KEYTOOL} view ${PACKET}\\image.png --crop 0,0,9,9 --grid 20 --keys`),
    'a double-quoted script path': bash(`node "${SET.replace('datasets\\real', 'scripts')}\\realKeyTool.mjs" view p1 --trace`),
    'a PowerShell call operator with a quoted script': bash('& node "scripts\\realKeyTool.mjs" view p1 --keys'),
    'a quoted script path with the trace flag last': bash(`node "C:\\Work Space\\FloorTrace\\scripts\\realKeyTool.mjs" view "${PACKET}\\image.jpg" --grid 20 --trace`),
    'the set folder as a working directory': bash(`cd "${SET}\\keys-wip" && ls`),
    'a search of the whole datasets folder': grep('outlines|lastTraceOutcome', DATASETS),
    'a recursive listing of the datasets folder': bash(`Get-ChildItem ${DATASETS}\\ -Recurse | Select-String outlines`),
    'a wildcard over the datasets folder': bash(`cat ${DATASETS.replace(/\\/g, '/')}/*/*.json`),
  };

  it('refuses every role the plan files, benchmark results, the keys file, the tracer and the trace views', () => {
    for (const role of BLIND_ROLES) refused(role, EVERYONE);
  });

  it('refuses each pattern for its reason', () => {
    for (const role of BLIND_ROLES) {
      refused(role, { a: bash('ls datasets/real_runs') }, { reason: /benchmark results/ });
      refused(role, { a: read('datasets/cubicasa5k_runs/dev.json') }, { reason: /benchmark results/ });
      refused(role, { a: bash('ls C:/x/datasets/real-backup-2026-09-30') }, { reason: /backup/ });
      refused(role, { a: bash('cat x/answer-keys.json') }, { reason: /keys file/ });
      refused(role, { a: bash('node -e "JSON.parse(x).perimeterTraces"') }, { reason: /trace/ });
      refused(role, { a: bash('$env:FLOORTRACE_REAL_DIR="x"; node scripts/realKeyTool.mjs labels p1') }, { reason: /re-pointed/ });
      refused(role, { a: bash('FLOORTRACE_TEST_SPLIT_OK=1 node scripts/x.mjs') }, { reason: /re-pointed|test-split/ });
      for (const command of [
        'npm run bench:cubicasa -- --split dev', 'npm run bench:detection', 'npm run bench:real', 'npm run bench:scale', 'npm run bench:ocr',
        'node scripts/realBenchmark.mjs', 'node scripts/cubicasaBenchmark.mjs', 'node scripts/detectionBenchmark.mjs', 'node scripts/scaleBenchmark.mjs',
        'node scripts/traceDebug.mjs x', 'node scripts/drawBoundary.mjs x', 'npm run probe:exterior',
      ]) refused(role, { [command]: bash(command) }, { reason: /tracer or a benchmark/ });
      refused(role, { a: bash(`${KEYTOOL} view p1 --trace`) }, { reason: /trace or the stored keys/ });
      // A folder the allow-list would open is still no working directory: a
      // relative path from there is not checked.
      const packet = `${SET}\\keys-wip\\packets\\aladdin62-n15`;
      refused(role, {
        cd: bash(`cd "${packet}" && ls`),
        pushd: bash(`pushd "${packet}"; ls`),
        chdir: bash(`chdir ${packet.replace(/\\/g, '/')}`),
        setLocation: bash(`Set-Location -Path '${packet}'; Get-ChildItem`),
        relative: bash('cd datasets/real/keys-wip/packets/aladdin62-n15'),
      }, { reason: /working directory/ });
    }
    refused('reviewer', { a: bash(`${KEYTOOL} score p1 out.json --keys`) }, { reason: /trace or the stored keys/ });
  });

  it('refuses the orchestrator\'s folder, and says a sourcer logs through the tool', () => {
    for (const role of BLIND_ROLES) refused(role, { a: read(`${SET}\\orchestration\\failures.md`), b: bash('cat orchestration/manifest.json') });
    refused('sourcer', { a: bash('cat somewhere/orchestration/sources.md') }, { reason: /realSource\.mjs/ });
  });

  it('does not mistake the orchestrator\'s worktree, or prose in a description, for them', () => {
    allowed('annotator', {
      worktree: bash('cd "C:\\Work Space\\FloorTrace\\.claude\\worktrees\\floortrace-orchestrator-prompt-02471a" && node scripts/realKeyTool.mjs --help'),
      described: { command: 'ls scripts', description: 'Not looking at real_runs or orchestration or keys-wip' },
    });
  });
});

describe('the set folder, allowed per role', () => {
  // Spellings of one path: backslashes, forward slashes, mixed case, a POSIX
  // path, a relative one from a worktree, a `..` detour, quoting.
  const spell = (rel) => ({
    windows: read(`${SET}\\${rel.replace(/\//g, '\\')}`),
    forward: read(`${SETF}/${rel}`),
    upper: read(`${SET.toUpperCase()}\\${rel.replace(/\//g, '\\').toUpperCase()}`),
    posix: read(`${POSIX}/${rel}`),
    relative: bash(`cat ../../datasets/real/${rel}`),
    detour: bash(`cat "${SETF}/keys-wip/packets/../../${rel}"`),
    viaScratch: bash(`cat "C:/Work Space/FloorTrace/datasets/zz-scratch/../real/${rel}"`),
    quoted: bash(`Get-Content -Path '${SET}\\${rel.replace(/\//g, '\\')}'`),
    stripped: bash(`cat ${SETF.replace('datasets/real', "datasets/'real'")}/${rel}`),
    bare: bash(`cat ${rel.startsWith('keys-wip/') ? '' : 'nothing-to-see/'}${rel}`),
  });
  // A bare relative `keys-wip/...` is checked; other relative names carry no set marker.
  const spellings = (rel) => {
    const all = spell(rel);
    if (!rel.startsWith('keys-wip/')) delete all.bare;
    return all;
  };

  describe('annotator', () => {
    it('opens the packets, and no key of the set folder in the live guard', () => {
      allowed('annotator', {
        ...spellings('keys-wip/packets/aladdin62-n15/labels.json'),
        image: bash(`${KEYTOOL} view "${PACKET}\\image.jpg" --crop 0,0,400,400 --grid 20 --tag a-x`),
        listing: bash(`ls "${PACKET}"`),
        packets: bash(`ls ${SETF}/keys-wip/packets/`),
        wildcardInPacket: bash(`cat ${SETF}/keys-wip/packets/*/meta.json`),
        labels: bash(`${KEYTOOL} labels aladdin62-n15`),
      });
      refused('annotator', {
        ...spellings('keys-wip/aladdin62-n15.a.snapped.json'),
        ...Object.fromEntries(Object.entries(spellings('keys-wip/aladdin62-n15.b.json')).map(([k, v]) => [`b ${k}`, v])),
      });
    });

    it('opens its own key files when the letter is known, and not the other annotator\'s', () => {
      for (const letter of ['a', 'b']) {
        const other = letter === 'a' ? 'b' : 'a';
        allowed('annotator', {
          ...spellings(`keys-wip/aladdin62-n15.${letter}.snapped.json`),
          spec: read(`${SET}\\keys-wip\\aladdin62-n15.${letter}.json`),
        }, { letter });
        refused('annotator', spellings(`keys-wip/aladdin62-n15.${other}.snapped.json`), { letter });
        refused('annotator', {
          final: read(`${SET}\\keys-wip\\aladdin62-n15.final.json`),
          compare: read(`${SET}\\keys-wip\\aladdin62-n15.compare.json`),
          review: read(`${SET}\\keys-wip\\aladdin62-n15.review-1.json`),
          legacy: read(`${SET}\\keys-wip\\aladdin62-n15.json`),
          unlettered: read(`${SET}\\keys-wip\\aladdin62-n15.${letter}`),
        }, { letter });
      }
    });

    it('opens nothing else of the set folder: the folder, keys-wip, its neighbours, wildcards, searches', () => {
      refused('annotator', {
        root: bash(`ls "${SET}"`),
        rootSlash: bash(`ls ${SETF}/`),
        keysWip: bash(`ls "${SET}\\keys-wip"`),
        keysWipRelative: bash('ls datasets/real/keys-wip'),
        relativeKeysWip: bash('cat keys-wip/aladdin62-n15.b.json'),
        packetsLookalike: read(`${SET}\\keys-wip\\packets-old\\x.json`),
        packetsPrefix: bash(`cat ${SETF}/keys-wip/packets*/x.json`),
        detourOutOfPackets: read(`${SET}\\keys-wip\\packets\\..\\aladdin62-n15.b.snapped.json`),
        detourThroughScratch: read(`C:\\Work Space\\FloorTrace\\datasets\\zz-scratch\\..\\real\\keys-wip\\aladdin62-n15.b.snapped.json`),
        detourToTheRoot: read(`${SET}\\keys-wip\\packets\\..\\..\\PROGRESS.md`),
        detourToTheRootFolder: bash(`ls "${SET}\\keys-wip\\packets\\..\\.."`),
        progress: read(`${SET}\\PROGRESS.md`),
        handoff: read(`${SET}\\HANDOFF.md`),
        inbox: read(`${SET}\\inbox\\listing-001.png`),
        excluded: bash(`ls ${SETF}/excluded`),
        wildcardRoot: bash(`cat "${SETF}"/*.json`),
        wildcardKeysWip: bash(`cat ${SETF}/keys-wip/*.json`),
        wildcardMiddle: bash(`cat ${SETF}/*/packets/x/labels.json`),
        variable: bash(`cat ${SETF}/keys-wip/$name.b.json`),
        grepRoot: grep('outlines|lastTraceOutcome', SET),
        grepRootGlob: grep('outlines', SET, '*.snapped.json'),
        grepKeysWip: grep('outlines', `${SET}\\keys-wip`),
        globRoot: glob('**/*.json', SET),
        globPattern: glob(`${SETF}/**/*.json`),
        recurse: bash(`Get-ChildItem "${SET}" -Recurse | Select-String outlines`),
      });
    });
  });

  describe('adjudicator', () => {
    it('opens the packets, both keys and their specs, the compare report and its own final key', () => {
      allowed('adjudicator', {
        ...spellings('keys-wip/packets/aladdin62-n15/image.jpg'),
        ...spellings('keys-wip/aladdin62-n15.a.snapped.json'),
        ...spellings('keys-wip/aladdin62-n15.b.json'),
        ...spellings('keys-wip/aladdin62-n15.final.snapped.json'),
        ...spellings('keys-wip/aladdin62-n15.final.json'),
        ...spellings('keys-wip/aladdin62-n15.compare.json'),
      });
    });

    it('opens no review, record, unlettered key, or anything else of the folder', () => {
      refused('adjudicator', {
        review: read(`${SET}\\keys-wip\\aladdin62-n15.review-1.json`),
        record: read(`${SET}\\keys-wip\\aladdin62-n15.record.json`),
        legacy: read(`${SET}\\keys-wip\\aladdin62-n15.json`),
        legacySnapped: read(`${SET}\\keys-wip\\aladdin62-n15.snapped.json`),
        keysWip: bash(`ls "${SET}\\keys-wip"`),
        wildcard: bash(`cat ${SETF}/keys-wip/*.a.snapped.json`),
        root: grep('outlines', SET),
        inbox: read(`${SET}\\inbox\\x.png`),
        progress: read(`${SET}\\PROGRESS.md`),
      });
    });
  });

  describe('reviewer', () => {
    it('opens the packets, the final key and its spec, and the reviews', () => {
      allowed('reviewer', {
        ...spellings('keys-wip/packets/aladdin62-n15/image.jpg'),
        ...spellings('keys-wip/aladdin62-n15.final.snapped.json'),
        ...spellings('keys-wip/aladdin62-n15.final.json'),
        ...spellings('keys-wip/aladdin62-n15.review-2.json'),
      });
    });

    it('opens neither annotator\'s key, nor the compare report, the record, or a legacy key', () => {
      refused('reviewer', {
        ...spellings('keys-wip/aladdin62-n15.a.snapped.json'),
        ...Object.fromEntries(Object.entries(spellings('keys-wip/aladdin62-n15.b.json')).map(([k, v]) => [`b ${k}`, v])),
        compare: read(`${SET}\\keys-wip\\aladdin62-n15.compare.json`),
        record: read(`${SET}\\keys-wip\\aladdin62-n15.record.json`),
        legacy: read(`${SET}\\keys-wip\\aladdin62-n15.json`),
        legacySnapped: read(`${SET}\\keys-wip\\aladdin62-n15.snapped.json`),
        reviewLookalike: read(`${SET}\\keys-wip\\aladdin62-n15.review-x.json`),
        wildcard: bash(`cat ${SETF}/keys-wip/*.final.*`),
        root: bash(`ls "${SET}"`),
      });
    });
  });

  describe('sourcer', () => {
    it('opens the inbox and nothing of keys-wip, not even the packets', () => {
      allowed('sourcer', { inbox: read(`${SET}\\inbox\\listing-001.png`), inboxList: bash(`ls "${SET}\\inbox"`), inboxWild: bash(`ls ${SETF}/inbox/*.png`) });
      refused('sourcer', {
        ...spellings('keys-wip/packets/aladdin62-n15/labels.json'),
        ...spellings('keys-wip/aladdin62-n15.final.json'),
        keysWip: bash('ls datasets/real/keys-wip'),
        root: bash(`ls "${SET}"`),
        progress: read(`${SET}\\PROGRESS.md`),
      });
    });
  });

  it('never opens the folder to a role that has no rule for it: an unknown role is an error', () => {
    expect(() => violation('annotatr', bash('ls'))).toThrow(/unknown role "annotatr"/);
    expect(() => violation(undefined, bash('ls'))).toThrow(/unknown role/);
    expect(() => violation('annotator', bash('ls'), { letter: 'c' })).toThrow(/letter/);
    expect(ROLES).toEqual(expect.arrayContaining(BLIND_ROLES));
  });
});

describe('the key tool and the other scripts, per role', () => {
  const view = bash(`${KEYTOOL} view "${PACKET}\\image.jpg" --crop 0,0,400,400 --grid 20 --tag x --poly datasets/zz-scratch/x/snapped.json`);

  it('lets an annotator do its work', () => {
    allowed('annotator', {
      view,
      packetImage: bash(`${KEYTOOL} view "${PACKET}/image.png" --crop 0,0,400,400 --grid 20 --tag a-x`),
      quotedScript: bash(`node "C:\\Work Space\\FloorTrace\\scripts\\realKeyTool.mjs" view "${PACKET}\\image.jpg" --grid 100`),
      probe: bash(`${KEYTOOL} probe "${PACKET}\\image.jpg" --from 1,2 --to 3,4`),
      probeAcross: bash(`${KEYTOOL} probe "${PACKET}\\image.jpg" --across 10,20,90 --half 12`),
      snap: bash(`${KEYTOOL} snap aladdin62-n15 --role a --spec datasets/zz-scratch/a-x/spec.json --dry`),
      snapB: bash(`${KEYTOOL} snap aladdin62-n15 --role b --spec datasets/zz-scratch/b-x/spec.json`),
      snapTag: bash(`${KEYTOOL} snap aladdin62-n15 --role a --spec datasets/zz-scratch/a-x/spec.json --tag a-x`),
      checkTag: bash(`${KEYTOOL} check aladdin62-n15 --role a --tag a-x`),
      viewScratchCopy: bash(`${KEYTOOL} view "${PACKET}\\image.jpg" --poly datasets/zz-scratch/a-x/aladdin62-n15.a.snapped.json --crop 0,0,300,300`),
      check: bash(`${KEYTOOL} check aladdin62-n15 --role a`),
      checkScale: bash(`${KEYTOOL} check aladdin62-n15 --role b --feet-per-pixel 0.0501`),
      labels: bash(`${KEYTOOL} labels aladdin62-n15`),
      blind: bash(`${KEYTOOL} blind aladdin62-n15`),
      help: bash(`${KEYTOOL} --help | head -60`),
      chained: bash(`cd "C:\\Work Space\\FloorTrace" && ${KEYTOOL} snap p1 --role a --spec s.json && ${KEYTOOL} check p1 --role a 2>&1 | tail -20`),
      powershell: bash(`Set-Location "C:\\Work Space\\FloorTrace"; node scripts/realKeyTool.mjs check p1 --role a`),
      readsTheToolsSource: read('scripts/realKeyTool.mjs'),
      readsTheReadme: grep('Drawing and checking keys', 'datasets/README.md'),
    });
    allowed('annotator', { snapA: bash(`${KEYTOOL} snap p1 --role a --spec s.json`), checkA: bash(`${KEYTOOL} check p1 --role a`) }, { letter: 'a' });
  });

  it('refuses an annotator the commands that show a key, freeze one, or run the tracer', () => {
    refused('annotator', {
      compare: bash(`${KEYTOOL} compare aladdin62-n15`),
      compareFiles: bash(`${KEYTOOL} compare a.json b.json --image x.png`),
      sheet: bash(`${KEYTOOL} sheet aladdin62-n15 --out sheet.png`),
      apply: bash(`${KEYTOOL} apply aladdin62-n15`),
      review: bash(`${KEYTOOL} review aladdin62-n15 --approve --agent x`),
      score: bash(`${KEYTOOL} score aladdin62-n15 out.json`),
      checkWithoutRole: bash(`${KEYTOOL} check aladdin62-n15`),
      checkWithoutRoleChained: bash(`cd x && ${KEYTOOL} check aladdin62-n15 && ls`),
      checkFinal: bash(`${KEYTOOL} check aladdin62-n15 --role final`),
      snapFinal: bash(`${KEYTOOL} snap aladdin62-n15 --role final --spec s.json`),
      snapWithoutRole: bash(`${KEYTOOL} snap aladdin62-n15 --spec s.json`),
      chainedCompare: bash(`${KEYTOOL} check p1 --role a && ${KEYTOOL} compare p1`),
      quotedCompare: bash('& node "scripts\\realKeyTool.mjs" compare p1'),
      drafts: bash('node scripts/realDrafts.mjs "https://archive.org/x" --name x --force'),
      runDiff: bash('node scripts/realRunDiff.mjs a b'),
      keys: bash('node scripts/realKeys.mjs export'),
      keysApply: bash('node scripts/realKeys.mjs apply'),
    });
    refused('annotator', { snapOtherLetter: bash(`${KEYTOOL} snap p1 --role b --spec s.json`), checkOtherLetter: bash(`${KEYTOOL} check p1 --role b`) }, { letter: 'a', reason: /you are annotator a/ });
    refused('annotator', { checkWithoutRole: bash(`${KEYTOOL} check p1`), snapWithoutRole: bash(`${KEYTOOL} snap p1 --spec s.json`) }, { reason: /without --role/ });
    refused('annotator', { sheet: bash(`${KEYTOOL} sheet p1 --out x.png`) }, { reason: /annotators run/ });
  });

  it('lets an adjudicator compare and settle, and refuses it a freeze, a review and a snap into an annotator\'s key', () => {
    allowed('adjudicator', {
      view,
      compare: bash(`${KEYTOOL} compare aladdin62-n15 --draw out.png --tag adj-x`),
      snapFinal: bash(`${KEYTOOL} snap aladdin62-n15 --role final --spec datasets/zz-scratch/adj-x/spec.json`),
      checkFinal: bash(`${KEYTOOL} check aladdin62-n15 --role final`),
      checkDefault: bash(`${KEYTOOL} check aladdin62-n15`),
      checkA: bash(`${KEYTOOL} check aladdin62-n15 --role a`),
      probe: bash(`${KEYTOOL} probe "${PACKET}\\image.jpg" --from 1,2 --to 3,4`),
      labels: bash(`${KEYTOOL} labels aladdin62-n15`),
      blind: bash(`${KEYTOOL} blind aladdin62-n15`),
    });
    refused('adjudicator', {
      sheet: bash(`${KEYTOOL} sheet aladdin62-n15 --out s.png`),
      apply: bash(`${KEYTOOL} apply aladdin62-n15 --dispute d1`),
      review: bash(`${KEYTOOL} review aladdin62-n15 --approve --agent x`),
      score: bash(`${KEYTOOL} score aladdin62-n15 x.json`),
      snapA: bash(`${KEYTOOL} snap aladdin62-n15 --role a --spec s.json --replace`),
      snapWithoutRole: bash(`${KEYTOOL} snap aladdin62-n15 --spec s.json`),
      drafts: bash('node scripts/realDrafts.mjs x --name y'),
      runDiff: bash('node scripts/realRunDiff.mjs a b'),
      keys: bash('node scripts/realKeys.mjs export'),
    });
  });

  it('lets a reviewer view, check and record its decision, and refuses it the rest', () => {
    allowed('reviewer', {
      view,
      check: bash(`${KEYTOOL} check aladdin62-n15`),
      checkFinal: bash(`${KEYTOOL} check aladdin62-n15 --role final`),
      approve: bash(`${KEYTOOL} review aladdin62-n15 --approve --agent rev-1 --note "checked every corner"`),
      reject: bash(`${KEYTOOL} review aladdin62-n15 --reject --agent rev-1 --region 1,2,3,4 --reason "the edge is on the sill"`),
      probe: bash(`${KEYTOOL} probe "${PACKET}\\image.jpg" --across 10,20,90`),
      labels: bash(`${KEYTOOL} labels aladdin62-n15`),
      blind: bash(`${KEYTOOL} blind aladdin62-n15`),
    });
    refused('reviewer', {
      checkA: bash(`${KEYTOOL} check aladdin62-n15 --role a`),
      checkB: bash(`${KEYTOOL} check aladdin62-n15 --role=b`),
      compare: bash(`${KEYTOOL} compare aladdin62-n15`),
      sheet: bash(`${KEYTOOL} sheet aladdin62-n15 --out s.png`),
      apply: bash(`${KEYTOOL} apply aladdin62-n15`),
      snap: bash(`${KEYTOOL} snap aladdin62-n15 --role final --spec s.json`),
      score: bash(`${KEYTOOL} score aladdin62-n15 x.json`),
      drafts: bash('node scripts/realDrafts.mjs x --name y'),
    });
  });

  it('lets a sourcer view a page and draft and log, and refuses it every other key-tool command', () => {
    allowed('sourcer', {
      view: bash(`${KEYTOOL} view datasets/archive-cache/items/x/n12.jpg --crop 0,0,500,500 --grid 25 --tag src-x`),
      probe: bash(`${KEYTOOL} probe datasets/archive-cache/items/x/n12.jpg --from 1,2 --to 3,4`),
      drafts: bash('node scripts/realDrafts.mjs "https://archive.org/download/x/page/n12" --name x63-n12 --crop 1,2,3,4'),
      source: bash('node scripts/realSource.mjs search "house plans" --year 1915-1965'),
      report: bash('node scripts/realSource.mjs report'),
    });
    refused('sourcer', {
      sheet: bash(`${KEYTOOL} sheet p1 --out s.png`),
      compare: bash(`${KEYTOOL} compare p1`),
      check: bash(`${KEYTOOL} check p1`),
      snap: bash(`${KEYTOOL} snap p1 --role a --spec s.json`),
      labels: bash(`${KEYTOOL} labels p1`),
      blind: bash(`${KEYTOOL} blind p1`),
      runDiff: bash('node scripts/realRunDiff.mjs a b'),
      keys: bash('node scripts/realKeys.mjs export'),
      keysWip: bash('ls datasets/real/keys-wip'),
    });
  });
});

describe('the sourcer\'s logging call', () => {
  // What realDrafts.mjs prints: the line ends `-> <path>.floorplan`, and a
  // .floorplan holds the app's trace, so the sourcer pastes the line up to
  // (not including) ` -> `; realSource's --line parser reads only that part.
  const printed = `x63-n12: 21 labels (2 regions cut off), 7 rooms set the scale, 10.37 px/ft (good), 3 outline(s), trace ok -> ${SET}\\x63-n12.floorplan`;
  const trimmed = printed.slice(0, printed.indexOf(' -> '));
  const log = (line) => bash(`node scripts/realSource.mjs log plan --name x63-n12 --book x --era vintage --year 1963 --publisher X --leaf 12 --url https://archive.org/download/x/page/n12 --crop 1,2,3,4 --size 5,6 --line "${line}" --tag src-x`);

  it('is allowed with the line up to the arrow, and refused with the file it prints after it', () => {
    allowed('sourcer', { logged: log(trimmed) });
    refused('sourcer', { pastedWhole: log(printed) }, { reason: /\.floorplan/ });
  });

  it('is a line realSource\'s parser reads without the arrow', () => {
    expect(parseBuilderLine(trimmed)).toMatchObject({ name: 'x63-n12', labels: 21, cutOff: 2, rooms: 7, scale: '10.37 px/ft (good)', outlines: 3, level: 'ok' });
    expect(parseBuilderLine(printed)).toMatchObject({ name: 'x63-n12', level: 'ok' });
  });

  it('is the call sourcer.md documents', () => {
    const text = fs.readFileSync(path.join(AGENTS, 'sourcer.md'), 'utf8');
    expect(text).toMatch(/up to \(not including\) ` -> `/);
    expect(text).not.toMatch(/the builder line, whole/);
  });
});

describe('the engineer and the app checker', () => {
  const testPlans = ['distinctive57-n11', 'x63-n12'];

  it('lets an engineer see the trace, benchmark results and the keys of dev plans', () => {
    allowed('engineer', {
      bench: bash('npm run bench:real -- --split dev --jobs 4 --out master-abc-dev'),
      cubicasa: bash('npm run bench:cubicasa -- --split dev --workers 4 --out master-abc-dev'),
      overlay: read(`${SET}\\..\\real_runs\\master-abc-dev\\aladdin62-n15.png`),
      run: read(`${SET}/../real_runs/master-abc-dev.json`),
      keys: read(`${SET}\\answer-keys.json`),
      view: bash(`${KEYTOOL} view aladdin62-n15 --keys --trace --crop 0,0,400,400 --grid 20`),
      sheet: bash(`${KEYTOOL} sheet aladdin62-n15 --out s.png`),
      failures: read(`${SET}\\orchestration\\failures.md`),
      devPlan: read(`${SET}\\aladdin62-n15.floorplan`),
    }, { testPlans });
  });

  it('refuses an engineer the test split, however it is reached, and any key edit', () => {
    refused('engineer', {
      splitTest: bash('npm run bench:real -- --split test'),
      splitAll: bash('npm run bench:real -- --split all --out x'),
      splitEquals: bash('npm run bench:real -- --split=test'),
      override: bash('$env:FLOORTRACE_TEST_SPLIT_OK="1"; npm run bench:real -- --only x'),
      testRun: read(`${SET}\\..\\real_runs\\milestone-50.test.json`),
      apply: bash(`${KEYTOOL} apply aladdin62-n15 --dispute d1`),
      keysApply: bash('node scripts/realKeys.mjs apply'),
      drafts: bash('node scripts/realDrafts.mjs x --name y --force'),
    }, { testPlans });
    refused('engineer', { viewTestPlan: bash(`${KEYTOOL} view distinctive57-n11 --keys --trace`), readTestPlan: read(`${SET}\\X63-N12.floorplan`), only: bash('npm run bench:real -- --only aladdin62-n15,x63-n12') }, { testPlans, reason: /test-split plan/ });
    allowed('engineer', { longerName: bash(`${KEYTOOL} view x63-n12a --keys --trace`), otherName: bash(`${KEYTOOL} view x63-n1 --keys`) }, { testPlans });
  });

  it('lets an app checker run anything but a key edit', () => {
    allowed('app-checker', {
      bench: bash('npm run bench:real -- --only aladdin62-n15'),
      test: bash('npm run bench:real -- --split test'),
      score: bash(`${KEYTOOL} score aladdin62-n15 out.json`),
      view: bash(`${KEYTOOL} view aladdin62-n15 --keys --trace`),
    });
    refused('app-checker', { apply: bash(`${KEYTOOL} apply aladdin62-n15`), keysApply: bash('node scripts/realKeys.mjs apply') });
  });
});

describe('the role files', () => {
  const files = fs.readdirSync(AGENTS).filter((f) => f.endsWith('.md'));
  const text = (file) => fs.readFileSync(path.join(AGENTS, file), 'utf8').replace(/\r\n/g, '\n');
  const frontmatter = (file) => /^---\n([\s\S]*?)\n---\n/.exec(text(file))?.[1] ?? '';
  const nameOf = (file) => /^name:\s*(\S+)/m.exec(frontmatter(file))?.[1];

  it('holds a file per role of the protocol, named as its frontmatter says', () => {
    expect(files.map((f) => f.replace(/\.md$/, '')).sort()).toEqual([...BLIND_ROLES, 'engineer', 'app-checker', 'auditor'].sort());
    for (const file of files) expect(nameOf(file)).toBe(file.replace(/\.md$/, ''));
  });

  it.each(BLIND_ROLES)('wires the guard into %s, naming that role, failing closed', (role) => {
    const fm = frontmatter(`${role}.md`);
    expect(fm.match(/^\s*- type:/gm)).toHaveLength(1);
    expect(fm.match(/^hooks:/gm)).toHaveLength(1);
    // `shell: bash` sits beside `type: command` in the one hook entry.
    expect(fm).toMatch(/^ {2}PreToolUse:\n {4}- matcher: "([^"]*)"\n {6}hooks:\n {8}- type: command\n {10}shell: bash\n {10}command: '([^']*)'$/m);
    const [, matcher, command] = /matcher: "([^"]*)"[\s\S]*command: '([^']*)'/.exec(fm);
    // Every tool the audit reads, and nothing the rules do not know.
    expect(matcher.split('|').sort()).toEqual([...SCANNED_TOOLS].sort());
    // The hook names its own role (a typo drops that role's rules), and a script
    // that fails to run is a refusal.
    expect(command).toBe(`node "$CLAUDE_PROJECT_DIR/.claude/hooks/blind-guard.mjs" ${role} || exit 2`);
    expect(BLIND_ROLES).toContain(command.match(/blind-guard\.mjs" (\S+)/)[1]);
    expect(nameOf(`${role}.md`)).toBe(role);
  });

  it('hooks no role that is not blind', () => {
    for (const role of ['engineer', 'app-checker', 'auditor']) expect(frontmatter(`${role}.md`)).not.toMatch(/hooks:/);
  });

  it('carries no home directory in any role file, and names the set folder as a placeholder', () => {
    for (const file of files) {
      expect(text(file), file).not.toMatch(/[A-Za-z]:\\Users\\|[A-Za-z]:\/Users\/|\/Users\/[a-z]|\/home\/[a-z]/);
    }
    for (const role of [...BLIND_ROLES, 'engineer', 'app-checker', 'auditor']) expect(text(`${role}.md`), role).toContain('<set folder>');
  });

  it('tells each role only the folder its rules allow', () => {
    expect(text('sourcer.md')).not.toMatch(/keys-wip/);
    for (const role of ['annotator', 'adjudicator', 'reviewer']) expect(text(`${role}.md`)).toMatch(/keys-wip\/packets\/<NAME>/);
  });
});

// The frontmatter's own command, run the way Claude Code runs it: by bash, with
// $CLAUDE_PROJECT_DIR in a path that has a space in it.
const BASH = (() => {
  for (const candidate of ['bash', 'C:/Program Files/Git/bin/bash.exe']) {
    const probe = spawnSync(candidate, ['-c', 'echo "$PROBE_VAR"; node -v'], { env: { ...process.env, PROBE_VAR: 'a b' }, encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.startsWith('a b')) return candidate;
  }
  return null;
})();

describe('blind-guard', () => {
  // The guard's verdict on a payload: 'allow' (exit 0) or 'block' (exit 2); its stderr.
  const run = (role, input, { raw, script = GUARD } = {}) => {
    const result = spawnSync(process.execPath, [script, ...(role === undefined ? [] : [role])], {
      input: raw ?? JSON.stringify(input), encoding: 'utf8',
    });
    return { status: result.status, stderr: result.stderr, stdout: result.stdout };
  };
  const payload = (tool_name, tool_input) => ({ tool_name, tool_input });

  it('exits 2 with the reason for a call that would show a blind role what it must not see', () => {
    for (const role of BLIND_ROLES) {
      const result = run(role, payload('Bash', bash('cat datasets/real/aladdin62-n15.floorplan | head -c 100')));
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(`blind-guard (${role}): refused`);
      expect(result.stderr).toContain('.floorplan');
    }
  });

  it('exits 0 and prints nothing for the calls a role\'s work needs', () => {
    const packet = run('annotator', payload('Read', read(`${PACKET}\\labels.json`)));
    expect(packet).toMatchObject({ status: 0, stderr: '', stdout: '' });
    expect(run('adjudicator', payload('Read', read(`${SET}\\keys-wip\\aladdin62-n15.a.snapped.json`))).status).toBe(0);
    expect(run('sourcer', payload('Bash', bash('node scripts/realDrafts.mjs "https://archive.org/download/x/page/n12" --name x63-n12 --crop 1,2,3,4'))).status).toBe(0);
  });

  it('refuses in the live guard what the audit allows only for an annotator\'s own letter', () => {
    const own = payload('Read', read(`${SET}\\keys-wip\\aladdin62-n15.a.snapped.json`));
    expect(run('annotator', own).status).toBe(2);
    expect(violation('annotator', own.tool_input, { letter: 'a' })).toBeNull();
  });

  it('refuses a quoted script path, a wildcard search and a detour, as a process', () => {
    expect(run('annotator', payload('Bash', bash(`node "C:\\Work Space\\FloorTrace\\scripts\\realKeyTool.mjs" view p1 --trace`))).status).toBe(2);
    expect(run('annotator', payload('Grep', grep('outlines', SET))).status).toBe(2);
    expect(run('annotator', payload('Read', read(`${SET}\\keys-wip\\packets\\..\\aladdin62-n15.b.snapped.json`))).status).toBe(2);
  });

  it('scans a payload that will not parse instead of letting it through', () => {
    expect(run('annotator', null, { raw: 'cat C:\\x\\real_runs\\a.json' }).status).toBe(2);
    expect(run('annotator', null, { raw: 'not json at all' }).status).toBe(0);
    // A JSON payload cut off in the middle keeps its text, quotes and all.
    expect(run('annotator', null, { raw: '{"tool_name":"Bash","tool_input":{"command":"node \\"C:\\\\a b\\\\realKeyTool.mjs\\" view p1 --trace' }).status).toBe(2);
  });

  describe('fails closed', () => {
    it('on a role it does not know, or none: a typo in an agent file drops no rules', () => {
      const benign = payload('Bash', bash('ls'));
      const typo = run('annotatr', benign);
      expect(typo.status).toBe(2);
      expect(typo.stderr).toMatch(/unknown role "annotatr"/);
      expect(typo.stderr).toContain('fails closed');
      expect(run(undefined, benign).status).toBe(2);
      // The engineer has no hook: the guard is for the four blind roles.
      expect(run('engineer', benign).status).toBe(2);
    });

    const inTemp = (rulesSource) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blind guard '));
      fs.copyFileSync(GUARD, path.join(dir, 'blind-guard.mjs'));
      if (rulesSource !== null) fs.writeFileSync(path.join(dir, 'blindRules.mjs'), rulesSource);
      return { dir, script: path.join(dir, 'blind-guard.mjs') };
    };

    it.each([
      ['a rules file that throws', "export const BLIND_ROLES = ['annotator'];\nexport const violation = () => { throw new Error('rules exploded'); };\n", /rules exploded/],
      ['a rules file that will not parse', "export const BLIND_ROLES = ['annotator'];\nexport const violation = ( => ;\n", /./],
      ['a rules file that is missing', null, /Cannot find module|ERR_MODULE_NOT_FOUND|blindRules/],
      ['a rules file without the rules', 'export const nothing = 1;\n', /./],
    ])('on %s: exit 2 and a message, never the exit 1 that lets the call through', (_what, source, message) => {
      const { dir, script } = inTemp(source);
      try {
        const result = run('annotator', payload('Bash', bash('ls')), { script });
        expect(result.status).toBe(2);
        expect(result.stderr).toMatch(message);
        expect(result.stderr).toContain('fails closed');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // The command the frontmatter carries, run by bash as Claude Code runs it.
  describe.skipIf(!BASH)('the frontmatter command, run by bash', () => {
    const commandOf = (role) => /command: '([^']*)'/.exec(fs.readFileSync(path.join(AGENTS, `${role}.md`), 'utf8'))[1];
    const runHook = (role, projectDir, input) => spawnSync(BASH, ['-c', commandOf(role)], {
      input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    });

    it.each(BLIND_ROLES)('%s: allows a benign call, refuses a forbidden one, in a project path with a space', (role) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blind project '));
      try {
        fs.mkdirSync(path.join(dir, '.claude/hooks'), { recursive: true });
        for (const file of ['blind-guard.mjs', 'blindRules.mjs']) fs.copyFileSync(path.join(HOOKS, file), path.join(dir, '.claude/hooks', file));
        expect(runHook(role, dir, payload('Bash', bash('ls scripts'))).status).toBe(0);
        const refusal = runHook(role, dir, payload('Bash', bash('cat datasets/real_runs/x.json')));
        expect(refusal.status).toBe(2);
        expect(refusal.stderr).toContain(`blind-guard (${role})`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('refuses when the hook script is not where $CLAUDE_PROJECT_DIR says (a missing file is exit 1 in node)', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blind empty '));
      try {
        expect(runHook('annotator', dir, payload('Bash', bash('ls'))).status).toBe(2);
        expect(runHook('annotator', path.join(dir, 'nothing here'), payload('Bash', bash('ls'))).status).toBe(2);
        // The bare form (no `|| exit 2`) would have let it through.
        const bare = spawnSync(BASH, ['-c', commandOf('annotator').replace(' || exit 2', '')], { input: '{}', encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
        expect(bare.status).toBe(1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('runs the repository\'s own hook file', () => {
      expect(runHook('sourcer', ROOT, payload('Bash', bash('ls'))).status).toBe(0);
      expect(runHook('sourcer', ROOT, payload('Bash', bash('ls datasets/real/keys-wip'))).status).toBe(2);
    });
  });
});

// A workflow's transcript folder: journal.jsonl and one agent-<id>.jsonl each,
// in the shape the audit reads (assistant records with tool_use parts).
const workflow = (agents, { journalExtra = [], skipTranscript = [], badLine = [] } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit wf '));
  const journal = [{ type: 'launched' }];
  agents.forEach(({ label, calls = [] }, i) => {
    const agentId = `agent${i}`;
    journal.push({ type: 'started', key: `k${i}`, agentId, ...(label === undefined ? {} : { label }), phase: 'Annotate' });
    if (skipTranscript.includes(agentId)) return;
    const lines = [{ type: 'user', message: { role: 'user', content: 'go' } }];
    for (const [name, input] of calls) lines.push({ message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name, input }] } });
    lines.push({ message: { role: 'user', content: [{ type: 'tool_result', content: 'real_runs answer-keys' }] } });
    const text = lines.map((l) => JSON.stringify(l)).join('\n');
    fs.writeFileSync(path.join(dir, `agent-${agentId}.jsonl`), badLine.includes(agentId) ? `${text}\n{"cut off here` : `${text}\n`);
  });
  journal.push(...journalExtra);
  fs.writeFileSync(path.join(dir, 'journal.jsonl'), `${journal.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return dir;
};
const cleanup = (dir) => fs.rmSync(dir, { recursive: true, force: true });
const capture = (argv) => {
  const out = [];
  const err = [];
  const status = main(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { status, out: out.join('\n'), err: err.join('\n') };
};
const packetView = ['Bash', bash(`${KEYTOOL} view "${PACKET}\\image.jpg" --grid 20`)];
const own = (letter) => ['Read', read(`${SET}\\keys-wip\\p1.${letter}.snapped.json`)];

describe('auditBlind', () => {
  const call = (name, input) => ({ message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });

  describe('auditRecords', () => {
    it('finds the calls a blind role should not have made, in a transcript', () => {
      const records = [
        call('Bash', bash(`${KEYTOOL} view keys-wip/packets/p1/image.png --grid 20`)),
        call('Read', read(`${SET}\\keys-wip\\p1.b.snapped.json`)),
        call('Bash', bash('cat datasets/real/p1.floorplan')),
        { message: { role: 'user', content: [{ type: 'tool_result', content: 'real_runs' }] } },
      ];
      const found = auditRecords(records, { role: 'annotator', letter: 'a' });
      expect(found.map((f) => f.tool)).toEqual(['Read', 'Bash']);
      expect(found[0]).toMatchObject({ why: expect.stringContaining('allow-list') });
      expect(found[0].input).toContain('p1.b.snapped.json');
    });

    it('lets an annotator read back its own key and no other', () => {
      const mine = [call('Bash', bash(`${KEYTOOL} view keys-wip/packets/p1/image.png --poly ${SETF}/keys-wip/p1.a.snapped.json`))];
      expect(auditRecords(mine, { role: 'annotator', letter: 'a' })).toEqual([]);
      expect(auditRecords(mine, { role: 'annotator', letter: 'b' })).toHaveLength(1);
      expect(violation('annotator', { file_path: `${SETF}/keys-wip/p1.a.snapped.json` })).not.toBeNull();
    });

    it('reads every tool the guard\'s matcher covers, and no other', () => {
      expect(SCANNED_TOOLS).toEqual(expect.arrayContaining(['Bash', 'PowerShell', 'Monitor', 'Read', 'Grep', 'Glob']));
      const bad = { command: 'cat real_runs/x.json', file_path: 'x/real_runs/y', pattern: 'real_runs', path: 'real_runs' };
      for (const name of SCANNED_TOOLS) {
        expect(auditRecords([call(name, bad)], { role: 'annotator', letter: 'a' }), name).toHaveLength(1);
      }
      expect(auditRecords([call('Grep', grep('outlines', SET))], { role: 'annotator', letter: 'a' })).toHaveLength(1);
      expect(auditRecords([call('Glob', glob('**/*.json', SET))], { role: 'annotator', letter: 'a' })).toHaveLength(1);
      expect(auditRecords([call('Monitor', { command: 'until grep -q x real_runs/log; do sleep 3; done', timeout_ms: 1000 })], { role: 'annotator', letter: 'a' })).toHaveLength(1);
      // What an agent writes is its own notes, and a tool result is not a call.
      const records = [call('Write', { file_path: 'x', content: 'real_runs' }), call('Edit', { file_path: 'perimeterTraces' })];
      expect(auditRecords(records, { role: 'annotator', letter: 'a' })).toEqual([]);
    });

    it('reads the engineer and the app checker by their own rules', () => {
      const records = [call('Bash', bash('npm run bench:real -- --split test')), call('Bash', bash('npm run bench:real -- --split dev'))];
      expect(auditRecords(records, { role: 'engineer' })).toHaveLength(1);
      expect(auditRecords(records, { role: 'app-checker' })).toEqual([]);
      const named = [call('Read', read(`${SET}\\x63-n12.floorplan`))];
      expect(auditRecords(named, { role: 'engineer' }, { testPlans: ['x63-n12'] })).toHaveLength(1);
      expect(auditRecords(named, { role: 'engineer' }, { testPlans: ['x63-n13'] })).toEqual([]);
    });
  });

  describe('the label contract', () => {
    it('knows a: b: adj: final: rev: src: eng: app:', () => {
      expect(ROLE_OF_PREFIX).toEqual({
        a: { role: 'annotator', letter: 'a' },
        b: { role: 'annotator', letter: 'b' },
        adj: { role: 'adjudicator' },
        final: { role: 'adjudicator' },
        rev: { role: 'reviewer' },
        src: { role: 'sourcer' },
        eng: { role: 'engineer' },
        app: { role: 'app-checker' },
      });
      for (const { role } of Object.values(ROLE_OF_PREFIX)) expect(ROLES).toContain(role);
    });

    it('audits every prefix as its role, including the pilot\'s final: as the adjudicator', () => {
      const dir = workflow([
        { label: 'a:p1', calls: [own('a'), own('b')] },
        { label: 'b:p1', calls: [own('b'), own('a')] },
        { label: 'final:p1', calls: [['Read', read(`${SET}\\keys-wip\\p1.a.snapped.json`)], ['Read', read(`${SET}\\keys-wip\\p1.review-1.json`)]] },
        { label: 'adj:p2', calls: [['Read', read(`${SET}\\keys-wip\\p2.compare.json`)], ['Read', read(`${SET}\\keys-wip\\p2.record.json`)]] },
        { label: 'rev:p1', calls: [['Read', read(`${SET}\\keys-wip\\p1.final.json`)], own('a')] },
        { label: 'src:x', calls: [['Bash', bash('node scripts/realSource.mjs report')], ['Bash', bash('ls datasets/real/keys-wip')]] },
        { label: 'eng:m1', calls: [['Bash', bash('npm run bench:real -- --split dev')], ['Bash', bash('npm run bench:real -- --split test')]] },
        { label: 'app:p1', calls: [['Bash', bash(`${KEYTOOL} score p1 f.json`)], ['Bash', bash(`${KEYTOOL} apply p1`)]] },
      ]);
      try {
        const report = auditDir(dir);
        expect(report.unknown).toEqual([]);
        const flagged = Object.fromEntries(report.audited.map((r) => [r.label, r.violations.map((v) => v.tool)]));
        expect(flagged).toEqual({
          'a:p1': ['Read'], 'b:p1': ['Read'], 'final:p1': ['Read'], 'adj:p2': ['Read'], 'rev:p1': ['Read'], 'src:x': ['Bash'], 'eng:m1': ['Bash'], 'app:p1': ['Bash'],
        });
        expect(report.audited.map((r) => r.role)).toEqual(['annotator', 'annotator', 'adjudicator', 'adjudicator', 'reviewer', 'sourcer', 'engineer', 'app-checker']);
        expect(report.audited.map((r) => r.calls)).toEqual([2, 2, 2, 2, 2, 2, 2, 2]);
        // The violation is the second call of each agent, not the first.
        const first = report.audited.find((r) => r.label === 'a:p1').violations[0];
        expect(first.input).toContain('p1.b.snapped.json');
      } finally {
        cleanup(dir);
      }
    });

    it('lists a label it does not know, or none, and exits non-zero', () => {
      const dir = workflow([{ label: 'a:p1', calls: [packetView] }, { label: 'annotate:p1', calls: [packetView] }, { label: undefined, calls: [packetView] }, { label: 'resume' }]);
      try {
        const report = auditDir(dir);
        expect(report.audited.map((r) => r.label)).toEqual(['a:p1']);
        expect(report.unknown.map((u) => u.label)).toEqual(['annotate:p1', null, 'resume']);
        expect(report.unknown[0].why).toMatch(/"annotate"/);
        expect(report.unknown[1].why).toMatch(/no label/);
        const result = capture([dir]);
        expect(result.status).toBe(1);
        expect(result.out).toMatch(/3 NOT RECOGNISED/);
        expect(result.out).toMatch(/annotate:p1 \[agent agent1\]: the prefix "annotate" is not one of/);
        expect(result.out).toMatch(/\(no label\) \[agent agent2\]/);
      } finally {
        cleanup(dir);
      }
    });

    it('takes --ignore-prefix for labels that are deliberately not audited, and counts them', () => {
      const dir = workflow([{ label: 'a:p1', calls: [packetView] }, { label: 'build:tool' }, { label: 'Audit:pr1' }, { label: 'fix:x' }, { label: 'resume' }]);
      try {
        const result = capture([dir, '--ignore-prefix', 'build,audit', '--ignore-prefix=fix', '--ignore-prefix', 'resume']);
        expect(result.status).toBe(0);
        expect(result.out).toMatch(/1 role agents audited \(1 tool calls read\), 0 with findings; 4 ignored by --ignore-prefix/);
        // A prefix left out of the list is still a finding.
        expect(capture([dir, '--ignore-prefix', 'build,audit,fix']).status).toBe(1);
        // A role's own prefix cannot be ignored: that would hide the agents the audit is for.
        const role = capture([dir, '--ignore-prefix', 'build,a']);
        expect(role.status).toBe(2);
        expect(role.err).toMatch(/always audited/);
        // Nor can an unlabelled agent be ignored by an empty prefix.
        const bare = workflow([{ label: undefined }]);
        try {
          expect(capture([bare, '--ignore-prefix', '']).status).toBe(1);
        } finally {
          cleanup(bare);
        }
      } finally {
        cleanup(dir);
      }
    });
  });

  describe('auditDir and main on a transcript folder', () => {
    it('reports a clean workflow: exit 0, and says how many calls it read', () => {
      const dir = workflow([{ label: 'a:p1', calls: [packetView, own('a')] }, { label: 'b:p1', calls: [packetView, own('b')] }, { label: 'rev:p1', calls: [['Bash', bash(`${KEYTOOL} check p1`)]] }]);
      try {
        const result = capture([dir]);
        expect(result).toMatchObject({ status: 0, err: '' });
        expect(result.out).toBe('3 role agents audited (5 tool calls read), 0 with findings');
      } finally {
        cleanup(dir);
      }
    });

    it('names the agent, tool and input of a violation, and exits 1', () => {
      const dir = workflow([
        { label: 'a:p1', calls: [packetView, ['Read', read(`${SET}\\keys-wip\\p1.b.snapped.json`)]] },
        { label: 'b:p1', calls: [['Bash', bash('cat datasets/real/p1.floorplan')]] },
        { label: 'b:p2', calls: [own('b')] },
      ]);
      try {
        const result = capture([dir]);
        expect(result.status).toBe(1);
        expect(result.out).toMatch(/^3 role agents audited \(4 tool calls read\), 2 with findings/);
        expect(result.out).toMatch(/a:p1 \(annotator a\)\n {4}Read: .*allow-list.*p1\.b\.snapped\.json/);
        expect(result.out).toMatch(/b:p1 \(annotator b\)\n {4}Bash: it would show you a \.floorplan file/);
        expect(result.out).not.toMatch(/b:p2 \(/);
      } finally {
        cleanup(dir);
      }
    });

    it('does not skip an agent whose transcript is missing, or a transcript with a line that will not parse', () => {
      const dir = workflow([{ label: 'a:p1', calls: [packetView] }, { label: 'b:p1', calls: [packetView] }, { label: 'rev:p1', calls: [packetView] }], { skipTranscript: ['agent0'], badLine: ['agent1'] });
      try {
        const report = auditDir(dir);
        expect(report.audited.find((r) => r.label === 'a:p1')).toMatchObject({ missing: true, calls: 0 });
        expect(report.audited.find((r) => r.label === 'b:p1')).toMatchObject({ unparsed: 1, calls: 1 });
        const result = capture([dir]);
        expect(result.status).toBe(1);
        expect(result.out).toMatch(/2 with findings/);
        expect(result.out).toMatch(/a:p1 \(annotator a\): transcript missing/);
        expect(result.out).toMatch(/b:p1 \(annotator b\): 1 transcript line\(s\) would not parse/);
      } finally {
        cleanup(dir);
      }
    });

    it('lists the tools it does not read without failing the run', () => {
      const dir = workflow([{ label: 'a:p1', calls: [packetView, ['WebFetch', { url: 'https://x.test' }], ['mcp__terminal__read_terminal', {}], ['mcp__terminal__read_terminal', {}], ['Write', { file_path: 'x', content: 'y' }]] }]);
      try {
        const result = capture([dir]);
        expect(result.status).toBe(0);
        expect(result.out).toMatch(/note: a:p1 used tools the audit does not read: WebFetch x1, mcp__terminal__read_terminal x2$/m);
        expect(result.out).not.toMatch(/Write/);
      } finally {
        cleanup(dir);
      }
    });

    it('checks an engineer against the manifest\'s test plans, and says when it had no manifest', () => {
      const dir = workflow([{ label: 'eng:m1', calls: [['Bash', bash(`${KEYTOOL} view x63-n12 --keys --trace`)], ['Bash', bash(`${KEYTOOL} view aladdin62-n15 --keys --trace`)]] }]);
      const manifest = path.join(dir, 'manifest.json');
      fs.writeFileSync(manifest, JSON.stringify({ version: 1, plans: { 'x63-n12': { split: 'test' }, 'aladdin62-n15': { split: 'dev' } } }));
      try {
        const without = capture([dir]);
        expect(without.status).toBe(0);
        expect(without.out).toMatch(/audited without --manifest/);
        const withManifest = capture([dir, '--manifest', manifest]);
        expect(withManifest.status).toBe(1);
        expect(withManifest.out).toMatch(/eng:m1 \(engineer\)\n {4}Bash: x63-n12 is a test-split plan/);
        expect(withManifest.out).not.toMatch(/aladdin62-n15 is a test/);
        expect(withManifest.out).not.toMatch(/audited without --manifest/);
        expect(capture([dir, `--manifest=${manifest}`]).status).toBe(1);
      } finally {
        cleanup(dir);
      }
    });

    it('prints the report as JSON with --json, and the same exit status', () => {
      const dir = workflow([{ label: 'a:p1', calls: [['Read', read(`${SET}\\keys-wip\\p1.b.snapped.json`)]] }, { label: 'weird:x' }, { label: 'build:y' }]);
      try {
        const result = capture([dir, '--json', '--ignore-prefix', 'build']);
        expect(result.status).toBe(1);
        const report = JSON.parse(result.out);
        expect(report.audited).toHaveLength(1);
        expect(report.audited[0]).toMatchObject({ label: 'a:p1', role: 'annotator', letter: 'a', calls: 1 });
        expect(report.audited[0].violations).toHaveLength(1);
        expect(report.unknown.map((u) => u.label)).toEqual(['weird:x']);
        expect(report.ignored.map((u) => u.label)).toEqual(['build:y']);
      } finally {
        cleanup(dir);
      }
    });

    it('is exit 2 with a message, not a stack or a violation\'s 1, for a folder it cannot audit', () => {
      const dir = workflow([{ label: 'a:p1', calls: [packetView] }]);
      const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'audit empty '));
      const noAgents = fs.mkdtempSync(path.join(os.tmpdir(), 'audit none '));
      fs.writeFileSync(path.join(noAgents, 'journal.jsonl'), '{"type":"launched"}\n');
      try {
        const missing = capture([path.join(empty, 'not-there')]);
        expect(missing.status).toBe(2);
        expect(missing.err).toMatch(/not-there is not a folder/);
        expect(capture([dir + path.sep + 'agent0.jsonl']).status).toBe(2);
        const noJournal = capture([empty]);
        expect(noJournal.status).toBe(2);
        expect(noJournal.err).toMatch(/no journal\.jsonl/);
        const none = capture([noAgents]);
        expect(none.status).toBe(2);
        expect(none.err).toMatch(/no started agents/);
        expect(capture([]).status).toBe(2);
        expect(capture([]).err).toMatch(/TRANSCRIPT_DIR is required/);
        expect(capture([dir, '--ignore-prefx', 'x']).err).toMatch(/unknown option --ignore-prefx/);
        expect(capture([dir, dir]).status).toBe(2);
        expect(capture([dir, '--ignore-prefix']).status).toBe(2);
        expect(capture([dir, '--manifest', path.join(empty, 'nope.json')]).err).toMatch(/cannot be read/);
        fs.writeFileSync(path.join(empty, 'm.json'), '{"nothing":true}');
        expect(capture([dir, '--manifest', path.join(empty, 'm.json')]).err).toMatch(/has no "plans"/);
        expect(capture([dir]).status).toBe(0);
      } finally {
        for (const d of [dir, empty, noAgents]) cleanup(d);
      }
    });

    it('sets the process exit status: 0 clean, 1 a finding, 2 a folder it cannot read', () => {
      const clean = workflow([{ label: 'a:p1', calls: [packetView] }]);
      const dirty = workflow([{ label: 'a:p1', calls: [['Bash', bash('cat real_runs/x.json')]] }]);
      const unknown = workflow([{ label: 'oops:p1', calls: [packetView] }]);
      const status = (dir, ...flags) => {
        try {
          execFileSync(process.execPath, [AUDIT, dir, ...flags], { stdio: ['ignore', 'pipe', 'pipe'] });
          return 0;
        } catch (error) {
          return error.status;
        }
      };
      try {
        expect(status(clean)).toBe(0);
        expect(status(dirty)).toBe(1);
        expect(status(unknown)).toBe(1);
        expect(status(unknown, '--ignore-prefix', 'oops')).toBe(0);
        expect(status(path.join(clean, 'not-there'))).toBe(2);
        expect(status(clean, '--bogus')).toBe(2);
      } finally {
        for (const d of [clean, dirty, unknown]) cleanup(d);
      }
    });
  });
});
