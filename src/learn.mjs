#!/usr/bin/env node
/**
 * Tool 6: loop closing.
 *
 * Joins what you did (the ledger) against what the market did (the snapshot history)
 * and answers questions nobody else on the team can ask, because nobody else has been
 * collecting since 3 September:
 *
 *   - which signal actually produced advanced opportunities, not just replies
 *   - whether the 35-day call-on window after a talent leader is hired is right
 *   - which AEs advance, and what their advanced meetings have in common
 *   - where the funnel actually leaks: reply, show, or AE accept
 *
 * Built before the start date because the tool is an invention and the answers are
 * only findings. It reports honestly on thin data rather than inventing a trend from
 * four rows.
 *
 *   npm run learn
 *   npm run learn -- --window 30    # days before sourcing to look for a signal
 */
import { snapshotFiles, loadSnapshot, argv } from './lib/facts.mjs';
import { diffAccount } from './diff.mjs';
import { readEvents, replay } from './ledger.mjs';

const DEFAULT_WINDOW = 30;
const MIN_FOR_A_RATE = 5;   // below this, a percentage is noise dressed as insight

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '  n/a');
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const normAccount = s => String(s ?? '').toLowerCase().trim()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

/** Replay every consecutive snapshot pair into a dated signal history. */
async function signalHistory() {
  const files = await snapshotFiles();
  if (files.length < 2) return { events: [], days: files.length, span: files };
  const events = [];
  let before = await loadSnapshot(files[0]);
  for (let i = 1; i < files.length; i++) {
    const after = await loadSnapshot(files[i]);
    const domains = new Set([...Object.keys(before.accounts), ...Object.keys(after.accounts)]);
    for (const d of domains) {
      for (const e of diffAccount(d, before.accounts[d], after.accounts[d], after.date)) {
        events.push({ ...e, date: after.date });
      }
    }
    before = after; // keep exactly two snapshots in memory
  }
  return { events, days: files.length, span: [files[0], files.at(-1)].map(f => f.replace('.json', '')) };
}

function table(rows, headers) {
  const w = headers.map((h, i) => Math.max(h.length, ...rows.map(r => String(r[i]).length)));
  const line = cells => cells.map((c, i) => String(c).padEnd(w[i])).join('  ');
  return [line(headers), w.map(n => '-'.repeat(n)).join('  '), ...rows.map(line)];
}

