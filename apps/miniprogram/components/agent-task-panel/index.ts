export {}

interface TaskAction {
  kind: 'structured_action' | 'navigate' | 'switch_tab'
  label: string
  action?: string
  payload?: Record<string, unknown>
  source?: string
  originalText?: string
  url?: string
}

interface TaskItem {
  id: string
  taskTypeLabel: string
  stageLabel: string
  headline: string
  summary: string
  activityTitle?: string
  primaryAction?: TaskAction
  secondaryAction?: TaskAction
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readTaskAction(value: unknown): TaskAction | null {
  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.label !== 'string') {
    return null
  }

  if (value.kind !== 'structured_action' && value.kind !== 'navigate' && value.kind !== 'switch_tab') {
    return null
  }

  return {
    kind: value.kind,
    label: value.label,
    ...(typeof value.action === 'string' ? { action: value.action } : {}),
    ...(isRecord(value.payload) ? { payload: value.payload } : {}),
    ...(typeof value.source === 'string' ? { source: value.source } : {}),
    ...(typeof value.originalText === 'string' ? { originalText: value.originalText } : {}),
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
  }
}

function readTaskItem(value: unknown): TaskItem | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.taskTypeLabel !== 'string' ||
    typeof value.stageLabel !== 'string' ||
    typeof value.headline !== 'string' ||
    typeof value.summary !== 'string'
  ) {
    return null
  }

  const primaryAction = readTaskAction(value.primaryAction)
  const secondaryAction = readTaskAction(value.secondaryAction)

  return {
    id: value.id,
    taskTypeLabel: value.taskTypeLabel,
    stageLabel: value.stageLabel,
    headline: value.headline,
    summary: value.summary,
    ...(typeof value.activityTitle === 'string' ? { activityTitle: value.activityTitle } : {}),
    ...(primaryAction ? { primaryAction } : {}),
    ...(secondaryAction ? { secondaryAction } : {}),
  }
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    eyebrow: {
      type: String,
      value: '继续帮你接着办',
    },
    title: {
      type: String,
      value: '刚才那件事，我还在继续推进',
    },
    tasks: {
      type: Array,
      value: [],
    },
    secondaryCount: {
      type: Number,
      value: 0,
    },
  },

  methods: {
    onPrimaryTap(e: WechatMiniprogram.BaseEvent) {
      this.emitAction(e.currentTarget.dataset.taskIndex, 'primary')
    },

    onSecondaryTap(e: WechatMiniprogram.BaseEvent) {
      this.emitAction(e.currentTarget.dataset.taskIndex, 'secondary')
    },

    emitAction(taskIndexValue: unknown, actionRole: 'primary' | 'secondary') {
      const taskIndex = typeof taskIndexValue === 'number' ? taskIndexValue : Number(taskIndexValue)
      if (!Number.isInteger(taskIndex) || taskIndex < 0) {
        return
      }

      const tasks = Array.isArray(this.properties.tasks) ? this.properties.tasks : []
      const task = readTaskItem(tasks[taskIndex])
      if (!task) {
        return
      }

      const action = actionRole === 'primary' ? task.primaryAction : task.secondaryAction
      if (!action) {
        return
      }

      this.triggerEvent('actiontap', {
        taskId: task.id,
        action,
      })
    },
  },
})
