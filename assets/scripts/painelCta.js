/**
 * A isca fixa do Painel dos partidos, presente em toda página menos a
 * própria. Script solto de propósito: os bundles do site são por página
 * (home.js, candidato.js, painel.js) e este elemento vive em todas, então
 * pendurá-lo em qualquer um deles deixaria as outras sem ele.
 *
 * Duas responsabilidades, e nada além: preencher a contagem regressiva do
 * prazo das cotas (calculada aqui, e não no build, porque o build não roda
 * todo dia) e lembrar que o visitante fechou o aviso.
 */

import { QUOTA_DEADLINES } from './utilities/electoralFund';

// A versão na chave é o que nos deixa chamar a atenção de novo numa próxima
// novidade, sem ressuscitar este aviso para quem já o dispensou.
const STORAGE_KEY = 'h72:painelCta:v1';

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

// Fim do dia do prazo no horário de Brasília, para quem está algumas horas à
// frente ou atrás ver a virada no dia certo.
function daysUntil(iso) {
  const end = new Date(`${iso}T23:59:59-03:00`).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - Date.now()) / 86400000);
}

export default function watchPainelCta() {
  const cta = document.getElementById('js-painel-cta');
  if (!cta) return;

  const close = cta.querySelector('[data-cta-close]');
  if (close) {
    close.addEventListener('click', () => {
      cta.hidden = true;
      remember();
    });
  }

  if (readDismissed()) return;

  const line = cta.querySelector('[data-cta-line]');
  const deadline = QUOTA_DEADLINES[cta.dataset.year];
  if (line && deadline) {
    const left = daysUntil(deadline);
    if (left !== null) {
      const unit = left === 1 ? cta.dataset.day : cta.dataset.days;
      // Passado o prazo a contagem não faz sentido, mas o painel passa a
      // responder outra pergunta, e é ela que a linha oferece.
      line.textContent = left > 0
        ? `${left} ${unit} ${cta.dataset.tail}`
        : cta.dataset.past;
    }
  }

  cta.hidden = false;
}

watchPainelCta();