async function main() {
  const a = argv();
  const windowDays = Number(a.window ?? DEFAULT_WINDOW);

  const { events: signals, days, span } = await signalHistory();
  const opps = replay(await readEvents());

  console.log(`\n=== loop closing ===`);
  console.log(`  snapshots      ${days} day${days === 1 ? '' : 's'}${span.length === 2 ? ` (${span[0]} to ${span[1]})` : ''}`);
  console.log(`  signals        ${signals.length}`);
  console.log(`  opportunities  ${opps.length}`);
  console.log(`  attribution    signal fired within ${windowDays} days before sourcing\n`);

  if (!opps.length) {
    console.log('  No ledger entries yet, so nothing to attribute. This tool is scaffolding:');
    console.log('  it exists now so it is a Prior Invention, and it becomes useful once you');
    console.log('  have logged real opportunities.\n');
    console.log('  Once there is data it will report:');
    console.log('    - advance rate by signal type, so you work the signals that convert');
    console.log('    - whether 35 days is the right call-on delay after a talent leader is hired');
    console.log('    - show rate and AE accept rate, to find which stage actually leaks');
    console.log('    - per-AE accept rate\n');
    console.log(`  Rough guide: ${MIN_FOR_A_RATE} opportunities per signal type before a percentage`);
    console.log('  means anything. Realistically that is late November.\n');
    return;
  }

  // --- funnel ---
  const held = opps.filter(o => ['held', 'advanced', 'rejected'].includes(o.status)).length;
  const noshow = opps.filter(o => o.status === 'no-show').length;
  const advanced = opps.filter(o => o.status === 'advanced').length;
  console.log('--- funnel ---');
  console.log(`  booked ${opps.length}  held ${held}  no-show ${noshow}  advanced ${advanced}`);
  console.log(`  show rate    ${pct(held, held + noshow)}   (benchmark 75-80%)`);
  console.log(`  AE accept    ${pct(advanced, held)}`);
  const leak = (held + noshow) && (held / (held + noshow)) < 0.75 ? 'show rate'
    : held && (advanced / held) < 0.6 ? 'AE accept' : 'neither stage looks broken';
  console.log(`  weakest link: ${leak}\n`);

  // --- signal attribution ---
  const byAccount = new Map();
  for (const s of signals) {
    const k = normAccount(s.domain);
    if (!byAccount.has(k)) byAccount.set(k, []);
    byAccount.get(k).push(s);
  }

  const stats = new Map();
  let attributed = 0;
  for (const o of opps) {
    const k = normAccount(o.account);
    const sourced = o.sourcedAt;
    const preceding = (byAccount.get(k) ?? []).filter(s => {
      const gap = daysBetween(s.date, sourced);
      return gap >= 0 && gap <= windowDays;
    });
    const types = new Set(preceding.map(s => s.type));
    if (types.size) attributed++;
    for (const t of types.size ? types : ['(no signal)']) {
      const st = stats.get(t) ?? { sourced: 0, advanced: 0 };
      st.sourced++;
      if (o.status === 'advanced') st.advanced++;
      stats.set(t, st);
    }
  }

  console.log('--- advance rate by preceding signal ---');
  const rows = [...stats.entries()]
    .sort((x, y) => y[1].sourced - x[1].sourced)
    .map(([type, st]) => [
      type,
      st.sourced,
      st.advanced,
      st.sourced >= MIN_FOR_A_RATE ? pct(st.advanced, st.sourced) : `(n=${st.sourced})`,
    ]);
  for (const l of table(rows, ['SIGNAL', 'SOURCED', 'ADVANCED', 'RATE'])) console.log('  ' + l);
  console.log(`\n  ${attributed}/${opps.length} opportunities had a signal in the window.`);
  console.log(`  Rates shown only where n >= ${MIN_FOR_A_RATE}; anything less is noise.\n`);

  // --- does the 35-day call-on delay hold? ---
  const hires = signals.filter(s => s.type === 'TALENT_LEADER_HIRED');
  if (hires.length) {
    const buckets = new Map();
    for (const o of opps) {
      const k = normAccount(o.account);
      const h = hires.filter(s => normAccount(s.domain) === k)
        .map(s => daysBetween(s.date, o.sourcedAt)).filter(d => d >= 0 && d <= 120);
      if (!h.length) continue;
      const b = Math.floor(Math.min(...h) / 14) * 14;
      const cur = buckets.get(b) ?? { n: 0, adv: 0 };
      cur.n++; if (o.status === 'advanced') cur.adv++;
      buckets.set(b, cur);
    }
    console.log('--- call-on delay after a talent leader was hired ---');
    if (buckets.size) {
      const br = [...buckets.entries()].sort((x, y) => x[0] - y[0])
        .map(([b, v]) => [`${b}-${b + 13} days`, v.n, v.adv, v.n >= MIN_FOR_A_RATE ? pct(v.adv, v.n) : `(n=${v.n})`]);
      for (const l of table(br, ['DELAY', 'SOURCED', 'ADVANCED', 'RATE'])) console.log('  ' + l);
      console.log(`\n  Current setting is 35 days. Move it if a different bucket wins on real volume.`);
    } else {
      console.log(`  ${hires.length} talent-leader hires observed, none worked yet.`);
    }
    console.log('');
  }

  // --- per AE ---
  const aes = new Map();
  for (const o of opps.filter(o => o.ae)) {
    const cur = aes.get(o.ae) ?? { held: 0, adv: 0 };
    if (['held', 'advanced', 'rejected'].includes(o.status)) cur.held++;
    if (o.status === 'advanced') cur.adv++;
    aes.set(o.ae, cur);
  }
  if (aes.size) {
    console.log('--- AE accept rate ---');
    const ar = [...aes.entries()].sort((x, y) => y[1].held - x[1].held)
      .map(([ae, v]) => [ae, v.held, v.adv, v.held >= MIN_FOR_A_RATE ? pct(v.adv, v.held) : `(n=${v.held})`]);
    for (const l of table(ar, ['AE', 'HELD', 'ADVANCED', 'RATE'])) console.log('  ' + l);
    console.log('');
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
