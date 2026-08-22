#!/usr/bin/env node
/**
 * Writes static/sitemap-candidatos*.xml before Hugo runs, so Hugo copies
 * them into public/ like any other static asset. See candidateSitemap.mjs
 * for why this exists at all.
 *
 * Never fails the build. A sitemap is an invitation to crawl, not part of
 * the site: if the API is down or slow, shipping the site without today's
 * candidate sitemap is strictly better than not shipping the site. On
 * failure it removes any stale files it wrote before, and layouts/robots.txt
 * stops advertising the sitemap because the file is gone.
 *
 * Env:
 *   SITEMAP_BASE_URL  absolute base for the URLs (default: $URL, then
 *                     $DEPLOY_PRIME_URL, then https://72horas.org)
 *   SITEMAP_YEARS     comma-separated years (default: `run` in params.yaml)
 *   SITEMAP_API_BASE  API root (default: `apiDomain` in params.yaml)
 *   SITEMAP_BUDGET_MS whole-job time budget (default: 3 min)
 */

import {
  mkdir, readdir, readFile, rm, writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_BUDGET_MS, buildSitemapFiles, candidacyUrls, fetchCandidacies,
} from './candidateSitemap.mjs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = join(projectRoot, 'static');
const paramsPath = join(projectRoot, 'config/_default/params.yaml');

const FALLBACK_BASE_URL = 'https://72horas.org';
const FALLBACK_API_BASE = 'https://h72-api.appcivico.com/v1/';
const FALLBACK_YEAR = new Date().getUTCFullYear();

/**
 * params.yaml is the single source of truth for the election year and the
 * API root, and it's flat enough that two regexes beat adding a YAML parser
 * to a build that has no other use for one. Both fall back rather than
 * throwing: a missing key should degrade, not break the deploy.
 */
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

function parseYears(raw, fallbackYear) {
  const years = String(raw || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 2000 && value <= 2100);
  return years.length ? years : [fallbackYear];
}

/**
 * Leaving a previous run's files behind would be worse than leaving none:
 * robots.txt keys off the index file's existence, and a stale partition the
 * current index no longer references still gets crawled — advertising URLs
 * we no longer vouch for. So every run starts from a clean slate, and a run
 * that dies partway through takes its own output with it.
 */
async function removeGeneratedFiles() {
  const existing = await readdir(staticDir).catch(() => []);
  await Promise.all(
    existing
      .filter((name) => /^sitemap-candidatos(-\d+)?\.xml$/.test(name))
      .map((name) => rm(join(staticDir, name), { force: true })),
  );
}

async function main() {
  const params = await readParams();
  const baseUrl = process.env.SITEMAP_BASE_URL
    || process.env.URL
    || process.env.DEPLOY_PRIME_URL
    || FALLBACK_BASE_URL;
  const apiBase = process.env.SITEMAP_API_BASE || params.apiDomain || FALLBACK_API_BASE;
  const years = parseYears(process.env.SITEMAP_YEARS, params.run || FALLBACK_YEAR);

  const budgetMs = Number(process.env.SITEMAP_BUDGET_MS) || DEFAULT_BUDGET_MS;
  const deadline = Date.now() + budgetMs;

  console.log(`[sitemap-candidatos] base=${baseUrl} anos=${years.join(',')} orçamento=${budgetMs}ms`);

  // Antes de qualquer fetch: um run que não chega ao fim não deixa para trás
  // o sitemap do run anterior se passando pelo de hoje.
  await mkdir(staticDir, { recursive: true });
  await removeGeneratedFiles();

  const candidacies = [];
  for (const year of years) {
    const yearCandidacies = await fetchCandidacies({
      year, apiBase, deadline, log: (message) => console.log(`[sitemap-candidatos]${message}`),
    });
    console.log(`[sitemap-candidatos] ${year}: ${yearCandidacies.length} candidaturas com repasse`);
    candidacies.push(...yearCandidacies);
  }

  const urls = candidacyUrls(candidacies, baseUrl);
  const files = buildSitemapFiles({
    urls,
    baseUrl,
    lastmod: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
  });

  if (!files.length) {
    console.log('[sitemap-candidatos] nenhuma URL — nada a escrever');
    return;
  }

  for (const file of files) {
    await writeFile(join(staticDir, file.name), file.contents, 'utf8');
  }

  console.log(`[sitemap-candidatos] ${urls.length} URLs em ${files.length - 1} arquivo(s) + índice`);
}

try {
  await main();
} catch (error) {
  console.warn(`[sitemap-candidatos] pulando: ${error.message}`);
  await removeGeneratedFiles();
}
