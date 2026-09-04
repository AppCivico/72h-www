# Testes do 72horas

Quatro camadas, do mais barato para o mais caro. Cada uma existe por causa
de uma classe de erro que já chegou (ou quase chegou) em produção neste
projeto — não por completude.

| Camada | Onde | O que pega | Custo |
| --- | --- | --- | --- |
| Unidade | `tests/unit/` | contas e regras: teto de gastos, valor implausível, formatação, paleta dos gráficos, `<head>` da edge function | ~1s |
| Dados e i18n | `tests/data/` | número externo digitado errado, chave de texto faltando ou duplicada, catálogo de filtros mudando de id | ~1s |
| Smoke do build | `tests/build/` | página que não saiu, canônica errada, link e asset quebrados, resíduo de template, sitemap anunciando 404 | ~2s + build |
| E2E | `tests/e2e/` | o site no navegador: filtros, rotas, overlays, rolagem horizontal, erro de console | ~3min |

## Rodando

```sh
npm test           # lint + unidade + dados  (é o que roda a cada commit)
npm run verify     # tudo, incluindo build, smoke e E2E — antes de subir
```

Separado, quando quiser só uma camada:

```sh
npm run test:unit
npm run test:data
npm run site:for-tests && npm run test:build
npm run test:e2e            # precisa de public/ construído
npm run test:e2e:ui         # mesma suíte, com a interface do Playwright
```

Na primeira vez: `npx playwright install chromium`.

`SITE_DIR=/caminho/para/public` aponta o smoke e o E2E para outro build
(é o que o CI usa quando constrói em diretório temporário).

## Decisões que valem saber

**O smoke roda sobre `public/`, não sobre os templates.** O que vai para o
ar é o HTML, e vários erros do Hugo não derrubam o build: eles publicam a
página com um pedaço a menos (`ZgotmplZ`, `%!s(MISSING)`, `<no value>`).

**O E2E roda sobre o site construído, servido por
`tests/helpers/staticServer.mjs`** — um emulador mínimo do Netlify. O
`hugo server` não tem o rewrite `/candidato/* -> /candidato/index.html`, e
sem ele a página de candidatura só abre por `?id=`, que não é como ela
existe em produção.

**A API é sempre mockada** (`tests/e2e/fixtures/`). As fixtures têm a forma
medida na API real — cada arquivo diz quando, no campo `_fixture`. Um teste
que falha porque o TSE mudou um número ninguém olha; e a API não é
alcançável de dentro do escritório.

**Três larguras (1440, 1100, 390).** Os dois bugs históricos do filtro só
apareciam abaixo de 1280px. Testar só em desktop teria deixado os dois
passarem.

**Os cliques são de ponteiro de verdade.** Onde o teste precisa saber se um
botão está clicável, ele pergunta `document.elementFromPoint` em vez de
confiar no `.click()` do Playwright — que rola a tela e acerta o alvo mesmo
quando um overlay o cobre. Foi exatamente esse o bug em que clicar em
"Aplicar" marcava um estado na lista.

**`tests/helpers/loader.mjs`** repõe no Node a resolução de import sem
extensão que o esbuild do Hugo faz (`import x from './spendingLimits'`).
Sem isso, metade de `assets/scripts/` não seria importável num teste. Por
isso `--import ./tests/helpers/loader.mjs` aparece nos scripts de unidade e
de build.

## Bug conhecido marcado na suíte

`tests/e2e/home-filtros.spec.mjs` tem um `test.fail()` para o celular: a
isca fixa do site (`.site-cta`, hoje anunciando /doadores) fica ancorada no
rodapé e cobre o botão flutuante "Aplicar novos filtros". Quando isso for
resolvido, o teste passa a acusar que o marcador pode sair.

## Ao adicionar página, filtro ou dado novo

- página nova: acrescente em `OBRIGATORIAS` (`tests/build/pages.test.mjs`) e
  na lista `PAGINAS` (`tests/e2e/paginas.spec.mjs`);
- constante ou JSON de dado externo: um teste em `tests/data/` que confira o
  número contra a fonte, e a fonte no próprio arquivo;
- texto novo: nada a fazer — `tests/data/i18n.test.mjs` cobra que a chave
  exista, não esteja duplicada e receba os argumentos certos.

## Uma pegadinha que já custou uma rodada

`npm run site:for-tests` usa `--ignoreCache`, como o build de produção. Sem
isso o Hugo reaproveita `resources/_gen` e publica o bundle de JS/CSS de
antes da sua mudança: os testes passam (ou falham) contra um código que não
é o que você escreveu.
