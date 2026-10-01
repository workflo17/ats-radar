#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './lib/http.mjs';
import { adapterById } from './adapters.mjs';
import { detect } from './detect.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = path.join(ROOT, 'config', 'targets.csv');
const REGISTRY = path.join(ROOT, 'data', 'registry.json');
const SNAPSHOTS = path.join(ROOT, 'data', 'snapshots');

const REVERIFY_DAYS = 7;   // an ATS change is a top-tier signal, so re-check weekly
const CONCURRENCY = 5;

const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * `domain,name` or, to pin a board the detector cannot guess, `domain,name,ats,token`.
 *
 * Front is the case that forced this. Their Ashby board is `frontcareers`, which is
 * derivable from neither `front.com` nor "Front", so no amount of candidate generation
 * finds it and the account sits unresolved forever. data/unresolved.csv has always told
 * you to read the apply link off the careers page and add the token by hand; this is
 * the by-hand.
 *
 * The ATS and token are read off the END of the row, and only when the second-to-last
 * field names a real adapter. Company names contain commas ("Hugging Face, Inc.") and
 * splitting from the front would eat them.
 */
async function loadTargets() {
  const known = new Set(Object.keys(adapterById));
  return (await readFile(TARGETS, 'utf8')).split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !/^domain\s*,/i.test(l))
    .map(line => {
      const parts = line.split(',').map(s => s.trim());
      const domain = (parts.shift() ?? '').toLowerCase();
      let ats = null, token = null;
      if (parts.length >= 3 && known.has(parts[parts.length - 2].toLowerCase())) {
        token = parts.pop();
        ats = parts.pop().toLowerCase();
      }
      return { domain, name: parts.join(', '), ats, token };
    })
    .filter(t => t.domain);
}

async function loadRegistry() {
  try {
    return JSON.parse(await readFile(REGISTRY, 'utf8'));
  } catch {
    return { version: 1, accounts: {} };
  }
}

const daysSince = ts => (ts ? (Date.now() - Date.parse(ts)) / 86400000 : Infinity);

