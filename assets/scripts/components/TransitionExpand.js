/* global Vue */

/**
 * @author Markus Oberlehner
 * @see https://markus.oberlehner.net/blog/transition-to-height-auto-with-vue/
 */

function TransitionExpand(props, { slots }) {
  return Vue.h(Vue.Transition, {
    name: 'expand',

    onAfterEnter(element) {
      // eslint-disable-next-line no-param-reassign
      element.style.height = 'auto';
    },

    onEnter(element) {
      const { width } = getComputedStyle(element);

      /* eslint-disable no-param-reassign */
      element.style.width = width;
      element.style.position = 'absolute';
      element.style.visibility = 'hidden';
      element.style.height = 'auto';
      /* eslint-enable */

      const { height } = getComputedStyle(element);

      /* eslint-disable no-param-reassign */
      element.style.width = null;
      element.style.position = null;
      element.style.visibility = null;
      element.style.height = 0;
      /* eslint-enable */

      // Force repaint to make sure the
      // animation is triggered correctly.
      // eslint-disable-next-line no-unused-expressions
      getComputedStyle(element).height;

      setTimeout(() => {
        // eslint-disable-next-line no-param-reassign
        element.style.height = height;
      });
    },

    onLeave(element) {
      const { height } = getComputedStyle(element);

      // eslint-disable-next-line no-param-reassign
      element.style.height = height;

      // Force repaint to make sure the
      // animation is triggered correctly.
      // eslint-disable-next-line no-unused-expressions
      getComputedStyle(element).height;

      setTimeout(() => {
        // eslint-disable-next-line no-param-reassign
        element.style.height = 0;
      });
    },
  }, slots.default);
}

export default TransitionExpand;
