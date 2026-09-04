/**
 * Derives the hiring facts every downstream tool needs from one account's job list.
 *
 * The prospect brief, the AE handoff and the report all say the same things about a
 * company, so they compute them in exactly one place. Everything here comes from a
 * public job board, which means every number is something the prospect can verify
 * on their own careers page. Keep it that way.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * True when this module is the entry point rather than an import.
 * pathToFileURL handles Windows drive letters and separators, which hand-rolled
 * string munging on process.argv[1] does not; and argv[1] is undefined entirely
 * under `node -e`, so guard for that too.
 */
export const isMain = url => Boolean(process.argv[1]) && url === pathToFileURL(process.argv[1]).href;

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SNAPSHOTS = path.join(ROOT, 'data', 'snapshots');

export const STALE_DAYS = 60;
// Past a year a posting is almost always an evergreen pipeline req (Ramp has a
// frontend role at 1274 days), not a role anyone is failing to fill. Quoting those
// back to a prospect as "stuck" reads as not understanding their board, so they get
// counted separately and kept out of the examples.
export const EVERGREEN_DAYS = 365;
export const TALENT = /\b(recruit\w*|talent|sourcer|staffing|people\s*(ops|operations)|human\s*resources|hris|hrbp)\b/i;
export const SENIOR = /\b(head|director|vp|vice\s*president|chief|chro|principal|lead|manager|senior\s*manager)\b/i;
export const NOT_A_BUYER = /\b(coordinator|assistant|intern|associate)\b/i;
// "Content Lead, Talent Trends" is marketing at an ATS vendor, not a hiring buyer.
export const NOT_TALENT_CONTEXT = /\b(content|marketing|brand|community|partner|sales|revenue|customer)\b/i;

export const daysOld = iso => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null);

export function isBuyerReq(title) {
  return TALENT.test(title) && SENIOR.test(title)
    && !NOT_A_BUYER.test(title) && !NOT_TALENT_CONTEXT.test(title);
}

const topN = (items, n) => Object.entries(
  items.reduce((acc, v) => (v ? (acc[v] = (acc[v] ?? 0) + 1, acc) : acc), {})
).sort((a, b) => b[1] - a[1]).slice(0, n);

/** How senior a talent req is, so the strongest buyer leads the pitch rather than whichever came first. */
export function buyerRank(title) {
  if (/\b(chief|chro)\b/i.test(title)) return 5;
  if (/\b(vp|vice\s*president|head)\b/i.test(title)) return 4;
  if (/\bdirector\b/i.test(title)) return 3;
  if (/\bsenior\s*manager\b/i.test(title)) return 2.5;
  if (/\bmanager\b/i.test(title)) return 2;
  return 1;
}

export function accountFacts(account) {
  const jobs = account.jobs ?? [];
  const age = j => daysOld(j.postedAt) ?? 0;
  const ages = jobs.map(j => daysOld(j.postedAt)).filter(n => n !== null).sort((a, b) => a - b);
  const evergreen = jobs.filter(j => age(j) > EVERGREEN_DAYS);
  const stale = jobs.filter(j => age(j) > STALE_DAYS && age(j) <= EVERGREEN_DAYS);
  const talent = jobs.filter(j => TALENT.test(j.title));
  const buyers = jobs.filter(j => isBuyerReq(j.title))
    .sort((a, b) => buyerRank(b.title) - buyerRank(a.title));

  return {
    name: account.name,
    ats: account.ats,
    token: account.token,
    jobCount: account.jobCount ?? jobs.length,
    stale,
    staleCount: stale.length,
    staleRatio: jobs.length ? stale.length / jobs.length : 0,
    evergreen,
    evergreenCount: evergreen.length,
    medianAgeDays: ages.length ? ages[Math.floor(ages.length / 2)] : null,
    // The oldest genuinely-stuck req, ignoring evergreen pipeline postings.
    oldestDays: stale.length ? Math.max(...stale.map(age)) : null,
    talent,
    buyers,
    departments: topN(jobs.map(j => j.department), 5),
    locations: topN(jobs.map(j => j.location), 5),
    // "Remote-eligible", NOT "remote role". Ashby flags a Security Engineer based at
    // Ramp's NYC HQ as isRemote, so 92% of that board reads remote while 110 of 143
    // reqs are in New York. Never put this in prospect-facing copy as "remote".
    remoteEligibleShare: jobs.length ? jobs.filter(j => j.remote).length / jobs.length : 0,
    newest: [...jobs].sort((a, b) => Date.parse(b.postedAt ?? 0) - Date.parse(a.postedAt ?? 0)).slice(0, 5),
    // Examples for a call: real stuck reqs, oldest first, evergreen excluded.
    oldest: [...stale].sort((a, b) => Date.parse(a.postedAt ?? 0) - Date.parse(b.postedAt ?? 0)).slice(0, 5),
  };
}

export async function snapshotFiles() {
  return (await readdir(SNAPSHOTS)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
}

export async function loadSnapshot(file) {
  // A bare "2026-09-03.json" means the snapshot store; anything with a separator
  // is a real path, so fixtures and ad-hoc comparisons work from the shell.
  const p = path.isAbsolute(file) ? file
    : /[/\\]/.test(file) ? path.resolve(process.cwd(), file)
    : path.join(SNAPSHOTS, file);
  return JSON.parse(await readFile(p, 'utf8'));
}

export async function latestSnapshot() {
  const files = await snapshotFiles();
  if (!files.length) throw new Error('no snapshots yet. Run `npm run collect` first');
  return loadSnapshot(files.at(-1));
}

/** Find one account by domain, or by fuzzy name match, in the latest snapshot. */
export async function findAccount(query) {
  const snap = await latestSnapshot();
  const q = String(query).toLowerCase().trim();
  const entries = Object.entries(snap.accounts);
  const hit =
    entries.find(([d]) => d === q) ??
    entries.find(([d]) => d.startsWith(q)) ??
    entries.find(([, a]) => (a.name ?? '').toLowerCase() === q) ??
    entries.find(([, a]) => (a.name ?? '').toLowerCase().includes(q));
  if (!hit) {
    throw new Error(
      `no account matching "${query}" in ${snap.date}. Known: ` +
      entries.slice(0, 8).map(([d]) => d).join(', ') + (entries.length > 8 ? ', ...' : '')
    );
  }
  return { domain: hit[0], snapshot: snap, ...accountFacts(hit[1]) };
}

/** Simple flag parsing shared by the CLIs. */
export function argv(args = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(args[i]);
  }
  return out;
}
