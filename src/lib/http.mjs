const UA = 'ats-radar/0.1 (+job board monitor; contact don.flo17@gmail.com)';

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} ${url}`);
    this.status = status;
    this.url = url;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * GET JSON. Returns { status, json } — a 404 is a normal answer here (it means
 * "this company is not on this ATS"), not an exception. Only network faults and
 * 5xx after retries throw.
 */
export async function getJson(url, { timeout = 15000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(500 * 2 ** attempt + Math.random() * 300);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
      });
      if (res.status >= 500 || res.status === 429) {
        lastErr = new HttpError(res.status, url);
        continue;
      }
      if (!res.ok) return { status: res.status, json: null };
      const text = await res.text();
      try {
        return { status: res.status, json: JSON.parse(text) };
      } catch {
        // A board that answers 200 with HTML is a proxied careers page, not an API.
        return { status: res.status, json: null };
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Run `worker` over `items` with bounded concurrency, never rejecting. */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await worker(items[i], i) };
      } catch (e) {
        results[i] = { ok: false, error: e };
      }
      await sleep(120 + Math.random() * 120); // be a polite guest
    }
  });
  await Promise.all(runners);
  return results;
}
