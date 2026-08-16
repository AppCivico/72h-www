/**
 * Rich tooltips for `[data-tooltip]` elements.
 *
 * Uses event delegation on `document`, so it keeps working even after Vue
 * re-renders the DOM it was attached to (the home page mounts Vue over
 * server-rendered markup). One shared bubble element is appended to
 * `<body>` and repositioned per target.
 */

const HIDE_DELAY = 160;

let bubble = null;
let hideTimer = null;

function hide() {
  if (bubble) {
    bubble.hidden = true;
  }
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, HIDE_DELAY);
}

function ensureBubble() {
  if (bubble) {
    return bubble;
  }

  bubble = document.createElement('div');
  bubble.className = 'tooltip-bubble';
  bubble.setAttribute('role', 'tooltip');
  bubble.hidden = true;
  document.body.appendChild(bubble);

  bubble.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  bubble.addEventListener('mouseleave', scheduleHide);

  return bubble;
}

function place(target) {
  const rect = target.getBoundingClientRect();
  const margin = 10;
  const viewportWidth = document.documentElement.clientWidth;

  bubble.classList.remove('tooltip-bubble--above');

  let left = rect.left + window.scrollX - 24;
  left = Math.min(
    Math.max(left, window.scrollX + 12),
    window.scrollX + viewportWidth - bubble.offsetWidth - 12,
  );

  bubble.style.left = `${left}px`;
  bubble.style.top = `${rect.bottom + window.scrollY + margin}px`;

  const bubbleRect = bubble.getBoundingClientRect();

  if (bubbleRect.bottom > window.innerHeight - 8) {
    bubble.classList.add('tooltip-bubble--above');
    bubble.style.top = `${rect.top + window.scrollY - bubble.offsetHeight - margin}px`;
  }
}

function show(target) {
  const text = target.getAttribute('data-tooltip');

  if (!text) {
    return;
  }

  clearTimeout(hideTimer);
  ensureBubble();
  bubble.textContent = text;
  bubble.hidden = false;
  bubble.style.left = '0px';
  bubble.style.top = '-9999px';

  window.requestAnimationFrame(() => place(target));
}

export default function watchTooltips() {
  document.addEventListener('mouseover', (event) => {
    const target = event.target.closest('[data-tooltip]');

    if (target) {
      show(target);
    }
  });

  document.addEventListener('mouseout', (event) => {
    if (event.target.closest('[data-tooltip]')) {
      scheduleHide();
    }
  });

  document.addEventListener('focusin', (event) => {
    const target = event.target.closest('[data-tooltip]');

    if (target) {
      show(target);
    }
  });

  document.addEventListener('focusout', (event) => {
    if (event.target.closest('[data-tooltip]')) {
      scheduleHide();
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-tooltip]');

    if (target) {
      event.preventDefault();
      show(target);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hide();
    }
  });

  window.addEventListener('scroll', hide, { passive: true });
}
