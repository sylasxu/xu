import { useChatStore } from '../../src/stores/chat'

interface ActionChipItem {
  label: string
  action: string
  params?: Record<string, unknown>
}

interface ComponentData {
  isSubmitting: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function readActionChipItem(value: unknown): ActionChipItem | null {
  if (!isRecord(value)) {
    return null
  }

  const label = readString(value.label)
  const action = readString(value.action)
  if (!label || !action) {
    return null
  }

  return {
    label,
    action,
    ...(isRecord(value.params) ? { params: value.params } : {}),
  }
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    items: {
      type: Array,
      value: [],
    },
    disabled: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    isSubmitting: false,
  } as ComponentData,

  observers: {
    disabled(disabled: boolean) {
      if (!disabled && this.data.isSubmitting) {
        this.setData({ isSubmitting: false })
      }
    },
  },

  methods: {
    onTap(e: WechatMiniprogram.TouchEvent) {
      if (this.properties.disabled || this.data.isSubmitting) {
        return
      }

      const item = readActionChipItem(e.currentTarget.dataset?.item)
      if (!item) {
        return
      }

      this.setData({ isSubmitting: true })
      wx.vibrateShort({ type: 'light' })

      useChatStore.getState().sendAction({
        action: item.action,
        payload: item.params || {},
        source: 'widget_action_chips',
        originalText: item.label,
      })
    },
  },
})
