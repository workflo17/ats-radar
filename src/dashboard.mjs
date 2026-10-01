#!/usr/bin/env node
/**
 * The morning page. Four sections, in the order you actually need them:
 *
 *   1 Now            the calls worth making, each able to show its own evidence
 *   2 Soon           dated follow-ups already committed to
 *   3 Where to dig   the territory, filterable, every score able to show its working
 *   4 How this works the pipeline explained with this morning's real numbers
 *
 * The rule the layout follows: a claim is always visible, the evidence behind it is
 * always one click away, and the rule that produced it is always findable. Nothing is
 * asserted without a route back to the row it came from.
 *
 *   npm run dashboard
 *
 * Palette and type are Greenhouse's own, read off their live design tokens on
 * 2026-09-16: evergreen #15372c for ink, green-700 #008561 for accounts already theirs,
 * blue-500 #3574d6 for everyone on a rival ATS, marigold and poppy for warnings. Their
 * faces are Untitled Sans and Untitled Serif, which are licensed, so this uses
 * Instrument Sans and Instrument Serif, the pairing already chosen for the LinkedIn kit.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  ROOT, snapshotFiles, loadSnapshot, latestSnapshot, daysOld,
  EVERGREEN_DAYS, STALE_DAYS, isMain,
} from './lib/facts.mjs';
import { diffAccount } from './diff.mjs';
import { rankAccounts, scoreBreakdown, HOME_ATS } from './report.mjs';
import { approachFor, battlecards } from './approach.mjs';
import { readQueue, replay as replayQueue } from './queue.mjs';
import { readEvents, replay as replayLedger } from './ledger.mjs';
import { check } from './health.mjs';

const OUT = path.join(ROOT, 'data', 'dashboard.html');
const ACT_ON = 8;
const STRIP_DAYS = 21;
const LOCALE = 'en-US';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shiftDay = (iso, n) => new Date(Date.parse(iso) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const longDate = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const shortDate = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString(LOCALE, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const num = n => Number(n).toLocaleString(LOCALE);
// A stored UTC timestamp rendered as a UTC date reads as tomorrow all evening in New York.
const localShort = ts => new Date(ts).toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' });
const stamp = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const spell = n => ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'][n] ?? String(n);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------ gathering */

async function gather() {
  const files = await snapshotFiles();
  const snap = await latestSnapshot();
  const now = today();

  let events = [], before = null;
  const byDomain = {};
  if (files.length >= 2) {
    before = await loadSnapshot(files.at(-2));
    const ctx = {
      beforeDate: before.date,
      knownBefore: new Set([...Object.keys(before.accounts), ...(before.unresolvedDomains ?? []), ...(before.errors ?? []).map(e => e.domain)]),
      erroredBefore: new Set((before.errors ?? []).map(e => e.domain)),
    };
    for (const d of new Set([...Object.keys(before.accounts), ...Object.keys(snap.accounts)])) {
      byDomain[d] = diffAccount(d, before.accounts[d], snap.accounts[d], snap.date, ctx);
    }
    events = Object.values(byDomain).flat().sort((x, y) => y.p - x.p);
  }

  const ranked = rankAccounts(snap);
  const cards = await battlecards();
  for (const r of ranked) {
    r.events = byDomain[r.domain] ?? [];
    r.approach = approachFor({ f: r.f, domain: r.domain, events: r.events, ranked, cards, homeAts: HOME_ATS });
  }
  const approachBy = Object.fromEntries(ranked.map(r => [r.domain, r.approach]));

  return {
    now, snap, files, events, before, byDomain, ranked, approachBy,
    queue: replayQueue(await readQueue()).filter(i => i.status === 'open'),
    ledger: replayLedger(await readEvents()),
    health: await check(now),
  };
}

/* -------------------------------------------------------------- the age comb */

const COMB_W = 400;
const COMB_EVER_X = COMB_W - 12;
const combScale = d => 5 + (Math.min(d, EVERGREEN_DAYS) / EVERGREEN_DAYS) * (COMB_EVER_X - 16);

function combAxis() {
  const ticks = [[0, '0'], [60, '60'], [180, '180'], [365, '1 year']].map(([d, label]) => {
    const x = combScale(d).toFixed(1);
    return `<line x1="${x}" y1="0" x2="${x}" y2="4"/><text x="${x}" y="14">${label}</text>`;
  }).join('');
  return `<svg class="axis" viewBox="0 0 ${COMB_W} 18" width="${COMB_W}" height="18" aria-hidden="true">${ticks}</svg>`;
}

/** Every open req as one tick, placed by how long it has been open. */
function ageComb(facts, height = 28) {
  const ticks = (facts.jobs ?? []).map(j => {
    const d = daysOld(j.postedAt);
    if (d === null) return '';
    const over = d > EVERGREEN_DAYS;
    const x = (over ? COMB_EVER_X : combScale(d)).toFixed(1);
    const cls = over ? 'tk tk-ever' : d > STALE_DAYS ? 'tk tk-stuck' : 'tk';
    return `<line class="${cls}" x1="${x}" y1="5" x2="${x}" y2="${height - 5}" data-t="${esc(j.title)}" data-d="${d}"/>`;
  }).join('');
  const gate = combScale(STALE_DAYS).toFixed(1);
  return `<svg class="comb" viewBox="0 0 ${COMB_W} ${height}" width="${COMB_W}" height="${height}" role="img"
   aria-label="${facts.jobCount} open roles by age, ${facts.staleCount} of them past ${STALE_DAYS} days">
  <line class="comb-axis" x1="3" y1="${height / 2}" x2="${COMB_W - 3}" y2="${height / 2}"/>
  <line class="comb-gate" x1="${gate}" y1="1" x2="${gate}" y2="${height - 1}"/>${ticks}</svg>`;
}

/* ------------------------------------------------------- section 1: the calls */

