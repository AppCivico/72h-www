export default {
  name: 'ListBox',
  template: '#list-box-markup',
  inheritAttrs: false,
  props: {
    options: {
      type: Array,
      default: () => [],
    },
    name: {
      type: String,
      default: '',
    },
    labelForEmpty: {
      type: String,
      default: '',
    },
    multiple: {
      type: Boolean,
      default: false,
    },
    required: {
      type: Boolean,
      default: false,
    },
    type: {
      type: String,
      default: 'single_choice',
    },
    modelValue: {
      type: [Array, Number, String],
      default: () => [],
      validator: (value) => !(!Array.isArray(value) && typeof value === 'object'),
    },
  },
  emits: ['update:modelValue'],
  data() {
    return {
      // whether the interaction in flight came from a pointer (see emit)
      pointerUsed: false,
    };
  },
  computed: {
    currentValues({ modelValue = '' } = this) {
      return modelValue && Array.isArray(modelValue)
        ? modelValue.map((x) => String(x))
        : [String(modelValue)];
    },
    normalizedOptions({ options } = this) {
      return options.map((x) => (typeof x === 'object' ? {
        ...x, id: x.id ?? x.value, label: x.label || x.acronym || x.name, value: String(typeof x.value !== 'undefined' ? x.value : x.id),
      } : x)) || [];
    },
    normalizedType({ multiple, options } = this) {
      if (!multiple) {
        if (options.length <= 6) {
          return 'radio';
        }
        return 'select';
      }
      return 'checkbox';
    },
    /**
     * What the collapsed control says: the empty label when nothing is
     * picked, the option's own label for a single pick, a count beyond
     * that — the closed face only needs to show THAT a choice was made.
     */
    summaryText({ currentValues, normalizedOptions, labelForEmpty } = this) {
      const selected = normalizedOptions.filter((option) => {
        const value = typeof option === 'object' ? option.value : String(option);
        return value !== '' && currentValues.includes(String(value));
      });

      if (!selected.length) {
        return labelForEmpty || '';
      }

      if (selected.length === 1) {
        const only = selected[0];
        return typeof only === 'object' ? only.label : String(only);
      }

      const word = window.appDictionary?.selectedCount || 'selecionados';
      return `${selected.length} ${word}`;
    },
    lastSelected({ currentValues, normalizedOptions } = this) {
      let i = normalizedOptions.length - 1;

      while (normalizedOptions[i]) {
        const value = String(normalizedOptions[i]?.value);
        if (currentValues.includes(value)) {
          return value;
        }
        i -= 1;
      }
      return '';
    },
  },
  methods: {
    /**
     * Keeps the DOM in step with the model by hand.
     *
     * The inputs carry `:checked`, but the user has just changed them
     * directly: when the value Vue computes for an input matches what it
     * recorded on the previous render, it skips the patch and the browser's
     * own state stands — which is how "Todos os X" could stay ticked next
     * to individual choices, and how a stale empty value could ride along
     * into the query string.
     */
    syncInputs(values, rootEl) {
      const inputs = rootEl?.querySelectorAll?.('.list-box__input');

      if (!inputs) {
        return;
      }

      inputs.forEach((node) => {
        const input = node;

        input.checked = input.value
          ? values.includes(String(input.value))
          : !values.length;
      });
    },
    emit(e) {
      const { target } = e;
      const { value } = target;
      const { multiple } = this;

      if (!multiple) {
        this.$emit('update:modelValue', value);
        return;
      }

      // Read the checkboxes instead of `currentValues`: the prop still
      // holds the previous render's value when two options are toggled
      // within the same tick (Vue updates asynchronously), which silently
      // dropped the earlier choice. The DOM is what the reader just acted
      // on, so it is the honest source here.
      //
      // The list is reached through the event target rather than `$el`:
      // this in-DOM template has more than one root node, so depending on
      // the build the component mounts as a fragment and `$el` points at a
      // placeholder text node — `querySelectorAll` silently comes back
      // empty and none of this runs.
      const rootEl = target.closest('.list-box');
      const inputs = [...(rootEl?.querySelectorAll('.list-box__input') || [])];

      // An empty value is the "all" option: it clears the selection
      // outright, since the browser leaves the checkboxes alone (a radio
      // only excludes other radios).
      const newValues = value
        ? inputs.filter((input) => input.value && input.checked).map((input) => String(input.value))
        : [];

      this.$emit('update:modelValue', newValues);
      this.$nextTick(() => {
        this.syncInputs(newValues, rootEl);

        // Mouse flow: drop focus after the change so the list closes as
        // soon as the cursor leaves (hover keeps it open meanwhile). With
        // focus retained, :focus-within held the overlay open forever and
        // it sat on top of the Aplicar button — clicks meant for the
        // button landed on list options. Keyboard flow never sets
        // pointerUsed, so focus (and the open list) survives tabbing.
        // Blur whatever actually holds focus: after the patch the focused
        // node may not be the original event target anymore.
        if (this.pointerUsed) {
          const active = document.activeElement;

          if (rootEl && rootEl.contains(active)) {
            active.blur();
          } else {
            target?.blur?.();
          }
          this.pointerUsed = false;
        }
      });
    },
  },
};
