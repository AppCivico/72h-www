/**
 * A página de candidatura só existe como rota: /candidato/{slug}-{id}/ é
 * o mesmo shell estático para todas as ~853 mil, e quem a transforma na
 * página de alguém é o JS lendo o id do próprio caminho. O `hugo server`
 * não tem esse rewrite — daí o servidor estático dos testes emulá-lo.
 */
import { expect, test } from '@playwright/test';

import { PERSON, mockApi } from './fixtures/api.mjs';

test('a rota /candidato/{slug}-{id}/ serve o shell e carrega a pessoa', async ({ page }) => {
  const chamadas = await mockApi(page);
  await page.goto('/candidato/marcio-franca-260327/');

  await expect.poll(() => chamadas.people.length).toBeGreaterThan(0);
  expect(chamadas.people[0]).toContain('/people/260327');

  await expect(page.locator('#vueCandidato')).toBeVisible();
  await expect(page.locator('h1')).toContainText(/Márcio França/i);
});

test('o valor declarado aparece formatado em pt-BR', async ({ page }) => {
  await mockApi(page);
  await page.goto('/candidato/marcio-franca-260327/');

  const corpo = page.locator('#vueCandidato');
  // R$ 2.853.182,50 sem centavos, como o site escreve
  await expect(corpo).toContainText('R$ 2.853.183');
  await expect(corpo).toContainText(/PSB/);
});

test('a trajetória lista as duas eleições da pessoa', async ({ page }) => {
  await mockApi(page);
  await page.goto('/candidato/marcio-franca-260327/');

  const corpo = page.locator('#vueCandidato');
  for (const eleicao of PERSON.elections) {
    await expect(corpo).toContainText(String(eleicao.year));
  }
});

test('?id= continua funcionando (é como se testa sem o rewrite)', async ({ page }) => {
  const chamadas = await mockApi(page);
  await page.goto('/candidato/?id=260327');

  await expect.poll(() => chamadas.people.length).toBeGreaterThan(0);
  await expect(page.locator('h1')).toContainText(/Márcio França/i);
});

test('id inexistente não deixa a página em carregamento eterno', async ({ page }) => {
  await page.route('**/h72-api.appcivico.com/**', (route) => route.fulfill({
    status: 404, contentType: 'application/json', body: '{"error":"not found"}',
  }));
  await page.goto('/candidato/ninguem-999999999/');

  await expect(page.locator('#vueCandidato')).toBeVisible();
  await expect(page.locator('#vueCandidato')).not.toHaveAttribute('v-cloak', /.*/);
});