function evidenceTrail(e, snap) {
  const v = e.evidence;
  if (!v) return `<p class="ev-none">No row-level evidence is stored for this event type.</p>`;
  const src = `<p class="ev-src">Read from <code>data/snapshots/${esc(v.seenOn ?? v.absentOn ?? '')}.json</code> and <code>data/snapshots/${esc(snap.date)}.json</code>, both collected from the company's own public job-board API.</p>`;

  if (v.kind === 'closed-req') {
    const age = daysOld(v.job.postedAt);
    return `<ol class="ev">
      <li><b>The req existed.</b> "${esc(v.job.title)}"${v.job.location ? ` in ${esc(v.job.location)}` : ''} was on their board on ${esc(shortDate(v.seenOn))}${age !== null ? `, posted ${plural(age, 'day', 'days')} before that` : ''}.</li>
      <li><b>It is gone.</b> Today's collection returned their whole board and that req id is not in it.</li>
      <li><b>The title matched the buyer rule.</b> It carries a seniority word and a recruiting word and none of the disqualifiers. <a href="#how-rank">See the rule</a>.</li>
      <li><b>So they hired.</b> Senior hires start four to eight weeks out, so ${v.delayDays} days from today is roughly week two of that person's tenure, while they are still writing down what is broken.</li>
    </ol>${src}`;
  }
  if (v.kind === 'opened-req') {
    return `<ol class="ev">
      <li><b>It was not there.</b> No such req on their board on ${esc(shortDate(v.absentOn))}.</li>
      <li><b>It is there now.</b> "${esc(v.job.title)}"${v.job.location ? ` in ${esc(v.job.location)}` : ''}.</li>
      <li><b>The title matched the buyer rule</b>, so the person who would own this decision is being recruited right now. <a href="#how-rank">See the rule</a>.</li>
      ${v.job.url ? `<li><a href="${esc(v.job.url)}" target="_blank" rel="noopener">Read the posting</a></li>` : ''}
    </ol>${src}`;
  }
  if (v.kind === 'migration') {
    return `<ol class="ev">
      <li><b>Then.</b> On ${esc(shortDate(v.seenOn))} their board answered on <code>${esc(v.from)}</code> as <code>${esc(v.fromToken)}</code>, with ${plural(v.fromCount ?? 0, 'req', 'reqs')}.</li>
      <li><b>Now.</b> It answers on <code>${esc(v.to)}</code> as <code>${esc(v.toToken)}</code>, with ${plural(v.toCount ?? 0, 'req', 'reqs')}.</li>
      <li><b>Check this one before you use it.</b> A move away from a board that held zero reqs usually means the earlier detection was wrong, not that they migrated. Compare the two counts above.</li>
    </ol>${src}`;
  }
  if (v.kind === 'repost') {
    return `<ol class="ev">
      <li><b>Closed.</b> "${esc(v.prior.title)}" was open on ${esc(shortDate(v.seenOn))} and is gone today.</li>
      <li><b>Reopened.</b> "${esc(v.job.title)}" appeared with a new id.</li>
      <li><b>Matched on ${esc(v.matchedOn)}</b>, and only because that identifier appears exactly once on each side of the comparison. Ambiguous ids are ignored. <a href="#how-diff">Why that matters</a>.</li>
    </ol>${src}`;
  }
  return `<p class="ev-none">${esc(JSON.stringify(v).slice(0, 300))}</p>`;
}

function callCards(events, snap, approachBy = {}) {
  const act = events.filter(e => e.p >= ACT_ON);
  if (!act.length) {
    return `<p class="empty">Nothing at priority ${ACT_ON} or above since the last collection. Work section 2, then section 3.</p>`;
  }
  return act.map(e => {
    const a = approachBy[e.domain];
    const customer = a?.motion === 'customer';
    return `
  <article class="card${customer ? ' card-cust' : ''}">
    <div class="card-head">
      <span class="p p-${e.p}" title="priority ${e.p} of 10">${e.p}</span>
      <h3>${esc(e.name)}</h3>
      <span class="tag">${esc(e.type.toLowerCase().replace(/_/g, ' '))}</span>
      <span class="ap-m ${customer ? 'is-cust' : ''}">${customer ? 'existing customer' : 'new business'}</span>
      ${e.callOn ? `<span class="pill">call ${esc(shortDate(e.callOn))}</span>` : ''}
    </div>
    <p class="card-d">${esc(e.detail)}</p>
    <p class="card-w">${esc(e.why)}</p>
    ${customer ? `<p class="card-warn">This account already runs Greenhouse. It is not a meeting you can book, and it does not count toward quota. Tell whoever owns the account.</p>` : ''}
    <details class="disc">
      <summary>How we know</summary>
      <div class="disc-body">${evidenceTrail(e, snap)}</div>
    </details>
    ${a ? `<details class="disc"><summary>What to do about it</summary><div class="disc-body">${approachBlock(a)}</div></details>` : ''}
  </article>`;
  }).join('');
}

/* --------------------------------------------------------- section 2: queue */

function queueList(queue, now) {
  if (!queue.length) {
    return `<p class="empty">Empty. A dated follow-up lands here every time a talent leader req closes, and stays until you clear it.</p>`;
  }
  return `<ul class="queue">` + [...queue].sort((a, b) => a.callOn.localeCompare(b.callOn)).map(i => {
    const n = daysBetween(now, i.callOn);
    const state = n < 0 ? 'late' : n === 0 ? 'now' : 'soon';
    const when = n < 0 ? `${-n} days late` : n === 0 ? 'today' : `in ${n} days`;
    return `<li class="q-${state}">
      <span class="q-when">${esc(when)}</span>
      <span class="q-co">${esc(i.name)}</span>
      <span class="q-id" translate="no" title="clear it with: npm run queue -- done ${esc(i.id)}">${esc(i.id)}</span>
      <span class="q-why">${esc(i.reason)} · queued ${esc(localShort(i.addedAt ?? i.addedOn))}, to call ${esc(shortDate(i.callOn))}</span>
    </li>`;
  }).join('') + `</ul>`;
}

/* ----------------------------------------------------- section 3: the table */

function territoryBar(snap) {
  const by = snap.stats.byAts ?? {};
  const house = by[HOME_ATS] ?? 0;
  const unresolved = by.unresolved ?? 0;
  const rival = Object.entries(by).filter(([k]) => k !== HOME_ATS && k !== 'unresolved');
  const rivalTotal = rival.reduce((s, [, v]) => s + v, 0);
  const seg = (n, cls, label) => n ? `<span class="seg ${cls}" style="flex:${n}"><span class="seg-n">${n}</span><span class="seg-l">${esc(label)}</span></span>` : '';
  return `<div class="bar" role="img" aria-label="${rivalTotal} accounts on a rival ATS, ${house} already on Greenhouse, ${unresolved} unresolved">
    ${seg(rivalTotal, 'seg-rival', 'on a rival ATS')}
    ${seg(house, 'seg-house', 'already yours')}
    ${seg(unresolved, 'seg-unknown', 'unresolved')}
  </div>
  <ul class="vendors">${rival.sort((a, b) => b[1] - a[1]).map(([k, v]) => `<li><b>${v}</b> <span translate="no">${esc(k)}</span></li>`).join('')}</ul>`;
}

/**
 * The recommendation. Three questions in the order an SDR asks them: is this new
 * business at all, why this company, and what do I open with.
 */