async function main() {
  const started = Date.now();
  const targets = await loadTargets();
  const registry = await loadRegistry();
  const limit = Number(opt('limit', 0));
  const list = limit > 0 ? targets.slice(0, limit) : targets;
  const forceDetect = flag('force-detect');

  console.log(`ats-radar: ${list.length} targets, concurrency ${CONCURRENCY}${forceDetect ? ', forcing re-detection' : ''}`);

  const migrations = [];
  const errors = [];

  const results = await pool(list, CONCURRENCY, async ({ domain, name, ats: pinAts, token: pinToken }) => {
    const known = registry.accounts[domain];

    // A pin is a hand-verified fact, so it outranks detection and never expires. It is
    // also honoured when the board comes back empty: an empty board is a real state for
    // a real customer, and re-detecting would just lose the token again.
    if (pinAts && pinToken) {
      const adapter = adapterById[pinAts];
      const res = await adapter.fetchBoard(pinToken);
      const now = new Date().toISOString();
      registry.accounts[domain] = {
        ...(known ?? {}), name: name || known?.name || '', ats: pinAts, token: pinToken,
        detectedAt: known?.detectedAt ?? now, lastVerified: now, unresolvedSince: null, pinned: true,
      };
      return { domain, name, ats: pinAts, token: pinToken, jobs: res.jobs, total: res.total, pinned: true };
    }

    const stale = !known || forceDetect || daysSince(known.lastVerified) >= REVERIFY_DAYS;

    // Fast path: token already known and recently verified, so one request.
    if (known?.ats && !stale) {
      const adapter = adapterById[known.ats];
      const res = await adapter.fetchBoard(known.token);
      if (res.present) {
        known.lastVerified = new Date().toISOString();
        return { domain, name: name || known.name, ats: known.ats, token: known.token, jobs: res.jobs, total: res.total };
      }
      // Board went away mid-week. Fall through to a full re-detect.
    }

    const found = await detect(domain, name);
    const now = new Date().toISOString();

    if (!found.ats) {
      registry.accounts[domain] = {
        ...(known ?? {}), name: name || known?.name || '', ats: null, token: null,
        lastVerified: now, unresolvedSince: known?.unresolvedSince ?? now,
        ambiguous: found.ambiguous?.length ? found.ambiguous : undefined,
      };
      return { domain, name, ats: null, token: null, jobs: [], total: 0 };
    }

    if (known?.ats && known.ats !== found.ats) {
      migrations.push({ domain, from: known.ats, to: found.ats, detectedAt: now });
      registry.accounts[domain] = {
        ...known, name: name || known.name, ats: found.ats, token: found.token,
        detectedAt: now, lastVerified: now, unresolvedSince: null,
        history: [...(known.history ?? []), { ats: known.ats, token: known.token, until: now }],
      };
    } else {
      registry.accounts[domain] = {
        ...(known ?? {}), name: name || known?.name || '', ats: found.ats, token: found.token,
        detectedAt: known?.detectedAt ?? now, lastVerified: now, unresolvedSince: null,
      };
    }
    return { domain, name, ats: found.ats, token: found.token, jobs: found.jobs, total: found.total };
  });

  const accounts = {};
  const unresolvedDomains = [];
  let totalJobs = 0;
  const byAts = {};

  results.forEach((r, i) => {
    if (!r.ok) {
      errors.push({ domain: list[i].domain, error: String(r.error?.message ?? r.error) });
      return;
    }
    const v = r.value;
    if (!v.ats) {
      byAts.unresolved = (byAts.unresolved ?? 0) + 1;
      unresolvedDomains.push(v.domain);
      return;
    }
    byAts[v.ats] = (byAts[v.ats] ?? 0) + 1;
    totalJobs += v.total;
    accounts[v.domain] = {
      name: v.name || registry.accounts[v.domain]?.name || '',
      ats: v.ats, token: v.token, jobCount: v.total, jobs: v.jobs,
      // The diff needs to tell "they started hiring" from "we finally found their
      // board". Without this a hand-pinned account reads as BOARD_APPEARED the next
      // morning, which is a call made on a change that never happened.
      ...(v.pinned ? { pinned: true } : {}),
    };
  });

  const date = localDate();
  const snapshot = {
    date,
    collectedAt: new Date().toISOString(),
    stats: {
      targets: list.length,
      resolved: Object.keys(accounts).length,
      unresolved: byAts.unresolved ?? 0,
      errors: errors.length,
      totalJobs,
      byAts,
      durationSec: Math.round((Date.now() - started) / 1000),
    },
    migrations,
    errors,
    // Which domains we looked at and found nothing for. Absent from `accounts` used to
    // mean three different things at once: unresolved, failed to fetch, or not a target
    // yet. The diff cannot tell a real BOARD_APPEARED from the other two without this.
    unresolvedDomains,
    accounts,
  };

  await mkdir(SNAPSHOTS, { recursive: true });
  // A limited run covers only part of the territory, so writing it as the day's
  // snapshot would tell tomorrow's diff that every omitted account vanished
  // overnight. Partial runs go somewhere the history never reads from.
  const partial = limit > 0;
  const outPath = partial
    ? path.join(ROOT, 'data', 'partial-run.json')
    : path.join(SNAPSHOTS, `${date}.json`);
  await writeFile(outPath, JSON.stringify(snapshot, null, 1));
  await writeFile(REGISTRY, JSON.stringify(registry, null, 1));

  console.log(
    `\n${date}  resolved ${snapshot.stats.resolved}/${list.length}` +
    `  jobs ${totalJobs}  errors ${errors.length}  ${snapshot.stats.durationSec}s`
  );
  console.log('  ' + Object.entries(byAts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('  '));
  if (migrations.length) {
    console.log('\n  ATS MIGRATIONS DETECTED:');
    for (const m of migrations) console.log(`    ${m.domain}: ${m.from} -> ${m.to}`);
  }
  if (errors.length) {
    console.log('\n  errors:');
    for (const e of errors.slice(0, 10)) console.log(`    ${e.domain}: ${e.error}`);
  }
  console.log(partial
    ? `\n  PARTIAL RUN (--limit ${limit}) -> data/partial-run.json`
      + `\n  Not written to the snapshot history, so it cannot corrupt tomorrow's diff.`
    : `\n  snapshot -> data/snapshots/${date}.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
