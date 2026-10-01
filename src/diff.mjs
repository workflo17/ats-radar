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
import { ROOT, snapshotFiles, loadSnapshot, isBuyerReq, TALENT, argv, isMain } from './lib/facts.mjs';
import { recordCallOns } from './queue.mjs';

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

/**
 * `ctx` carries what the earlier snapshot knew about the whole territory, which is the
 * only way to read an account's absence correctly. Optional: learn.mjs replays history
 * without it and gets the old, permissive behaviour.
 */
export function diffAccount(domain, before, after, date, ctx = null) {
  const events = [];
  const push = (type, detail) => events.push({ type, domain, name: after?.name ?? before?.name ?? domain, ...EVENTS[type], ...detail });

  if (!before && after) {
    // "Not in yesterday's accounts" is not the same as "had no board yesterday". It also
    // covers a token we pinned by hand this morning, an account whose fetch timed out,
    // and a company only added to the target list today. Calling a prospect to say they
    // just started hiring, when what changed was our own lookup, is the kind of opener
    // that ends a conversation.
    const weJustFoundIt = after.pinned === true;
    const itErroredBefore = ctx?.erroredBefore.has(domain);
    const notATargetBefore = ctx && !ctx.knownBefore.has(domain);
    if (weJustFoundIt || itErroredBefore || notATargetBefore) return events;
    push('BOARD_APPEARED', { detail: `${after.jobCount} reqs on ${after.ats}` });
    return events;
  }
  if (!after) return events;

  // Taking manual control of an account changes what we believe, not what they run.
  // Front's board was filed under Workable on an empty board, was pinned to its real
  // Ashby token by hand, and read back as a priority 9 "they just churned off a
  // competitor". Pin-to-pin changes still report, because those are the owner editing
  // the file after noticing something real.
  const justPinned = after.pinned === true && before.pinned !== true;
  if (before.ats !== after.ats && !justPinned) {
    push('ATS_MIGRATION', { detail: `${before.ats} -> ${after.ats}`,
      evidence: { kind: 'migration', from: before.ats, fromToken: before.token, to: after.ats, toToken: after.token,
                  fromCount: before.jobCount, toCount: after.jobCount, seenOn: ctx?.beforeDate, nowOn: date } });
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
      evidence: { kind: 'closed-req', job: j, seenOn: ctx?.beforeDate, goneOn: date, delayDays: DAYS_UNTIL_NEW_LEADER_IS_WORTH_CALLING },
    });
  }
  for (const j of opened.filter(j => isBuyerReq(j.title))) {
    push('TALENT_LEADER_POSTED', { detail: `"${j.title}"`, url: j.url,
      evidence: { kind: 'opened-req', job: j, absentOn: ctx?.beforeDate, seenOn: date } });
  }

  // A req that closed and came back.
  //
  // requisition_id looked like the exact way to match one, and it is not. Greenhouse
  // hands Stripe the literal string "See Opening ID" for all 651 of their reqs, and
  // Brex reuses one id across every location a role is open in: 261 reqs, 80 distinct
  // ids. Keying a Map on it leaves one survivor per id, which then matches every new
  // posting that shares it. On 2026-09-16 that reported 114 Stripe reposts in a single
  // diff and buried the two events actually worth calling under 190 rows of noise.
  //
  // So an identifier only counts as evidence when it identifies exactly one req on
  // each side. Anything ambiguous falls through to an exact title match under the same
  // rule, and each closed req can explain at most one repost.
  const tally = (jobs, key) => {
    const n = new Map();
    for (const j of jobs) { const k = key(j); if (k) n.set(k, (n.get(k) ?? 0) + 1); }
    return n;
  };
  const reqKey = j => j.reqId || null;
  const titleKey = j => j.title.trim().toLowerCase() || null;
  const unambiguous = (k, inClosed, inOpened) => k && inClosed.get(k) === 1 && inOpened.get(k) === 1;

  const closedReqs = tally(closed, reqKey), openedReqs = tally(opened, reqKey);
  const closedTitles = tally(closed, titleKey), openedTitles = tally(opened, titleKey);

  const closedByReq = new Map(
    closed.filter(j => unambiguous(reqKey(j), closedReqs, openedReqs)).map(j => [reqKey(j), j])
  );
  const closedByTitle = new Map(
    closed.filter(j => unambiguous(titleKey(j), closedTitles, openedTitles)).map(j => [titleKey(j), j])
  );

  const spent = new Set();
  for (const j of opened) {
    const prior = closedByReq.get(reqKey(j)) ?? closedByTitle.get(titleKey(j));
    if (prior && prior.id !== j.id && !spent.has(prior.id)) {
      spent.add(prior.id);
      const via = closedByReq.get(reqKey(j)) === prior ? 'requisition id' : 'an exact, unique title match';
      push('REPOST', { detail: `"${j.title}" reposted`, url: j.url,
        evidence: { kind: 'repost', job: j, prior, matchedOn: via, seenOn: ctx?.beforeDate, nowOn: date } });
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
  // An explicit pair is an ad-hoc or fixture comparison. It must not write to the
  // same filename as the day's real diff, or `npm run fixture` silently overwrites
  // genuine history with synthetic events.
  if (a.from && a.to) return [await loadSnapshot(a.from), await loadSnapshot(a.to), true];
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

// Priority 8 and up is a dated, expiring reason to call someone this week. Below it
// is context you want on the page but never want to read row by row at 8am.
const ACT_ON = 8;

/** One line per (event type, account), because thirteen Brex reposts are one fact. */
function collapse(events) {
  const groups = new Map();
  for (const e of events) {
    const key = `${e.type}|${e.domain}`;
    if (!groups.has(key)) groups.set(key, { ...e, items: [] });
    groups.get(key).items.push(e);
  }
  return [...groups.values()].sort((a, b) => b.p - a.p || b.items.length - a.items.length);
}

const NOUN = {
  REPOST: 'reqs reposted',
  TALENT_LEADER_POSTED: 'talent leader reqs open',
  TALENT_LEADER_HIRED: 'talent leader reqs closed',
  TA_TEAM_GROWING: 'recruiting hires',
};

function summarize(g) {
  if (g.items.length === 1) return g.detail;
  const titles = g.items.map(e => (e.detail.match(/"([^"]+)"/) ?? [])[1]).filter(Boolean);
  const noun = NOUN[g.type] ?? `${g.type.toLowerCase().replace(/_/g, ' ')} events`;
  const shown = titles.slice(0, 2).map(t => `"${t}"`).join(', ');
  const more = titles.length > 2 ? `, +${titles.length - 2} more` : '';
  return `${g.items.length} ${noun}` + (shown ? `: ${shown}${more}` : '');
}

async function main() {
  const a = argv();
  const [before, after, adhoc] = await resolvePair(a);

  const domains = new Set([...Object.keys(before.accounts), ...Object.keys(after.accounts)]);
  // Snapshots written before 2026-09-16 have no unresolvedDomains list. For those,
  // knownBefore holds only what resolved, so a formerly-unresolved account stays quiet
  // rather than announcing itself. Quiet is the right way to be wrong here.
  const ctx = {
    beforeDate: before.date,
    knownBefore: new Set([
      ...Object.keys(before.accounts),
      ...(before.unresolvedDomains ?? []),
      ...(before.errors ?? []).map(e => e.domain),
    ]),
    erroredBefore: new Set((before.errors ?? []).map(e => e.domain)),
  };
  const events = [...domains]
    .flatMap(d => diffAccount(d, before.accounts[d], after.accounts[d], after.date, ctx))
    .sort((x, y) => y.p - x.p);

  const act = events.filter(e => e.p >= ACT_ON);
  const rest = collapse(events.filter(e => e.p < ACT_ON));
  const restCount = events.length - act.length;

  console.log(`\nats-radar diff  ${before.date} -> ${after.date}\n`);
  if (!events.length) console.log('  no changes. Normal for consecutive days on a small target list.\n');

  if (act.length) {
    console.log(`ACT ON THESE (${act.length})\n`);
    for (const e of act) {
      console.log(`  [${String(e.p).padStart(2)}] ${e.name.padEnd(18)} ${e.detail}` + (e.callOn ? `   -> CALL ON ${e.callOn}` : ''));
      if (e.url) console.log(`       ${' '.repeat(18)} ${e.url}`);
    }
    console.log('');
  } else if (events.length) {
    console.log('  Nothing at priority 8 or above today. Work yesterday\'s call-on dates.\n');
  }

  if (rest.length) {
    console.log(`ALSO CHANGED (${restCount} across ${new Set(rest.map(g => g.domain)).size} accounts)\n`);
    for (const g of rest) console.log(`  [${String(g.p).padStart(2)}] ${g.name.padEnd(18)} ${summarize(g)}`);
  }

  const md = [
    `# ATS radar diff: ${before.date} to ${after.date}`,
    ``,
    `${act.length} worth acting on, ${restCount} lower-priority changes across ${domains.size} accounts.`,
    ``,
    ...(events.length ? [] : ['No changes detected.']),
    ...(act.length ? [
      `## Act on these`,
      ``,
      `| Priority | Event | Company | Detail | Call on |`,
      `|--:|---|---|---|---|`,
      ...act.map(e => `| ${e.p} | ${e.type} | ${e.name} | ${e.detail} | ${e.callOn ?? ''} |`),
      ``,
    ] : []),
    ...(rest.length ? [
      `## Also changed`,
      ``,
      `| P | Event | Company | What changed |`,
      `|--:|---|---|---|`,
      ...rest.map(g => `| ${g.p} | ${g.type} | ${g.name} | ${summarize(g)} |`),
      ``,
    ] : []),
  ].join('\n');

  await mkdir(REPORTS, { recursive: true });
  const name = adhoc ? 'diff-adhoc.md' : `diff-${after.date}.md`;
  await writeFile(path.join(REPORTS, name), md);
  console.log(`\ndiff -> data/reports/${name}`);

  // A dated signal that only exists in a markdown file expires unread. An ad-hoc or
  // fixture comparison stays out of the queue for the same reason it writes to its own
  // filename: it is a what-if, not something that happened.
  if (!adhoc) {
    const queued = await recordCallOns(events);
    if (queued) console.log(`${queued} call-on date(s) queued. See them with: npm run queue`);
  }
}

// Importable by learn.mjs, which replays every consecutive snapshot pair to build
// a signal history. Only run the CLI when invoked directly.
if (isMain(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
