/**
 * A API do 72horas fica atrás da allowlist do escritório e muda de número
 * a cada coleta: E2E contra ela seria lento e instável, e um teste que
 * falha por causa do TSE ninguém olha. Aqui toda chamada é interceptada,
 * e as fixtures têm a forma medida na API real (ver o campo _fixture de
 * cada arquivo).
 *
 * O objeto devolvido registra as URLs chamadas — é assim que os testes de
 * filtro verificam o que foi PARA a API, que é onde os bugs moravam.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const carregar = (nome) => JSON.parse(readFileSync(path.join(AQUI, nome), 'utf8'));

export const INDEX = carregar('index.json');
export const CANDIDATES = carregar('candidates.json');
export const PERSON = carregar('person.json');

const json = (route, body) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

export async function mockApi(page, { onIndex } = {}) {
  const chamadas = { index: [], candidates: [], people: [], todas: [], externas: [] };

  // Nada de rede externa num E2E: fonte do Google, analytics e afins
  // deixariam o teste dependente da conexão da máquina (e do allowlist do
  // escritório) para dizer se o site está de pé.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, async (route) => {
    const url = route.request().url();
    if (url.includes('h72-api.appcivico.com')) return route.fallback();
    chamadas.externas.push(url);
    // Responder vazio em vez de abortar: um request abortado vira erro de
    // console, e a lista de erros de console é assertada nos testes.
    return route.fulfill({ status: 200, body: '' });
  });

  await page.route('**/h72-api.appcivico.com/**', async (route) => {
    const url = route.request().url();
    chamadas.todas.push(url);
    const caminho = new URL(url).pathname;

    if (caminho.endsWith('/index')) {
      chamadas.index.push(url);
      return json(route, onIndex ? onIndex(url, INDEX) : INDEX);
    }
    if (/\/candidates\/\d+\/(comparison|breakdown|transfers)$/.test(caminho)) {
      return json(route, { data: [], has_more: false });
    }
    if (/\/candidates\/\d+$/.test(caminho)) {
      return json(route, CANDIDATES.candidates[0]);
    }
    if (caminho.endsWith('/candidates')) {
      chamadas.candidates.push(url);
      return json(route, CANDIDATES);
    }
    if (/\/people\/\d+$/.test(caminho)) {
      chamadas.people.push(url);
      return json(route, PERSON);
    }
    return json(route, {});
  });

  return chamadas;
}

/** Os parâmetros que o front mandou na última chamada de /index. */
export function paramsDaUltimaChamada(chamadas) {
  const url = chamadas.index[chamadas.index.length - 1];
  if (!url) return null;
  return new URL(url).searchParams;
}
