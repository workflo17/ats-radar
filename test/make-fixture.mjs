#!/usr/bin/env node
/**
 * Builds a synthetic "yesterday" from the newest real snapshot, mutated so every
 * diff event type has something to fire on. Writes to test/fixtures/ so the real
 * snapshot store stays clean and tomorrow's first genuine diff is untouched.
 *
 *   node test/make-fixture.mjs
 *   npm run diff -- --from test/fixtures/before.json --to test/fixtures/after.json
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, latestSnapshot, isBuyerReq, TALENT } from '../src/lib/facts.mjs';

const OUT = path.join(ROOT, 'test', 'fixtures');
const clone = o => JSON.parse(JSON.stringify(o));

const after = await latestSnapshot();
const before = clone(after);
before.date = '2026-09-02';

const acc = before.accounts;
const expect = [];
const pick = (...names) => names.find(n => acc[n]);

// VELOCITY_SPIKE + TALENT_LEADER_POSTED + TA_TEAM_GROWING:
// yesterday had fewer reqs and none of today's talent reqs.
const spike = pick('ramp.com');
if (spike) {
  const a = acc[spike];
  a.jobs = a.jobs.filter(j => !TALENT.test(j.title)).slice(0, Math.max(1, a.jobs.length - 40));
  a.jobCount = a.jobs.length;
  expect.push('VELOCITY_SPIKE', 'TALENT_LEADER_POSTED', 'TA_TEAM_GROWING');
}

// TALENT_LEADER_HIRED: yesterday had a senior talent req that is gone today.
const hired = pick('notion.so');
if (hired) {
  acc[hired].jobs = [...acc[hired].jobs, {
    id: 'fixture-vp-talent', title: 'VP of Talent Acquisition', department: 'People',
    location: 'San Francisco, California', remote: false,
    url: 'https://example.invalid/vp-talent', postedAt: '2026-07-01T00:00:00.000Z', reqId: null,
  }];
  acc[hired].jobCount = acc[hired].jobs.length;
  expect.push('TALENT_LEADER_HIRED');
}

// ATS_MIGRATION: yesterday they were on a different platform.
const moved = pick('figma.com');
if (moved) { acc[moved].ats = 'lever'; expect.push('ATS_MIGRATION'); }

// REPOST: same title, different posting id.
const repost = pick('linear.app');
if (repost && acc[repost].jobs.length) {
  const j = clone(acc[repost].jobs[0]);
  j.id = 'fixture-old-' + j.id;
  acc[repost].jobs = [j, ...acc[repost].jobs.slice(1)];
  expect.push('REPOST');
}

// BOARD_EMPTIED: pick an account sitting at zero reqs today.
const emptied = Object.keys(acc).find(d => after.accounts[d].jobCount === 0);
if (emptied) {
  acc[emptied].jobs = [{
    id: 'fixture-gone', title: 'Software Engineer', department: null, location: 'Remote',
    remote: true, url: null, postedAt: '2026-06-01T00:00:00.000Z', reqId: null,
  }];
  acc[emptied].jobCount = 1;
  expect.push('BOARD_EMPTIED');
}

// BOARD_APPEARED: absent yesterday, present today.
const appeared = Object.keys(acc).find(d => d !== spike && d !== hired && d !== moved && d !== repost && d !== emptied);
if (appeared) { delete acc[appeared]; expect.push('BOARD_APPEARED'); }

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'before.json'), JSON.stringify(before, null, 1));
await writeFile(path.join(OUT, 'after.json'), JSON.stringify(after, null, 1));

console.log(`fixtures written from real snapshot ${after.date}`);
console.log(`expecting these event types: ${[...new Set(expect)].sort().join(', ')}`);
