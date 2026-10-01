#!/usr/bin/env node
/**
 * Turns the latest snapshot into a ranked call list.
 *
 * Point-in-time signals only. Change signals (vanished reqs, reposts, velocity
 * spikes, ATS migrations) need two snapshots and live in diff.mjs.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, latestSnapshot, accountFacts, STALE_DAYS, EVERGREEN_DAYS, isMain } from './lib/facts.mjs';

const REPORTS = path.join(ROOT, 'data', 'reports');
export const HOME_ATS = 'greenhouse';

/**
 * The score, itemised. Exported so the dashboard can show its working rather than
 * printing a number nobody can argue with. `score()` is the sum of exactly this.
 */
export function scoreBreakdown(f) {
  const otherTA = Math.min(f.talent.length - f.buyers.length, 4);
  return [
    { points: Math.min(f.buyers.length, 3) * 5, of: 15,
      why: f.buyers.length
        ? `${f.buyers.length} open req${f.buyers.length > 1 ? 's' : ''} for a talent leader, counted up to 3, 5 points each`
        : 'no open talent-leader req',
      note: 'The strongest single tell. A new head of talent audits the stack in their first 90 days.' },
    { points: otherTA > 0 ? otherTA * 2 : 0, of: 8,
      why: otherTA > 0
        ? `${otherTA} other recruiting req${otherTA > 1 ? 's' : ''} open, counted up to 4, 2 points each`
        : 'recruiting team not visibly growing',
      note: 'A TA function adding people is a function outgrowing its tooling.' },
    { points: f.jobCount >= 25 ? 2 : 0, of: 2, why: `${f.jobCount} open reqs${f.jobCount >= 25 ? ', at or above 25' : ', under 25'}`,
      note: 'Below about 25 reqs a spreadsheet still works and the pain is not yet real.' },
    { points: f.jobCount >= 100 ? 2 : 0, of: 2, why: f.jobCount >= 100 ? 'board is past 100 reqs' : 'board is under 100 reqs',
      note: 'Past 100 the coordination cost is what breaks, not the applicant tracking.' },
    { points: f.staleRatio > 0.4 ? 3 : 0, of: 3,
      why: `${Math.round(f.staleRatio * 100)}% of the board is open past ${STALE_DAYS} days${f.staleRatio > 0.4 ? ', above the 40% line' : ', under the 40% line'}`,
      note: 'They cannot fill what they post. That is a sourcing and process conversation.' },
  ];
}

/** Exported so the dashboard ranks accounts the same way the call list does. */
export function score(f) {
  return scoreBreakdown(f).reduce((s, r) => s + r.points, 0);
}

function line(domain, f, s) {
  const tags = [];
  if (f.buyers.length) tags.push(`BUYER: ${f.buyers.map(j => j.title).slice(0, 2).join('; ')}`);
  else if (f.talent.length) tags.push(`${f.talent.length} TA req${f.talent.length > 1 ? 's' : ''}`);
  if (f.staleCount) tags.push(`${f.staleCount} stuck >${STALE_DAYS}d`);
  if (f.evergreenCount) tags.push(`${f.evergreenCount} evergreen`);
  return [
    String(s).padStart(3),
    f.ats.padEnd(15),
    String(f.jobCount).padStart(4) + ' reqs',
    (f.name || domain).padEnd(18),
  ].join('  ') + (tags.length ? '  | ' + tags.join(' | ') : '');
}

/** Every account in the snapshot, scored and ranked. One definition, two consumers. */
export function rankAccounts(snap) {
  return Object.entries(snap.accounts)
    .map(([domain, a]) => { const f = accountFacts(a); return { domain, f, s: score(f) }; })
    .sort((x, y) => y.s - x.s || y.f.jobCount - x.f.jobCount);
}

async function main() {
  const snap = await latestSnapshot();
  const rows = rankAccounts(snap);

  const targets = rows.filter(r => r.f.ats !== HOME_ATS);
  const customers = rows.filter(r => r.f.ats === HOME_ATS);
  const hot = targets.filter(r => r.f.buyers.length);

  console.log(`\n=== DISPLACEMENT TARGETS (${targets.length}), not on ${HOME_ATS} ===`);
  console.log(`"stuck" is open ${STALE_DAYS}-${EVERGREEN_DAYS} days. Past a year is an evergreen pipeline req, counted separately.\n`);
  for (const r of targets) console.log(line(r.domain, r.f, r.s));

  console.log(`\n=== HIRING A TALENT LEADER RIGHT NOW (${hot.length}) ===`);
  console.log('The buyer is arriving. Reach them in their first three weeks.\n');
  for (const r of hot) {
    console.log(`  ${(r.f.name || r.domain)} (${r.f.ats}, ${r.f.jobCount} reqs)`);
    for (const j of r.f.buyers) console.log(`    - ${j.title}${j.location ? '  [' + j.location + ']' : ''}\n      ${j.url ?? ''}`);
  }

  console.log(`\n=== ALREADY ON ${HOME_ATS.toUpperCase()} (${customers.length}): expansion, not prospecting ===\n`);
  console.log('  ' + customers.map(r => r.f.name || r.domain).join(', '));

  const md = [
    `# ATS radar: ${snap.date}`,
    ``,
    `${snap.stats.resolved}/${snap.stats.targets} resolved · ${snap.stats.totalJobs} open reqs · ` +
      Object.entries(snap.stats.byAts).map(([k, v]) => `${k} ${v}`).join(' · '),
    ``,
    `"Stuck" means open ${STALE_DAYS} to ${EVERGREEN_DAYS} days. Anything past a year is treated as an`,
    `evergreen pipeline posting and counted separately, because quoting those back as`,
    `unfilled roles reads as not understanding their board.`,
    ``,
    `## Displacement targets`,
    ``,
    `| Score | Company | ATS | Reqs | Talent-leader req | Stuck | Evergreen |`,
    `|--:|---|---|--:|---|--:|--:|`,
    ...targets.map(r =>
      `| ${r.s} | ${r.f.name || r.domain} | ${r.f.ats} | ${r.f.jobCount} | ` +
      `${r.f.buyers.map(j => j.title).join('; ') || '-'} | ${r.f.staleCount} | ${r.f.evergreenCount} |`),
    ``,
    `## Already on Greenhouse`,
    ``,
    customers.map(r => r.f.name || r.domain).join(', '),
    ``,
  ].join('\n');

  await mkdir(REPORTS, { recursive: true });
  await writeFile(path.join(REPORTS, `${snap.date}.md`), md);
  console.log(`\nreport -> data/reports/${snap.date}.md`);
}

// Importable by dashboard.mjs, which reuses the scoring. Only run the CLI directly.
if (isMain(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