function approachBlock(a) {
  const R = a.rating;
  const bar = (n, label) => `<span class="ax"><span class="ax-l">${label}</span><span class="ax-t" aria-hidden="true"><span class="ax-f" style="width:${n * 10}%"></span></span><span class="ax-n">${n}</span></span>`;

  const head = `
    <div class="ap-head">
      <span class="gr gr-${a.rating.letter === '·' ? 'x' : a.rating.letter}">${esc(a.rating.letter)}</span>
      <span class="ap-v">${esc(R.verdict)}</span>
      <span class="ap-m ${a.motion === 'customer' ? 'is-cust' : ''}">${a.motion === 'customer' ? 'existing customer' : 'new business'}</span>
    </div>
    ${a.motion === 'customer' ? '' : `<div class="axes">${bar(R.pain, 'pain')}${bar(R.timing, 'timing')}</div>`}`;

  const row = (label, body) => body ? `<div class="ap-row"><span class="ap-k">${esc(label)}</span><div class="ap-b">${body}</div></div>` : '';

  return `<div class="approach">
    ${head}
    ${row('Why them', esc(a.whyThem))}
    ${row('Why now', esc(a.whyNow.text) + (a.whyNow.callOn ? ` <b>Call on ${esc(shortDate(a.whyNow.callOn))}.</b>` : ''))}
    ${row('Lead with', `<b>${esc(a.angle.lead)}</b><br>${esc(a.angle.because)}${a.angle.support ? `<span class="ap-s">Supporting point from the ${esc(a.cardName)} card: ${esc(a.angle.support)}</span>` : ''}`)}
    ${a.opener ? row('Say something like', `<span class="ap-q">${esc(a.opener.line)}</span>${a.opener.clean ? '' : `<span class="ap-warn">Contains "${esc(a.opener.flagged)}", which reads as a pitch. Rewrite it.</span>`}`) : ''}
    ${a.ask ? row('Then ask', esc(a.ask)) : ''}
    ${a.peer ? row('Peer to name', `${esc(a.peer.name)}, ${a.peer.jobCount} open roles, already on Greenhouse. A named comparable is the difference between a 3% and a 15% reply rate.`) : ''}
    ${a.avoid ? row('Do not say', `<span class="ap-no">${esc(a.avoid)}</span>${a.theyWin ? `<span class="ap-s">Where they genuinely win: ${esc(a.theyWin)}</span>` : ''}`) : ''}
  </div>`;
}

function scorecard(r) {
  const rows = scoreBreakdown(r.f).map(b => `
    <tr class="${b.points ? 'hit' : 'miss'}">
      <td class="sc-p">${b.points ? '+' + b.points : '0'}</td>
      <td class="sc-w">${esc(b.why)}<span class="sc-n">${esc(b.note)}</span></td>
    </tr>`).join('');
  const oldest = (r.f.oldest ?? []).slice(0, 3).map(j =>
    `<li>${esc(j.title)}${j.location ? `, ${esc(j.location)}` : ''} <b>${daysOld(j.postedAt)} days</b></li>`).join('');
  return `<div class="disc-body">
    ${r.approach ? approachBlock(r.approach) : ''}
    <p class="sc-h">How the 30-point pain score was built</p>
    <table class="sc"><caption class="sr-only">Score components for ${esc(r.f.name || r.domain)}</caption>
      <tbody>${rows}</tbody>
      <tfoot><tr><td class="sc-p">${r.s}</td><td class="sc-w">out of a possible 30</td></tr></tfoot>
    </table>
    ${oldest ? `<p class="sc-h">Longest-open roles, evergreen posts excluded</p><ul class="sc-o">${oldest}</ul>` : ''}
    <p class="ev-src">Board read as <code translate="no">${esc(r.f.ats)}/${esc(r.f.token)}</code> on ${esc(shortDate(r.snapDate))}.${r.f.buyers.length ? ` Talent-leader reqs open: ${r.f.buyers.map(j => esc(j.title)).join('; ')}.` : ''}</p>
  </div>`;
}

function targetsTable(ranked, snapDate) {
  const rows = ranked.filter(r => r.f.ats !== HOME_ATS)
    .sort((a, b) => (b.approach?.rating.total ?? 0) - (a.approach?.rating.total ?? 0) || b.f.jobCount - a.f.jobCount);
  const body = rows.map((r, i) => {
    const tags = [];
    if ('AB'.includes(r.approach?.rating.letter ?? '')) tags.push('ab');
    if (r.f.buyers.length) tags.push('buyer');
    if (r.f.staleRatio > 0.4) tags.push('stuck');
    if (r.f.jobCount >= 100) tags.push('big');
    return `
    <tr data-tags="${tags.join(' ')}" data-score="${r.s}" data-open="${r.f.jobCount}"
        data-grade="${r.approach?.rating.total ?? 0}"
        data-stuck="${r.f.staleCount}" data-name="${esc((r.f.name || r.domain).toLowerCase())}">
      <td class="t-co">
        <button type="button" class="rowtog" aria-expanded="false" aria-controls="d-${i}">
          <span class="t-name">${esc(r.f.name || r.domain)}</span>${r.f.buyers.length ? '<span class="t-flag">hiring their talent lead</span>' : ''}
        </button>
      </td>
      <td class="t-grade"><span class="gr gr-${r.approach?.rating.letter ?? 'D'}">${esc(r.approach?.rating.letter ?? 'D')}</span><span class="t-ax">${r.approach?.rating.pain ?? 0}/${r.approach?.rating.timing ?? 0}</span></td>
      <td class="ats" translate="no">${esc(r.f.ats)}</td>
      <td class="num">${num(r.f.jobCount)}</td>
      <td class="comb-c">${ageComb(r.f)}</td>
      <td class="num strong">${num(r.f.staleCount)}</td>
    </tr>
    <tr class="drow" id="d-${i}" data-for="${i}" hidden><td colspan="6">${scorecard({ ...r, snapDate })}</td></tr>`;
  }).join('');

  const counts = {
    all: rows.length,
    ab: rows.filter(r => 'AB'.includes(r.approach?.rating.letter ?? '')).length,
    buyer: rows.filter(r => r.f.buyers.length).length,
    stuck: rows.filter(r => r.f.staleRatio > 0.4).length,
    big: rows.filter(r => r.f.jobCount >= 100).length,
  };
  const pill = (key, label) => `<button type="button" class="fpill" data-filter="${key}" aria-pressed="${key === 'all'}">${esc(label)} <span class="fn">${counts[key]}</span></button>`;

  return `
  <div class="controls">
    <div class="fgroup" role="group" aria-label="Filter accounts">
      ${pill('all', 'All')}${pill('ab', 'Graded A or B')}${pill('buyer', 'Hiring a talent lead')}${pill('stuck', 'Mostly stuck')}${pill('big', 'Over 100 reqs')}
    </div>
    <p class="fnote" id="fcount" aria-live="polite">Showing all ${counts.all}. Open a company to see how its score was built.</p>
  </div>
  <div class="tscroll">
  <table class="targets" id="targets">
    <caption class="sr-only">Accounts on a rival ATS, ranked by signal score</caption>
    <thead><tr>
      <th scope="col"><button type="button" class="sortb" data-sort="name">Account</button></th>
      <th scope="col"><button type="button" class="sortb" data-sort="grade" aria-sort="descending">Grade<span class="th-sub">pain / timing</span></button></th>
      <th scope="col">ATS</th>
      <th scope="col" class="num"><button type="button" class="sortb" data-sort="open">Open</button></th>
      <th scope="col" class="comb-h">Every open role, by days open${combAxis()}</th>
      <th scope="col" class="num"><button type="button" class="sortb" data-sort="stuck">Stuck</button></th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>
  </div>
  <ul class="legend">
    <li><span class="lg-fresh" aria-hidden="true"></span>open under ${STALE_DAYS} days</li>
    <li><span class="lg-stuck" aria-hidden="true"></span>open ${STALE_DAYS} to ${EVERGREEN_DAYS} days, the pitch</li>
    <li><span class="lg-ever" aria-hidden="true"></span>past a year, an evergreen pipeline post</li>
    <li><span class="lg-gate" aria-hidden="true"></span>the ${STALE_DAYS}-day line</li>
  </ul>`;
}

