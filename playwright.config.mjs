import { defineConfig, devices } from '@playwright/test';

/**
 * Os E2E rodam sobre o site JÁ CONSTRUÍDO, servido pelo mesmo emulador do
 * Netlify usado pelo smoke (tests/helpers/staticServer.mjs) — e não pelo
 * `hugo server`, que não tem o rewrite de /candidato/* e por isso não
 * reproduz a página de candidatura como ela é em produção.
 *
 * As três larguras não são decoração: os dois bugs históricos do filtro só
 * apareciam abaixo de 1280px, e o overlay do dropdown cobria o botão
 * "Aplicar" justamente onde a coluna estreita.
 */
const SITE = process.env.SITE_DIR || 'public';
const PORT = Number(process.env.E2E_PORT || 4321);

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Escapatória para ambientes que já têm um Chromium instalado e não
    // conseguem baixar o do Playwright (allowlist de rede).
    ...(process.env.E2E_CHROMIUM ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM } } : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // A faixa onde o dropdown de filtros empurrava o layout.
      name: 'laptop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1100, height: 800 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],

  webServer: {
    command: `node tests/helpers/staticServer.mjs ${SITE} ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
