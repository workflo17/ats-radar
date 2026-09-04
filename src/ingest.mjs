#!/usr/bin/env node
/**
 * Turns whatever Amanda hands you into a target list.
 *
 * A CRM export gives company names, sometimes a website column, rarely a clean
 * domain, and never a board token. This reads any CSV shape, works out which
 * columns matter, resolves each company to its ATS, and appends the hits to
 * config/targets.csv. Whatever it cannot resolve goes to data/unresolved.csv with
 * the original row intact, so those get handled by hand instead of vanishing.
 *
 *   npm run ingest -- --file territory.csv
 *   npm run ingest -- --file territory.csv --dry-run
 *   npm run ingest -- --file names.txt --replace
 *
 * A domain is not required. Board tokens are derived from the company name at
 * least as often as from the domain, so a bare list of names resolves most of the way.
 */
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, argv } from './lib/facts.mjs';
import { parseCsv, csvLine } from './lib/csv.mjs';
import { detect, cleanCompanyName } from './detect.mjs';
import { pool } from './lib/http.mjs';

const TARGETS = path.join(ROOT, 'config', 'targets.csv');
const UNRESOLVED = path.join(ROOT, 'data', 'unresolved.csv');
const CONCURRENCY = 5;

const NAME_HEADER   = /^(account\s*name|company\s*name|company|account|organi[sz]ation|employer|name)$/i;
const NAME_FALLBACK = /(account|company|organi[sz]ation|employer|name)/i;
const WEB_HEADER    = /(domain|website|web\s*site|url|homepage|site)/i;

/** Work out which columns hold the company and the website, if there is a header at all. */
function pickColumns(rows) {
  const [first] = rows;
  if (!first) throw new Error('file is empty');

  if (first.length === 1) return { nameIdx: 0, webIdx: -1, body: rows, header: null };

  const headerish = first.some(c => NAME_FALLBACK.test(c) || WEB_HEADER.test(c));
  if (!headerish) {
    // No header. Assume the first column is the company, and look for a domain-shaped
    // column by sampling the data rather than trusting position.
    const webIdx = first.findIndex((_, i) => rows.slice(0, 10).filter(r => /\.[a-z]{2,}($|\/)/i.test(r[i] ?? '')).length >= Math.min(3, rows.length));
    return { nameIdx: 0, webIdx, body: rows, header: null };
  }

  let nameIdx = first.findIndex(c => NAME_HEADER.test(c.trim()));
  if (nameIdx < 0) nameIdx = first.findIndex(c => NAME_FALLBACK.test(c));
  if (nameIdx < 0) nameIdx = 0;
  const webIdx = first.findIndex(c => WEB_HEADER.test(c));
  return { nameIdx, webIdx, body: rows.slice(1), header: first };
}

const normDomain = v => String(v ?? '').trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/[?#].*$/, '');

async function main() {
  const a = argv();
  if (!a.file) {
    console.error('usage: npm run ingest -- --file <territory.csv> [--dry-run] [--replace] [--limit N]');
    process.exit(1);
  }

  const raw = await readFile(path.resolve(process.cwd(), a.file), 'utf8');
  const rows = parseCsv(raw);
  const { nameIdx, webIdx, body, header } = pickColumns(rows);

  console.log(`ingest: ${body.length} rows from ${a.file}`);
  console.log(`  company column: ${header ? `"${header[nameIdx]}"` : `#${nameIdx + 1} (no header detected)`}`);
  console.log(`  website column: ${webIdx >= 0 ? (header ? `"${header[webIdx]}"` : `#${webIdx + 1}`) : 'none, resolving from company name alone'}`);

  const seen = new Set();
  const items = [];
  let dupes = 0;
  for (const r of body) {
    const name = (r[nameIdx] ?? '').trim();
    if (!name) continue;
    const domain = webIdx >= 0 ? normDomain(r[webIdx]) : '';
    const key = domain || cleanCompanyName(name).toLowerCase();
    if (!key) continue;
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);
    items.push({ name, domain, row: r });
  }

  const list = a.limit ? items.slice(0, Number(a.limit)) : items;
  console.log(`  ${list.length} unique companies to resolve${dupes ? ` (${dupes} duplicate${dupes > 1 ? 's' : ''} dropped)` : ''}\n`);

  let done = 0;
  const results = await pool(list, CONCURRENCY, async item => {
    const found = await detect(item.domain, item.name);
    done++;
    if (done % 25 === 0) process.stdout.write(`  ...${done}/${list.length}\n`);
    return { ...item, found };
  });

  const resolved = [];
  const unresolved = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r.ok) { unresolved.push({ ...list[i], reason: String(r.error?.message ?? r.error) }); continue; }
    const { found } = r.value;
    if (found.ats) resolved.push({ ...r.value, ats: found.ats, token: found.token, jobs: found.total });
    else unresolved.push({ ...r.value, reason: found.ambiguous?.length ? `ambiguous: ${found.ambiguous.join(' ')}` : 'no board found' });
  }

  const byAts = {};
  for (const r of resolved) byAts[r.ats] = (byAts[r.ats] ?? 0) + 1;

  console.log(`\nresolved ${resolved.length}/${list.length}`);
  console.log('  ' + (Object.entries(byAts).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join('  ') || 'none'));

  // The domain is the key targets.csv is keyed on. When the CRM gave none, the board
  // token stands in as a stable identifier so the registry and snapshots line up.
  const lines = resolved.map(r => csvLine([r.domain || `${r.token}.${r.ats}.board`, r.name]));

  if (a['dry-run']) {
    console.log('\ndry run, nothing written. Would add:\n');
    for (const r of resolved.slice(0, 15)) console.log(`  ${r.ats.padEnd(16)} ${String(r.jobs).padStart(4)} reqs  ${r.name}`);
    if (resolved.length > 15) console.log(`  ... and ${resolved.length - 15} more`);
  } else if (a.replace) {
    await writeFile(TARGETS, `# ats-radar target list\n# domain,name\ndomain,name\n${lines.join('\n')}\n`);
    console.log(`\nwrote ${resolved.length} targets -> config/targets.csv (replaced)`);
  } else {
    await appendFile(TARGETS, lines.length ? '\n' + lines.join('\n') + '\n' : '');
    console.log(`\nappended ${resolved.length} targets -> config/targets.csv`);
  }

  if (unresolved.length) {
    await mkdir(path.dirname(UNRESOLVED), { recursive: true });
    const out = [csvLine(['name', 'domain', 'reason', ...(header ?? [])])]
      .concat(unresolved.map(u => csvLine([u.name, u.domain, u.reason, ...(u.row ?? [])])));
    if (!a['dry-run']) await writeFile(UNRESOLVED, out.join('\n') + '\n');
    console.log(`\n${unresolved.length} unresolved -> data/unresolved.csv`);
    console.log('  Most are companies that proxy their careers page server-side, which hides');
    console.log('  the ATS. Open the careers page, read the apply link, add the token by hand.');
    for (const u of unresolved.slice(0, 8)) console.log(`    ${u.name}${u.domain ? ` (${u.domain})` : ''}: ${u.reason}`);
    if (unresolved.length > 8) console.log(`    ... and ${unresolved.length - 8} more`);
  }

  if (!a['dry-run'] && resolved.length) console.log('\nNext: npm run collect');
}

main().catch(e => { console.error(e.message); process.exit(1); });
