#!/usr/bin/env node
/**
 * What to do about an account, and why that one.
 *
 * The score in report.mjs answers "how much visible pain is this board in". It does not
 * answer the two questions an SDR actually has at 8am: why this company rather than the
 * next one, and what do I open with. This module answers those, and shows its working
 * the same way everything else here does.
 *
 * Three things shape it, all from public research done 2026-09-16:
 *
 * 1. Signal-personalised outreach replies at around 18% against 3.43% for generic, and
 *    stacking several signals takes it to 25-40%. So the recommendation stacks every
 *    signal it has rather than leading with one.
 * 2. Trigger + research + a named peer reference is the 15-25% reply band. The peer is
 *    the part most tools cannot do; this one can, because 32 accounts in the same
 *    territory snapshot are already on Greenhouse and their req counts are known.
 * 3. Greenhouse's own ICP starts around 150 employees. A board under ~15 open reqs is
 *    usually a company below that line, so it gets said out loud rather than ranked.
 *
 * Competitive positioning is internal. This never goes into brief.mjs, which a prospect
 * reads. Dashboard and AE handoff only.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, STALE_DAYS } from './lib/facts.mjs';

const CARDS = path.join(ROOT, 'config', 'battlecards.json');

/** Under this many open reqs a company is usually below Greenhouse's ICP floor. */
const ICP_MIN_REQS = 15;

let cardCache = null;
export async function battlecards() {
  if (!cardCache) cardCache = JSON.parse(await readFile(CARDS, 'utf8'));
  return cardCache;
}

/* ------------------------------------------------------------------- rating */

/**
 * Two axes, kept apart on purpose. A board can hurt a great deal and still have no
 * reason to be called this week, and a dated trigger at a company with no visible pain
 * is a call with nothing to talk about. Collapsing them into one number hides which.
 */
export function rate(f, events = []) {
  const has = t => events.some(e => e.type === t);
  const count = t => events.filter(e => e.type === t).length;

  const pain = [
    { on: f.staleRatio > 0.4, n: 4, why: `${Math.round(f.staleRatio * 100)}% of the board is open past ${STALE_DAYS} days` },
    { on: f.staleRatio > 0.25 && f.staleRatio <= 0.4, n: 2, why: `${Math.round(f.staleRatio * 100)}% of the board is open past ${STALE_DAYS} days` },
    { on: f.jobCount >= 100, n: 3, why: `${f.jobCount} open reqs, past the point where coordination breaks before tracking does` },
    { on: f.jobCount >= 25 && f.jobCount < 100, n: 2, why: `${f.jobCount} open reqs, past the size a spreadsheet survives` },
    { on: f.talent.length - f.buyers.length >= 2, n: 2, why: `${f.talent.length - f.buyers.length} recruiting reqs open, so the TA function is scaling` },
  ].filter(r => r.on);

  const timing = [
    { on: has('TALENT_LEADER_HIRED'), n: 6, why: 'a senior talent req just closed, so they hired' },
    { on: has('ATS_MIGRATION'), n: 5, why: 'they changed ATS since the last snapshot' },
    { on: has('TALENT_LEADER_POSTED'), n: 4, why: 'a talent leader req is open right now' },
    { on: !has('TALENT_LEADER_POSTED') && f.buyers.length > 0, n: 3, why: `they are hiring a ${(f.buyers[0]?.title ?? 'talent leader').toLowerCase()}` },
    { on: count('REPOST') >= 3, n: 2, why: `${count('REPOST')} reqs closed and came back` },
    { on: has('VELOCITY_SPIKE'), n: 2, why: 'hiring accelerated sharply' },
  ].filter(r => r.on);

  const painScore = Math.min(10, pain.reduce((s, r) => s + r.n, 0));
  const timingScore = Math.min(10, timing.reduce((s, r) => s + r.n, 0));
  const total = painScore + timingScore;

  const belowIcp = f.jobCount < ICP_MIN_REQS;
  let letter, verdict;
  if (belowIcp) {
    letter = 'D';
    verdict = `Under ${ICP_MIN_REQS} open reqs, which usually means under the 150 employees Greenhouse's ICP starts at. Leave it.`;
  } else if (total >= 13) {
    letter = 'A'; verdict = 'Call this week.';
  } else if (total >= 8) {
    letter = 'B'; verdict = 'Worth a touch this month.';
  } else if (total >= 4) {
    letter = 'C'; verdict = 'Watch. Not yet a reason to call.';
  } else {
    letter = 'D'; verdict = 'Nothing here yet.';
  }

  return { pain: painScore, timing: timingScore, total, letter, verdict, belowIcp, painParts: pain, timingParts: timing };
}

