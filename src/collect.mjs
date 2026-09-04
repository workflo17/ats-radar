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

async function loadTargets() {
  const raw = await readFile(TARGETS, 'utf8');
  return raw.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !/^domain\s*,/i.test(l))
    .map(line => {
      const [domain, ...rest] = line.split(',');
      return { domain: domain.trim().toLowerCase(), name: rest.join(',').trim() };
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

  const results = await pool(list, CONCURRENCY, async ({ domain, name }) => {
    const known = registry.accounts[domain];
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
      return;
    }
    byAts[v.ats] = (byAts[v.ats] ?? 0) + 1;
    totalJobs += v.total;
    accounts[v.domain] = {
      name: v.name || registry.accounts[v.domain]?.name || '',
      ats: v.ats, token: v.token, jobCount: v.total, jobs: v.jobs,
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
    accounts,
  };

  await mkdir(SNAPSHOTS, { recursive: true });
  await writeFile(path.join(SNAPSHOTS, `${date}.json`), JSON.stringify(snapshot, null, 1));
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
  console.log(`\n  snapshot -> data/snapshots/${date}.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
