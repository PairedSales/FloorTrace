// The four numbers of a milestone report (scripts/lib/pipelineStats.mjs) computed
// from files: the agreement rate, the adjudication rate, the final review's
// send-back rate, and the disputes tally, whose one machine-readable line is
// parsed strictly (a line it cannot read is reported, never skipped).
import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { review, snap } from '../keyCommands.mjs';
import { adjudicated, compareAll, finalizeAgreed } from '../pipelineCommands.mjs';
import { freeze } from '../pipelineRelease.mjs';
import {
  collectStats, parseDisputes, stats, statsLines, tallyDisputes,
} from '../pipelineStats.mjs';
import { loadCatalog } from '../pipelineCatalog.mjs';
import { makeSet, newPlan, planEvent, specOf, writeLog } from './pipelineHarness.mjs';

let set;
beforeEach(() => {
  set = makeSet();
});
afterEach(() => set.cleanup());

const line = (extra = '') => `DISPUTE D-1 plan=alpha60-n1 status=decided outcome=changed direction=toward-tracer${extra}`;

describe('the dispute line', () => {
  it('reads the documented line, whatever markdown wraps it', () => {
    const text = [
      '# Disputes',
      'Some prose that mentions a DISPUTE in passing is not a dispute line.',
      line(),
      '- DISPUTE D-2 plan=beta61-n3 status=decided outcome=kept',
      '  * DISPUTE D-3 plan=beta61-n4 status=open',
      '> DISPUTE D-4 plan=beta61-n5 status=decided outcome=changed direction=away',
      '`DISPUTE D-5 plan=beta61-n6 status=decided outcome=changed direction=neutral`',
      'DISPUTE D-6 plan=beta61-n7 status=decided outcome=kept direction=neutral',
    ].join('\n');
    const { disputes, malformed } = parseDisputes(text);
    expect(malformed).toEqual([]);
    expect(disputes.map((d) => [d.id, d.plan, d.status, d.outcome, d.direction])).toEqual([
      ['D-1', 'alpha60-n1', 'decided', 'changed', 'toward-tracer'],
      ['D-2', 'beta61-n3', 'decided', 'kept', null],
      ['D-3', 'beta61-n4', 'open', null, null],
      ['D-4', 'beta61-n5', 'decided', 'changed', 'away'],
      ['D-5', 'beta61-n6', 'decided', 'changed', 'neutral'],
      ['D-6', 'beta61-n7', 'decided', 'kept', 'neutral'],
    ]);
  });

  it('reads a line wrapped in bold or italics, and reports, rather than skips, one that carries a dispute without starting as one', () => {
    const text = [
      '**DISPUTE D-4 plan=beta61-n5 status=decided outcome=changed direction=away **',
      '- **DISPUTE D-5 plan=beta61-n6 status=open**',
      '__DISPUTE D-6 plan=beta61-n7 status=open__',
      '*DISPUTE D-7 plan=beta61-n8 status=decided outcome=kept*',
      '**DISPUTE** D-8 plan=beta61-n9 status=open',
      '**Filed:** DISPUTE D-9 plan=beta61-n10 status=open',
      'Dispute D-10 plan=beta61-n11 status=open',
      'The format is described as DISPUTE <id> plan=NAME status=open in the manual.',
      'Some prose that mentions a DISPUTE in passing, or the plan= field, is not a dispute line.',
    ].join('\n');
    const { disputes, malformed } = parseDisputes(text);
    expect(disputes.map((d) => d.id)).toEqual(['D-4', 'D-5', 'D-6', 'D-7', 'D-8']);
    expect(disputes[0]).toMatchObject({ plan: 'beta61-n5', direction: 'away' });
    // Every line that has the id and plan= of a dispute and is not one is named, with its number.
    // (A sentence that describes the format with a placeholder id, line 8, is prose.)
    expect(malformed.map((m) => m.line)).toEqual([6, 7]);
    expect(malformed[0].why).toMatch(/starts with DISPUTE, in capitals/);
    // The tally over these counts what it read and the command exits 1 on what it could not (stats returns 1 for any malformed line).
    expect(tallyDisputes(disputes).total).toBe(5);
  });

  it('takes the latest line of an id: a dispute filed open and decided later is one dispute', () => {
    const { disputes } = parseDisputes(['DISPUTE D-9 plan=alpha60-n1 status=open', 'more prose', 'DISPUTE D-9 plan=alpha60-n1 status=decided outcome=kept'].join('\n'));
    expect(disputes).toHaveLength(1);
    expect(disputes[0]).toMatchObject({ id: 'D-9', status: 'decided', outcome: 'kept', line: 3 });
  });

  it('keeps unknown fields out of its way, and reports every line it cannot read, with the line number and the reason', () => {
    const text = [
      'DISPUTE D-1 plan=alpha60-n1 status=open reviewer=someone',
      'DISPUTE plan=alpha60-n1 status=open',
      'DISPUTE D-2 status=open',
      'DISPUTE D-3 plan=a status=pending',
      'DISPUTE D-4 plan=a status=open outcome=kept',
      'DISPUTE D-5 plan=a status=decided',
      'DISPUTE D-6 plan=a status=decided outcome=maybe',
      'DISPUTE D-7 plan=a status=decided outcome=changed',
      'DISPUTE D-8 plan=a status=decided outcome=changed direction=sideways',
      'DISPUTE D-9 plan=a status=open stray',
    ].join('\n');
    const { disputes, malformed } = parseDisputes(text);
    expect(disputes.map((d) => d.id)).toEqual(['D-1']);
    expect(malformed.map((m) => [m.line, m.why.replace(/ \(got.*$/, '')])).toEqual([
      [2, 'no id after DISPUTE'],
      [3, 'no plan=NAME'],
      [4, 'status must be open or decided'],
      [5, 'an open dispute has no outcome yet'],
      [6, 'a decided dispute needs outcome=changed|kept'],
      [7, 'a decided dispute needs outcome=changed|kept'],
      [8, expect.stringMatching(/^a changed key needs direction=toward-tracer\|away\|neutral/)],
      [9, 'direction must be toward-tracer, away, neutral'],
      [10, '"stray" is not key=value'],
    ]);
  });

  it('tallies the outcomes and the direction of the changes, and warns when they all go the tracer\'s way', () => {
    const many = (n, direction) => Array.from({ length: n }, (_, i) => ({ id: `${direction}${i}`, plan: `p${i}`, status: 'decided', outcome: 'changed', direction }));
    const kept = [{ id: 'k', plan: 'k1', status: 'decided', outcome: 'kept', direction: null }];
    const open = [{ id: 'o', plan: 'o1', status: 'open', outcome: null, direction: null }];
    const all = tallyDisputes([...many(3, 'toward-tracer'), ...kept, ...open]);
    expect(all).toMatchObject({
      total: 5, open: 1, decided: 4, changed: 3, kept: 1, direction: { 'toward-tracer': 3, away: 0, neutral: 0 },
    });
    expect(all.warning).toMatch(/all 3 changed keys moved toward the tracer: disputes that always go the tracer's way are a warning sign/);
    expect(tallyDisputes([...many(3, 'toward-tracer'), ...many(1, 'away')]).warning).toBeNull();
    expect(tallyDisputes(many(2, 'toward-tracer')).warning).toBeNull();
    expect(tallyDisputes([])).toMatchObject({ total: 0, changed: 0, warning: null });
  });
});

describe('collecting the numbers from a set', () => {
  // n1 agrees and is finalized; n2 is adjudicated after a rejected review; n3 agrees too.
  const runAll = async () => {
    for (const [name, author] of [['alpha60-n1', '1'], ['alpha60-n2', '2'], ['beta61-n3', '3']]) {
      set.addPlan(name, newPlan(name));
      await set.run(snap, name, '--role', 'a', '--spec', set.writeSpec(`${name}.a.json`, specOf(`a-${author}`)));
      const b = specOf(`b-${author}`, 2);
      if (name === 'alpha60-n2') b.outlines[1].type = 'porch';
      await set.run(snap, name, '--role', 'b', '--spec', set.writeSpec(`${name}.b.json`, b));
    }
    await set.run(compareAll, '--all');
    await set.run(finalizeAgreed, '--all');
    await set.run(snap, 'alpha60-n2', '--role', 'final', '--spec', set.writeSpec('n2.final.json', specOf('adj-2')));
    await set.run(adjudicated, 'alpha60-n2', '--adjudicator', 'adj-2');
    await set.run(review, 'alpha60-n1', '--approve', '--agent', 'rev-1');
    await set.run(review, 'alpha60-n2', '--reject', '--agent', 'rev-1', '--reason', 'the porch is missing');
    await set.run(review, 'alpha60-n2', '--approve', '--agent', 'rev-2');
    await set.run(review, 'beta61-n3', '--approve', '--agent', 'rev-1');
  };
  const all = () => collectStats(set.dir, loadCatalog(set.dir), ['alpha60-n1', 'alpha60-n2', 'beta61-n3']);

  it('counts agreement overall, by era and by book; adjudication; and the review\'s send-backs', async () => {
    await runAll();
    set.write('orchestration/disputes.md', `# Disputes\n${line()}\nDISPUTE D-2 plan=beta61-n3 status=decided outcome=kept\n`);
    const s = all();
    expect(s.plans).toBe(3);
    expect(s.agreement).toMatchObject({
      compared: 3, agree: 2, stale: 0, byEra: { vintage: { compared: 3, agree: 2 } }, byBook: { alpha60: { compared: 2, agree: 1 }, beta61: { compared: 1, agree: 1 } },
    });
    expect(s.adjudication).toEqual({ finalized: 3, adjudicated: 1 });
    expect(s.reviews).toMatchObject({
      reviews: 4, rejections: 1, plans: 3, rounds: { 1: 2, 2: 1 },
    });
    expect(s.disputes).toMatchObject({
      total: 2, decided: 2, changed: 1, kept: 1, direction: { 'toward-tracer': 1, away: 0, neutral: 0 }, malformed: [],
    });
    const text = statsLines(s).join('\n');
    expect(text).toMatch(/^agreement +2 of 3 compared agree \(66\.7%\)$/m);
    expect(text).toMatch(/^ {2}vintage +2\/3 \(66\.7%\)$/m);
    expect(text).toMatch(/^adjudication +1 of 3 finalized needed the adjudicator \(33\.3%\)$/m);
    expect(text).toMatch(/^final review +1 of 4 reviews sent a key back \(25\.0%\); 3 plans reviewed, rounds per plan 1:2 2:1$/m);
    expect(text).toMatch(/^disputes +2 \(open 0, decided 2: changed 1, kept 1\); changed keys moved toward the tracer 1, away 0, neutral 0$/m);
    expect(text).toMatch(/alpha60 +1 +2 +50\.0%/);
    expect(text).toMatch(/beta61 +1 +1 +100\.0%/);
  });

  it('does not count a comparison of keys that have since changed, and says how many', async () => {
    await runAll();
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(set.wip('alpha60-n1', '.compare.json'), old, old);
    const s = all();
    expect(s.agreement).toMatchObject({ compared: 2, agree: 1, stale: 1 });
    expect(statsLines(s).join('\n')).toMatch(/1 stale comparison not counted/);
  });

  it('reads a frozen plan\'s adjudicator from its own record when the work files are gone', async () => {
    await runAll();
    await set.run(freeze, '--all');
    for (const n of ['alpha60-n1', 'alpha60-n2', 'beta61-n3']) fs.rmSync(set.wip(n, '.record.json'));
    expect(all().adjudication).toEqual({ finalized: 3, adjudicated: 1 });
  });

  it('is well defined on a set with nothing done: zero over zero is n/a, not a number', async () => {
    set.addPlan('alpha60-n1', newPlan('alpha60-n1'));
    const s = collectStats(set.dir, loadCatalog(set.dir), ['alpha60-n1']);
    expect(s.agreement).toMatchObject({ compared: 0, agree: 0 });
    const text = statsLines(s).join('\n');
    expect(text).toMatch(/0 of 0 compared agree \(n\/a\)/);
    expect(text).toMatch(/0 of 0 finalized needed the adjudicator \(n\/a\)/);
    expect(text).toMatch(/0 of 0 reviews sent a key back \(n\/a\).*rounds per plan none/);
  });

  it('takes the era and book from the sourcing log for the plans it holds', async () => {
    await runAll();
    writeLog(set, [
      planEvent('alpha60-n1', { book: 'Alpha Homes', era: '2020-2022', year: 2021, decade: 2020, url: 'https://web.archive.org/web/20210101000000id_/https://x.com/a.png' }),
    ]);
    const s = all();
    expect(s.agreement.byEra).toEqual({ '2020-2022': { compared: 1, agree: 1 }, vintage: { compared: 2, agree: 1 } });
  });
});

describe('the stats command', () => {
  it('prints the numbers, and exits 1 with the line number when disputes.md holds a line it cannot read', async () => {
    set.addPlan('alpha60-n1', newPlan('alpha60-n1'));
    set.write('orchestration/disputes.md', `${line()}\nDISPUTE D-2 plan=alpha60-n1 status=decided\n`);
    const r = await set.run(stats);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/WARNING: disputes\.md line 2 is not a dispute line \(a decided dispute needs outcome=changed\|kept/);
    expect(r.out).toMatch(/^disputes +1 /m);
  });

  it('gives the same numbers as JSON, and can be narrowed by a selector', async () => {
    set.addPlan('alpha60-n1', newPlan('alpha60-n1'));
    set.addPlan('beta61-n3', newPlan('beta61-n3'));
    const all = JSON.parse((await set.run(stats, '--json')).out);
    expect(all.plans).toBe(2);
    expect(all.disputes.total).toBe(0);
    const one = JSON.parse((await set.run(stats, '--json', '--book', 'beta61')).out);
    expect(one.plans).toBe(1);
  });

  it('warns when every changed key moved toward the tracer', async () => {
    set.addPlan('alpha60-n1', newPlan('alpha60-n1'));
    set.write('orchestration/disputes.md', ['D-1', 'D-2', 'D-3'].map((id) => `DISPUTE ${id} plan=alpha60-n1 status=decided outcome=changed direction=toward-tracer`).join('\n'));
    const r = await set.run(stats);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/WARNING: all 3 changed keys moved toward the tracer/);
  });
});
