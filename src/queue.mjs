#!/usr/bin/env node
/**
 * The call-on queue.
 *
 * TALENT_LEADER_HIRED is the highest-priority signal the radar produces, and its whole
 * value is a date: a senior talent req closed, the new person starts in four to eight
 * weeks, and week two of their tenure is when they are still writing down what is
 * broken. The diff computes that date and then wrote it into a markdown file nobody
 * opens 35 days later, which means the best signal in the system expired unused.
 *
 * This is where those dates live instead.
 *
 *   npm run queue                  overdue, due today, and the next two weeks
 *   npm run queue -- --all         everything still open, however far out
 *   npm run queue -- done a1b2c3   you called them
 *   npm run queue -- skip a1b2c3   not worth it, stop showing me
 *
 * Append-only, same as the ledger: marking something done is an event, not a deletion,
 * so the history of what you actually worked stays intact for `learn` to read.
 */
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, argv, isMain } from './lib/facts.mjs';

const QUEUE = path.join(ROOT, 'data', 'callons.jsonl');
const UPCOMING_DAYS = 14;

const newId = () => Math.random().toString(36).slice(2, 8);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export async function readQueue() {
  try {
    return (await readFile(QUEUE, 'utf8')).split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

async function write(ev) {
  await mkdir(path.dirname(QUEUE), { recursive: true });
  await appendFile(QUEUE, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n');
}

/** Replay into open items. done and skip close one; nothing is ever removed. */
export function replay(events) {
  const items = new Map();
  for (const e of events) {
    if (e.op === 'due') {
      items.set(e.id, { id: e.id, domain: e.domain, name: e.name, callOn: e.callOn, reason: e.reason, url: e.url ?? null, status: 'open', addedOn: e.ts.slice(0, 10), addedAt: e.ts });
      continue;
    }
    const it = items.get(e.id);
    if (it && (e.op === 'done' || e.op === 'skip')) it.status = e.op;
  }
  return [...items.values()];
}

/**
 * Called by diff.mjs for every event carrying a callOn date. Idempotent: the same
 * signal re-detected on a later run must not queue the same company twice, so the
 * dedupe key is the company, the date and the req that closed.
 */
export async function recordCallOns(events) {
  const withDates = events.filter(e => e.callOn);
  if (!withDates.length) return 0;

  const known = new Set(replay(await readQueue()).map(i => `${i.domain}|${i.callOn}|${i.reason}`));
  let added = 0;
  for (const e of withDates) {
    const key = `${e.domain}|${e.callOn}|${e.detail}`;
    if (known.has(key)) continue;
    known.add(key);
    await write({ op: 'due', id: newId(), domain: e.domain, name: e.name, callOn: e.callOn, reason: e.detail, url: e.url });
    added++;
  }
  return added;
}

function render(items, now) {
  const open = items.filter(i => i.status === 'open').sort((a, b) => a.callOn.localeCompare(b.callOn));
  const overdue = open.filter(i => i.callOn < now);
  const due = open.filter(i => i.callOn === now);
  const soon = open.filter(i => i.callOn > now);

  const line = i => {
    const age = daysBetween(now, i.callOn);
    const when = age === 0 ? 'today' : age < 0 ? `${-age}d late` : `in ${age}d`;
    return `  ${i.id}  ${i.name.padEnd(18)} ${when.padEnd(9)} ${i.reason}`;
  };

  if (!open.length) {
    console.log('\nNothing queued. Call-on dates land here when a talent leader req closes.\n');
    return;
  }

  console.log('');
  if (overdue.length) {
    console.log(`OVERDUE (${overdue.length}). The window is closing, not closed.\n`);
    for (const i of overdue) console.log(line(i));
    console.log('');
  }
  if (due.length) {
    console.log(`CALL TODAY (${due.length})\n`);
    for (const i of due) { console.log(line(i)); if (i.url) console.log(`          ${i.url}`); }
    console.log('');
  }
  if (soon.length) {
    const window = soon.filter(i => daysBetween(now, i.callOn) <= UPCOMING_DAYS);
    const shown = window.length ? window : soon.slice(0, 3);
    console.log(`COMING UP (${shown.length} of ${soon.length})\n`);
    for (const i of shown) console.log(line(i));
    console.log('');
  }
  console.log(`  npm run queue -- done <id>   after you call\n`);
}

async function main() {
  const a = argv();
  const cmd = a._[0];
  const events = await readQueue();
  const items = replay(events);

  if (cmd === 'done' || cmd === 'skip') {
    const prefix = a._[1] ?? '';
    const hits = items.filter(i => i.id.startsWith(prefix) && i.status === 'open');
    if (hits.length !== 1) throw new Error(`"${prefix}" matched ${hits.length} open items`);
    await write({ op: cmd, id: hits[0].id });
    console.log(`${hits[0].name} -> ${cmd}`);
    return;
  }
  if (cmd) throw new Error(`unknown command "${cmd}". Try: done <id> | skip <id>`);

  const now = today();
  if (a.all) {
    const open = items.filter(i => i.status === 'open');
    console.log(`\n${open.length} open, ${items.length - open.length} closed\n`);
  }
  render(items, now);
}

if (isMain(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
