#!/usr/bin/env node
/**
 * Turns the latest snapshot into a ranked call list.
 *
 * Point-in-time signals only. Change signals (vanished reqs, reposts, velocity
 * spikes, ATS migrations) need two snapshots and live in diff.mjs.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, latestSnapshot, accountFacts, STALE_DAYS, EVERGREEN_DAYS } from './lib/facts.mjs';

const REPORTS = path.join(ROOT, 'data', 'reports');
const HOME_ATS = 'greenhouse';

function score(f) {
  let s = 0;
  s += Math.min(f.buyers.length, 3) * 5;                      // a talent-leader req is the strongest single tell
  s += Math.min(f.talent.length - f.buyers.length, 4) * 2;    // a growing TA team outgrows its tooling
  if (f.jobCount >= 25) s += 2;
  if (f.jobCount >= 100) s += 2;
  if (f.staleRatio > 0.4) s += 3;                             // they cannot fill what they post
  return s;
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

async function main() {
  const snap = await latestSnapshot();
  const rows = Object.entries(snap.accounts)
    .map(([domain, a]) => { const f = accountFacts(a); return { domain, f, s: score(f) }; })
    .sort((x, y) => y.s - x.s || y.f.jobCount - x.f.jobCount);

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

main().catch(e => { console.error(e.message); process.exit(1); });
