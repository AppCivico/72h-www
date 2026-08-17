/**
 * Folds the masthead's tagline away on the first scroll.
 *
 * The phrase greets whoever arrives at the top of the page, then gets out
 * of the way — the masthead is sticky, so leaving it open would cost a
 * band of every screen for the rest of the visit.
 */

const CONDENSE_AFTER = 24;

export default function watchHeaderCondense() {
  const header = document.querySelector('.main-header');

  if (!header) {
    return;
  }

  let queued = false;

  const apply = () => {
    queued = false;
    header.classList.toggle('is-condensed', window.scrollY > CONDENSE_AFTER);
  };

  // Runs once up front: a reload halfway down the page should not start
  // with the strip open only to collapse it on the next scroll event.
  apply();

  window.addEventListener('scroll', () => {
    if (queued) {
      return;
    }

    queued = true;
    window.requestAnimationFrame(apply);
  }, { passive: true });
}
