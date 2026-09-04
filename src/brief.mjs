#!/usr/bin/env node
/**
 * Tool 2: show-rate system.
 *
 * Your quota only counts meetings the prospect actually attends, so the gap between
 * a 70% and an 88% show rate is worth more than most prospecting improvements. This
 * generates the three touches that close that gap, plus the pre-call asset that does
 * the real work: their own hiring numbers, read off their own public job board.
 *
 *   npm run brief -- --account ramp.com --contact "Jane Doe" --role "Head of Talent" \
 *                    --when "2026-10-14 2:00pm ET" --ae "Sam Rivera"
 *
 * It writes text. It never sends anything. Sending from the company domain through
 * anything unapproved is an IT and deliverability problem you do not want to own.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, findAccount, argv, STALE_DAYS, daysOld } from './lib/facts.mjs';

const OUT = path.join(ROOT, 'data', 'briefs');
const pct = n => `${Math.round(n * 100)}%`;

function snapshotLines(f) {
  const lines = [`- **${f.jobCount} roles open right now** on your ${f.ats} board.`];
  if (f.staleCount) {
    lines.push(`- **${f.staleCount} of them have been open more than ${STALE_DAYS} days** (${pct(f.staleRatio)} of the board).`);
  }
  if (f.oldestDays) lines.push(`- The oldest has been live **${f.oldestDays} days**.`);
  if (f.medianAgeDays !== null) lines.push(`- Median posting age: **${f.medianAgeDays} days**.`);
  if (f.departments.length) {
    lines.push(`- Heaviest areas: ${f.departments.map(([d, n]) => `${d} (${n})`).join(', ')}.`);
  }
  if (f.locations.length) {
    lines.push(`- Top locations: ${f.locations.map(([l, n]) => `${l} (${n})`).join(', ')}.`);
  }
  if (f.talent.length) {
    lines.push(`- You are hiring for the recruiting function itself: ${f.talent.map(j => j.title).slice(0, 4).join('; ')}.`);
  }
  return lines;
}

function theHook(f) {
  if (f.buyers.length) return `you are hiring a ${f.buyers[0].title.toLowerCase()}`;
  if (f.staleRatio > 0.4) return `${f.staleCount} of your ${f.jobCount} roles have been open past ${STALE_DAYS} days`;
  if (f.talent.length >= 2) return `you are adding ${f.talent.length} people to the recruiting team`;
  return `you have ${f.jobCount} roles open`;
}

async function main() {
  const a = argv();
  if (!a.account) {
    console.error('usage: npm run brief -- --account <domain|name> --contact "Name" [--role "Title"] [--when "..."] [--ae "Name"] [--me "Don Florencio"]');
    process.exit(1);
  }
  const f = await findAccount(a.account);
  const contact = a.contact || 'there';
  const first = String(contact).split(/\s+/)[0];
  const when = a.when || '[TIME]';
  const ae = a.ae || '[AE]';
  const me = a.me || 'Don';
  const company = f.name || f.domain;

  const blocks = [];

  blocks.push(`# Show-rate pack: ${company}`, ``,
    `Contact: ${contact}${a.role ? `, ${a.role}` : ''} · Meeting: ${when} · AE: ${ae}`,
    `Source: ${f.ats} board as of ${f.snapshot.date}. Every number below is on their public careers page.`,
    ``, `---`, ``);

  // 1. Immediate confirmation. Send inside ten minutes of the booking.
  blocks.push(`## 1. Send immediately after booking`, ``,
    `An instant personal confirmation, rather than a bare calendar invite, is the single`,
    `largest lever on show rate. Send this within ten minutes.`, ``,
    '```', `Subject: Confirmed for ${when}`, ``,
    `${first},`, ``,
    `Locked in for ${when}. ${ae} will be on with me.`, ``,
    `I pulled your careers page before we talk. You have ${f.jobCount} roles open` +
      (f.staleCount ? `, and ${f.staleCount} of them have been live more than ${STALE_DAYS} days.` : `.`),
    `That is what I want to dig into.`, ``,
    `Anything specific you want covered? Happy to shape it around whatever is`,
    `actually painful right now.`, ``, `${me}`, '```', ``);

  // 2. Day before, carrying the asset.
  blocks.push(`## 2. Send the day before`, ``,
    `This is the one that carries content. A prospect who has read something useful`,
    `shows up; a prospect who got a reminder does not.`, ``,
    '```', `Subject: For tomorrow, what your board looks like from outside`, ``,
    `${first},`, ``,
    `Talking tomorrow at ${when}. I put together what your hiring looks like from`,
    `the outside, purely from your public board:`, ``,
    ...snapshotLines(f).map(l => l.replace(/\*\*/g, '')),
    ``,
    `The question I would want answered in your seat: ` + questionFor(f), ``,
    `If tomorrow stopped working, say so and I will move it. Easier for both of us`,
    `than a blank square.`, ``, `${me}`, '```', ``);

  // 3. Two hours out.
  blocks.push(`## 3. Send two hours before`, ``, '```',
    `Subject: In a couple of hours`, ``,
    `${first}, still good for ${when}? Dial-in is on the invite. ${ae} and I will be there.`,
    ``, `${me}`, '```', ``);

  // 4. The standalone asset.
  blocks.push(`---`, ``, `## Pre-call one-pager (attach or paste)`, ``,
    `### ${company}: what your hiring looks like from outside`, ``,
    ...snapshotLines(f), ``,
    `**Read on the oldest roles**`, ``,
    ...f.oldest.slice(0, 5).map(j => `- ${j.title}${j.location ? ` (${j.location})` : ''}, open ${daysOld(j.postedAt)} days`),
    ``, `_Compiled from ${company}'s public ${f.ats} job board on ${f.snapshot.date}._`, ``);

  const md = blocks.join('\n');
  await mkdir(OUT, { recursive: true });
  const slug = `${f.domain.replace(/\W+/g, '-')}-${f.snapshot.date}`;
  const out = path.join(OUT, `brief-${slug}.md`);
  await writeFile(out, md);
  console.log(md);
  console.log(`\n\nwritten -> data/briefs/brief-${slug}.md`);
}

function questionFor(f) {
  if (f.staleRatio > 0.4) return `what is actually blocking the ${f.staleCount} roles that have been open longest?`;
  if (f.buyers.length) return `what does the person you are hiring into ${f.buyers[0].title} inherit on day one?`;
  if (f.talent.length >= 2) return `what breaks first as the recruiting team doubles?`;
  return `where does time actually go between a req opening and an offer going out?`;
}

main().catch(e => { console.error(e.message); process.exit(1); });
