export {}

type FieldType = 'single-select' | 'textarea'

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
  activityId?: string
  title?: string
  type?: string
  field?: string
  locationName?: string
  locationHint?: string
  slot?: string
  maxParticipants?: string
  startAt?: string
  lat?: number
  lng?: number
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
    case 'textarea':
      return value
    default:
      return null
  }
}

function readFormValueKey(value: string): FormValueKey | null {
  switch (value) {
    case 'activityId':
    case 'title':
    case 'type':
    case 'field':
    case 'locationName':
    case 'locationHint':
    case 'slot':
    case 'maxParticipants':
    case 'startAt':
    case 'lat':
    case 'lng':
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
    case 'activityId':
      return { ...values, activityId: value }
    case 'title':
      return { ...values, title: value }
    case 'type':
      return { ...values, type: value }
    case 'field':
      return { ...values, field: value }
    case 'locationName':
      return { ...values, locationName: value }
    case 'locationHint':
      return { ...values, locationHint: value }
    case 'slot':
      return { ...values, slot: value }
    case 'maxParticipants':
      return { ...values, maxParticipants: value }
    case 'startAt':
      return { ...values, startAt: value }
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

function readFieldSelection(value: unknown): { field: string; value: string } | null {
  if (!isRecord(value)) {
    return null
  }

  const field = typeof value.field === 'string' ? value.field : ''
  const selectedValue = typeof value.value === 'string' ? value.value : ''
  if (!field || !selectedValue) {
    return null
  }

  return {
    field,
    value: selectedValue,
  }
}

function readFieldName(value: unknown): string {
  return isRecord(value) && typeof value.field === 'string' ? value.field : ''
}

function toStringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  return fallback
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
      maxLength: typeof item.maxLength === 'number' ? item.maxLength : 60,
    })
  }

  return fields
}

function normalizeValues(value: unknown): FormValues {
  if (!isRecord(value)) {
    return {}
  }

  return {
    activityId: toStringValue(value.activityId),
    title: toStringValue(value.title),
    type: toStringValue(value.type),
    field: toStringValue(value.field),
    locationName: toStringValue(value.locationName),
    locationHint: toStringValue(value.locationHint),
    slot: toStringValue(value.slot),
    maxParticipants: toStringValue(value.maxParticipants),
    startAt: toStringValue(value.startAt),
    lat: typeof value.lat === 'number' ? value.lat : undefined,
    lng: typeof value.lng === 'number' ? value.lng : undefined,
  }
}

function buildRenderFields(fields: FormField[], values: FormValues): RenderField[] {
  return fields.map((field) => {
    const currentValue = readFormTextValue(values, field.name)

    return {
      ...field,
      options: (field.options || []).map((option) => ({
        ...option,
        selected: currentValue === option.value,
      })),
      value: currentValue,
    }
  })
}

function validateRequired(fields: FormField[], values: FormValues): string | null {
  for (const field of fields) {
    if (!field.required) {
      continue
    }

    const currentValue = readFormTextValue(values, field.name)
    if (!currentValue.trim()) {
      return field.label
    }
  }

  return null
}

const INITIAL_COMPONENT_DATA: ComponentData = {
  isSubmitting: false,
  renderFields: [],
  submitLabel: '保存草稿设置',
  formValues: {},
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    title: {
      type: String,
      value: '调整活动草稿',
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
          : '保存草稿设置',
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

      const nextValues = writeFormTextValue(this.data.formValues, selection.field, selection.value)
      const schema = readFormSchema(this.properties.schema)
      const fields = schema.fields ?? []

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
      }

      this.triggerEvent('submit', { values: payload })

      this.triggerEvent('actiontap', {
        action: typeof schema.submitAction === 'string' && schema.submitAction.trim()
          ? schema.submitAction.trim()
          : 'save_draft_settings',
        payload,
        source: 'widget_draft_settings_form',
        originalText: '保存草稿设置',
      })
    },
  },
})
