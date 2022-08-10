export default {
  name: 'ListBox',
  template: "#list-box-markup",
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
      default: 'multiple_choice',
    },
    value: {
      type: [Array, Number, String],
      default: () => [],
      validator: (value) => !(!Array.isArray(value) && typeof value === 'object'),
    },
  },
  computed: {
    currentValues({ value = '' } = this) {
      return value && Array.isArray(value)
        ? value.map((x) => String(x))
        : [String(value)];
    },
    normalizedOptions({ options } = this) {
      return options.map((x) => { return typeof x === 'object' ? {...x, id: x.id || x.value, label: x.label || x.acronym || x.name, value: String(x.value || x.id) } : x}) || [];
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
    lastSelected({ currentValues = [], normalizedOptions = [] } = this) {
      let i = normalizedOptions.length - 1;

      while (normalizedOptions[i]) {
        const value = String(normalizedOptions[i]?.value);
        if (currentValues.includes(value)) {
          return value;
        }
        i -= 1;
      }
      return ''
    }
  },
  methods: {
    emit(e) {
      const { value } = e.target;
      const { multiple = false, currentValues = [] } = this;

      console.debug('e', e);
      console.debug('e.target', e.target);
      console.debug('e.currentTarget', e.currentTarget);

      if (multiple) {
        let newValues = [];
        if (value) {
          newValues = e.target.checked
            ? currentValues.concat([value])
            // eslint-disable-next-line eqeqeq
            : currentValues.filter((x) => x != value);
        }
        this.$emit('input', newValues);
      } else {
        this.$emit('input', value);
      }
    },
  },
};
