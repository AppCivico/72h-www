/**
 * Per-candidate <head> for /candidato/{slug}-{id}/.
 *
 * All ~853k candidate URLs are served by the same static shell (see the
 * redirect in netlify.toml), whose canonical points at /candidato/ — which
 * told search engines every candidate page was a duplicate of the section
 * page, so none of them ever got indexed. This edge function fetches the
 * same API the client-side app uses and rewrites title, description,
 * canonical, social tags and structured data before the HTML leaves the
 * edge; the Vue app then hydrates the body exactly as before.
 *
 * On any API failure the shell goes out with <meta name="robots"
 * content="noindex"> instead — never with the section-page canonical, and
 * never blocking the human reader (the client-side fetch still runs).
 */

const API_BASE = 'https://h72-api.appcivico.com/v1/';
const API_TIMEOUT_MS = 4000;

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const formatBRL = (value) => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
}).format(Number(value) || 0);

const titleCaseName = (name) => String(name || '')
  .toLowerCase()
  .replace(/(^|[\s'-])([a-zà-ú])/g, (m) => m.toUpperCase())
  .replace(/\b(D[aeo]s?|E)\b/g, (m) => m.toLowerCase());

export function personIdFromPath(pathname) {
  const segment = pathname.split('/').filter(Boolean)[1] || '';
  const match = segment.match(/(\d+)$/);
  return match ? Number(match[1]) : null;
}

/**
 * Everything derived from the API payload, in one testable step.
 * `data` is the /v1/people/{id} response; `cleanUrl` is the canonical
 * (origin + pathname, no query — ?na_eleicao= variants must all point at
 * the same page or each candidacy spawns a duplicate URL in the index).
 */
export function buildMeta(data, cleanUrl) {
  const person = data?.person;
  const elections = Array.isArray(data?.elections) ? data.elections : [];
  const latest = elections[0];
  if (!person || !latest) {
    return null;
  }

  const name = titleCaseName(person.name);
  const party = latest.party?.acronym || latest.party?.name || '';
  const position = latest.position?.name || '';
  const region = latest.city?.region?.name ? titleCaseName(latest.city.region.name) : '';
  const total = Number(latest.total_value) || 0;
  const transfers = Number(latest.total_transfers) || 0;

  const title = [name, party && `(${party})`].filter(Boolean).join(' ')
    + ` · ${[position, region].filter(Boolean).join(' · ')} · 72Horas`;

  const money = total > 0
    ? `declarou ${formatBRL(total)} em ${transfers} ${transfers === 1 ? 'repasse' : 'repasses'} de campanha`
    : 'ainda não declarou recebimento de recursos de campanha';
  const description = `${name}${party ? ` (${party})` : ''}, candidatura a `
    + `${[position, region].filter(Boolean).join(' por ')} nas Eleições ${latest.year}: `
    + `${money}, segundo o TSE (DivulgaCandContas). Veja doadores, datas e comparações.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Person',
        '@id': `${cleanUrl}#person`,
        name,
        url: cleanUrl,
        ...(party ? {
          affiliation: {
            '@type': 'Organization',
            name: latest.party?.name || party,
            ...(latest.party?.acronym ? { alternateName: latest.party.acronym } : {}),
          },
        } : {}),
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem', position: 1, name: '72Horas', item: new URL('/', cleanUrl).href,
          },
          {
            '@type': 'ListItem', position: 2, name: latest.election_name || `Eleições ${latest.year}`, item: new URL(`/${latest.year}/`, cleanUrl).href,
          },
          {
            '@type': 'ListItem', position: 3, name, item: cleanUrl,
          },
        ],
      },
    ],
  };

  return {
    title, description, canonical: cleanUrl, jsonLd,
  };
}

/**
 * String-level rewrite of the shell's <head>. The shell is built by Hugo,
 * so the tags below are known to exist in a stable shape; every regex
 * falls back to leaving the document untouched rather than corrupting it.
 */
export function injectMeta(html, meta) {
  let out = html;

  out = out.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(meta.title)}</title>`);
  out = out.replace(
    /<link rel="canonical" href="[^"]*"\s*\/?>/,
    `<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`,
  );
  out = out.replace(
    /(<meta name="description" content=")[^"]*(")/,
    `$1${escapeHtml(meta.description)}$2`,
  );
  out = out.replace(
    /(<meta name="twitter:title" property="og:title" content=")[^"]*(")/,
    `$1${escapeHtml(meta.title)}$2`,
  );
  out = out.replace(
    /(<meta name="twitter:description" property="og:description" content=")[^"]*(")/,
    `$1${escapeHtml(meta.description)}$2`,
  );
  out = out.replace(
    /(<meta name="twitter:url" property="og:url" content=")[^"]*(")/,
    `$1${escapeHtml(meta.canonical)}$2`,
  );
  out = out.replace(
    /(<meta itemprop="name" content=")[^"]*(")/,
    `$1${escapeHtml(meta.title)}$2`,
  );
  out = out.replace(
    /(<meta itemprop="description" content=")[^"]*(")/,
    `$1${escapeHtml(meta.description)}$2`,
  );
  out = out.replace(
    '</head>',
    `<script type="application/ld+json">${JSON.stringify(meta.jsonLd)}</script>\n</head>`,
  );

  return out;
}

export function injectNoindex(html) {
  // A canonical pointing anywhere is wrong for a page we're excluding;
  // noindex + self-neutral head keeps failures out of the index without
  // ever reviving the old duplicate-of-/candidato/ signal.
  return html.replace(
    '</head>',
    '<meta name="robots" content="noindex">\n</head>',
  );
}

export default async (request, context) => {
  const url = new URL(request.url);
  const personId = personIdFromPath(url.pathname);

  // /candidato/ itself (no id) keeps its static head untouched.
  if (!personId) {
    return context.next();
  }

  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return response;
  }
  const html = await response.text();

  let meta = null;
  try {
    const apiResponse = await fetch(`${API_BASE}people/${personId}`, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (apiResponse.ok) {
      meta = buildMeta(await apiResponse.json(), `${url.origin}${url.pathname}`);
    }
  } catch {
    // fall through to noindex
  }

  const body = meta ? injectMeta(html, meta) : injectNoindex(html);

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(body, { status: response.status, headers });
};
