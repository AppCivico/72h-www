/**
 * As páginas do site abrindo de verdade num navegador: sem erro de
 * console, sem barra de rolagem horizontal, com o cabeçalho visível e o
 * conteúdo montado. É o teste que pega o que o HTML estático não mostra —
 * CSS que estoura a largura, app Vue que não monta, v-cloak que nunca sai.
 */
import { expect, test } from '@playwright/test';

import { mockApi } from './fixtures/api.mjs';

const PAGINAS = [
  { url: '/2026/', nome: 'home do ano corrente' },
  { url: '/doadores/', nome: 'doadores' },
  { url: '/partidos/painel/', nome: 'painel dos partidos' },
  { url: '/quem-somos/', nome: 'quem somos' },
  { url: '/sobre-os-dados/', nome: 'sobre os dados' },
  { url: '/imprensa/', nome: 'imprensa' },
  { url: '/candidato/marcio-franca-260327/', nome: 'candidatura' },
];

for (const pagina of PAGINAS) {
  test.describe(pagina.nome, () => {
    test('abre sem erro de console e sem rolagem horizontal', async ({ page }, info) => {
      const erros = [];
      page.on('console', (msg) => { if (msg.type() === 'error') erros.push(msg.text()); });
      page.on('pageerror', (erro) => erros.push(String(erro)));

      await mockApi(page);
      await page.goto(pagina.url);
      await expect(page.locator('.main-header, header').first()).toBeVisible();

      // Rolagem horizontal em telas estreitas é o sintoma da armadilha
      // conhecida do .container (flex-coluna com wrap esticando o filho).
      const estouro = await page.evaluate(() => document.documentElement.scrollWidth
        - document.documentElement.clientWidth);
      expect(estouro, `${info.project.name}: a página rola ${estouro}px para o lado`).toBeLessThanOrEqual(1);

      expect(erros.filter((texto) => !/favicon|Highcharts error #16/i.test(texto))).toEqual([]);
    });

    test('o cabeçalho não fica coberto pelo overlay de carregamento', async ({ page }) => {
      // [v-cloak] pinta um overlay branco por cima do elemento até o Vue
      // montar. Num elemento que nenhum app monta, o overlay fica para
      // sempre — o leitor vê um retângulo branco com cursor de espera.
      await mockApi(page);
      await page.goto(pagina.url);
      await page.waitForTimeout(600);

      const presos = await page.$$eval('[v-cloak]', (elementos) => elementos
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => el.className || el.tagName));

      expect(presos, 'elementos que ficaram com v-cloak depois da montagem').toEqual([]);
    });
  });
}

test('a navegação do topo leva às páginas que ela anuncia', async ({ page }) => {
  await mockApi(page);
  await page.goto('/2026/');

  const links = page.locator('.main-header a[href^="/"]');
  const total = await links.count();
  expect(total).toBeGreaterThan(2);

  for (let i = 0; i < total; i += 1) {
    const href = await links.nth(i).getAttribute('href');
    const resposta = await page.request.get(href);
    expect(resposta.status(), `${href} respondeu ${resposta.status()}`).toBe(200);
  }
});