/* -------------------------------------------------------------- the approach */

/** The standing case. True whether or not anything changed today. */
export function whyThem(f, cardName = null) {
  const bits = [`${f.jobCount} open ${f.jobCount === 1 ? 'role' : 'roles'} on ${cardName ?? f.ats}`];
  if (f.staleCount) bits.push(`${f.staleCount} of them open past ${STALE_DAYS} days`);
  if (f.buyers.length) bits.push(`and they are hiring a ${f.buyers[0].title.toLowerCase()}`);
  else if (f.talent.length >= 2) bits.push(`and ${f.talent.length} recruiting reqs are open`);
  return bits.join(', ') + '.';
}

/** The dated case, or an honest admission that there is not one. */
export function whyNow(events, rating) {
  if (!rating.timingParts.length) {
    return { text: 'Nothing dated. This is a standing reason to call, not a trigger, so it keeps until you have run the A list.', dated: false };
  }
  const dated = events.find(e => e.callOn);
  return {
    text: rating.timingParts.map(p => p.why).join('; ') + '.',
    dated: Boolean(dated),
    callOn: dated?.callOn ?? null,
  };
}

/**
 * Which Greenhouse strength to lead with. Chosen by what their board shows, not by
 * which line sounds best, and always checked against the incumbent's card so the lead
 * is not a claim the competitor happens to be better at.
 */
export function angle(f, card, events = []) {
  const has = t => events.some(e => e.type === t);
  const wins = card?.whereGreenhouseWins ?? [];

  if (has('TALENT_LEADER_HIRED')) {
    return {
      lead: 'The new talent leader inherits the stack',
      because: 'They just hired someone to own recruiting. A new leader audits what they inherited in their first 90 days, and that audit is the only reliable moment an incumbent ATS is genuinely up for discussion.',
      support: wins[0] ?? null,
    };
  }
  if (has('ATS_MIGRATION')) {
    return {
      lead: 'They are already in motion',
      because: 'A platform change means the switching cost has already been paid once and the team has just lived through an evaluation. Either it went badly, which is your opening, or it went well and you are early for the next one.',
      support: wins[0] ?? null,
    };
  }
  if (f.buyers.length || has('TALENT_LEADER_POSTED')) {
    return {
      lead: 'The buyer is being recruited right now',
      because: `They have an open req for a ${(f.buyers[0]?.title ?? 'talent leader').toLowerCase()}. Whoever takes it will rebuild the process, and the person hiring them is thinking about that this quarter.`,
      support: wins[0] ?? null,
    };
  }
  if (f.staleRatio > 0.4) {
    return {
      lead: 'They cannot fill what they post',
      because: `${f.staleCount} of ${f.jobCount} roles are past ${STALE_DAYS} days. That is a process problem before it is a sourcing problem, and structured hiring is the argument that a consistent loop closes roles faster than another job board.`,
      support: wins.find(w => /structur|scorecard|interview kit/i.test(w)) ?? wins[0] ?? null,
    };
  }
  if (f.jobCount >= 100) {
    return {
      lead: 'The process is outgrowing the tool',
      because: `${f.jobCount} open reqs means several teams hiring at once with different needs. A tool that fitted at 30 people creaks at 300, and what breaks first is coordination, not tracking.`,
      support: wins.find(w => /scale|complexit|larger organis|larger organiz/i.test(w)) ?? wins[0] ?? null,
    };
  }
  if (f.talent.length - f.buyers.length >= 2) {
    return {
      lead: 'The recruiting team is scaling past its process',
      because: 'They are adding recruiters. Every new recruiter inherits whatever the process is, and an undocumented one gets reinvented per person.',
      support: wins.find(w => /interviewer|consisten|kit/i.test(w)) ?? wins[0] ?? null,
    };
  }
  return {
    lead: 'No strong angle yet',
    because: 'Their board is not showing the pain that makes this conversation land. Leave it in the watch list until something changes.',
    support: null,
  };
}

/**
 * A comparable company in the same territory that already runs Greenhouse. Named peer
 * references sit in the 15-25% reply band, and this is the one input a generic tool
 * cannot produce, because it needs the rest of the territory resolved.
 */
export function peer(f, ranked, homeAts = 'greenhouse') {
  const near = ranked
    .filter(r => r.f.ats === homeAts && r.f.jobCount > 0 && r.domain !== f.domain)
    .map(r => ({ r, ratio: r.f.jobCount / Math.max(f.jobCount, 1) }))
    .filter(x => x.ratio >= 0.5 && x.ratio <= 2)
    .sort((a, b) => Math.abs(Math.log(a.ratio)) - Math.abs(Math.log(b.ratio)));
  if (!near.length) return null;
  const p = near[0].r;
  return { name: p.f.name || p.domain, jobCount: p.f.jobCount };
}

