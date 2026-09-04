#!/usr/bin/env node
/**
 * Turns the latest snapshot into a ranked call list.
 *
 * Only point-in-time signals live here. Change signals (vanished reqs, reposts,
 * velocity spikes, ATS migrations) need two snapshots to compare and land in
 * diff.mjs once there is history. See README.
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOTS = path.join(ROOT, 'data', 'snapshots');
const REPORTS = path.join(ROOT, 'data', 'reports');

const HOME_ATS = 'greenhouse';
const STALE_DAYS = 60;

// A talent-shaped req is the tell. Someone is being hired to own hiring.
const TALENT = /\b(recruit\w*|talent|sourcer|staffing|people\s*(ops|operations)|human\s*resources|hris|hrbp)\b/i;
const SENIOR = /\b(head|director|vp|vice\s*president|chief|chro|principal|lead|manager|senior\s*manager)\b/i;
// "Technical Recruiter" is a doer; "Head of Talent" is a buyer. Keep them apart.
const NOT_A_BUYER = /\b(coordinator|assistant|intern|contract|associate)\b/i;

const daysOld = iso => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null);

async function latestSnapshot() {
  const files = (await readdir(SNAPSHOTS)).filter(f => f.endsWith('.json')).sort();
  if (!files.length) throw new Error('no snapshots yet — run `npm run collect` first');
  return JSON.parse(await readFile(path.join(SNAPSHOTS, files.at(-1)), 'utf8'));
}

function analyse(account) {
  const jobs = account.jobs ?? [];
  const talent = jobs.filter(j => TALENT.test(j.title));
  const buyers = talent.filter(j => SENIOR.test(j.title) && !NOT_A_BUYER.test(j.title));
  const stale = jobs.filter(j => (daysOld(j.postedAt) ?? 0) > STALE_DAYS);

  let score = 0;
  score += Math.min(buyers.length, 3) * 5;          // a talent leader req is the strongest single tell
  score += Math.min(talent.length - buyers.length, 4) * 2; // a growing TA team outgrows its tooling
  if (account.jobCount >= 25) score += 2;
  if (account.jobCount >= 100) score += 2;
  if (jobs.length && stale.length / jobs.length > 0.4) score += 3; // they cannot fill what they post

  return { talent, buyers, stale, score };
}

function line(domain, a, s) {
  const bits = [
    String(s.score).padStart(3),
    a.ats.padEnd(15),
    String(a.jobCount).padStart(4) + ' reqs',
    (a.name || domain).padEnd(18),
  ];
  const tags = [];
  if (s.buyers.length) tags.push(`BUYER: ${s.buyers.map(j => j.title).slice(0, 2).join('; ')}`);
  else if (s.talent.length) tags.push(`${s.talent.length} TA req${s.talent.length > 1 ? 's' : ''}`);
  if (s.stale.length) tags.push(`${s.stale.length} open >${STALE_DAYS}d`);
  return bits.join('  ') + (tags.length ? '  | ' + tags.join(' | ') : '');
}

async function main() {
  const snap = await latestSnapshot();
  const rows = Object.entries(snap.accounts)
    .map(([domain, a]) => ({ domain, a, s: analyse(a) }))
    .sort((x, y) => y.s.score - x.s.score || y.a.jobCount - x.a.jobCount);

  const targets = rows.filter(r => r.a.ats !== HOME_ATS);
  const customers = rows.filter(r => r.a.ats === HOME_ATS);
  const hot = targets.filter(r => r.s.buyers.length);

  console.log(`\n=== DISPLACEMENT TARGETS (${targets.length}) — not on ${HOME_ATS} ===\n`);
  for (const r of targets) console.log(line(r.domain, r.a, r.s));

  console.log(`\n=== HIRING A TALENT LEADER RIGHT NOW (${hot.length}) ===`);
  console.log('The buyer is arriving. Reach them in their first three weeks.\n');
  for (const r of hot) {
    console.log(`  ${(r.a.name || r.domain)} (${r.a.ats}, ${r.a.jobCount} reqs)`);
    for (const j of r.s.buyers) console.log(`    - ${j.title}${j.location ? '  [' + j.location + ']' : ''}\n      ${j.url ?? ''}`);
  }

  console.log(`\n=== ALREADY ON ${HOME_ATS.toUpperCase()} (${customers.length}) — do not prospect, these are expansion ===\n`);
  console.log('  ' + customers.map(r => r.a.name || r.domain).join(', '));

  const md = [
    `# ATS radar — ${snap.date}`,
    ``,
    `${snap.stats.resolved}/${snap.stats.targets} resolved · ${snap.stats.totalJobs} open reqs · ` +
      Object.entries(snap.stats.byAts).map(([k, v]) => `${k} ${v}`).join(' · '),
    ``,
    `## Displacement targets`,
    ``,
    `| Score | Company | ATS | Reqs | Talent-leader req | Stale >${STALE_DAYS}d |`,
    `|--:|---|---|--:|---|--:|`,
    ...targets.map(r =>
      `| ${r.s.score} | ${r.a.name || r.domain} | ${r.a.ats} | ${r.a.jobCount} | ` +
      `${r.s.buyers.map(j => j.title).join('; ') || '-'} | ${r.s.stale.length} |`),
    ``,
    `## Already on Greenhouse`,
    ``,
    customers.map(r => r.a.name || r.domain).join(', '),
    ``,
  ].join('\n');

  await mkdir(REPORTS, { recursive: true });
  const out = path.join(REPORTS, `${snap.date}.md`);
  await writeFile(out, md);
  console.log(`\nreport -> data/reports/${snap.date}.md`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
