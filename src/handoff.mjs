#!/usr/bin/env node
/**
 * Tool 3: AE handoff brief.
 *
 * A meeting only becomes a Stage Two Opportunity when the AE moves it to "Develop".
 * That decision gets made off whatever context the AE has ten minutes before the call.
 * Most SDRs hand over a calendar invite and two lines. This hands over a page.
 *
 *   npm run handoff -- --account ramp.com --contact "Jane Doe" --role "Head of Talent" \
 *                      --when "2026-10-14 2:00pm ET" --ae "Sam Rivera" \
 *                      --trigger "Posted Head of Talent Ops req 3 weeks ago" \
 *                      --notes "Currently on Ashby. Said reporting is the pain."
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, findAccount, argv, STALE_DAYS, daysOld } from './lib/facts.mjs';

const OUT = path.join(ROOT, 'data', 'briefs');
const pct = n => `${Math.round(n * 100)}%`;

/** Questions worth asking, chosen from what their board actually shows. */
function questions(f) {
  const q = [];
  if (f.staleCount >= 3) {
    q.push(`${f.staleCount} roles have been open past ${STALE_DAYS} days, the oldest ${f.oldestDays} days. Where do those actually stall: sourcing, scheduling, or decision?`);
  }
  if (f.buyers.length) {
    q.push(`You are hiring a ${f.buyers[0].title}. What is the first thing you want that person to fix?`);
  }
  if (f.talent.length >= 2) {
    q.push(`The recruiting team is growing by ${f.talent.length}. What does onboarding a new recruiter onto ${f.ats} look like today?`);
  }
  if (f.departments.length) {
    q.push(`Most of the board is ${f.departments[0][0]} (${f.departments[0][1]} reqs). Is that where the process strain is, or is it somewhere quieter?`);
  }
  q.push(`How do you currently answer "why did we lose that candidate" after the fact?`);
  return q.slice(0, 4);
}

function whyNow(f) {
  if (f.buyers.length) return `Hiring a ${f.buyers[0].title}. New talent leaders audit the stack in their first 90 days.`;
  if (f.staleRatio > 0.4) return `${pct(f.staleRatio)} of the board is stuck past ${STALE_DAYS} days. Process pain is measurable from outside.`;
  if (f.talent.length >= 2) return `Adding ${f.talent.length} people to recruiting. The function is scaling past its tooling.`;
  return `${f.jobCount} open reqs on ${f.ats}.`;
}

async function main() {
  const a = argv();
  if (!a.account) {
    console.error('usage: npm run handoff -- --account <domain|name> --contact "Name" [--role] [--when] [--ae] [--trigger] [--notes]');
    process.exit(1);
  }
  const f = await findAccount(a.account);
  const company = f.name || f.domain;

  const md = [
    `# Handoff: ${company}`,
    ``,
    `| | |`,
    `|---|---|`,
    `| Contact | ${a.contact ?? '[name]'}${a.role ? `, ${a.role}` : ''} |`,
    `| Meeting | ${a.when ?? '[time]'} |`,
    `| AE | ${a.ae ?? '[ae]'} |`,
    `| Incumbent ATS | **${f.ats}** |`,
    `| Open reqs | ${f.jobCount} (${f.staleCount} open >${STALE_DAYS}d) |`,
    `| Sourced by | Don Florencio |`,
    ``,
    `## Why now`,
    ``,
    whyNow(f),
    ...(a.trigger ? [``, `Trigger observed: ${a.trigger}`] : []),
    ``,
    `## What they said`,
    ``,
    a.notes ?? '_[paste the actual words from the call. This is the part the AE cannot get anywhere else.]_',
    ``,
    `## Their board, from the outside`,
    ``,
    `- ${f.jobCount} open reqs on ${f.ats}, median age ${f.medianAgeDays ?? 'n/a'} days`,
    `- ${f.staleCount} stuck between ${STALE_DAYS} days and a year (${pct(f.staleRatio)} of the board)`,
    ...(f.evergreenCount ? [`- ${f.evergreenCount} posted over a year ago (evergreen pipeline reqs, do not cite these as unfilled)`] : []),
    ...(f.departments.length ? [`- Concentration: ${f.departments.map(([d, n]) => `${d} ${n}`).join(', ')}`] : []),
    ...(f.locations.length ? [`- Locations: ${f.locations.map(([l, n]) => `${l} ${n}`).join(', ')}`] : []),
    ...(f.remoteEligibleShare > 0.15 ? [`- ${pct(f.remoteEligibleShare)} flagged remote-eligible by their ATS (not the same as remote roles)`] : []),
    ...(f.talent.length ? [``, `**Recruiting roles they have open:**`, ...f.talent.map(j => `- ${j.title}`)] : []),
    ``,
    `**Longest-open reqs** (useful as concrete examples on the call)`,
    ``,
    ...f.oldest.slice(0, 5).map(j => `- ${j.title}${j.location ? `, ${j.location}` : ''}, open **${daysOld(j.postedAt)} days**`),
    ``,
    `## Four questions worth asking`,
    ``,
    ...questions(f).map((q, i) => `${i + 1}. ${q}`),
    ``,
    `---`,
    `_Board data pulled ${f.snapshot.date} from ${company}'s public ${f.ats} feed. All of it is`,
    `verifiable on their careers page, so it is safe to quote back to them directly._`,
    ``,
  ].join('\n');

  await mkdir(OUT, { recursive: true });
  const slug = `${f.domain.replace(/\W+/g, '-')}-${f.snapshot.date}`;
  const out = path.join(OUT, `handoff-${slug}.md`);
  await writeFile(out, md);
  console.log(md);
  console.log(`\nwritten -> data/briefs/handoff-${slug}.md`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
