/**
 * A isca fixa do site, presente em toda página menos a que ela anuncia.
 * Script solto de propósito: os bundles do site são por página (home.js,
 * candidato.js, painel.js, doadores.js) e este elemento vive em todas, então
 * pendurá-lo em qualquer um deles deixaria as outras sem ele.
 *
 * Uma responsabilidade só: lembrar que o visitante fechou o aviso. A linha do
 * corpo é escrita no build (partials/donorsHighlight.html), porque um número
 * de porte de doador se move devagar e não vale uma requisição por visita.
 * Antes daqui saía uma contagem regressiva do prazo das cotas, calculada no
 * cliente porque o build não roda todo dia; se a isca um dia voltar a
 * anunciar algo com data, a contagem tem de voltar junto.
 */

// A versão na chave é o que nos deixa chamar a atenção de novo numa próxima
// novidade, sem ressuscitar este aviso para quem já o dispensou. v2: a isca
// deixou de anunciar o Painel dos partidos e passou a anunciar /doadores, e
// quem fechou a primeira precisa ver a segunda.
const STORAGE_KEY = 'h72:siteCta:v2';

// localStorage lança em janela privada e com cookies de site bloqueados, e
// aqui a falha nunca pode custar o aviso: sem memória, ele simplesmente
// reaparece na próxima página.
function readDismissed() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch (error) {
    return false;
  }
}

function remember() {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch (error) {
    // Sem memória disponível: o aviso volta, e está tudo bem.
  }
}

export default function watchSiteCta() {
  const cta = document.getElementById('js-site-cta');
  if (!cta) return;

  const close = cta.querySelector('[data-cta-close]');
  if (close) {
    close.addEventListener('click', () => {
      cta.hidden = true;
      remember();
    });
  }

  if (readDismissed()) return;

  cta.hidden = false;
}

watchSiteCta();
