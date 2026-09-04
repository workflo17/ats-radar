#!/usr/bin/env node
/**
 * Checks the payout function against values worked by hand from the 2026 Individual
 * Commission Agreement, Sections II and III. Quota 10, Monthly Role Bonus $2,000,
 * so the per-opportunity rate is $200.
 *
 * Section III  : under quota but at or above 70% pays rate x count.
 * Section II.A : opportunities above 100% and below 121% pay rate x 150%.
 * Section II.B : at or above 121% and below 151% pay rate x 175%.
 * Section II.C : at or above 151% pay rate x 200%.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../src/lib/facts.mjs';
import { payout } from '../src/ledger.mjs';

const comp = JSON.parse(await readFile(path.join(ROOT, 'config', 'comp.json'), 'utf8'));
const Q = 10, BONUS = 2000;

const cases = [
  // n,  expected,  why
  [0,     0,    'nothing booked'],
  [6,     0,    '60% is under the 70% floor, plan pays zero'],
  [7,  1400,    '70% floor met: 7 x $200'],
  [9,  1800,    '90%: 9 x $200, still discretionary'],
  [10, 2000,    'quota exactly: the Monthly Role Bonus, no accelerator'],
  [11, 2300,    '110%: $2000 + one opp at $200 x 150%'],
  [12, 2600,    '120%: $2000 + two opps at $300'],
  [13, 2950,    '130%: opps 11-12 at $300, opp 13 at $200 x 175% (121% of 10 = 12.1)'],
  [15, 3650,    '150%: $2000 + 2 x $300 + 3 x $350'],
  [16, 4050,    '160%: adds opp 16 at $200 x 200% (151% of 10 = 15.1)'],
  [20, 5650,    '200%: $2000 + 2 x $300 + 3 x $350 + 5 x $400'],
];

let failed = 0;
for (const [n, expected, why] of cases) {
  const got = payout(n, Q, BONUS, comp).total;
  const ok = Math.abs(got - expected) < 0.005;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  n=${String(n).padStart(2)}  expected $${String(expected).padStart(5)}  got $${String(got.toFixed(0)).padStart(5)}   ${why}`);
}

// A ramped month with a smaller quota must scale the same way.
const ramp = payout(6, 5, BONUS, comp);
const rampOk = Math.abs(ramp.total - (2000 + 400 * 1.5)) < 0.005;
if (!rampOk) failed++;
console.log(`${rampOk ? 'PASS' : 'FAIL'}  ramped quota 5, n=6  expected $2600  got $${ramp.total.toFixed(0)}`);

console.log(`\n${failed ? `${failed} FAILED` : 'all cases pass'}`);
process.exit(failed ? 1 : 0);
