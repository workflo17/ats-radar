#!/usr/bin/env node
/**
 * Tool 4: attribution ledger.
 *
 * The commission plan says bonuses are "in the complete and sole discretion of the
 * Company" and "not earned until paid", and attainment is computed from a Salesforce
 * record you do not control, where the qualifying event is an AE changing a picklist.
 * You will probably never need this. The month you do, it is the difference between
 * a conversation and a shrug.
 *
 * Append-only event log. Corrections are events too, so nothing is ever overwritten
 * and the history stays intact.
 *
 *   npm run ledger -- add --account ramp.com --contact "Jane Doe" --when 2026-10-14
 *   npm run ledger -- held k3f9x2
 *   npm run ledger -- noshow k3f9x2 --note "rescheduled to 10/21"
 *   npm run ledger -- advanced k3f9x2 --ae "Sam Rivera"
 *   npm run ledger -- closed k3f9x2 --value 42000 --on 2026-11-20
 *
 * --on backdates any status change to the day it really happened.
 *   npm run ledger -- list
 *   npm run ledger -- month 2026-10
 */
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, argv, isMain } from './lib/facts.mjs';

const LEDGER = path.join(ROOT, 'data', 'ledger.jsonl');
const COMP = path.join(ROOT, 'config', 'comp.json');

const money = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => (n * 100).toFixed(0) + '%';
const newId = () => Math.random().toString(36).slice(2, 8);
const quarterOf = ym => `${ym.slice(0, 4)}-Q${Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1}`;

