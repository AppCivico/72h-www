// Backs v-live-text/v-live-html (home.js, registered as 'live-text'/
// 'live-html'). Like the built-in v-text/v-html, except a null/undefined
// bound value is left alone instead of being written out — paired with
// the "live*" formatters (liveNumeral/liveCurrency/livePercent, home.js)
// that return null specifically while mainData hasn't loaded yet, so the
// build-time/SSR figure already sitting in the element (see
// plano-de-execucao.md item 14) stays visible until a real answer
// arrives, instead of blanking out or flashing a zero the instant Vue
// mounts.
function applyIfPresent(el, binding, property) {
  const { value } = binding;
  if (value === null || value === undefined) {
    return;
  }
  // no-param-reassign flags mutating el's properties too, not just
  // reassigning el itself — same alias-the-parameter workaround already
  // used elsewhere in this codebase (e.g. loadCandidateHistory, home.js).
  const target = el;
  target[property] = value;
}

export const liveText = {
  mounted(el, binding) {
    applyIfPresent(el, binding, 'textContent');
  },
  updated(el, binding) {
    applyIfPresent(el, binding, 'textContent');
  },
};

export const liveHtml = {
  mounted(el, binding) {
    applyIfPresent(el, binding, 'innerHTML');
  },
  updated(el, binding) {
    applyIfPresent(el, binding, 'innerHTML');
  },
};
