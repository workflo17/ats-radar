import { adapters } from './adapters.mjs';

const MULTI_TLD = /\.(co|com|org|net|gov|ac)\.[a-z]{2}$/i;
// Suffixes companies bolt onto a domain when the bare name was taken. The board
// token usually drops them again (datadoghq.com -> datadog, ashbyhq.com -> ashby).
const VANITY_SUFFIX = /(hq|app|inc|labs|io|ai|hr|tech|software)$/i;

/** Ordered guesses at a company's board token, most likely first. */
export function candidateSlugs(domain, name = '') {
  const host = String(domain).trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');

  const label = (MULTI_TLD.test(host) ? host.replace(MULTI_TLD, '') : host.replace(/\.[a-z]+$/i, ''))
    .split('.').pop();

  const fromName = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hyphenated = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const out = [label];
  const trimmed = label.replace(VANITY_SUFFIX, '');
  if (trimmed && trimmed !== label && trimmed.length >= 3) out.push(trimmed);
  if (fromName && fromName.length >= 3) out.push(fromName);
  if (hyphenated && hyphenated.includes('-')) out.push(hyphenated);

  return [...new Set(out.filter(Boolean))].slice(0, 4);
}

/**
 * Resolve one company to an ATS. Candidates are the outer loop because the domain
 * label is the right token far more often than it is wrong, so the common case
 * costs one round of adapter probes rather than a full cross product.
 *
 * Returns { ats, token, jobs, total } on a hit, or { ats: null, ambiguous } on a miss.
 */
export async function detect(domain, name = '') {
  const slugs = candidateSlugs(domain, name);
  const ambiguous = [];

  for (const token of slugs) {
    for (const adapter of adapters) {
      let res;
      try {
        res = await adapter.fetchBoard(token);
      } catch {
        continue; // network fault on one probe should not sink the whole resolution
      }
      if (res.present) return { ats: adapter.id, token, jobs: res.jobs, total: res.total };
      if (res.ambiguous) ambiguous.push(`${adapter.id}:${token}`);
    }
  }
  return { ats: null, token: null, jobs: [], total: 0, ambiguous };
}