export async function readEvents() {
  try {
    return (await readFile(LEDGER, 'utf8')).split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

async function write(ev) {
  await mkdir(path.dirname(LEDGER), { recursive: true });
  await appendFile(LEDGER, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n');
}

// When something actually happened, which is not always when you logged it.
// Backfilling a week of calls on Friday should not stamp them all with Friday.
const on = e => (typeof e.on === 'string' ? e.on : e.ts.slice(0, 10));

/** Replay the log into current state. Later events win, nothing is deleted. */
export function replay(events) {
  const opps = new Map();
  for (const e of events) {
    if (e.op === 'add') {
      opps.set(e.id, {
        id: e.id, account: e.account, contact: e.contact, role: e.role ?? null,
        sourcedAt: e.ts.slice(0, 10), meetingOn: e.when ?? null,
        status: 'booked', ae: e.ae ?? null, contractValue: null, notes: [],
      });
      continue;
    }
    const o = opps.get(e.id);
    if (!o) continue;
    if (e.op === 'held') o.status = 'held';
    if (e.op === 'noshow') o.status = 'no-show';
    if (e.op === 'advanced') { o.status = 'advanced'; o.advancedOn = on(e); if (e.ae) o.ae = e.ae; }
    if (e.op === 'rejected') o.status = 'rejected';
    if (e.op === 'closed') { o.closedOn = on(e); o.contractValue = Number(e.value) || 0; }
    if (e.note) o.notes.push(`${e.ts.slice(0, 10)} ${e.note}`);
  }
  return [...opps.values()];
}

/**
 * The plan's own arithmetic, Sections II and III.
 * Below 70% of quota pays nothing. From 70% to just under quota pays a flat rate per
 * opportunity. At or above quota the base bonus lands and each opportunity past quota
 * is priced by which accelerator band its position falls in.
 */
export function payout(n, quota, bonus, comp) {
  const rate = bonus / quota;
  const attainment = n / quota;
  const lines = [];

  if (attainment < comp.shortfallFloor) {
    return { total: 0, attainment, lines: [`below the ${pct(comp.shortfallFloor)} floor, plan pays nothing`] };
  }
  if (n < quota) {
    const total = n * rate;
    lines.push(`${n} opp x ${money(rate)} (Monthly Role Bonus / quota) = ${money(total)}`);
    lines.push(`Section III: discretionary, and "may be eligible", not guaranteed`);
    return { total, attainment, lines };
  }

  let total = bonus;
  lines.push(`quota met: Monthly Role Bonus = ${money(bonus)}`);
  const bands = { 1.5: 0, 1.75: 0, 2: 0 };
  for (let i = quota + 1; i <= n; i++) {
    const band = comp.accelerators.find(b => b.upToAttainment === null || i < b.upToAttainment * quota);
    bands[band.multiplier]++;
    total += rate * band.multiplier;
  }
  for (const [mult, count] of Object.entries(bands)) {
    if (count) lines.push(`${count} opp above quota x ${money(rate)} x ${Number(mult) * 100}% = ${money(count * rate * Number(mult))}`);
  }
  return { total, attainment, lines };
}

async function main() {
  const a = argv();
  const cmd = a._[0];
  const comp = JSON.parse(await readFile(COMP, 'utf8'));
  const events = await readEvents();
  const opps = replay(events);

  const resolve = prefix => {
    const hits = opps.filter(o => o.id.startsWith(prefix));
    if (hits.length !== 1) throw new Error(`"${prefix}" matched ${hits.length} opportunities`);
    return hits[0].id;
  };

  if (cmd === 'add') {
    if (!a.account || !a.contact) throw new Error('add needs --account and --contact');
    const id = newId();
    await write({ op: 'add', id, account: a.account, contact: a.contact, role: a.role, when: a.when, ae: a.ae, note: a.note });
    console.log(`logged ${id}  ${a.account}  ${a.contact}  meeting ${a.when ?? 'TBD'}`);
    return;
  }

  if (['held', 'noshow', 'advanced', 'rejected', 'closed'].includes(cmd)) {
    const id = resolve(a._[1] ?? '');
    await write({ op: cmd, id, ae: a.ae, value: a.value, note: a.note, on: a.on });
    console.log(`${id} -> ${cmd}`);
    return;
  }

  if (cmd === 'list' || !cmd) {
    if (!opps.length) return console.log('ledger is empty. `npm run ledger -- add --account X --contact Y`');
    console.log('\nID      STATUS     MEETING     ACCOUNT              CONTACT              AE');
    for (const o of opps) {
      console.log(
        `${o.id}  ${(o.status ?? '').padEnd(9)}  ${(o.meetingOn ?? '').padEnd(10)}  ` +
        `${(o.account ?? '').slice(0, 19).padEnd(19)}  ${(o.contact ?? '').slice(0, 19).padEnd(19)}  ${o.ae ?? ''}`
      );
    }
    console.log(`\n${opps.length} opportunities. ${events.length} events on file.\n`);
    return;
  }

  if (cmd === 'month') {
    const ym = a._[1];
    if (!/^\d{4}-\d{2}$/.test(ym ?? '')) throw new Error('usage: month YYYY-MM');
    const quota = comp.quotaByMonth?.[ym] ?? comp.quota;
    const inMonth = opps.filter(o => (o.meetingOn ?? o.sourcedAt ?? '').startsWith(ym));

    const booked = inMonth.length;
    const held = inMonth.filter(o => ['held', 'advanced', 'rejected'].includes(o.status)).length;
    const noshow = inMonth.filter(o => o.status === 'no-show').length;
    const advanced = inMonth.filter(o => o.status === 'advanced').length;
    const unresolved = inMonth.filter(o => o.status === 'booked');

    const p = payout(advanced, quota, comp.monthlyRoleBonus, comp);

    // Sales Contract Bonus, Section IV: only if 70% attainment that month, per-deal
    // and quarterly caps both apply.
    const quarter = quarterOf(ym);
    const eligible = p.attainment >= comp.shortfallFloor;
    const closedThisQuarter = opps.filter(o => o.closedOn && quarterOf(o.closedOn.slice(0, 7)) === quarter);
    const closedThisMonth = opps.filter(o => o.closedOn?.startsWith(ym));
    const rawDeal = v => Math.min(v * comp.contractBonusPct, comp.contractBonusPerDealCap);
    const quarterToDate = closedThisQuarter.reduce((s, o) => s + rawDeal(o.contractValue ?? 0), 0);
    const contractBonus = eligible
      ? Math.min(closedThisMonth.reduce((s, o) => s + rawDeal(o.contractValue ?? 0), 0),
                 Math.max(0, comp.contractBonusQuarterlyCap - (quarterToDate - closedThisMonth.reduce((s, o) => s + rawDeal(o.contractValue ?? 0), 0))))
      : 0;

    console.log(`\n=== ${ym} · quota ${quota} · ${comp.role} tier ${money(comp.monthlyRoleBonus)} ===\n`);
    console.log(`  meetings booked      ${booked}`);
    console.log(`  held                 ${held}${booked ? `   (show rate ${pct(held / (held + noshow || 1))})` : ''}`);
    console.log(`  no-showed            ${noshow}`);
    console.log(`  advanced to Develop  ${advanced}${held ? `   (AE accept ${pct(advanced / held)})` : ''}`);
    console.log(`\n  ATTAINMENT           ${advanced}/${quota} = ${pct(p.attainment)}`);
    console.log(`\n  Variable:`);
    for (const l of p.lines) console.log(`    ${l}`);
    console.log(`    ${'-'.repeat(52)}`);
    console.log(`    Monthly variable      ${money(p.total)}`);
    if (closedThisMonth.length) {
      console.log(`    Sales Contract Bonus  ${money(contractBonus)}  (${closedThisMonth.length} deal(s)${eligible ? '' : ', FORFEIT, under 70% this month'})`);
    }
    console.log(`    ${'='.repeat(52)}`);
    console.log(`    TOTAL VARIABLE        ${money(p.total + contractBonus)}\n`);

    if (unresolved.length) {
      console.log(`  ${unresolved.length} meeting(s) still unresolved, mark held/noshow/advanced before payroll:`);
      for (const o of unresolved) console.log(`    ${o.id}  ${o.account}  ${o.meetingOn ?? ''}`);
      console.log('');
    }
    console.log(`  Reconcile this against Salesforce before the payroll date. If the numbers`);
    console.log(`  disagree, this file and its timestamps are your record.\n`);
    return;
  }

  console.error(`unknown command "${cmd}". Try: add | held | noshow | advanced | rejected | closed | list | month YYYY-MM`);
  process.exit(1);
}

// Importable for tests without running the CLI.
if (isMain(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
