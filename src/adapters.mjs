import { getJson } from './lib/http.mjs';

/**
 * Each adapter answers one question: "is {token} a live board on this ATS, and
 * if so what is on it?"
 *
 * Return shape: { present, ambiguous, jobs, total }
 *   present   - confirmed this company is on this ATS
 *   ambiguous - the API answered 200 but proved nothing (see note below)
 *
 * The ambiguity flag matters. Probed with a nonsense token, Greenhouse and Ashby
 * return 404, but Lever and SmartRecruiters return 200 with an empty list. Treating
 * a bare 200 as confirmation would assign half the target list to whichever of those
 * two got probed first. Verified against zzznotacompany9 on 2026-09-03.
 */

const iso = v => (v ? new Date(v).toISOString() : null);

export const adapters = [
  {
    id: 'greenhouse',
    async fetchBoard(token) {
      const { status, json } = await getJson(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs`
      );
      if (status === 404 || !json?.jobs) return { present: false, ambiguous: false, jobs: [], total: 0 };
      const jobs = json.jobs.map(j => ({
        id: String(j.id),
        title: j.title ?? '',
        department: null, // basic feed omits it; title regex carries the signal instead
        location: j.location?.name ?? null,
        remote: /remote|anywhere/i.test(j.location?.name ?? ''),
        url: j.absolute_url ?? null,
        // first_published is the real age of the posting. updated_at resets on any edit,
        // so using it as age would make every stale req look freshly opened.
        postedAt: iso(j.first_published ?? j.updated_at),
        reqId: j.requisition_id ?? null,
      }));
      return { present: true, ambiguous: false, jobs, total: json.meta?.total ?? jobs.length };
    },
  },

  {
    id: 'lever',
    async fetchBoard(token) {
      const { status, json } = await getJson(
        `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`
      );
      if (status === 404 || !Array.isArray(json)) return { present: false, ambiguous: false, jobs: [], total: 0 };
      if (json.length === 0) return { present: false, ambiguous: true, jobs: [], total: 0 };
      const jobs = json.map(j => ({
        id: String(j.id),
        title: j.text ?? '',
        department: j.categories?.department ?? j.categories?.team ?? null,
        location: j.categories?.location ?? null,
        remote: /remote|anywhere/i.test(
          `${j.categories?.location ?? ''} ${j.workplaceType ?? ''}`
        ),
        url: j.hostedUrl ?? null,
        postedAt: iso(j.createdAt),
        reqId: null,
      }));
      return { present: true, ambiguous: false, jobs, total: jobs.length };
    },
  },

  {
    id: 'ashby',
    async fetchBoard(token) {
      const { status, json } = await getJson(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}`
      );
      if (status === 404 || !json?.jobs) return { present: false, ambiguous: false, jobs: [], total: 0 };
      const jobs = json.jobs
        .filter(j => j.isListed !== false)
        .map(j => ({
          id: String(j.id),
          title: j.title ?? '',
          department: j.department ?? j.team ?? null,
          location: j.location ?? null,
          remote: Boolean(j.isRemote),
          url: j.jobUrl ?? null,
          postedAt: iso(j.publishedAt),
          reqId: null,
        }));
      return { present: true, ambiguous: false, jobs, total: jobs.length };
    },
  },

  {
    id: 'smartrecruiters',
    async fetchBoard(token) {
      const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(token)}/postings`;
      const first = await getJson(`${base}?limit=100`);
      if (first.status === 404 || !first.json?.content) {
        return { present: false, ambiguous: false, jobs: [], total: 0 };
      }
      const total = first.json.totalFound ?? 0;
      if (total === 0) return { present: false, ambiguous: true, jobs: [], total: 0 };

      const pages = [first.json.content];
      for (let offset = 100; offset < Math.min(total, 500); offset += 100) {
        const next = await getJson(`${base}?limit=100&offset=${offset}`);
        if (!next.json?.content?.length) break;
        pages.push(next.json.content);
      }
      const jobs = pages.flat().map(j => ({
        id: String(j.id),
        title: j.name ?? '',
        department: j.department?.label ?? null,
        location: j.location?.fullLocation ?? null,
        remote: Boolean(j.location?.remote),
        url: `https://jobs.smartrecruiters.com/${token}/${j.id}`,
        postedAt: iso(j.releasedDate),
        reqId: j.refNumber ?? null,
      }));
      return { present: true, ambiguous: false, jobs, total };
    },
  },
];

// Not yet wired: Workable and Recruitee. Every documented public endpoint for both
// returned 404 when probed on 2026-09-03, so their real shape is unconfirmed and
// guessing would silently misclassify accounts. Add here once verified against a
// live board. Both skew SMB/Europe, so this mostly costs coverage below the
// mid-market line.

export const adapterById = Object.fromEntries(adapters.map(a => [a.id, a]));
