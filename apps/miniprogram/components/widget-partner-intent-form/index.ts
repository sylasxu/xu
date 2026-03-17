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

type FormValueKey = keyof FormValues

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readFieldType(value: unknown): FieldType | null {
  switch (value) {
    case 'single-select':
    case 'multi-select':
    case 'textarea':
      return value
    default:
      return null
  }
}

function readFormValueKey(value: string): FormValueKey | null {
  switch (value) {
    case 'rawInput':
    case 'activityType':
    case 'timeRange':
    case 'location':
    case 'budgetType':
    case 'tags':
    case 'note':
      return value
    default:
      return null
  }
}

function readFormTextValue(values: FormValues, fieldName: string): string {
  const key = readFormValueKey(fieldName)
  if (!key) {
    return ''
  }

  const value = values[key]
  return typeof value === 'string' ? value : ''
}

function writeFormTextValue(values: FormValues, fieldName: string, value: string): FormValues {
  switch (fieldName) {
    case 'rawInput':
      return { ...values, rawInput: value }
    case 'activityType':
      return { ...values, activityType: value }
    case 'timeRange':
      return { ...values, timeRange: value }
    case 'location':
      return { ...values, location: value }
    case 'budgetType':
      return { ...values, budgetType: value }
    case 'note':
      return { ...values, note: value }
    default:
      return values
  }
}

function readFormSchema(value: unknown): FormSchema {
  if (!isRecord(value)) {
    return {}
  }

  return {
    formType: typeof value.formType === 'string' ? value.formType : undefined,
    submitAction: typeof value.submitAction === 'string' ? value.submitAction : undefined,
    submitLabel: typeof value.submitLabel === 'string' ? value.submitLabel : undefined,
    fields: normalizeFields(value.fields),
  }
}

function readFieldSelection(value: unknown): { field: string; value: string; isMulti: boolean } | null {
  if (!isRecord(value)) {
    return null
  }

  const field = typeof value.field === 'string' ? value.field : ''
  const selectedValue = typeof value.value === 'string' ? value.value : ''
  const isMulti = value.multi === true || value.multi === 'true'
  if (!field || !selectedValue) {
    return null
  }

  return {
    field,
    value: selectedValue,
    isMulti,
  }
}

function readFieldName(value: unknown): string {
  return isRecord(value) && typeof value.field === 'string' ? value.field : ''
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

    const type = readFieldType(item.type)
    if (!type) {
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
      type,
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
      : readFormTextValue(values, field.name)

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

    const currentValue = readFormTextValue(values, field.name)
    if (typeof currentValue !== 'string' || !currentValue.trim()) {
      return field.label
    }
  }

  return null
}

const INITIAL_COMPONENT_DATA: ComponentData = {
  isSubmitting: false,
  renderFields: [],
  submitLabel: '开始找搭子',
  formValues: {},
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
      value: {},
    },
    initialValues: {
      type: Object,
      value: {},
    },
    disabled: {
      type: Boolean,
      value: false,
    },
  },

  data: INITIAL_COMPONENT_DATA,

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
      const schema = readFormSchema(this.properties.schema)
      const fields = schema.fields ?? []
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

      const selection = readFieldSelection(e.currentTarget.dataset)
      if (!selection) {
        return
      }

      const nextValues: FormValues = {
        ...this.data.formValues,
      }
      const schema = readFormSchema(this.properties.schema)
      const fields = schema.fields ?? []

      if (selection.isMulti) {
        const currentTags = Array.isArray(nextValues.tags) ? [...nextValues.tags] : []
        const hasValue = currentTags.includes(selection.value)
        let nextTags = hasValue
          ? currentTags.filter((item) => item !== selection.value)
          : [...currentTags, selection.value]

        if (selection.value === 'NoPreference' && !hasValue) {
          nextTags = ['NoPreference']
        } else if (selection.value !== 'NoPreference') {
          nextTags = nextTags.filter((item) => item !== 'NoPreference')
        }

        nextValues.tags = nextTags
      } else {
        Object.assign(nextValues, writeFormTextValue(nextValues, selection.field, selection.value))
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

      const field = readFieldName(e.currentTarget.dataset)
      if (!field) {
        return
      }

      const nextValues = writeFormTextValue(this.data.formValues, field, e.detail.value)
      const schema = readFormSchema(this.properties.schema)
      const fields = schema.fields ?? []

      this.setData({
        formValues: nextValues,
        renderFields: buildRenderFields(fields, nextValues),
      })
    },

    onSubmit() {
      if (this.properties.disabled || this.data.isSubmitting) {
        return
      }

      const schema = readFormSchema(this.properties.schema)
      const fields = schema.fields ?? []
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
