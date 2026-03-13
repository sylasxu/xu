import { useChatStore } from '../../src/stores/chat'

type FieldType = 'single-select' | 'multi-select' | 'textarea'

interface FormOption {
  label: string
  value: string
}

interface FormField {
  name: string
  label: string
  type: FieldType
  required?: boolean
  options?: FormOption[]
  placeholder?: string
  maxLength?: number
}

interface FormSchema {
  formType?: string
  submitAction?: string
  submitLabel?: string
  fields?: FormField[]
}

interface RenderOption extends FormOption {
  selected: boolean
}

interface RenderField extends Omit<FormField, 'options'> {
  options: RenderOption[]
  value: string
}

interface FormValues {
  rawInput?: string
  activityType?: string
  timeRange?: string
  location?: string
  budgetType?: string
  tags?: string[]
  note?: string
}

interface ComponentData {
  isSubmitting: boolean
  renderFields: RenderField[]
  submitLabel: string
  formValues: FormValues
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) {
    return []
  }

  const fields: FormField[] = []

  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== 'string' || typeof item.label !== 'string' || typeof item.type !== 'string') {
      continue
    }

    const options: FormOption[] = []
    if (Array.isArray(item.options)) {
      for (const option of item.options) {
        if (!isRecord(option) || typeof option.label !== 'string' || typeof option.value !== 'string') {
          continue
        }

        options.push({
          label: option.label,
          value: option.value,
        })
      }
    }

    fields.push({
      name: item.name,
      label: item.label,
      type: item.type as FieldType,
      required: item.required === true,
      options,
      placeholder: typeof item.placeholder === 'string' ? item.placeholder : '',
      maxLength: typeof item.maxLength === 'number' ? item.maxLength : 80,
    })
  }

  return fields
}

function normalizeValues(value: unknown): FormValues {
  if (!isRecord(value)) {
    return {}
  }

  const tags = Array.isArray(value.tags)
    ? value.tags.filter((item): item is string => typeof item === 'string')
    : []

  return {
    rawInput: typeof value.rawInput === 'string' ? value.rawInput : '',
    activityType: typeof value.activityType === 'string' ? value.activityType : '',
    timeRange: typeof value.timeRange === 'string' ? value.timeRange : '',
    location: typeof value.location === 'string' ? value.location : '',
    budgetType: typeof value.budgetType === 'string' ? value.budgetType : '',
    tags,
    note: typeof value.note === 'string' ? value.note : '',
  }
}

function buildRenderFields(fields: FormField[], values: FormValues): RenderField[] {
  return fields.map((field) => {
    const currentValue = field.type === 'multi-select'
      ? ''
      : typeof values[field.name as keyof FormValues] === 'string'
        ? (values[field.name as keyof FormValues] as string)
        : ''

    const selectedTags = Array.isArray(values.tags) ? values.tags : []
    const options = (field.options || []).map((option) => ({
      ...option,
      selected: field.type === 'multi-select'
        ? selectedTags.includes(option.value)
        : currentValue === option.value,
    }))

    return {
      ...field,
      options,
      value: field.type === 'textarea'
        ? (typeof values.note === 'string' ? values.note : '')
        : currentValue,
    }
  })
}

function validateRequired(fields: FormField[], values: FormValues): string | null {
  for (const field of fields) {
    if (!field.required) {
      continue
    }

    if (field.type === 'multi-select') {
      if (!Array.isArray(values.tags) || values.tags.length === 0) {
        return field.label
      }
      continue
    }

    const currentValue = values[field.name as keyof FormValues]
    if (typeof currentValue !== 'string' || !currentValue.trim()) {
      return field.label
    }
  }

  return null
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    title: {
      type: String,
      value: '找搭子偏好',
    },
    schema: {
      type: Object,
      value: {} as FormSchema,
    },
    initialValues: {
      type: Object,
      value: {} as FormValues,
    },
    disabled: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    isSubmitting: false,
    renderFields: [] as RenderField[],
    submitLabel: '开始找搭子',
    formValues: {} as FormValues,
  },

  lifetimes: {
    attached() {
      this.syncFormState()
    },
  },

  observers: {
    'schema, initialValues, disabled': function () {
      this.syncFormState()
    },
  },

  methods: {
    syncFormState() {
      const schema = this.properties.schema as FormSchema
      const fields = normalizeFields(schema.fields)
      const values = normalizeValues(this.properties.initialValues)

      this.setData({
        submitLabel: typeof schema.submitLabel === 'string' && schema.submitLabel.trim()
          ? schema.submitLabel.trim()
          : '开始找搭子',
        formValues: values,
        renderFields: buildRenderFields(fields, values),
        isSubmitting: false,
      })
    },

    onSelectOption(e: WechatMiniprogram.TouchEvent) {
      if (this.properties.disabled || this.data.isSubmitting) {
        return
      }

      const dataset = e.currentTarget.dataset as {
        field?: string
        value?: string
        multi?: boolean | string
      }
      const field = dataset.field || ''
      const value = dataset.value || ''
      const isMulti = dataset.multi === true || dataset.multi === 'true'
      if (!field || !value) {
        return
      }

      const nextValues: FormValues = {
        ...this.data.formValues,
      }
      const fields = normalizeFields((this.properties.schema as FormSchema).fields)

      if (isMulti) {
        const currentTags = Array.isArray(nextValues.tags) ? [...nextValues.tags] : []
        const hasValue = currentTags.includes(value)
        let nextTags = hasValue
          ? currentTags.filter((item) => item !== value)
          : [...currentTags, value]

        if (value === 'NoPreference' && !hasValue) {
          nextTags = ['NoPreference']
        } else if (value !== 'NoPreference') {
          nextTags = nextTags.filter((item) => item !== 'NoPreference')
        }

        nextValues.tags = nextTags
      } else {
        nextValues[field as keyof FormValues] = value as never
      }

      this.setData({
        formValues: nextValues,
        renderFields: buildRenderFields(fields, nextValues),
      })
    },

    onTextInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
      if (this.properties.disabled || this.data.isSubmitting) {
        return
      }

      const dataset = e.currentTarget.dataset as { field?: string }
      const field = dataset.field || ''
      if (!field) {
        return
      }

      const nextValues: FormValues = {
        ...this.data.formValues,
        [field]: e.detail.value,
      }
      const fields = normalizeFields((this.properties.schema as FormSchema).fields)

      this.setData({
        formValues: nextValues,
        renderFields: buildRenderFields(fields, nextValues),
      })
    },

    onSubmit() {
      if (this.properties.disabled || this.data.isSubmitting) {
        return
      }

      const schema = this.properties.schema as FormSchema
      const fields = normalizeFields(schema.fields)
      const values = this.data.formValues
      const missingField = validateRequired(fields, values)
      if (missingField) {
        wx.showToast({
          title: `请先补充${missingField}`,
          icon: 'none',
        })
        return
      }

      this.setData({ isSubmitting: true })
      wx.vibrateShort({ type: 'light' })

      const payload: Record<string, unknown> = {
        ...values,
        tags: Array.isArray(values.tags)
          ? values.tags.filter((item) => item !== 'NoPreference')
          : [],
      }

      this.triggerEvent('submit', { values: payload })

      const chatStore = useChatStore.getState()
      chatStore.sendAction({
        action: typeof schema.submitAction === 'string' && schema.submitAction.trim()
          ? schema.submitAction.trim()
          : 'submit_partner_intent_form',
        payload,
        source: 'widget_partner_intent_form',
        originalText: '提交找搭子偏好',
      })
    },
  },
})