// Words that cost 30 to 50 percent of opens when they land in a subject line. The
// opener below is a first line, not a subject, but the same words read as a pitch.
const SPAM_WORDS = /\b(free|guarantee|act now|limited time|exclusive|revolutionary|best-in-class|cutting-edge|synerg|streamline|unlock|leverage|game-?chang|solution provider|touch base|circle back|quick question)\b/i;

/** A paste-ready first line built only from facts on their own careers page. */
export function opener(f, rating, events = []) {
  const has = t => events.some(e => e.type === t);
  let line;

  if (has('TALENT_LEADER_HIRED')) {
    line = `I saw you closed your ${(events.find(e => e.type === 'TALENT_LEADER_HIRED')?.evidence?.job?.title ?? 'senior talent').toLowerCase()} req. Whoever starts in it inherits ${f.jobCount} open roles, ${f.staleCount} of them already past ${STALE_DAYS} days.`;
  } else if (f.buyers.length) {
    line = `You have a ${f.buyers[0].title.toLowerCase()} req open. Whoever takes it walks into ${f.jobCount} open roles, ${f.staleCount} of them past ${STALE_DAYS} days.`;
  } else if (f.staleRatio > 0.4) {
    line = `${f.staleCount} of your ${f.jobCount} open roles have been live more than ${STALE_DAYS} days. That is usually a process question rather than a sourcing one.`;
  } else if (f.jobCount >= 100) {
    line = `You have ${f.jobCount} roles open across ${f.departments.length || 'several'} areas. At that spread the thing that slows hiring is usually coordination between panels, not the pipeline.`;
  } else {
    line = `You have ${f.jobCount} roles open, ${f.staleCount} of them past ${STALE_DAYS} days.`;
  }

  return { line, clean: !SPAM_WORDS.test(line), flagged: line.match(SPAM_WORDS)?.[0] ?? null };
}

/**
 * Everything the dashboard needs for one account, in one call.
 *
 * The `home` branch is the one that earns its place. On 2026-09-16 three of the four
 * highest-priority signals in the territory were at Datadog, Twilio and Figma, all of
 * them already running Greenhouse. A talent leader hired at a customer is a real event,
 * but it is a champion change or an expansion, and it is not what an SDR is paid on.
 * Presenting it identically to a displacement target is how a rep ends up pitching
 * Greenhouse to a Greenhouse customer.
 */
export function approachFor({ f, domain, events = [], ranked = [], cards = {}, homeAts = 'greenhouse' }) {
  const rating = rate(f, events);
  const card = cards[f.ats] ?? cards.none ?? null;

  if (f.ats === homeAts) {
    const hired = events.some(e => e.type === 'TALENT_LEADER_HIRED');
    const posted = events.some(e => e.type === 'TALENT_LEADER_POSTED');
    return {
      motion: 'customer',
      rating: { ...rating, letter: '·', verdict: 'Already on Greenhouse. Not new business.' },
      whyThem: `Already a customer, ${f.jobCount} open ${f.jobCount === 1 ? 'role' : 'roles'} on their own Greenhouse board.`,
      whyNow: whyNow(events, rating),
      angle: {
        lead: hired ? 'Their champion just changed' : posted ? 'Their champion is being replaced' : 'Nothing to do here',
        because: hired
          ? 'The person who owned recruiting has been replaced. A new talent leader re-evaluates what they inherited, which for a customer is a renewal risk and an expansion opening at the same time. Flag it to the account owner rather than calling it yourself.'
          : posted
            ? 'They have an open req for the person who would own this relationship. Worth telling whoever owns the account before the seat is filled.'
            : 'They already run Greenhouse. Nothing here is a meeting you can book.',
        support: null,
      },
      peer: null,
      opener: null,
      ask: null,
      avoid: 'Pitching Greenhouse to a Greenhouse customer. Check the ATS column before you dial.',
      theyWin: null,
      cardName: 'Greenhouse',
    };
  }

  return {
    motion: 'displacement',
    rating,
    whyThem: whyThem(f, card?.name ?? null),
    whyNow: whyNow(events, rating),
    angle: angle(f, card, events),
    peer: peer({ ...f, domain }, ranked),
    opener: opener(f, rating, events),
    ask: card?.questionsThatOpenIt?.[0] ?? null,
    avoid: card?.doNotSay?.[0] ?? null,
    theyWin: card?.whereTheyWin?.[0] ?? null,
    cardName: card?.name ?? null,
  };
}