/* --------------------------------------------------- section 4: how it works */

function collectionStrip(files, now) {
  const have = new Set(files.map(f => f.replace('.json', '')));
  const cells = [];
  for (let i = STRIP_DAYS - 1; i >= 0; i--) {
    const d = shiftDay(now, -i);
    cells.push(`<span class="cell ${have.has(d) ? 'on' : 'off'}" title="${d}${have.has(d) ? '' : ', no snapshot'}"></span>`);
  }
  const first = shiftDay(now, -(STRIP_DAYS - 1));
  const kept = [...have].filter(d => d >= first).length;
  return `<div class="strip" role="img" aria-label="${kept} of the last ${STRIP_DAYS} days have a snapshot">${cells.join('')}</div>
    <p class="strip-l"><b>${kept}</b> of the last ${STRIP_DAYS} days collected.${kept < STRIP_DAYS ? ' Missing days cannot be backfilled. A day not collected is a change nobody can ever see.' : ''}</p>`;
}

function step(n, id, title, summary, body) {
  return `<details class="step" id="${id}">
    <summary><span class="step-n">${n}</span><span class="step-t">${esc(title)}</span><span class="step-s">${summary}</span></summary>
    <div class="step-body">${body}</div>
  </details>`;
}

function howItWorks(d) {
  const { snap, files, events, before, ranked } = d;
  const by = snap.stats.byAts ?? {};
  const act = events.filter(e => e.p >= ACT_ON).length;
  const rival = ranked.filter(r => r.f.ats !== HOME_ATS).length;

  return `
  ${step(1, 'how-collect', 'Collect', `${snap.stats.targets} asked, ${snap.stats.resolved} answered`, `
    <p>Every major ATS publishes its customers' job boards as a free, unauthenticated JSON
    API. This morning the collector asked all ${snap.stats.targets} companies in
    <code>config/targets.csv</code> and got ${num(snap.stats.totalJobs)} open roles back
    across ${snap.stats.resolved} boards, in ${snap.stats.durationSec ?? '?'} seconds.</p>
    <p>Six APIs are read: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee.
    Workday, iCIMS and any company that proxies its careers page server side are invisible
    here, which accounts for most of the ${by.unresolved ?? 0} unresolved.</p>
    <p class="warnline">Nothing on this page comes from a Greenhouse system, a CRM, or a
    paid data vendor. Public web in, ranked list out.</p>`)}

  ${step(2, 'how-detect', 'Detect', `${num(by[HOME_ATS] ?? 0)} on Greenhouse, ${rival} on a rival`, `
    <p>A company's board token is guessed from its domain and its name, then each ATS is
    probed in turn. The first one that answers with a real board wins, and the answer is
    cached and re-checked weekly, because an ATS change is itself a top signal.</p>
    <p><b>An empty board is never proof.</b> Probed with a company that is not their
    customer, Lever returns <code>200</code> with <code>[]</code>, SmartRecruiters returns
    <code>totalFound: 0</code>, and Workable returns a named account holding no jobs.
    Treating any of those as a yes filed nine accounts under Workable that had never been
    Workable customers, one of them a current Greenhouse customer. A detection now needs a
    non-empty board.</p>
    <p>When the token cannot be guessed at all, it gets pinned by hand in
    <code>config/targets.csv</code> as <code>domain,name,ats,token</code>. Front is the
    example: their Ashby board is <code>frontcareers</code>, which no amount of guessing
    from "front.com" or "Front" ever reaches.</p>`)}

  ${step(3, 'how-snapshot', 'Snapshot', `${files.length} days on file`, `
    <p>Each morning's answers are written to
    <code>data/snapshots/${esc(snap.date)}.json</code> and never edited. This is the only
    part of the system that cannot be bought. Vendors sell a picture of who runs what
    today, with a 90 to 180 day lag on mid-market records. Change only exists if
    yesterday's file is still on disk.</p>
    ${collectionStrip(files, d.now)}`)}

  ${step(4, 'how-diff', 'Compare', before ? `${esc(shortDate(before.date))} against ${esc(shortDate(snap.date))}, ${events.length} changes` : 'needs two snapshots', `
    ${before ? `<p>Today's file is compared to ${esc(shortDate(before.date))}'s, req by req, by the
    id the ATS assigns. Present then and absent now means closed. Absent then and present
    now means opened. ${events.length} changes came out of it, ${act} of them at priority
    ${ACT_ON} or above.</p>
    <p><b>Requisition ids are not reliable identifiers.</b> Greenhouse hands Stripe the
    literal string <code>See Opening ID</code> for all 651 of their reqs, and Brex reuses
    one id across every location a role is open in. An id only counts when it names exactly
    one req on each side of the comparison. Before that rule, a single diff reported 114
    Stripe reposts and buried the two events actually worth calling.</p>
    <p>Eight change types are emitted, priority 10 down to 3. Priority ${ACT_ON} and above
    is dated and expires, which is why it sits at the top of this page and the rest does
    not.</p>` : `<p>The first comparison needs two snapshots. The collector runs at 06:30 daily.</p>`}`)}

  ${step(5, 'how-rank', 'Rank', 'five components, 30 points', `
    <p>The score in section 3 is point-in-time. It reads one snapshot and asks how much
    pain this company's hiring is visibly in. It is not a prediction, and nothing in it is
    weighted by what has actually converted, because there is not yet enough closed
    business to learn from.</p>
    <table class="sc rulebook"><tbody>
      <tr><td class="sc-p">15</td><td class="sc-w">open reqs for a talent leader, up to 3, 5 points each<span class="sc-n">A new head of talent audits the stack in their first 90 days. The strongest single tell.</span></td></tr>
      <tr><td class="sc-p">8</td><td class="sc-w">other open recruiting reqs, up to 4, 2 points each<span class="sc-n">A TA function adding people is a function outgrowing its tooling.</span></td></tr>
      <tr><td class="sc-p">2</td><td class="sc-w">board at or above 25 reqs<span class="sc-n">Below that a spreadsheet still works and the pain is not real yet.</span></td></tr>
      <tr><td class="sc-p">2</td><td class="sc-w">board past 100 reqs<span class="sc-n">Past 100 the coordination cost breaks first, not the tracking.</span></td></tr>
      <tr><td class="sc-p">3</td><td class="sc-w">over 40% of the board open past ${STALE_DAYS} days<span class="sc-n">They cannot fill what they post.</span></td></tr>
    </tbody></table>
    <p><b>"Talent leader" is a title rule, not a judgement.</b> A title qualifies when it
    carries a seniority word (head, director, VP, chief, principal, lead, manager) and a
    recruiting word (recruiting, talent, sourcer, staffing, people ops, HRIS), and carries
    none of the disqualifiers (coordinator, assistant, intern, associate).</p>
    <p><b>"Stuck" means ${STALE_DAYS} to ${EVERGREEN_DAYS} days.</b> Anything open past a
    year is an evergreen pipeline post, counted separately and kept out of the pitch. Ramp
    has a front-end req at 1,274 days. Quoting that back as an unfilled role reads as not
    understanding their board.</p>
    <p><b>Posting age uses the true publish date</b>, not the last-updated field, which
    resets on any edit and would make every stale req look freshly opened.</p>`)}

  ${step(6, 'how-grade', 'Recommend', 'two axes, A to D', `
    <p>The grade in section 3 answers a different question from the 30-point score. The
    score asks how much visible pain a board is in. The grade asks whether to call, and
    it keeps two things apart that a single number hides.</p>
    <p><b>Pain</b>, out of 10, is what their board shows: how much of it is stuck, how
    big it is, whether the recruiting team is growing. <b>Timing</b>, out of 10, is
    whether there is a dated reason to call this week: a talent leader hired or posted,
    an ATS change, a run of reposts. A board can hurt a great deal and still have no
    reason to be called today, and a trigger at a company with no visible pain is a call
    with nothing to talk about.</p>
    <table class="sc rulebook"><tbody>
      <tr><td class="sc-p">A</td><td class="sc-w">pain plus timing at 13 or more<span class="sc-n">Call this week. Rare on purpose.</span></td></tr>
      <tr><td class="sc-p">B</td><td class="sc-w">8 to 12<span class="sc-n">Worth a touch this month.</span></td></tr>
      <tr><td class="sc-p">C</td><td class="sc-w">4 to 7<span class="sc-n">Watch. Not yet a reason to call.</span></td></tr>
      <tr><td class="sc-p">D</td><td class="sc-w">under 4, or under ${15} open reqs<span class="sc-n">Greenhouse's ICP starts around 150 employees, and a board under 15 reqs is usually a company below that line. Said out loud rather than ranked.</span></td></tr>
    </tbody></table>
    <p><b>New business or not.</b> Every recommendation says first whether the account
    already runs Greenhouse. On 2026-09-16 three of the four highest-priority signals in
    this territory were at Datadog, Twilio and Figma, all of them customers. A talent
    leader hired at a customer is a real event, a champion change worth flagging to the
    account owner, but it is not a meeting you can book and it does not count toward
    quota. Presenting it identically to a displacement target is how a rep ends up
    pitching Greenhouse to a Greenhouse customer.</p>
    <p><b>Why the opener is built the way it is.</b> Signal-personalised outreach replies
    at roughly 18% against 3.43% for generic, and trigger plus research plus a named peer
    reference sits in the 15 to 25% band. So each recommendation stacks every signal it
    has and names a comparable company from your own territory that already runs
    Greenhouse. Generated openers are also checked against the words that cost 30 to 50%
    of opens when they read as a pitch, and flagged rather than silently sent.</p>
    <p><b>What it will not do.</b> It will not write the message. Generic AI outreach is
    the most saturated category in the market and it is the part currently failing. The
    leverage is in compressing the research, not in generating the words.</p>`)}

  ${step(7, 'how-limits', 'What this cannot tell you', 'four honest gaps', `
    <ul class="limits">
      <li><b>It cannot see ${by.unresolved ?? 0} of your ${snap.stats.targets} accounts.</b>
      Workday, iCIMS and proxied career pages have no public feed here. Unresolved is an
      honest answer, not a bug, and the pin in step 2 fixes the ones that are fixable.</li>
      <li><b>It has no contacts.</b> Deliberately. Greenhouse pays for ZoomInfo or
      similar, and pulling private data into this repo is the one thing that would make it
      a problem to own.</li>
      <li><b>It does not know what converts.</b> <code>npm run learn</code> joins signals
      against your ledger and refuses to print a percentage under five opportunities.
      Realistically that is late November.</li>
      <li><b>A board is not a company.</b> Reqs move, get reposted for administrative
      reasons, and sit open because of a freeze nobody announced. Every signal here is a
      reason to call, not a fact to assert on the call.</li>
    </ul>`)}`;
}

