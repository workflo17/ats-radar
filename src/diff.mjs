#!/usr/bin/env node
/**
 * Compares two snapshots and emits change events. This is the half of the radar
 * that vendors cannot sell you, because it only exists if you have been collecting.
 *
 *   npm run diff                     latest two snapshots
 *   npm run diff -- --days 30        latest vs ~30 days ago (best for reposts)
 *   npm run diff -- --from a.json --to b.json
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, snapshotFiles, loadSnapshot, isBuyerReq, TALENT, argv } from './lib/facts.mjs';

const REPORTS = path.join(ROOT, 'data', 'reports');

// A senior talent req closing means they hired. Senior hires typically start 4 to 8
// weeks out, so week two of the new person's tenure lands about 35 days from the close.
const DAYS_UNTIL_NEW_LEADER_IS_WORTH_CALLING = 35;
const SPIKE_PCT = 0.25;
const SPIKE_MIN = 5;

const EVENTS = {
  TALENT_LEADER_HIRED:  { p: 10, why: 'They hired someone to own recruiting. New talent leaders audit the tech stack in their first 90 days.' },
  ATS_MIGRATION:        { p: 9,  why: 'They moved ATS. Either they just churned off a competitor, or they are mid-evaluation and reachable.' },
  TALENT_LEADER_POSTED: { p: 8,  why: 'A talent leader req is open. The buyer is being recruited right now.' },
  REPOST:               { p: 7,  why: 'They closed a req and posted it again. They cannot fill it. This is the structured-hiring pitch.' },
  VELOCITY_SPIKE:       { p: 6,  why: 'Hiring is accelerating. Whatever they run today is about to stop coping.' },
  TA_TEAM_GROWING:      { p: 5,  why: 'They are adding recruiters. The function is scaling past its tooling.' },
  BOARD_EMPTIED:        { p: 3,  why: 'Reqs went to zero. Freeze or a cleanup. Worth knowing before you call.' },
  BOARD_APPEARED:       { p: 4,  why: 'A board showed up where there was none. They just started hiring properly.' },
};

const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

function diffAccount(domain, before, after, date) {
  const events = [];
  const push = (type, detail) => events.push({ type, domain, name: after?.name ?? before?.name ?? domain, ...EVENTS[type], ...detail });

  if (!before && after) {
    push('BOARD_APPEARED', { detail: `${after.jobCount} reqs on ${after.ats}` });
    return events;
  }
  if (!after) return events;

  if (before.ats !== after.ats) {
    push('ATS_MIGRATION', { detail: `${before.ats} -> ${after.ats}` });
  }

  const beforeJobs = before.jobs ?? [];
  const afterJobs = after.jobs ?? [];
  const beforeIds = new Set(beforeJobs.map(j => j.id));
  const afterIds = new Set(afterJobs.map(j => j.id));
  const opened = afterJobs.filter(j => !beforeIds.has(j.id));
  const closed = beforeJobs.filter(j => !afterIds.has(j.id));

  for (const j of closed.filter(j => isBuyerReq(j.title))) {
    push('TALENT_LEADER_HIRED', {
      detail: `"${j.title}" closed`,
      callOn: addDays(date, DAYS_UNTIL_NEW_LEADER_IS_WORTH_CALLING),
    });
  }
  for (const j of opened.filter(j => isBuyerReq(j.title))) {
    push('TALENT_LEADER_POSTED', { detail: `"${j.title}"`, url: j.url });
  }

  // A req that closed and came back. reqId is exact where the ATS exposes one
  // (Greenhouse, SmartRecruiters); elsewhere fall back to an identical title.
  const closedByReq = new Map(closed.filter(j => j.reqId).map(j => [j.reqId, j]));
  const closedByTitle = new Map(closed.map(j => [j.title.toLowerCase(), j]));
  for (const j of opened) {
    const prior = (j.reqId && closedByReq.get(j.reqId)) || closedByTitle.get(j.title.toLowerCase());
    if (prior && prior.id !== j.id) {
      push('REPOST', { detail: `"${j.title}" reposted`, url: j.url });
    }
  }

  const delta = after.jobCount - before.jobCount;
  if (before.jobCount > 0 && delta >= SPIKE_MIN && delta / before.jobCount >= SPIKE_PCT) {
    push('VELOCITY_SPIKE', { detail: `${before.jobCount} -> ${after.jobCount} reqs (+${delta})` });
  }
  if (before.jobCount > 0 && after.jobCount === 0) {
    push('BOARD_EMPTIED', { detail: `${before.jobCount} -> 0` });
  }

  const newTA = opened.filter(j => TALENT.test(j.title) && !isBuyerReq(j.title));
  if (newTA.length >= 2) {
    push('TA_TEAM_GROWING', { detail: `${newTA.length} new recruiting reqs: ${newTA.map(j => j.title).slice(0, 3).join('; ')}` });
  }

  return events;
}

async function resolvePair(a) {
  if (a.from && a.to) return [await loadSnapshot(a.from), await loadSnapshot(a.to)];
  const files = await snapshotFiles();
  if (files.length < 2) {
    throw new Error(
      `need two snapshots to diff, have ${files.length}. The collector runs daily at 06:30, ` +
      `so the first real diff is available tomorrow.`
    );
  }
  const to = files.at(-1);
  let from = files.at(-2);
  if (a.days) {
    const target = addDays(to.replace('.json', ''), -Number(a.days));
    from = files.filter(f => f.replace('.json', '') <= target).at(-1) ?? files[0];
  }
  return [await loadSnapshot(from), await loadSnapshot(to)];
}

async function main() {
  const a = argv();
  const [before, after] = await resolvePair(a);

  const domains = new Set([...Object.keys(before.accounts), ...Object.keys(after.accounts)]);
  const events = [...domains]
    .flatMap(d => diffAccount(d, before.accounts[d], after.accounts[d], after.date))
    .sort((x, y) => y.p - x.p);

  console.log(`\nats-radar diff  ${before.date} -> ${after.date}  (${events.length} events)\n`);
  if (!events.length) console.log('  no changes. Normal for consecutive days on a small target list.\n');

  let lastType = null;
  for (const e of events) {
    if (e.type !== lastType) {
      console.log(`\n[${e.type}]  ${e.why}`);
      lastType = e.type;
    }
    console.log(`   ${e.name.padEnd(20)} ${e.detail}` + (e.callOn ? `   -> CALL ON ${e.callOn}` : ''));
    if (e.url) console.log(`   ${' '.repeat(20)} ${e.url}`);
  }

  const md = [
    `# ATS radar diff: ${before.date} to ${after.date}`,
    ``,
    `${events.length} change events across ${domains.size} accounts.`,
    ``,
    ...(events.length ? [
      `| Priority | Event | Company | Detail | Call on |`,
      `|--:|---|---|---|---|`,
      ...events.map(e => `| ${e.p} | ${e.type} | ${e.name} | ${e.detail} | ${e.callOn ?? ''} |`),
    ] : ['No changes detected.']),
    ``,
  ].join('\n');

  await mkdir(REPORTS, { recursive: true });
  const out = path.join(REPORTS, `diff-${after.date}.md`);
  await writeFile(out, md);
  console.log(`\ndiff -> data/reports/diff-${after.date}.md`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
