#!/usr/bin/env node
/**
 * Writes data/partyPanel.json before Hugo runs, so the /partidos/painel/
 * page can inline every party's equity numbers at build time and visitors
 * never hit the API. Same contract as build-candidate-sitemap.mjs:
 *
 * Never fails the build. If the API is down or the budget blows, shipping
 * the site without today's panel data beats not shipping the site: the
 * page's educational half is static, and its data half renders an honest
 * "dados indisponíveis" state when the file is absent. On failure the
 * stale file is removed rather than left to masquerade as fresh.
 *
 * Two requests per party (public money; public money to Black candidacies),
 * the second skipped when the first came back empty. ~43 parties in 2026
 * means at most ~87 sequential requests, well inside the API's per-IP rate
 * limit and this job's budget.
 *
 * Env:
 *   PANEL_YEAR       election year (default: `run` in params.yaml)
 *   PANEL_API_BASE   API root (default: `apiDomain` in params.yaml)
 *   PANEL_BUDGET_MS  whole-job time budget (default: 3 min)
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIndexUrl, buildPartyEntry } from './partyPanel.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = join(projectRoot, 'data', 'partyPanel.json');
const paramsPath = join(projectRoot, 'config/_default/params.yaml');
const quotasPath = join(projectRoot, 'data', 'fefc2026.json');

const FALLBACK_API_BASE = 'https://h72-api.appcivico.com/v1/';
const DEFAULT_BUDGET_MS = 3 * 60 * 1000;

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

  const entries = [];
  for (const party of parties) {
    // Sequential on purpose: the API rate-limits per IP and the budget
    // check inside fetchJson is what turns a slow API into a clean abort
    // instead of a hung build.
    // eslint-disable-next-line no-await-in-loop
    const publicData = await fetchJson(buildIndexUrl(apiBase, year, party.id), deadline);
    const hasMoney = Number(publicData?.big_numbers?.total_amount) > 0;
    const blackData = hasMoney
      // eslint-disable-next-line no-await-in-loop
      ? await fetchJson(buildIndexUrl(apiBase, year, party.id, { black: true }), deadline)
      : { big_numbers: {}, chart: {} };
    entries.push(buildPartyEntry(party, publicData, blackData, fefc.quotas));
  }

  const panel = {
    generated_at: new Date().toISOString(),
    year,
    fefc_total: fefc.total,
    parties: entries,
  };

  await writeFile(outputPath, `${JSON.stringify(panel, null, 1)}\n`);
  process.stdout.write(`party panel: ${entries.length} parties for ${year} -> data/partyPanel.json\n`);
}

main().catch(async (err) => {
  process.stderr.write(`party panel build failed (soft): ${err.message}\n`);
  await rm(outputPath, { force: true });
});
