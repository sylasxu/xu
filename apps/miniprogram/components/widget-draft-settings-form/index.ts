import { useChatStore } from '../../src/stores/chat'

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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
    const currentValue = toStringValue(values[field.name as keyof FormValues])

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

    const currentValue = toStringValue(values[field.name as keyof FormValues])
    if (!currentValue.trim()) {
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
      value: '调整活动草稿',
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
    submitLabel: '保存草稿设置',
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

      const dataset = e.currentTarget.dataset as {
        field?: string
        value?: string
      }
      const field = dataset.field || ''
      const value = dataset.value || ''
      if (!field || !value) {
        return
      }

      const nextValues: FormValues = {
        ...this.data.formValues,
        [field]: value,
      }
      const fields = normalizeFields((this.properties.schema as FormSchema).fields)

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
      }

      this.triggerEvent('submit', { values: payload })

      const chatStore = useChatStore.getState()
      chatStore.sendAction({
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
