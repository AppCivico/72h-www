export default {
  name: 'Choice',
  template: "#choice-markup",
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
    currentValues({ value } = this) {
      if (Array.isArray(value)) {
        return value.map((x) => (x ? String(x) : x));
      } else if (typeof value === 'object') {
        return value.map((x) => (x ? String(x) : x));
      }
      return [(value ? String(value) : value)];
    },
    normalizedOptions({ options } = this) {
      return options.map((x) => { return typeof x === 'object' ? {...x, id: x.id || x.value, label: x.label || x.acronym || x.name, value: x.value || x.id } : x});
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
    lastSelected({ currentValues, normalizedOptions } = this) {
      return !currentValues.length
        ? ''
        : normalizedOptions.findLast((x) => currentValues.includes(String(x.value)))?.value;
    }
  },
  methods: {
    emit(e) {
      const { value } = e.target;
      const { multiple = false, currentValues = [] } = this;

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
