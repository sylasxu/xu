import type { StructuredPendingAction } from '../../src/stores/app'

type AuthMode = 'login' | 'bind_phone'

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    message: {
      type: String,
      value: '',
    },
    mode: {
      type: String,
      value: 'login',
    },
    pendingAction: {
      type: Object,
      value: {},
    },
  },

  methods: {
    onContinue() {
      const properties = this.properties as unknown as {
        pendingAction?: StructuredPendingAction
        mode?: string
      }
      const pendingAction = properties.pendingAction || null
      if (!pendingAction) {
        return
      }

      const mode = properties.mode === 'bind_phone' ? 'bind_phone' : 'login'
      this.triggerEvent('continue', {
        pendingAction: {
          ...pendingAction,
          authMode: mode as AuthMode,
        },
      })
    },
  },
})
