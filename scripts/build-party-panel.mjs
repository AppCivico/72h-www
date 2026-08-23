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
 * Two requests per party (public money; public money to Black candidacies),
 * the second skipped when the first came back empty. ~43 parties in 2026
 * means at most ~87 requests, run CONCURRENCY at a time: the API allows 120
 * GET/min per IP, so a handful in flight stays well inside it while cutting
 * the job from minutes to seconds.
 *
 * Env:
 *   PANEL_YEAR       election year (default: `run` in params.yaml)
 *   PANEL_API_BASE   API root (default: `apiDomain` in params.yaml)
 *   PANEL_BUDGET_MS  whole-job time budget (default: 3 min)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIndexUrl, buildPartyEntry } from './partyPanel.mjs';

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
  const parties = filters?.filters?.parties || [];
  if (!parties.length) throw new Error('filters returned no parties');

  // One party's two requests, in order: the second is skipped when the
  // first shows no public money at all.
  const fetchParty = async (party) => {
    const publicData = await fetchJson(buildIndexUrl(apiBase, year, party.id), deadline);
    const hasMoney = Number(publicData?.big_numbers?.total_amount) > 0;
    const blackData = hasMoney
      ? await fetchJson(buildIndexUrl(apiBase, year, party.id, { black: true }), deadline)
      : { big_numbers: {}, chart: {} };
    return buildPartyEntry(party, publicData, blackData, fefc.quotas);
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

  const panel = {
    generated_at: new Date().toISOString(),
    year,
    fefc_total: fefc.total,
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
