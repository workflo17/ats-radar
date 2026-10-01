#!/usr/bin/env node
/**
 * Is the radar actually running?
 *
 * On 2026-09-16 the answer was no, and had been no since the 8th. The scheduled task
 * was set to refuse to start on battery power, the laptop was on battery at 06:30, and
 * Windows declined it every morning without telling anyone. Eight days of snapshots do
 * not exist and cannot be backfilled, because the whole asset is a time series.
 *
 * Nothing in the system noticed. The report still rendered, the diff still ran against
 * whatever two files were newest, and everything looked fine. That is the failure mode
 * worth spending code on: not a crash, a silence.
 *
 *   npm run health
 *
 * Runs first thing every morning from the menu. Says nothing when there is nothing to
 * say, because a check that prints a wall of green teaches you to skip it.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, snapshotFiles, loadSnapshot, isMain } from './lib/facts.mjs';
import { readEvents, replay } from './ledger.mjs';

const COMP = path.join(ROOT, 'config', 'comp.json');
const TARGETS = path.join(ROOT, 'config', 'targets.csv');

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export async function check(now = today()) {
  const problems = [];
  const notes = [];

  // 1. The silence that already cost eight days.
  const files = await snapshotFiles();
  if (!files.length) {
    problems.push(['NO DATA', 'No snapshots at all. Run option 7 to collect.']);
  } else {
    const latest = files.at(-1).replace('.json', '');
    const age = daysBetween(latest, now);
    if (age >= 2) {
      problems.push([
        `${age} DAYS STALE`,
        `Newest snapshot is ${latest}. The 06:30 job is not running.`,
        `Check it:  schtasks /query /tn ats-radar-daily /v /fo LIST`,
        `A "Last Result" of 2147946720 means Windows refused to start it.`,
      ]);
    } else if (age === 1) {
      notes.push(`Newest snapshot is yesterday (${latest}). Normal before 06:30.`);
    }

    // 2. A transient fetch failure drops an account from the day's snapshot, and an
    //    account that vanishes for one day looks like a brand new board when it returns.
    const snap = await loadSnapshot(files.at(-1));
    const errors = snap.errors ?? [];
    if (errors.length) {
      problems.push([
        `${errors.length} ACCOUNT(S) FAILED TO FETCH`,
        errors.slice(0, 5).map(e => e.domain).join(', ') + (errors.length > 5 ? ', ...' : ''),
        `Run option 7 again today. They will come back, and fixing it now stops a`,
        `false BOARD_APPEARED when they reappear tomorrow.`,
      ]);
    }
    const unresolved = snap.stats?.unresolved ?? 0;
    if (unresolved) notes.push(`${unresolved} of ${snap.stats.targets} targets unresolved (Workday, iCIMS and proxied career pages are invisible here).`);
  }

  // 3. Two settings only the owner can supply, and both silently produce wrong answers.
  try {
    const comp = JSON.parse(await readFile(COMP, 'utf8'));
    if (!comp.quotaConfirmed) {
      problems.push([
        'QUOTA IS STILL A GUESS',
        `config/comp.json says quota ${comp.quota}, which is a placeholder: the number is`,
        `not in the commission agreement, Amanda sets it. Every payout figure is wrong`,
        `until you put the real one in and set "quotaConfirmed": true.`,
      ]);
    }
  } catch { problems.push(['NO COMP CONFIG', 'config/comp.json is missing or unreadable.']); }

  try {
    const targets = await readFile(TARGETS, 'utf8');
    if (/SEED LIST ONLY/.test(targets)) {
      // Same filter collect.mjs uses, so the count here matches the count it polls.
      const rows = targets.split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#') && !/^domain\s*,/i.test(l)).length;
      problems.push([
        'STILL ON THE SEED TARGET LIST',
        `${rows} recognizable tech companies, there to prove the pipeline works. None of`,
        `them are your accounts. Load the real territory with menu option 5.`,
      ]);
    }
  } catch { problems.push(['NO TARGET LIST', 'config/targets.csv is missing.']); }

  // 4. A ledger you fill in retroactively is not a record.
  const opps = replay(await readEvents());
  const stale = opps.filter(o => o.status === 'booked' && o.meetingOn && o.meetingOn < now);
  if (stale.length) {
    problems.push([
      `${stale.length} MEETING(S) NEED RESOLVING`,
      stale.map(o => `${o.id} ${o.account} ${o.meetingOn}`).join(' · '),
      `The meeting date has passed and it is still marked booked. Menu option 3.`,
    ]);
  }

  return { problems, notes };
}

async function main() {
  const { problems, notes } = await check();

  if (!problems.length && !notes.length) {
    console.log('\nhealth: ok\n');
    return;
  }

  if (problems.length) {
    console.log('');
    for (const [title, ...rest] of problems) {
      console.log(`  !! ${title}`);
      for (const l of rest) console.log(`     ${l}`);
      console.log('');
    }
  }
  for (const n of notes) console.log(`  -- ${n}`);
  if (notes.length) console.log('');
}

if (isMain(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
