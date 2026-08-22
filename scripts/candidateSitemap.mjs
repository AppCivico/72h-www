/**
 * Builds the sitemap for /candidato/{slug}-{person_id}/ pages.
 *
 * Hugo's own sitemap can only list pages Hugo generates, and it can't
 * generate one page per candidacy — there are ~853k of them, all served by
 * the same static shell (see the redirect in netlify.toml). So the candidate
 * URLs were invisible to search engines except through JS-rendered internal
 * links: in August 2026, three weeks after launch, Google had found ~54 of
 * them. This module asks the same API the site uses which candidacies exist,
 * and writes them out as a sitemap index Google can read directly.
 *
 * Scope is deliberate, not exhaustive: the current election's candidacies
 * *that declared money*, ordered by how much. Those are the pages with
 * something to say, and submitting a focused set beats dumping hundreds of
 * thousands of near-empty URLs on a crawler that has never seen this site
 * before. SITEMAP_YEARS widens it when we're ready for the long tail.
 *
 * Every function here except fetchCandidacies() is pure, so the interesting
 * parts are unit-testable without network (see candidateSitemap.test.mjs).
 */

import personUrl from '../assets/scripts/utilities/personUrl.js';

// Sitemap protocol caps a file at 50k URLs / 50MB uncompressed. Half that
// keeps files small enough to eyeball and leaves room to grow the per-URL
// payload (lastmod, alternates) without re-partitioning.
export const MAX_URLS_PER_FILE = 25000;

// The API rejects results > 100 ("1000 > maximum(100)").
export const API_PAGE_SIZE = 100;

// A ceiling so a paging bug (or has_more never going false) can't spin the
// build forever. 200 pages = 20k candidacies, well past the ~1.1k that the
// 2026 election has declared so far.
export const MAX_PAGES_PER_YEAR = 200;

export const API_TIMEOUT_MS = 20000;

// Whole-job budget. Per-request timeouts alone don't bound the job: 200
// pages that each take 19s would sit on a Netlify build until it hits the
// platform's own limit and the deploy dies with it. The sitemap is optional;
// the deploy is not.
export const DEFAULT_BUDGET_MS = 180000;

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

/**
 * `https://72horas.org/` + `/candidato/x-1/` -> `https://72horas.org/candidato/x-1/`,
 * whether or not the base carries a trailing slash or a path of its own.
 */
export function absoluteUrl(baseUrl, path) {
  return new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href;
}

/**
 * Candidacies -> the distinct person pages they map to.
 *
 * A URL is scoped to a person, not a candidacy (see personUrl.js), so the
 * same person running for two offices in one election, or in four elections
 * over the years, is one entry — deduped on first sight, which keeps the
 * highest-value candidacy's position in the ordering the API gave us.
 * Entries without the two things a URL needs are dropped rather than
 * guessed at.
 */
export function candidacyUrls(candidacies, baseUrl) {
  const seen = new Set();
  const urls = [];

  for (const candidacy of candidacies) {
    const personId = candidacy?.person_id;
    const name = candidacy?.name;
    if (!personId || !name || seen.has(personId)) {
      continue;
    }
    seen.add(personId);
    urls.push(absoluteUrl(baseUrl, personUrl({ id: personId, name })));
  }

  return urls;
}

export function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function renderUrlset(urls) {
  const body = urls.map((url) => `  <url>\n    <loc>${escapeXml(url)}</loc>\n  </url>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

export function renderSitemapIndex(sitemapUrls, lastmod) {
  const body = sitemapUrls
    .map((url) => `  <sitemap>\n    <loc>${escapeXml(url)}</loc>\n    <lastmod>${escapeXml(lastmod)}</lastmod>\n  </sitemap>`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>
`;
}

/**
 * The files to write, given the URLs. Returned rather than written so the
 * partitioning is testable and the caller owns all the I/O.
 */
export function buildSitemapFiles({
  urls, baseUrl, lastmod, indexName = 'sitemap-candidatos.xml', maxPerFile = MAX_URLS_PER_FILE,
}) {
  if (!urls.length) {
    return [];
  }

  const prefix = indexName.replace(/\.xml$/, '');
  const parts = chunk(urls, maxPerFile).map((partUrls, i) => ({
    name: `${prefix}-${i + 1}.xml`,
    contents: renderUrlset(partUrls),
  }));

  const index = {
    name: indexName,
    contents: renderSitemapIndex(
      parts.map((part) => absoluteUrl(baseUrl, `/${part.name}`)),
      lastmod,
    ),
  };

  return [index, ...parts];
}

/**
 * Every candidacy of `year` that declared money, most money first.
 *
 * Stops on has_more, on an empty page, or at MAX_PAGES_PER_YEAR. A page that
 * fails after its retry aborts the year rather than silently shipping a
 * sitemap with a hole in the middle of it — a partial list looks identical
 * to a complete one from the outside, and the caller can decide what a
 * failed year means for the build.
 */
export async function fetchCandidacies({
  year, apiBase, fetchImpl = fetch, log = () => {}, deadline = Infinity, now = Date.now,
}) {
  const candidacies = [];

  for (let page = 1; page <= MAX_PAGES_PER_YEAR; page += 1) {
    if (now() > deadline) {
      throw new Error(`${year} page ${page}: orçamento de tempo esgotado`);
    }

    const url = `${apiBase}candidates?year=${year}&results=${API_PAGE_SIZE}&page=${page}`
      + '&order_by=total_value&order=desc';

    let payload = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(API_TIMEOUT_MS),
          headers: { accept: 'application/json' },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        payload = await response.json();
        break;
      } catch (error) {
        if (attempt === 2) {
          throw new Error(`${year} page ${page}: ${error.message}`);
        }
        log(`  retentando ${year} página ${page} (${error.message})`);
      }
    }

    const pageCandidacies = Array.isArray(payload?.candidates) ? payload.candidates : [];
    candidacies.push(...pageCandidacies);

    if (!payload?.has_more || !pageCandidacies.length) {
      break;
    }
  }

  return candidacies;
}
