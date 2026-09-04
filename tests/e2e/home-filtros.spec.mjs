/**
 * Os filtros da home, com cliques reais de ponteiro em três larguras.
 *
 * Todo teste aqui existe por causa de um bug que chegou a produção. Os
 * dois piores não apareciam em teste de unidade nem em revisão de código:
 * um era o valor do rádio "Todos" viajando vazio na query (a API devolvia
 * zero e a página mostrava um site sem dados), o outro era o dropdown
 * ficando aberto por causa de `:focus-within` e cobrindo o próprio botão
 * "Aplicar" — clicar em Aplicar acertava uma opção da lista.
 */
import { expect, test } from '@playwright/test';

import { mockApi, paramsDaUltimaChamada } from './fixtures/api.mjs';

const SAO_PAULO = { id: 24, nome: 'SÃO PAULO' };

const abrirHome = async (page) => {
  const chamadas = await mockApi(page);
  await page.goto('/2026/');
  await expect(page.locator('#vueHome')).toBeVisible();
  // o app montou quando o v-cloak sai do ar
  await expect(page.locator('.filterable-area')).not.toHaveAttribute('v-cloak', /.*/);
  return chamadas;
};

/** O botão "Aplicar" do formulário de filtros. */
const aplicar = (page) => page.locator('#filters form .button--primary').first();

const abrirPainelDeFiltros = async (page) => {
  const alternar = page.locator('.filters__toggle');
  if ((await alternar.getAttribute('aria-expanded')) !== 'true') {
    await alternar.click();
  }
  await expect(page.locator('#filters')).toBeVisible();
};

// O id do <list-box> não sobrevive à renderização (o componente espalha
// $attrs nos inputs), então a lista é localizada pelas opções que ela tem:
// os ids option__states--{id} são únicos na página.
const listaDeEstados = (page) => page
  .locator('ul.list-box')
  .filter({ has: page.locator('#option__states--empty') })
  .first();

/**
 * A lista só mostra as opções quando tem foco (`:focus-within`) — fechada,
 * ela é uma linha de resumo. Clicar direto num rótulo escondido daria
 * timeout, então o passo de abrir é explícito, como para o leitor.
 */
/** Espera a lista assentar depois de uma escolha (ela se re-renderiza). */
const escolher = async (lista, id) => {
  await abrirLista(lista);
  const rotulo = lista.locator(`label[for="option__states--${id}"]`);
  await rotulo.scrollIntoViewIfNeeded();
  await rotulo.click();
  await expect(lista.locator(`#option__states--${id}`)).toBeChecked();
};

const abrirLista = async (lista) => {
  const primeira = lista.locator('.list-box__option').first();
  if (await primeira.isVisible()) return;

  // A lista abre de três jeitos (:hover, :focus e :focus-within). Abrir
  // por FOCO é o único estável para um teste: o :hover se perde quando o
  // Playwright rola a página para clicar na opção, a lista fecha no meio
  // do caminho e o clique persegue um alvo que sumiu. O foco também é o
  // caminho do teclado e do toque. O clique na opção continua sendo de
  // ponteiro de verdade — que é o que os bugs deste arquivo exigem.
  await lista.focus();
  await expect(primeira).toBeVisible();
};

