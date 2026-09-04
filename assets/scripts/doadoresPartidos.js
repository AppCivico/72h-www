/**
 * Camada de tooltip de /doadores/partidos/.
 *
 * A página inteira é renderizada pelo Hugo no build: barras, tabela e
 * ranking já chegam prontos no HTML e continuam legíveis sem JavaScript
 * nenhum. Este arquivo só acrescenta o detalhe que não cabe na tela, lendo
 * o atributo data-tip de cada elemento.
 *
 * Por isso não há framework aqui. Um Vue montando em cima de conteúdo que
 * já existe só criaria a chance de a página ficar em branco quando o script
 * falhar.
 */
(function tooltips() {
  const alvos = document.querySelectorAll('[data-tip]');
  if (!alvos.length) return;

  const balao = document.createElement('div');
  balao.className = 'dpartidos__tip';
  balao.setAttribute('role', 'status');
  document.body.appendChild(balao);

  let atual = null;

  function posicionar(evento) {
    if (!atual) return;
    const caixa = atual.getBoundingClientRect();
    const tip = balao.getBoundingClientRect();
    const x = evento
      ? evento.clientX + 14
      : caixa.left + (caixa.width / 2) - (tip.width / 2);
    const acima = caixa.top - tip.height - 10;
    balao.style.left = `${Math.max(8, Math.min(x, window.innerWidth - tip.width - 8))}px`;
    balao.style.top = `${acima < 8 ? caixa.bottom + 10 : acima}px`;
  }

  function abrir(elemento, evento) {
    atual = elemento;
    balao.textContent = elemento.getAttribute('data-tip');
    balao.classList.add('dpartidos__tip--on');
    posicionar(evento);
  }

  function fechar() {
    atual = null;
    balao.classList.remove('dpartidos__tip--on');
  }

  alvos.forEach((alvo) => {
    // Teclado também abre: a informação do tooltip não existe em outro lugar
    // para quem não usa mouse.
    if (!alvo.hasAttribute('tabindex')) alvo.setAttribute('tabindex', '0');
    alvo.addEventListener('mouseenter', (evento) => abrir(alvo, evento));
    alvo.addEventListener('mousemove', posicionar);
    alvo.addEventListener('mouseleave', fechar);
    alvo.addEventListener('focus', () => abrir(alvo));
    alvo.addEventListener('blur', fechar);
  });

  window.addEventListener('scroll', fechar, { passive: true });
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') fechar();
  });
}());
