// The PreToolUse guard the blind roles run (.claude/hooks/blind-guard.mjs): a
// tool call that would show an annotator, adjudicator, reviewer or sourcer the
// app's trace, a benchmark result or another key is refused; the calls their
// work needs are not.
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { violation } from '../../../.claude/hooks/blindRules.mjs';
import { auditRecords } from '../../auditBlind.mjs';

const GUARD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.claude/hooks/blind-guard.mjs');
const SET = 'C:\\Users\\jeffh\\Coding Projects\\FloorTrace\\datasets\\real';

// The guard's verdict on a payload: 'allow' (exit 0) or 'block' (exit 2).
const verdict = (role, input, { raw } = {}) => {
  try {
    execFileSync(process.execPath, [GUARD, role], { input: raw ?? JSON.stringify(input), stdio: ['pipe', 'pipe', 'pipe'] });
    return 'allow';
  } catch (error) {
    expect(error.status).toBe(2);
    return 'block';
  }
};
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const read = (file) => ({ tool_name: 'Read', tool_input: { file_path: file } });

describe('blind-guard', () => {
  it('refuses every role a plan file, benchmark results, the keys file and the tracer', () => {
    for (const role of ['annotator', 'adjudicator', 'reviewer', 'sourcer']) {
      expect(verdict(role, bash('cat datasets/real/aladdin62-n15.floorplan | head -c 100'))).toBe('block');
      expect(verdict(role, read(`${SET}\\..\\real_runs\\master-43d42e6.json`))).toBe('block');
      expect(verdict(role, read(`${SET}\\answer-keys.json`))).toBe('block');
      expect(verdict(role, bash('npm run bench:real -- --only aladdin62-n15'))).toBe('block');
      expect(verdict(role, bash('node scripts/realKeyTool.mjs view aladdin62-n15 --trace'))).toBe('block');
      expect(verdict(role, bash('node scripts/realKeyTool.mjs view aladdin62-n15 --keys --crop 0,0,9,9'))).toBe('block');
    }
  });

  it('lets an annotator use the blind packet, the key tool and its own scratch', () => {
    const packet = `${SET}\\keys-wip\\packets\\aladdin62-n15`;
    expect(verdict('annotator', read(`${packet}\\labels.json`))).toBe('allow');
    expect(verdict('annotator', bash(`node scripts/realKeyTool.mjs view "${packet}/image.png" --crop 0,0,400,400 --grid 20 --tag a-x`))).toBe('allow');
    expect(verdict('annotator', bash('node scripts/realKeyTool.mjs snap aladdin62-n15 --role a --spec datasets/zz-scratch/a-x/spec.json --dry'))).toBe('allow');
    expect(verdict('annotator', bash('node scripts/realKeyTool.mjs check aladdin62-n15 --role a'))).toBe('allow');
  });

  it('keeps an annotator off every other key, and every blind role off the orchestrator\'s folder', () => {
    expect(verdict('annotator', read(`${SET}\\keys-wip\\aladdin62-n15.a.snapped.json`))).toBe('block');
    expect(verdict('annotator', bash('ls datasets/real/keys-wip'))).toBe('block');
    for (const role of ['annotator', 'adjudicator', 'reviewer', 'sourcer']) {
      expect(verdict(role, read(`${SET}\\orchestration\\failures.md`))).toBe('block');
    }
  });

  it('hands the adjudicator both keys but the reviewer only the final one', () => {
    const a = read(`${SET}\\keys-wip\\aladdin62-n15.a.snapped.json`);
    const b = read(`${SET}\\keys-wip\\aladdin62-n15.b.json`);
    const final = read(`${SET}\\keys-wip\\aladdin62-n15.final.snapped.json`);
    expect(verdict('adjudicator', a)).toBe('allow');
    expect(verdict('adjudicator', b)).toBe('allow');
    expect(verdict('reviewer', final)).toBe('allow');
    expect(verdict('reviewer', a)).toBe('block');
    expect(verdict('reviewer', b)).toBe('block');
  });

  it('lets a sourcer draft and log', () => {
    expect(verdict('sourcer', bash('node scripts/realDrafts.mjs "https://archive.org/download/x/page/n12" --name x63-n12 --crop 1,2,3,4'))).toBe('allow');
    expect(verdict('sourcer', bash('node scripts/realSource.mjs log plan --name x63-n12 --book x'))).toBe('allow');
    expect(verdict('sourcer', bash('ls datasets/real/keys-wip'))).toBe('block');
  });

  it('scans a payload that will not parse instead of letting it through', () => {
    expect(verdict('annotator', null, { raw: 'cat C:\\x\\real_runs\\a.json' })).toBe('block');
    expect(verdict('annotator', null, { raw: 'not json at all' })).toBe('allow');
  });
});

describe('auditBlind', () => {
  const call = (name, input) => ({ message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] } });

  it('finds the calls a blind role should not have made, in a transcript', () => {
    const records = [
      call('Bash', { command: 'node scripts/realKeyTool.mjs view keys-wip/packets/p1/image.png --grid 20' }),
      call('Read', { file_path: `${SET}\\keys-wip\\p1.b.snapped.json` }),
      call('Bash', { command: 'cat datasets/real/p1.floorplan' }),
      { message: { role: 'user', content: [{ type: 'tool_result', content: 'real_runs' }] } },
    ];
    const found = auditRecords(records, { role: 'annotator', letter: 'a' });
    expect(found.map((f) => f.tool)).toEqual(['Read', 'Bash']);
  });

  it('lets an annotator read back its own key and no other', () => {
    const own = [call('Bash', { command: 'node scripts/realKeyTool.mjs view keys-wip/packets/p1/image.png --poly datasets/real/keys-wip/p1.a.snapped.json' })];
    expect(auditRecords(own, { role: 'annotator', letter: 'a' })).toEqual([]);
    expect(auditRecords(own, { role: 'annotator', letter: 'b' })).toHaveLength(1);
    expect(violation('annotator', `${SET}/keys-wip/p1.a.snapped.json`)).not.toBeNull();
  });

  it('ignores tools the guard does not cover, and tool results', () => {
    const records = [call('Write', { file_path: 'x', content: 'real_runs' }), call('Edit', { file_path: 'perimeterTraces' })];
    expect(auditRecords(records, { role: 'annotator', letter: 'a' })).toEqual([]);
  });
});
