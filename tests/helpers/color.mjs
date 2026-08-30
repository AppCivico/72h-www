/**
 * Contraste WCAG e simulação de daltonismo (Viénot et al. 1999), para os
 * testes que verificam a promessa da paleta: "CVD-safe e >= 3:1 contra a
 * superfície". Sem isso a checagem de cor vira opinião.
 */
const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * (c ** (1 / 2.4)) - 0.055);

export const luminance = (hex) => {
  const [r, g, b] = channels(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

export const contrast = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export const lab = (hex) => {
  const [r, g, b] = channels(hex).map(toLinear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};

/** Distância perceptual CIE76: abaixo de ~10 duas cores lidas juntas confundem. */
export const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

const MATRICES = {
  deutan: [[0.625, 0.7, 0], [0.7, 0.3, 0], [0, 0, 1]],
  protan: [[0.1115, 0.8858, 0], [0.1115, 0.8858, 0], [0.004, -0.0041, 1]],
  tritan: [[1, 0.1273, -0.1273], [0, 1, 0], [0, -0.4413, 1.4413]],
};

export const simulate = (hex, type) => {
  if (type === 'normal') return hex;
  const linear = channels(hex).map(toLinear);
  return `#${MATRICES[type]
    .map((row) => row.reduce((sum, k, i) => sum + k * linear[i], 0))
    .map((c) => Math.round(toGamma(Math.min(1, Math.max(0, c))) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
};

export const VISIONS = ['normal', 'deutan', 'protan', 'tritan'];
