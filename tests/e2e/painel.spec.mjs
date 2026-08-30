/**
 * O painel dos partidos é frontend-only: tudo que ele mostra vem de
 * data/partyPanel.json, gerado no prebuild. Os testes cobrem o que já
 * quebrou nele: a armadilha do .container no mobile e as tabelas que
 * precisam virar cartões abaixo de 48em.
 */
import { expect, test } from '@playwright/test';

import { mockApi } from './fixtures/api.mjs';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('o painel monta e mostra o placar dos partidos', async ({ page }) => {
  await page.goto('/partidos/painel/');
  await expect(page.locator('#vuePainel')).toBeVisible();
  await expect(page.locator('h1')).toContainText(/Seguindo o dinheiro/i);
  // com dados gerados, os maiores partidos aparecem pelo nome
  const temPlacar = await page.locator('table, .placar, [class*="ranking"]').count();
  expect(temPlacar).toBeGreaterThan(0);
});

test('nenhuma tabela estoura a largura da tela', async ({ page }, info) => {
  await page.goto('/partidos/painel/');
  await page.waitForTimeout(300);

  const estouros = await page.$$eval('table, .data-table, figure', (elementos) => elementos
    .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible')
    .map((el) => `${el.tagName}.${el.className}`));

  expect(estouros, `${info.project.name}: elementos mais largos que o container`).toEqual([]);
});

test('o main do painel não é esticado pelo wrap do container', async ({ page }) => {
  // Toda página nova precisa de flex-wrap: nowrap no main — o painel
  // apanhou disso e o candidato documentou.
  await page.goto('/partidos/painel/');
  const wrap = await page.locator('main .container, .container').first()
    .evaluate((el) => getComputedStyle(el).flexWrap);
  expect(wrap).toBe('nowrap');
});

test('o termômetro do prazo aparece com a data de 8 de setembro', async ({ page }) => {
  await page.goto('/partidos/painel/');
  await expect(page.locator('body')).toContainText(/8 de setembro|08\/09/);
});