/* ---------------------------------------------------------------------- page */

function page(d) {
  const { snap, events, queue, ledger, health, now, ranked } = d;
  const act = events.filter(e => e.p >= ACT_ON);
  const due = queue.filter(i => i.callOn <= now);
  const rival = ranked.filter(r => r.f.ats !== HOME_ATS);

  // The headline counts bookable calls only. Three of today's four act-on signals are
  // at accounts that already run Greenhouse, and counting those as calls worth making
  // is how the page would lie to you before you had finished reading it.
  const bookable = act.filter(e => d.approachBy[e.domain]?.motion !== 'customer');
  const atCustomers = act.length - bookable.length;
  const todo = bookable.length + due.length;
  const thesis = todo
    ? `${spell(todo)} ${todo === 1 ? 'call' : 'calls'} worth making today.`
    : `No new business is dated for today. Work section 3.`;
  const thesisSub = atCustomers
    ? `${spell(atCustomers)} other ${atCustomers === 1 ? 'signal is' : 'signals are'} at accounts already on Greenhouse. Worth flagging to whoever owns them, not worth dialling.`
    : null;

  const healthPanel = health.problems.length ? `
    <details class="health" open>
      <summary><span class="h-dot" aria-hidden="true"></span>${plural(health.problems.length, 'thing', 'things')} to fix before you trust these numbers</summary>
      <ul>${health.problems.map(([t, ...rest]) => `<li><span class="hp-t">${esc(t)}</span><span class="hp-d">${esc(rest.join(' ').replace(/\s+/g, ' ').trim())}</span></li>`).join('')}</ul>
    </details>` : `
    <p class="health-ok"><span class="h-dot ok" aria-hidden="true"></span>Data checks passed. Collected ${esc(shortDate(snap.date))}.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#031c17" media="(prefers-color-scheme: dark)">
<title>Territory Radar · ${esc(snap.date)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Instrument+Serif&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  color-scheme: light dark;
  --ink: #15372c; --ink-2: #5f6f68; --ink-3: #667770;
  --surface: #ffffff; --tint: #f3fffb; --rule: #c9f0e6; --rule-2: #e6fff8;
  --house: #008561; --rival: #3574d6; --unknown: #5f6f68;
  --warn-ink: #9a5b00; --warn-bg: #ffecd4; --warn-edge: #ffd093;
  --crit: #d8372a; --focus: #3574d6;
  --sans: "Instrument Sans", system-ui, "Segoe UI", sans-serif;
  --serif: "Instrument Serif", Georgia, serif;
  --mono: "Geist Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
  --pad: clamp(18px, 4vw, 56px);
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --ink: #d9f5ec; --ink-2: #90d1c2; --ink-3: #7a978c;
  --surface: #031c17; --tint: #112b22; --rule: #274b3f; --rule-2: #1c3a30;
  --house: #24a47f; --rival: #5b91e0; --unknown: #7e938b;
  --warn-ink: #ffd093; --warn-bg: #2a2317; --warn-edge: #5c4520;
  --crit: #ff8a7d; --focus: #8fb6ee;
} }

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
body { margin: 0 auto; max-width: 1080px; background: var(--surface); color: var(--ink);
  font: 400 15px/1.55 var(--sans); font-variant-numeric: tabular-nums; padding: 0 var(--pad) 80px; }
h1, h2, h3 { font-weight: 500; letter-spacing: -0.01em; margin: 0; }
a { color: inherit; text-underline-offset: 2px; }
code { font: 400 0.88em var(--mono); background: var(--rule-2); padding: 1px 4px; border-radius: 3px; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 3px; }
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }
.empty { color: var(--ink-2); max-width: 52ch; }

header { display: flex; flex-wrap: wrap; gap: 6px 20px; align-items: baseline; padding: 26px 0 12px; }
h1 { font-size: 14px; letter-spacing: 0.15em; text-transform: uppercase; }
header .when { font: 400 12.5px/1 var(--mono); color: var(--ink-2); }
header .src { font: 400 12.5px/1 var(--mono); color: var(--ink-3); }
@media (min-width: 720px) { header .src { margin-left: auto; } }
nav { position: sticky; top: 0; z-index: 5; display: flex; gap: 2px; flex-wrap: wrap;
  padding: 8px 0; margin-bottom: 30px; background: var(--surface); border-bottom: 1px solid var(--ink); }
nav a { font: 500 12px/1 var(--mono); letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--ink-2); text-decoration: none; padding: 8px 11px; border-radius: 6px; }
nav a:hover { background: var(--rule-2); color: var(--ink); }
nav a b { color: var(--ink-3); font-weight: 500; }

section { margin-bottom: 58px; scroll-margin-top: 58px; }
.sec-h { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-bottom: 18px; }
.sec-n { font: 400 12px/1 var(--mono); color: var(--ink-3); }
.sec-h h2 { font-size: 16px; }
.sec-h p { margin: 0; font-size: 13.5px; color: var(--ink-2); }

.health { background: var(--warn-bg); border: 1px solid var(--warn-edge); border-radius: 10px; margin-bottom: 26px; }
.health > summary { cursor: pointer; padding: 13px 18px; font: 500 13.5px/1.3 var(--sans); color: var(--warn-ink); display: flex; align-items: center; gap: 9px; }
.health ul { margin: 0; padding: 0 18px 16px; list-style: none; display: grid; gap: 9px; }
.health li { display: flex; flex-wrap: wrap; gap: 3px 12px; align-items: baseline; }
.hp-t { font: 500 12.5px/1.3 var(--mono); color: var(--warn-ink); }
.hp-d { font-size: 13.5px; color: var(--ink-2); flex: 1 1 300px; }
.health-ok { font-size: 13.5px; color: var(--ink-2); display: flex; align-items: center; gap: 9px; margin: 0 0 26px; }
.h-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--crit); flex: none; }
.h-dot.ok { background: var(--house); }

.lede { font: 400 clamp(29px, 5vw, 44px)/1.08 var(--serif); letter-spacing: -0.015em; margin: 0 0 12px; max-width: 19ch; text-wrap: balance; }
.lede-sub { margin: 0 0 26px; font: 400 15px/1.55 var(--sans); color: var(--ink-2); max-width: 58ch; }
.card { border: 1px solid var(--rule); border-radius: 10px; padding: 16px 18px; margin-bottom: 10px; }
.card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.card-head h3 { font-size: 17px; font-weight: 600; }
.p { font: 500 12px/21px var(--mono); min-width: 22px; text-align: center; border-radius: 4px; color: var(--surface); background: var(--ink-2); }
.p-10, .p-9 { background: var(--crit); }
.p-8 { background: var(--house); }
.tag { font: 400 11px/1 var(--mono); letter-spacing: 0.04em; color: var(--ink-3); text-transform: uppercase; }
.pill { margin-left: auto; font: 400 12px/1 var(--mono); background: var(--rule-2); border: 1px solid var(--rule); border-radius: 999px; padding: 5px 10px; }
.card-d { margin: 10px 0 0; overflow-wrap: anywhere; }
.card-w { margin: 4px 0 0; font-size: 13.5px; color: var(--ink-2); max-width: 66ch; }

.disc > summary { cursor: pointer; font: 500 12.5px/1 var(--mono); color: var(--rival); padding: 9px 0 3px; width: fit-content; }
.disc > summary::marker { color: var(--ink-3); }
.disc[open] > summary { color: var(--ink-2); }
.disc-body { padding: 8px 0 4px; }
.ev { margin: 0; padding-left: 20px; display: grid; gap: 7px; font-size: 13.5px; max-width: 72ch; }
.ev b { font-weight: 600; }
.ev-src, .ev-none { font-size: 12.5px; color: var(--ink-3); margin: 12px 0 0; max-width: 72ch; }

.queue { list-style: none; margin: 0; padding: 0; }
.queue li { display: grid; grid-template-columns: 100px minmax(0, 1fr) auto; gap: 3px 14px; align-items: baseline; padding: 13px 0; border-bottom: 1px solid var(--rule); }
.q-when { font: 500 12.5px/1 var(--mono); color: var(--ink-2); }
.q-late .q-when { color: var(--crit); } .q-now .q-when { color: var(--house); }
.q-co { font-weight: 600; }
.q-id { font: 400 11.5px/1 var(--mono); color: var(--ink-3); }
.q-why { grid-column: 2 / -1; font-size: 13px; color: var(--ink-2); overflow-wrap: anywhere; }

.bar { display: flex; height: 52px; border-radius: 8px; overflow: hidden; gap: 2px; margin-bottom: 12px; }
.seg { display: flex; flex-direction: column; justify-content: center; padding: 0 12px; min-width: 0; color: #fff; }
.seg-rival { background: var(--rival); } .seg-house { background: var(--house); } .seg-unknown { background: var(--unknown); }
.seg-n { font: 500 16px/1 var(--mono); } .seg-l { font-size: 11.5px; opacity: .93; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vendors { list-style: none; display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0 0 30px; padding: 0; font-size: 13px; color: var(--ink-2); }
.vendors b { font: 500 13px var(--mono); color: var(--ink); }

.controls { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; margin-bottom: 14px; }
.fgroup { display: flex; flex-wrap: wrap; gap: 6px; }
.fpill { font: 400 13px/1 var(--sans); color: var(--ink-2); background: none; border: 1px solid var(--rule); border-radius: 999px; padding: 7px 13px; cursor: pointer; }
.fpill:hover { border-color: var(--ink-3); color: var(--ink); }
.fpill[aria-pressed="true"] { background: var(--ink); border-color: var(--ink); color: var(--surface); }
.fn { font: 500 11.5px var(--mono); opacity: .7; }
.fnote { margin: 0; font-size: 13px; color: var(--ink-3); }

.tscroll { overflow-x: auto; }
.targets { width: 100%; border-collapse: collapse; font-size: 14px; }
.targets th, .targets td { text-align: left; padding: 9px 14px 9px 0; border-bottom: 1px solid var(--rule); vertical-align: middle; }
.targets thead th { font: 500 11px/1.3 var(--mono); letter-spacing: 0.07em; text-transform: uppercase; color: var(--ink-3); border-bottom-color: var(--ink-3); vertical-align: bottom; }
.sortb { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; letter-spacing: inherit; text-transform: inherit; }
.sortb:hover { color: var(--ink); }
.sortb[aria-sort="descending"]::after { content: " \\2193"; }
.sortb[aria-sort="ascending"]::after { content: " \\2191"; }
.t-co { min-width: 170px; }
.rowtog { display: block; text-align: left; font: 600 14px/1.3 var(--sans); color: var(--ink);
  background: none; border: 0; padding: 0; cursor: pointer; }
.rowtog:hover .t-name { text-decoration: underline; }
.rowtog::before { content: "B8 "; color: var(--ink-3); font-weight: 400; }
.rowtog[aria-expanded="true"]::before { content: "BE "; }
.drow > td { padding: 4px 0 22px; background: var(--tint); }
.drow .disc-body { padding: 18px 20px 4px; }
.t-flag { display: block; font: 400 11px/1.3 var(--mono); color: var(--house); }
.t-score { font-weight: 500; color: var(--ink); }
.ats { font: 400 12.5px var(--mono); color: var(--ink-2); }
.num { text-align: right; font: 400 13px var(--mono); color: var(--ink-2); white-space: nowrap; }
.num.strong { color: var(--ink); font-weight: 500; }
.comb-c, .comb-h { width: 420px; padding-right: 18px; }
.comb { display: block; width: 100%; height: auto; }
.comb-axis { stroke: var(--rule); stroke-width: 1; }
.comb-gate { stroke: var(--ink-3); stroke-width: 1; stroke-dasharray: 2 3; }
.tk { stroke: var(--rival); stroke-width: 1.5; opacity: .45; }
.tk-stuck { stroke: var(--rival); opacity: 1; stroke-width: 2; }
.tk-ever { stroke: var(--ink-3); opacity: .55; stroke-width: 2; }
.axis { display: block; width: 100%; height: auto; overflow: visible; margin-top: 5px; }
.axis line { stroke: var(--ink-3); stroke-width: 1; }
.axis text { font: 400 9px var(--mono); fill: var(--ink-3); text-anchor: middle; letter-spacing: 0; text-transform: none; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 22px; margin: 14px 0 0; padding: 0; list-style: none; font-size: 12.5px; color: var(--ink-2); }
.legend span { display: inline-block; width: 3px; height: 13px; margin-right: 7px; vertical-align: -2px; }
.lg-fresh { background: var(--rival); opacity: .45; } .lg-stuck { background: var(--rival); }
.lg-ever { background: var(--ink-3); opacity: .75; width: 4px; }
.lg-gate { width: 0; border-left: 1px dashed var(--ink-3); height: 13px; }

.sc { border-collapse: collapse; font-size: 13px; margin: 0 0 14px; max-width: 62ch; }
.sc td { padding: 6px 12px 6px 0; border-bottom: 1px solid var(--rule-2); vertical-align: top; }
.sc .sc-p { font: 500 13px var(--mono); text-align: right; width: 42px; color: var(--ink); }
.sc tr.miss .sc-p, .sc tr.miss .sc-w { color: var(--ink-3); }
.sc-n { display: block; font-size: 12px; color: var(--ink-3); margin-top: 2px; }
.sc tfoot td { border-bottom: 0; border-top: 1px solid var(--ink-3); font-weight: 600; }
.sc-h { font: 500 11px/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-3); margin: 0 0 7px; }
.sc-o { margin: 0 0 12px; padding-left: 18px; font-size: 13px; color: var(--ink-2); }
.sc-o b { font: 500 13px var(--mono); color: var(--ink); }
.rulebook { max-width: 68ch; }

.step { border-bottom: 1px solid var(--rule); }
.step > summary { cursor: pointer; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; padding: 15px 0; }
.step > summary::marker { color: var(--ink-3); }
.step-n { font: 400 12px/1 var(--mono); color: var(--ink-3); min-width: 14px; }
.step-t { font-weight: 600; font-size: 15px; }
.step-s { font: 400 12.5px/1 var(--mono); color: var(--ink-3); margin-left: auto; }
.step-body { padding: 0 0 22px 28px; max-width: 74ch; }
.step-body p { margin: 0 0 12px; font-size: 13.5px; color: var(--ink-2); }
.step-body p b { color: var(--ink); }
.warnline { border-left: 2px solid var(--house); padding-left: 12px; }
.limits { margin: 0; padding-left: 18px; display: grid; gap: 10px; font-size: 13.5px; color: var(--ink-2); max-width: 74ch; }
.limits b { color: var(--ink); }

.strip { display: flex; gap: 3px; margin-bottom: 10px; }
.cell { flex: 1; height: 26px; border-radius: 3px; background: var(--house); }
.cell.off { background: transparent; border: 1px dashed var(--crit); }
.strip-l { font-size: 13px; color: var(--ink-2); margin: 0; }
.strip-l b { font: 500 13px var(--mono); color: var(--ink); }

/* the recommendation */
.approach { margin: 0 0 20px; max-width: 74ch; }
.ap-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 10px; }
.gr { font: 500 15px/28px var(--mono); min-width: 28px; text-align: center; border-radius: 6px; color: var(--surface); background: var(--ink-2); }
.gr-A { background: var(--crit); } .gr-B { background: var(--house); }
.gr-C { background: var(--rival); } .gr-D, .gr-x { background: var(--unknown); }
.ap-v { font-weight: 600; font-size: 15px; }
.ap-m { font: 500 10.5px/1 var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--house);
  border: 1px solid var(--house); border-radius: 999px; padding: 5px 9px; }
.ap-m.is-cust { color: var(--warn-ink); border-color: var(--warn-edge); }
.axes { display: flex; flex-wrap: wrap; gap: 8px 22px; margin-bottom: 14px; }
.ax { display: flex; align-items: center; gap: 8px; font: 400 11.5px/1 var(--mono); color: var(--ink-3); }
.ax-l { min-width: 42px; text-transform: uppercase; letter-spacing: .08em; }
.ax-t { width: 96px; height: 5px; border-radius: 3px; background: var(--rule); overflow: hidden; }
.ax-f { display: block; height: 100%; background: var(--rival); }
.ax-n { color: var(--ink-2); }
.ap-row { display: grid; gap: 2px 16px; padding: 9px 0; border-top: 1px solid var(--rule-2); grid-template-columns: 1fr; }
@media (min-width: 640px) { .ap-row { grid-template-columns: 116px minmax(0, 1fr); } }
.ap-k { font: 500 11px/1.6 var(--mono); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
.ap-b { font-size: 13.5px; color: var(--ink-2); }
.ap-b b { color: var(--ink); font-weight: 600; }
.ap-s { display: block; margin-top: 6px; font-size: 12.5px; color: var(--ink-3); }
.ap-q { display: block; font: 400 13.5px/1.6 var(--sans); color: var(--ink); border-left: 2px solid var(--rival); padding-left: 12px; }
.ap-no { color: var(--warn-ink); }
.ap-warn { display: block; margin-top: 6px; font-size: 12.5px; color: var(--crit); }
.card-cust { border-color: var(--warn-edge); }
.card-warn { margin: 10px 0 0; font-size: 13px; color: var(--warn-ink); max-width: 66ch; }
.t-grade { white-space: nowrap; }
.t-ax { margin-left: 8px; font: 400 11.5px var(--mono); color: var(--ink-3); }
.th-sub { display: block; font-weight: 400; text-transform: none; letter-spacing: 0; color: var(--ink-3); opacity: .75; }

#tip { position: fixed; z-index: 20; pointer-events: none; opacity: 0; background: var(--ink); color: var(--surface);
  font: 400 12px/1.4 var(--sans); padding: 6px 9px; border-radius: 6px; max-width: 280px; }
#tip b { font: 500 12px var(--mono); }

footer { padding-top: 18px; border-top: 1px solid var(--rule); font: 400 12px/1.7 var(--mono); color: var(--ink-3); }

@media (max-width: 759px) {
  .comb-c, .comb-h, .legend { display: none; }
  .targets th, .targets td { padding-right: 10px; }
  .step-s { margin-left: 0; flex-basis: 100%; }
  .pill { margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
@media print { nav, #tip { display: none; } body { max-width: none; padding: 0; } }
</style>
</head>
<body>

<header>
  <h1>Territory Radar</h1>
  <span class="when">${esc(longDate(snap.date))}</span>
  <span class="src">${snap.stats.targets} accounts · public job boards only</span>
</header>

<nav aria-label="Sections">
  <a href="#now">1 Now <b>${bookable.length}</b></a>
  <a href="#soon">2 Soon <b>${queue.length}</b></a>
  <a href="#dig">3 Where to dig <b>${rival.length}</b></a>
  <a href="#how">4 How this works</a>
</nav>

<section id="now">
  <div class="sec-h"><span class="sec-n">1</span><h2>Now</h2><p>Dated, and they expire.</p></div>
  ${healthPanel}
  <p class="lede">${esc(thesis)}</p>
  ${thesisSub ? `<p class="lede-sub">${esc(thesisSub)}</p>` : ''}
  ${callCards(events, snap, d.approachBy)}
</section>

<section id="soon">
  <div class="sec-h"><span class="sec-n">2</span><h2>Soon</h2><p>Follow-ups you already committed to.</p></div>
  ${queueList(queue, now)}
</section>

<section id="dig">
  <div class="sec-h"><span class="sec-n">3</span><h2>Where to dig</h2><p>Standing reasons to call, whether or not anything changed today.</p></div>
  ${territoryBar(snap)}
  ${targetsTable(ranked, snap.date)}
</section>

<section id="how">
  <div class="sec-h"><span class="sec-n">4</span><h2>How this works</h2><p>Every number above, traced back to where it came from.</p></div>
  ${howItWorks(d)}
</section>

<footer>
  Built ${esc(stamp())} from data/snapshots/${esc(snap.date)}.json.
  Public job-board APIs only. Nothing here comes from a Greenhouse system.
  ${ledger.length ? `Ledger: ${plural(ledger.length, 'opportunity', 'opportunities')}.` : 'Ledger empty.'}
</footer>

<div id="tip" role="status" aria-live="off"></div>

<script>
(function () {
  'use strict';

  var pills = Array.prototype.slice.call(document.querySelectorAll('[data-filter]'));
  // Child combinators, not descendant. Each detail row holds a scorecard with its own
  // nested <table>, so '#targets tbody tr' matches far more rows than there are
  // accounts: the filter then hid scorecard lines and sorting hoisted them into the
  // main table. Account rows and their detail rows are tracked as pairs.
  var tbody = document.querySelector('#targets > tbody');
  var rows = Array.prototype.slice.call(document.querySelectorAll('#targets > tbody > tr:not(.drow)'));
  var detailOf = function (tr) { return document.getElementById('d-' + tr.querySelector('.rowtog').getAttribute('aria-controls').slice(2)); };

  // expand and collapse
  Array.prototype.forEach.call(document.querySelectorAll('.rowtog'), function (btn) {
    btn.addEventListener('click', function () {
      var d = document.getElementById(btn.getAttribute('aria-controls'));
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      d.hidden = open;
    });
  });
  var note = document.getElementById('fcount');

  function applyFilter(key) {
    var shown = 0;
    rows.forEach(function (tr) {
      var tags = (tr.getAttribute('data-tags') || '').split(' ');
      var on = key === 'all' || tags.indexOf(key) !== -1;
      tr.hidden = !on;
      var d = detailOf(tr);
      // A filtered-out row must take its open detail with it.
      if (d) d.hidden = !on || tr.querySelector('.rowtog').getAttribute('aria-expanded') !== 'true';
      if (on) shown++;
    });
    pills.forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-filter') === key));
    });
    note.textContent = (key === 'all' ? 'Showing all ' + shown : 'Showing ' + shown + ' of ' + rows.length) +
      '. Open a company to see how its score was built.';
  }
  pills.forEach(function (b) {
    b.addEventListener('click', function () { applyFilter(b.getAttribute('data-filter')); });
  });

  var sorts = Array.prototype.slice.call(document.querySelectorAll('.sortb'));
  sorts.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-sort');
      var current = btn.getAttribute('aria-sort');
      // First click sorts a name A to Z and a number biggest first, which is what each
      // one is actually useful for. After that it just flips.
      var dir = current ? (current === 'descending' ? 1 : -1) : (key === 'name' ? 1 : -1);
      sorts.forEach(function (b) { b.removeAttribute('aria-sort'); });
      btn.setAttribute('aria-sort', dir === -1 ? 'descending' : 'ascending');
      rows.sort(function (a, b) {
        var x = a.getAttribute('data-' + key), y = b.getAttribute('data-' + key);
        return key === 'name' ? dir * String(x).localeCompare(String(y)) : dir * (Number(x) - Number(y));
      });
      rows.forEach(function (tr) {
        tbody.appendChild(tr);
        var d = detailOf(tr);
        if (d) tbody.appendChild(d);
      });
    });
  });

  var tip = document.getElementById('tip');
  var hideTimer = null;
  function show(el, x, y) {
    tip.textContent = '';
    var b = document.createElement('b');
    b.textContent = el.getAttribute('data-d') + ' days open';
    tip.appendChild(b);
    tip.appendChild(document.createElement('br'));
    tip.appendChild(document.createTextNode(el.getAttribute('data-t')));
    tip.style.opacity = '1';
    var w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(x + 12, window.innerWidth - w - 8)) + 'px';
    tip.style.top = (y - h - 10 < 8 ? y + 16 : y - h - 10) + 'px';
  }
  document.addEventListener('mouseover', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('tk')) { clearTimeout(hideTimer); show(t, e.clientX, e.clientY); }
  });
  document.addEventListener('mouseout', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('tk')) {
      hideTimer = setTimeout(function () { tip.style.opacity = '0'; }, 80);
    }
  });

  // A printout should be complete, not a page of collapsed triangles.
  window.addEventListener('beforeprint', function () {
    Array.prototype.forEach.call(document.querySelectorAll('details'), function (d) {
      d.dataset.wasOpen = d.open ? '1' : '';
      d.open = true;
    });
  });
  window.addEventListener('afterprint', function () {
    Array.prototype.forEach.call(document.querySelectorAll('details'), function (d) {
      d.open = d.dataset.wasOpen === '1';
    });
  });
})();
</script>

</body>
</html>`;
}

async function main() {
  const d = await gather();
  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, page(d));
  const act = d.events.filter(e => e.p >= ACT_ON).length;
  console.log(`dashboard -> data/dashboard.html  (${d.snap.date}, ${act} to act on, ${d.queue.length} queued)`);
}

if (isMain(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exit(1); });
}
