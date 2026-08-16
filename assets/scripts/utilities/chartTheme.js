/**
 * Editorial chart theme.
 *
 * The categorical palette below was validated for colour-vision
 * deficiency (deutan/tritan separation) and for >= 3:1 contrast against
 * the page surface, and is used in a fixed order — never cycled. Colour
 * follows the entity, never its rank.
 */

const SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif";

export const ink = '#1B1723';
export const inkSoft = '#565064';
export const hairline = '#E7E3DA';
export const surface = '#FCFCFB';

/** Fixed categorical order. */
export const categorical = ['#6D28D9', '#00897B', '#B45309', '#1D4ED8', '#C2185B'];

/** Two-tone pairs for binary breakdowns (e.g. gender). */
export const binary = ['#C2185B', '#1D4ED8'];

/**
 * Sequential ramp for "many categories of the same kind" (states,
 * parties, schooling): one hue, light to dark, so magnitude reads off
 * lightness instead of a rainbow.
 */
export function sequentialRamp(steps) {
  const from = { r: 0x4c, g: 0x1d, b: 0x95 };
  const to = { r: 0xd9, g: 0xd2, b: 0xf0 };
  const total = Math.max(steps, 2);
  const out = [];

  for (let i = 0; i < total; i += 1) {
    const t = i / (total - 1);
    const r = Math.round(from.r + (to.r - from.r) * t);
    const g = Math.round(from.g + (to.g - from.g) * t);
    const b = Math.round(from.b + (to.b - from.b) * t);

    out.push(`#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`);
  }

  return out;
}

/**
 * Compact currency for axis ticks and the donut centre, where the full
 * "R$ 2.853.182" would not fit: "R$ 2,85 mi", "R$ 770 mil".
 */
export function compactCurrency(value, digits = 2) {
  const abs = Math.abs(value);
  const br = (n, d) => n.toFixed(d).replace('.', ',');

  if (abs >= 1e9) { return `R$ ${br(value / 1e9, digits)} bi`; }
  if (abs >= 1e6) { return `R$ ${br(value / 1e6, digits)} mi`; }
  if (abs >= 1e3) { return `R$ ${br(value / 1e3, 0)} mil`; }

  return `R$ ${br(value, 0)}`;
}

/** Draws the total in the middle of a donut, editorial style. */
export function renderDonutCenter(chart, valueText, labelText) {
  const target = chart;
  const series = target.series && target.series[0];

  if (!series || !series.center) {
    return;
  }

  const x = target.plotLeft + series.center[0];
  const y = target.plotTop + series.center[1];

  if (target.centerValue) { target.centerValue.destroy(); }
  if (target.centerLabel) { target.centerLabel.destroy(); }

  target.centerValue = target.renderer
    .text(valueText, x, y + 2)
    .attr({ 'text-anchor': 'middle', zIndex: 5 })
    .css({
      fontFamily: SERIF, fontSize: '17px', fontWeight: '600', color: ink,
    })
    .add();

  target.centerLabel = target.renderer
    .text(labelText, x, y + 22)
    .attr({ 'text-anchor': 'middle', zIndex: 5 })
    .css({ fontFamily: SANS, fontSize: '12px', color: inkSoft })
    .add();
}

/** Global Highcharts options — recessive chrome, editorial type. */
export default {
  colors: categorical,
  chart: {
    backgroundColor: 'transparent',
    spacing: [8, 8, 12, 8],
    style: { fontFamily: SANS },
  },
  title: {
    align: 'left',
    margin: 4,
    style: {
      fontFamily: SERIF, fontSize: '20px', fontWeight: '600', color: ink,
    },
  },
  subtitle: {
    align: 'left',
    style: { fontFamily: SANS, fontSize: '13px', color: inkSoft },
  },
  xAxis: {
    lineColor: hairline,
    tickColor: hairline,
    labels: { style: { fontSize: '12px', color: inkSoft } },
    title: { style: { fontSize: '12px', color: inkSoft } },
  },
  yAxis: {
    gridLineColor: hairline,
    gridLineDashStyle: 'Dash',
    labels: { style: { fontSize: '12px', color: inkSoft } },
    title: { style: { fontSize: '12px', color: inkSoft } },
  },
  legend: {
    align: 'left',
    verticalAlign: 'bottom',
    margin: 16,
    symbolRadius: 3,
    symbolHeight: 10,
    symbolWidth: 10,
    itemStyle: { fontSize: '13px', fontWeight: '500', color: inkSoft },
    itemHoverStyle: { color: ink },
  },
  tooltip: {
    backgroundColor: '#211D2B',
    borderWidth: 0,
    borderRadius: 10,
    shadow: false,
    padding: 12,
    useHTML: true,
    style: { color: '#F3F0F9', fontSize: '13px' },
  },
  plotOptions: {
    series: { animation: { duration: 450 } },
    pie: {
      borderWidth: 2,
      borderColor: surface,
      dataLabels: {
        connectorColor: hairline,
        connectorWidth: 1,
        distance: 14,
        style: {
          fontFamily: SANS, fontSize: '12px', fontWeight: '600', color: inkSoft, textOutline: 'none',
        },
      },
    },
    column: {
      borderWidth: 0,
      borderRadius: 4,
      groupPadding: 0.08,
    },
    line: { lineWidth: 2.5 },
    spline: { lineWidth: 2.5 },
  },
  credits: { enabled: false },
  lang: {
    viewFullscreen: 'Ver em tela cheia',
    printChart: 'Imprimir gráfico',
    downloadPNG: 'Baixar em PNG',
    downloadJPEG: 'Baixar em JPG',
    downloadPDF: 'Baixar em PDF',
    downloadSVG: 'Baixar em SVG',
    resetZoom: 'Resetar zoom',
    loading: 'Carregando...',
  },
  navigation: {
    buttonOptions: {
      symbolStroke: inkSoft,
      theme: { fill: 'transparent' },
    },
    menuItemStyle: { fontSize: '13px' },
  },
  exporting: {
    buttons: {
      contextButton: {
        menuItems: [
          'viewFullscreen',
          'printChart',
          'separator',
          'downloadPNG',
          'downloadJPEG',
          'downloadPDF',
          'downloadSVG',
        ],
      },
    },
  },
};