test.describe('filtros da home', () => {
  test('a home carrega e desenha o gráfico com os dados da API', async ({ page }) => {
    const chamadas = await abrirHome(page);

    await expect.poll(() => chamadas.index.length).toBeGreaterThan(0);
    await expect(page.locator('#js-main-chart svg')).toBeVisible();
    // 9.203 candidaturas com repasse declarado, da fixture
    await expect(page.locator('body')).toContainText('9.203');
  });

  test('escolher São Paulo manda region_id[]=24 — e só isso', async ({ page }) => {
    const chamadas = await abrirHome(page);
    await abrirPainelDeFiltros(page);

    const lista = listaDeEstados(page);
    await escolher(lista, SAO_PAULO.id);
    await aplicar(page).click();

    await expect.poll(() => chamadas.index.length).toBeGreaterThan(1);
    const params = paramsDaUltimaChamada(chamadas);

    expect(params.getAll('region_id[]')).toEqual([String(SAO_PAULO.id)]);
    // O bug: o rádio "Todos" tem value="" e ia junto na query. A API lia
    // region_id[]= vazio e devolvia zero — o site inteiro zerado.
    expect(params.getAll('region_id[]')).not.toContain('');
    expect(params.get('year')).toBe('2026');
  });

  test('voltar para "Todos" limpa o filtro em vez de mandar valor vazio', async ({ page }) => {
    const chamadas = await abrirHome(page);
    await abrirPainelDeFiltros(page);

    const lista = listaDeEstados(page);
    await escolher(lista, SAO_PAULO.id);

    // Um rádio já marcado não dispara change: sem o @click, clicar em
    // "Todos" para desfazer uma seleção não fazia nada.
    await escolher(lista, 'empty');
    await aplicar(page).click();

    await expect.poll(() => chamadas.index.length).toBeGreaterThan(1);
    const params = paramsDaUltimaChamada(chamadas);
    expect(params.getAll('region_id[]')).toEqual([]);
  });

  test('o id 0 (ACRE) sobrevive à seleção', async ({ page }) => {
    // `id || fallback` engoliria o Acre inteiro; o código usa `??`.
    const chamadas = await abrirHome(page);
    await abrirPainelDeFiltros(page);

    const lista = listaDeEstados(page);
    await escolher(lista, 0);
    await aplicar(page).click();

    await expect.poll(() => chamadas.index.length).toBeGreaterThan(1);
    expect(paramsDaUltimaChamada(chamadas).getAll('region_id[]')).toEqual(['0']);
  });

  test('dois estados viajam como dois region_id[]', async ({ page }) => {
    const chamadas = await abrirHome(page);
    await abrirPainelDeFiltros(page);

    const lista = listaDeEstados(page);
    await escolher(lista, 0);
    await escolher(lista, SAO_PAULO.id);
    await aplicar(page).click();

    await expect.poll(() => chamadas.index.length).toBeGreaterThan(1);
    expect(paramsDaUltimaChamada(chamadas).getAll('region_id[]').sort()).toEqual(['0', '24']);
  });

  test('o resumo do controle fechado conta quantos foram escolhidos', async ({ page }) => {
    await abrirHome(page);
    await abrirPainelDeFiltros(page);

    const lista = listaDeEstados(page);
    await expect(lista.locator('.list-box__summary')).toContainText(/todos/i);

    await escolher(lista, SAO_PAULO.id);
    await expect(lista.locator('.list-box__summary')).toContainText(SAO_PAULO.nome);

    await escolher(lista, 0);
    await expect(lista.locator('.list-box__summary')).toContainText(/2 selecionados/i);
  });

  test('depois de escolher com o mouse, sempre há um "Aplicar" clicável', async ({ page }) => {
    // O pior dos dois bugs: a lista aberta virava overlay por cima do
    // "Aplicar" do formulário, e o clique no botão caía numa opção. A
    // resposta do site foi o CTA flutuante — este teste cobra que ele
    // esteja realmente por cima quando os filtros ficam desatualizados.
    // Perguntar quem está no ponto é essencial: um .click() do Playwright
    // acertaria o alvo mesmo coberto.
    const chamadas = await abrirHome(page);
    await abrirPainelDeFiltros(page);

    const lista = listaDeEstados(page);
    await escolher(lista, SAO_PAULO.id);

    const flutuante = page.locator('.filters__stale-cta button');
    await expect(flutuante).toBeVisible();
    await flutuante.scrollIntoViewIfNeeded();

    // O gesto de verdade: levar o ponteiro até o botão, passando por onde
    // tiver que passar — é esse trajeto que um overlay intercepta. Só no
    // mouse: num aparelho de toque não existe :hover, e arrastar um cursor
    // até o botão reabriria a lista por um caminho que o dedo não percorre.
    if (!test.info().project.use.hasTouch) {
      const alvo = await flutuante.boundingBox();
      await page.mouse.move(alvo.x + alvo.width / 2, alvo.y + alvo.height / 2, { steps: 12 });
    }

    const noPonto = await flutuante.evaluate((el) => {
      const { top, left, width, height } = el.getBoundingClientRect();
      const emCima = document.elementFromPoint(left + width / 2, top + height / 2);
      return { cobertoPor: emCima?.className || null, ehOBotao: el.contains(emCima) };
    });
    expect(noPonto.ehOBotao, `o CTA flutuante está coberto por: ${noPonto.cobertoPor}`).toBe(true);

    await flutuante.click();
    await expect.poll(() => chamadas.index.length).toBeGreaterThan(1);
    expect(paramsDaUltimaChamada(chamadas).getAll('region_id[]')).toEqual([String(SAO_PAULO.id)]);
  });

  test('a isca do site sai do rodapé enquanto o CTA de aplicar está no ar', async ({ page }) => {
    // As duas peças são fixas no mesmo canto e não se conhecem (scripts
    // separados): a ponte é a classe js-filters-stale no <body>. Este
    // teste existe para que ninguém remova a ponte sem perceber.
    await abrirHome(page);
    await abrirPainelDeFiltros(page);

    const isca = page.locator('.site-cta');
    const tinhaIsca = await isca.count();

    await escolher(listaDeEstados(page), SAO_PAULO.id);
    await expect(page.locator('body')).toHaveClass(/js-filters-stale/);
    if (tinhaIsca) await expect(isca).toBeHidden();

    await aplicar(page).click();
    await expect(page.locator('body')).not.toHaveClass(/js-filters-stale/);
    if (tinhaIsca) await expect(isca).toBeVisible();
  });

  test('com o ponteiro fora da lista, o "Aplicar" do formulário volta a ficar por cima', async ({ page }) => {
    // A lista é overlay absoluto e fica aberta enquanto o ponteiro estiver
    // nela (:hover) — nessa hora ela cobre o "Aplicar" do formulário em
    // telas estreitas, e é por isso que o CTA flutuante existe. Saindo da
    // lista, o botão do formulário tem que voltar a receber o clique.
    const chamadas = await abrirHome(page);
    await abrirPainelDeFiltros(page);

    await escolher(listaDeEstados(page), SAO_PAULO.id);

    await page.locator('.main-header').first().hover();
    await page.waitForTimeout(300);

    const botao = aplicar(page);
    await botao.scrollIntoViewIfNeeded();
    const noPonto = await botao.evaluate((el) => {
      const { top, left, width, height } = el.getBoundingClientRect();
      const emCima = document.elementFromPoint(left + width / 2, top + height / 2);
      return { cobertoPor: emCima?.className || null, ehOBotao: el.contains(emCima) };
    });

    expect(noPonto.ehOBotao, `o "Aplicar" continuou coberto por: ${noPonto.cobertoPor}`).toBe(true);

    await botao.click();
    await expect.poll(() => chamadas.index.length).toBeGreaterThan(1);
  });

  test('a lista aberta não empurra o resto da página', async ({ page }) => {
    // Em fluxo normal ela empurrava ~600px de conteúdo para baixo; a
    // correção foi torná-la overlay absoluto.
    await abrirHome(page);
    await abrirPainelDeFiltros(page);

    // Posição no DOCUMENTO, não na viewport: o Playwright rola a página
    // para clicar, e um boundingBox mediria a rolagem, não o empurrão.
    const grafico = page.locator('#js-main-chart');
    const posicao = () => grafico.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);

    const antes = await posicao();
    await abrirLista(listaDeEstados(page));
    const depois = await posicao();

    expect(Math.abs(depois - antes), 'a lista aberta empurrou o conteúdo abaixo dela').toBeLessThan(24);
  });

  test('a lista fecha depois da escolha com mouse e continua aberta no teclado', async ({ page }) => {
    await abrirHome(page);
    await abrirPainelDeFiltros(page);

    const lista = listaDeEstados(page);
    const opcoesVisiveis = async () => lista.locator('.list-box__option').first().isVisible();

    await escolher(lista, SAO_PAULO.id);
    await page.waitForTimeout(200);
    // com mouse: o foco sai do controle (senão :focus-within mantém aberto)
    const focoDentro = await lista.evaluate((el) => el.contains(document.activeElement));
    expect(focoDentro).toBe(false);

    // com teclado: o foco fica, e a lista segue navegável
    await lista.focus();
    await page.keyboard.press('Tab');
    expect(await opcoesVisiveis()).toBe(true);
  });

  test('trocar o ano recarrega os dados daquele ano', async ({ page }) => {
    const chamadas = await abrirHome(page);
    const seletor = page.locator('.main-header__year select');

    // No mobile o seletor vive dentro do menu recolhido; a troca de ano
    // por lá tem o seu próprio caminho e não é o que este teste cobre.
    test.skip(!(await seletor.isVisible()), 'seletor de ano não visível nesta largura');

    await seletor.selectOption('2022');
    await expect.poll(() => chamadas.index.some((url) => url.includes('year=2022'))).toBe(true);
  });
});
