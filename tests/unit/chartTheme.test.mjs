import assert from 'node:assert/strict';
import { test } from 'node:test';

import theme, {
  binary, categorical, compactCurrency, hairline, ink, inkSoft, sequentialRamp, surface,
} from '../../assets/scripts/utilities/chartTheme.js';
import {
  VISIONS, contrast, deltaE, luminance, simulate,
} from '../helpers/color.mjs';

// Abaixo disso duas séries vizinhas num gráfico deixam de ser lidas como
// cores diferentes. 12 dá folga sobre o piso usual (~10) sem engessar a paleta.
const SEPARACAO_MINIMA = 12;

test('toda cor categórica tem ao menos 3:1 contra o fundo da página', () => {
  // Sem isso a série mais clara some para quem tem baixa visão — e o
  // gráfico é a peça de informação principal da home.
  for (const color of categorical) {
    const ratio = contrast(color, surface);
    assert.ok(ratio >= 3, `${color} tem só ${ratio.toFixed(2)}:1 contra ${surface}`);
  }
});

test('as cores categóricas continuam distinguíveis em daltonismo', () => {
  // Deutan/protan/tritan simulados: uma paleta "bonita" pode colapsar em
  // duas cores iguais para ~8% dos homens, e aí o gráfico mente para eles.
  for (const vision of VISIONS) {
    for (let i = 0; i < categorical.length; i += 1) {
      for (let j = i + 1; j < categorical.length; j += 1) {
        const distance = deltaE(simulate(categorical[i], vision), simulate(categorical[j], vision));
        assert.ok(
          distance >= SEPARACAO_MINIMA,
          `${categorical[i]} e ${categorical[j]} colidem em ${vision} (ΔE ${distance.toFixed(1)})`,
        );
      }
    }
  }
});

test('as duas cores do par binário se separam em qualquer visão', () => {
  for (const vision of VISIONS) {
    const distance = deltaE(simulate(binary[0], vision), simulate(binary[1], vision));
    assert.ok(distance >= SEPARACAO_MINIMA, `o par binário colide em ${vision} (ΔE ${distance.toFixed(1)})`);
  }
});

test('a paleta é de ordem fixa: cor segue a entidade, nunca o ranking', () => {
  assert.deepEqual(categorical, ['#6D28D9', '#00897B', '#B45309', '#1D4ED8', '#C2185B']);
  assert.equal(theme.colors, categorical);
  assert.equal(binary.length, 2);
});

test('sequentialRamp vai do escuro ao claro sem repetir cor', () => {
  for (const steps of [2, 5, 12, 33]) {
    const ramp = sequentialRamp(steps);
    assert.equal(ramp.length, Math.max(steps, 2));
    assert.equal(new Set(ramp).size, ramp.length, `rampa de ${steps} repetiu cor`);
    ramp.forEach((color) => assert.match(color, /^#[0-9a-f]{6}$/));
    assert.ok(luminance(ramp[0]) < luminance(ramp[ramp.length - 1]));
  }
});

test('sequentialRamp não estoura com 1 ou 0 categorias', () => {
  assert.equal(sequentialRamp(1).length, 2);
  assert.equal(sequentialRamp(0).length, 2);
});

test('compactCurrency abrevia em pt-BR e não deixa vírgula à toa', () => {
  assert.equal(compactCurrency(4961519777), 'R$ 4,96 bi');
  assert.equal(compactCurrency(2853182), 'R$ 2,85 mi');
  assert.equal(compactCurrency(770000), 'R$ 770 mil');
  assert.equal(compactCurrency(500), 'R$ 500');
  assert.equal(compactCurrency(1000000), 'R$ 1 mi', 'não deve virar "R$ 1,0 mi"');
  assert.equal(compactCurrency(1500000), 'R$ 1,5 mi', 'a casa decimal informativa tem que ficar');
});

test('compactCurrency preserva zero na parte inteira e trata negativo', () => {
  assert.equal(compactCurrency(500000), 'R$ 500 mil');
  assert.equal(compactCurrency(-2500000), 'R$ -2,5 mi');
  assert.equal(compactCurrency(0), 'R$ 0');
});

test('os créditos só entram na exportação, nunca na tela', () => {
  // Na tela a fonte já está escrita embaixo de cada número; no PNG baixado
  // ela precisa viajar junto.
  assert.equal(theme.credits.enabled, false);
  assert.equal(theme.exporting.chartOptions.credits.enabled, true);
  assert.equal(theme.exporting.chartOptions.credits.text, 'Fonte: 72horas.org');
});

test('o cromo do gráfico é recessivo e os menus estão em português', () => {
  assert.equal(theme.chart.backgroundColor, 'transparent');
  assert.equal(theme.xAxis.lineColor, hairline);
  assert.equal(theme.title.style.color, ink);
  assert.equal(theme.legend.itemStyle.color, inkSoft);
  assert.equal(theme.lang.downloadPNG, 'Baixar em PNG');
  assert.ok(contrast(ink, surface) >= 7, 'o texto do gráfico precisa passar AAA');
  assert.ok(contrast(inkSoft, surface) >= 4.5, 'o texto secundário precisa passar AA');
});
