#!/usr/bin/env node
/**
 * Writes data/partyPanel.json before Hugo runs, so the /partidos/painel/
 * page can inline every party's equity numbers at build time and visitors
 * never hit the API. Same contract as build-candidate-sitemap.mjs:
 *
 * Never fails the build. If the API is down or the budget blows, the file
 * already committed to the repo (refreshed daily by
 * .github/workflows/painel-partidos.yml) stays in place: yesterday's real
 * numbers, stamped with their own generated_at, beat both a broken build
 * and an empty page. Only when there is no committed file at all does the
 * page fall back to its honest "dados indisponíveis" state.
 *
 * Two requests per party (Fundo Eleitoral; Fundo Eleitoral to Black
 * candidacies), the second skipped when the first came back empty, plus one
 * whole-election request for the Fundo Partidário total, which exists only
 * to disclose what this page leaves out. ~43 parties in 2026 means at most
 * ~88 requests, run CONCURRENCY at a time: the API allows 120 GET/min per
 * IP, so a handful in flight stays well inside it while cutting the job
 * from minutes to seconds.
 *
 * Env:
 *   PANEL_YEAR       election year (default: `run` in params.yaml)
 *   PANEL_API_BASE   API root (default: `apiDomain` in params.yaml)
 *   PANEL_BUDGET_MS  whole-job time budget (default: 3 min)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildFundTotalUrl, buildIndexUrl, buildPartyEntry, FEFC_FUND_TYPE, futureDatedDays,
  isPanelParty, PARTY_FUND_TYPE,
} from './partyPanel.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = join(projectRoot, 'data', 'partyPanel.json');
const paramsPath = join(projectRoot, 'config/_default/params.yaml');
const quotasPath = join(projectRoot, 'data', 'fefc2026.json');

const FALLBACK_API_BASE = 'https://h72-api.appcivico.com/v1/';
const DEFAULT_BUDGET_MS = 3 * 60 * 1000;
// Parties in flight at once. Each party costs at most 2 requests, so this
// peaks at 10 concurrent against a 120/min budget.
const CONCURRENCY = 5;

async function readParams() {
  try {
    const yaml = await readFile(paramsPath, 'utf8');
    const run = yaml.match(/^run:\s*(\d{4})\s*$/m)?.[1];
    const apiDomain = yaml.match(/^apiDomain:\s*"?([^"\s]+)"?\s*$/m)?.[1];
    return { run: run ? Number(run) : null, apiDomain: apiDomain || null };
  } catch {
    return { run: null, apiDomain: null };
  }
}

async function fetchJson(url, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('panel build budget exhausted');
  const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(remaining, 45000)) });
  if (!response.ok) throw new Error(`GET ${url} -> ${response.status}`);
  return response.json();
}

async function main() {
  const params = await readParams();
  const year = Number(process.env.PANEL_YEAR) || params.run || new Date().getUTCFullYear();
  const apiBase = process.env.PANEL_API_BASE || params.apiDomain || FALLBACK_API_BASE;
  const budgetMs = Number(process.env.PANEL_BUDGET_MS) || DEFAULT_BUDGET_MS;
  const deadline = Date.now() + budgetMs;

  const fefc = JSON.parse(await readFile(quotasPath, 'utf8'));

  const filtersUrl = new URL('filters', apiBase);
  filtersUrl.searchParams.set('year', String(year));
  const filters = await fetchJson(filtersUrl.toString(), deadline);
  const allParties = filters?.filters?.parties || [];
  if (!allParties.length) throw new Error('filters returned no parties');
  const parties = allParties.filter(isPanelParty);

  // The collection date, in the API's own clock, used as the cutoff for the
  // plotted daily series. Declarations dated after it are set aside there
  // (never in the totals) and counted in `future_dated` below.
  let until = new Date().toISOString().slice(0, 10);
  const futureDated = { count: 0, value: 0 };

  // One party's two requests, in order: the second is skipped when the
  // first shows no Fundo Eleitoral at all.
  const fetchParty = async (party) => {
    const fefcData = await fetchJson(buildIndexUrl(apiBase, year, party.id), deadline);
    // `now` is the API's clock. Preferring it over ours keeps the cutoff on
    // the same clock that produced the series, so a build machine with a
    // skewed date can neither hide real days nor keep future ones.
    if (fefcData?.now) until = String(fefcData.now).slice(0, 10);
    const hasMoney = Number(fefcData?.big_numbers?.total_amount) > 0;
    const blackData = hasMoney
      ? await fetchJson(buildIndexUrl(apiBase, year, party.id, { black: true }), deadline)
      : { big_numbers: {}, chart: {} };
    const late = futureDatedDays(fefcData?.chart, until);
    futureDated.count += late.count;
    futureDated.value += late.value;
    return buildPartyEntry(party, fefcData, blackData, fefc.quotas, { until });
  };

  // Fixed-size batches rather than a full fan-out: bounded concurrency keeps
  // the request rate predictable, and any rejection still aborts the whole
  // job (the caller keeps the previously committed data).
  const entries = [];
  for (let i = 0; i < parties.length; i += CONCURRENCY) {
    const batch = parties.slice(i, i + CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    entries.push(...await Promise.all(batch.map(fetchParty)));
  }
  // The API returns parties in its own order; batching preserves it, but be
  // explicit so the committed file's diff stays minimal day to day.
  entries.sort((a, b) => a.id - b.id);

  // How much Fundo Partidário the candidacies declared receiving. It is not
  // part of any number on the page: it exists so the methodology can say, in
  // reais, what choosing the Fundo Eleitoral alone leaves out. A failure here
  // must not cost the whole panel, so it degrades to null and the page hides
  // the sentence.
  let partyFundDeclared = null;
  try {
    const partyFund = await fetchJson(
      buildFundTotalUrl(apiBase, year, PARTY_FUND_TYPE), deadline,
    );
    partyFundDeclared = Number(partyFund?.big_numbers?.total_amount) || 0;
  } catch (err) {
    process.stderr.write(`party panel: party-fund total unavailable (${err.message})\n`);
  }

  // The whole election's Fundo Eleitoral, on the same basis as the panel.
  // The panel's own sum is smaller: it scores only the parties that come
  // back from /filters and survive isPanelParty, so legends excluded there
  // (and any record attached to none of them) fall outside. On 29/08/2026
  // the gap was R$ 73,5 milhões, 4,6%, which is the sort of thing a reader
  // finds by comparing this page with the home and we would rather state
  // ourselves. Degrades to null exactly like the Fundo Partidário total.
  let fefcDeclaredTotal = null;
  try {
    const fefcTotal = await fetchJson(
      buildFundTotalUrl(apiBase, year, FEFC_FUND_TYPE), deadline,
    );
    fefcDeclaredTotal = Number(fefcTotal?.big_numbers?.total_amount) || 0;
  } catch (err) {
    process.stderr.write(`party panel: FEFC election total unavailable (${err.message})\n`);
  }

  const panelSum = entries.reduce((sum, entry) => sum + entry.fefc.total, 0);

  const panel = {
    generated_at: new Date().toISOString(),
    year,
    // Which fund every number below is made of. The page reads it so a
    // legacy file generated on the old FEFC + Fundo Partidário basis can
    // never be presented as if it were Fundo Eleitoral only.
    basis: 'fefc',
    // Cutoff of the plotted daily series, and what it left out. Both exist so
    // the page can say where the lines stop and why, instead of the reader
    // discovering a silent trim.
    collected_until: until,
    future_dated: futureDated,
    fefc_total: fefc.total,
    // What the panel itself measures, and what the whole election declared on
    // the same fund. The difference is the money outside the scored parties.
    fefc_declared_panel: panelSum,
    fefc_declared_total: fefcDeclaredTotal,
    party_fund_declared: partyFundDeclared,
    parties: entries,
  };

  await writeFile(outputPath, `${JSON.stringify(panel, null, 1)}\n`);
  process.stdout.write(`party panel: ${entries.length} parties for ${year} -> data/partyPanel.json\n`);
}

main().catch((err) => {
  // Deliberately does NOT remove the existing file: the committed copy is
  // the fallback, and deleting it here would also let the scheduled
  // workflow commit that deletion.
  process.stderr.write(`party panel build failed (soft, keeping existing data): ${err.message}\n`);
});
