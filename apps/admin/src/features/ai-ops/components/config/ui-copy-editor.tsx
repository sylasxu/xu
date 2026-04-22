import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, History, Loader2, Plus, Save, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useAiConfigDetail, useUpdateAiConfig } from '../../hooks/use-ai-config'

interface Props {
  onSelectConfig: (key: string | null) => void
}

type PathField = {
  kind: 'text' | 'textarea'
  path: string
  label: string
  placeholder?: string
  description?: string
  wide?: boolean
}

type FieldsSection = {
  kind: 'fields'
  title: string
  description?: string
  fields: PathField[]
}

type StringListSection = {
  kind: 'string-list'
  title: string
  description?: string
  path: string
  itemLabel: string
  addLabel: string
  placeholder?: string
}

type ObjectListSection = {
  kind: 'object-list'
  title: string
  description?: string
  path: string
  addLabel: string
  itemTitle: string
  createItem: () => Record<string, string>
  fields: Array<{
    key: string
    label: string
    placeholder?: string
    multiline?: boolean
  }>
}

type SectionDef = FieldsSection | StringListSection | ObjectListSection

type ConfigFormDef = {
  key: string
  label: string
  description: string
  sections: SectionDef[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneConfig(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {}
  }

  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

function readPathValue(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (isRecord(current) && segment in current) {
      return current[segment]
    }

    return undefined
  }, source)
}

function writePathValue(source: Record<string, unknown>, path: string, nextValue: unknown): Record<string, unknown> {
  const segments = path.split('.')
  const nextSource = cloneConfig(source)
  let cursor: Record<string, unknown> = nextSource

  for (const [index, segment] of segments.entries()) {
    const isLast = index === segments.length - 1
    if (isLast) {
      cursor[segment] = nextValue
      continue
    }

    const current = cursor[segment]
    if (!isRecord(current)) {
      cursor[segment] = {}
    }
    cursor = cursor[segment] as Record<string, unknown>
  }

  return nextSource
}

function readStringValue(source: Record<string, unknown>, path: string): string {
  const value = readPathValue(source, path)
  return typeof value === 'string' ? value : ''
}

function readStringArray(source: Record<string, unknown>, path: string): string[] {
  const value = readPathValue(source, path)
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) => (typeof item === 'string' ? item : ''))
}

function readObjectArray(source: Record<string, unknown>, path: string): Record<string, unknown>[] {
  const value = readPathValue(source, path)
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((item) => (isRecord(item) ? item : {}))
}

function getSectionKey(configKey: string, sectionTitle: string): string {
  return `${configKey}:${sectionTitle}`
}

function buildDefaultOpenState(config: ConfigFormDef): Record<string, boolean> {
  return config.sections.reduce<Record<string, boolean>>((state, section, index) => {
    const sectionKey = getSectionKey(config.key, section.title)
    state[sectionKey] = config.key === 'welcome.ui' ? index < 3 : true
    return state
  }, {})
}

function getSectionItemCount(section: SectionDef, configValue: Record<string, unknown>): number | null {
  if (section.kind === 'fields') {
    return section.fields.length
  }

  if (section.kind === 'string-list') {
    return readStringArray(configValue, section.path).length
  }

  return readObjectArray(configValue, section.path).length
}

const UI_CONFIGS: readonly ConfigFormDef[] = [
  {
    key: 'welcome.ui',
    label: 'Welcome',
    description: '欢迎区、快捷问题、输入框与 chat shell 文案。',
    sections: [
      {
        kind: 'fields',
        title: '主舞台',
        fields: [
          { kind: 'text', path: 'composerPlaceholder', label: '输入框占位' },
          { kind: 'text', path: 'composerPlaceholder', label: '输入框占位', description: '用户一进来还没发消息时，输入框里展示的那句引导。' },
          { kind: 'text', path: 'sectionTitles.suggestions', label: '快捷问题标题', description: '欢迎区快捷问题分组标题。' },
          { kind: 'text', path: 'sectionTitles.explore', label: '附近探索标题', description: '附近探索分组标题。' },
          { kind: 'text', path: 'exploreTemplates.label', label: '探索卡标签', description: '展示给用户看的探索按钮文案。' },
          { kind: 'textarea', path: 'exploreTemplates.prompt', label: '探索卡 prompt', description: '点探索卡后实际发给 xu 的内容。', wide: true },
        ],
      },
      {
        kind: 'object-list',
        title: '快捷问题',
        description: '首页欢迎区直接可点的问题列表。',
        path: 'quickPrompts',
        addLabel: '新增快捷问题',
        itemTitle: '问题',
        createItem: () => ({ icon: '', text: '', prompt: '' }),
        fields: [
          { key: 'icon', label: '图标', placeholder: '🗓️' },
          { key: 'text', label: '展示文案', placeholder: '周末附近有什么活动？' },
          { key: 'prompt', label: '发送内容', placeholder: '周末附近有什么活动', multiline: true },
        ],
      },
      {
        kind: 'object-list',
        title: '推荐入口',
        description: '首页推荐按钮，适合新手冷启动。',
        path: 'suggestionItems',
        addLabel: '新增推荐入口',
        itemTitle: '入口',
        createItem: () => ({ icon: '', label: '', prompt: '' }),
        fields: [
          { key: 'icon', label: '图标', placeholder: '🍜' },
          { key: 'label', label: '按钮文案', placeholder: '约饭局' },
          { key: 'prompt', label: '发送内容', placeholder: '帮我组一个吃饭的局', multiline: true },
        ],
      },
      {
        kind: 'string-list',
        title: '底部快捷动作',
        description: '输入框上方的轻量入口文案。',
        path: 'bottomQuickActions',
        itemLabel: '动作',
        addLabel: '新增动作',
      },
      {
        kind: 'fields',
        title: '画像提示',
        fields: [
          { kind: 'text', path: 'profileHints.low', label: '低完成度提示', description: '适合刚开始使用、画像信息很少的时候。' },
          { kind: 'text', path: 'profileHints.medium', label: '中完成度提示', description: '适合聊过几轮，但还没很稳定的时候。' },
          { kind: 'text', path: 'profileHints.high', label: '高完成度提示', description: '适合偏好已经比较清楚时。' },
        ],
      },
      {
        kind: 'fields',
        title: '对话壳层',
        fields: [
          { kind: 'text', path: 'chatShell.composerHint', label: '输入辅助提示', description: '输入框附近的轻提示，不要太长。', wide: true },
          { kind: 'text', path: 'chatShell.pendingActionTitle', label: '待恢复动作标题', description: '出现动作闸门时卡片的标题。' },
          { kind: 'textarea', path: 'chatShell.pendingActionDefaultMessage', label: '待恢复默认说明', description: '动作被挂起后，默认向用户解释当前状态。', wide: true },
          { kind: 'textarea', path: 'chatShell.pendingActionLoginHint', label: '登录后提示', description: '需要登录才能继续时显示。', wide: true },
          { kind: 'textarea', path: 'chatShell.pendingActionBindPhoneHint', label: '绑定手机号后提示', description: '需要补手机号时显示。', wide: true },
          { kind: 'text', path: 'chatShell.pendingActionResumeLabel', label: '恢复按钮文案', description: '用户完成闸门后点击继续的按钮。' },
        ],
      },
      {
        kind: 'fields',
        title: '运行时状态',
        fields: [
          { kind: 'text', path: 'chatShell.runtimeStatus.networkOfflineText', label: '断网提示', description: '顶部网络断开提醒。' },
          { kind: 'text', path: 'chatShell.runtimeStatus.networkRetryText', label: '重试按钮', description: '网络断开卡片上的重试按钮。' },
          { kind: 'text', path: 'chatShell.runtimeStatus.networkRestoredToast', label: '恢复 toast', description: '网络重新可用时的轻提示。' },
          { kind: 'text', path: 'chatShell.runtimeStatus.widgetErrorMessage', label: 'Widget 错误文案', description: '聊天卡片渲染失败时的默认提示。' },
          { kind: 'text', path: 'chatShell.runtimeStatus.widgetErrorRetryText', label: 'Widget 重试按钮', description: '错误卡片上的重试按钮。' },
        ],
      },
      {
        kind: 'fields',
        title: '侧边栏',
        fields: [
          { kind: 'text', path: 'sidebar.title', label: '标题', description: '侧边栏顶部品牌名称。' },
          { kind: 'text', path: 'sidebar.authSubtitle', label: '已登录副标题', description: '登录用户看到的承接语气。', wide: true },
          { kind: 'text', path: 'sidebar.visitorSubtitle', label: '访客副标题', description: '访客模式下的轻说明。', wide: true },
          { kind: 'text', path: 'sidebar.messageCenterLabel', label: '消息中心标题' },
          { kind: 'text', path: 'sidebar.messageCenterHint', label: '消息中心提示', description: '标题旁边的简短提示。' },
          { kind: 'textarea', path: 'sidebar.authContinuationHint', label: '已登录承接说明', description: '解释 xu 会如何继续接住后续进展。', wide: true },
          { kind: 'text', path: 'sidebar.historyTitle', label: '历史会话标题' },
          { kind: 'text', path: 'sidebar.historyDescriptionAuthenticated', label: '已登录历史说明', wide: true },
          { kind: 'text', path: 'sidebar.historyDescriptionVisitor', label: '访客历史说明', wide: true },
          { kind: 'text', path: 'sidebar.searchPlaceholder', label: '搜索占位' },
          { kind: 'textarea', path: 'sidebar.visitorHistoryHint', label: '访客记录说明', wide: true },
          { kind: 'text', path: 'sidebar.emptySearchResult', label: '搜索空状态' },
          { kind: 'text', path: 'sidebar.emptyHistory', label: '历史空状态' },
          { kind: 'textarea', path: 'sidebar.composerCapabilityHint', label: '输入能力提示', description: '说明当前仅支持文本输入等能力边界。', wide: true },
        ],
      },
    ],
  },
  {
    key: 'ui.message_center',
    label: '消息中心',
    description: '消息中心标题、空状态、动作按钮与失败提示。',
    sections: [
      {
        kind: 'fields',
        title: '基础文案',
        fields: [
          { kind: 'text', path: 'title', label: '标题' },
          { kind: 'text', path: 'description', label: '副标题', wide: true },
          { kind: 'text', path: 'visitorTitle', label: '访客标题' },
          { kind: 'text', path: 'visitorDescription', label: '访客说明', wide: true },
          { kind: 'text', path: 'summaryTitle', label: '摘要标题' },
          { kind: 'text', path: 'actionInboxSectionTitle', label: '待处理分区标题' },
          { kind: 'textarea', path: 'actionInboxDescription', label: '待处理分区说明', wide: true },
          { kind: 'text', path: 'actionInboxEmpty', label: '待处理空状态', wide: true },
          { kind: 'text', path: 'pendingMatchesTitle', label: '待确认分区标题' },
          { kind: 'text', path: 'pendingMatchesEmpty', label: '待确认空状态', wide: true },
        ],
      },
      {
        kind: 'fields',
        title: '动作与错误',
        fields: [
          { kind: 'text', path: 'requestAuthHint', label: '未登录查看提示', description: '未登录时打开消息中心展示。' },
          { kind: 'text', path: 'loadFailedText', label: '加载失败提示' },
          { kind: 'text', path: 'markReadSuccess', label: '已读成功提示' },
          { kind: 'text', path: 'markReadFailed', label: '已读失败提示' },
          { kind: 'text', path: 'pendingDetailAuthHint', label: '详情未登录提示' },
          { kind: 'text', path: 'pendingDetailLoadFailed', label: '详情加载失败' },
          { kind: 'text', path: 'actionFailed', label: '操作失败提示' },
          { kind: 'text', path: 'followUpFailed', label: '跟进失败提示' },
          { kind: 'text', path: 'refreshLabel', label: '刷新按钮说明', description: '按钮 aria 与提示共用。' },
        ],
      },
      {
        kind: 'fields',
        title: '系统跟进与群聊摘要',
        fields: [
          { kind: 'text', path: 'systemSectionTitle', label: '系统跟进标题' },
          { kind: 'text', path: 'systemEmpty', label: '系统空状态', wide: true },
          { kind: 'text', path: 'feedbackPositiveLabel', label: '正向反馈按钮' },
          { kind: 'text', path: 'feedbackNeutralLabel', label: '一般反馈按钮' },
          { kind: 'text', path: 'feedbackNegativeLabel', label: '负向反馈按钮' },
          { kind: 'text', path: 'reviewActionLabel', label: '复盘按钮' },
          { kind: 'text', path: 'rebookActionLabel', label: '再约按钮' },
          { kind: 'text', path: 'kickoffActionLabel', label: 'AI 开场按钮' },
          { kind: 'text', path: 'markReadActionLabel', label: '标记已读按钮' },
          { kind: 'text', path: 'chatSummarySectionTitle', label: '群聊摘要标题' },
          { kind: 'textarea', path: 'chatSummaryDescription', label: '群聊摘要说明', wide: true },
          { kind: 'text', path: 'chatSummaryEmpty', label: '群聊摘要空状态', wide: true },
          { kind: 'text', path: 'chatSummaryFallbackMessage', label: '群聊默认消息', wide: true },
        ],
      },
    ],
  },
  {
    key: 'ui.report',
    label: '举报',
    description: '举报弹层标题、原因、placeholder 与 toast。',
    sections: [
      {
        kind: 'fields',
        title: '标题与分区',
        fields: [
          { kind: 'text', path: 'titleByType.activity', label: '活动举报标题' },
          { kind: 'text', path: 'titleByType.message', label: '消息举报标题' },
          { kind: 'text', path: 'titleByType.user', label: '用户举报标题' },
          { kind: 'text', path: 'sectionTitles.reason', label: '原因分区标题' },
          { kind: 'text', path: 'sectionTitles.description', label: '补充分区标题' },
          { kind: 'text', path: 'descriptionPlaceholder', label: '补充说明占位', description: '文本输入框 placeholder。', wide: true },
          { kind: 'text', path: 'submitLabel', label: '提交按钮' },
        ],
      },
      {
        kind: 'fields',
        title: '举报原因',
        fields: [
          { kind: 'text', path: 'reasons.inappropriate', label: '违规内容' },
          { kind: 'text', path: 'reasons.fake', label: '虚假信息' },
          { kind: 'text', path: 'reasons.harassment', label: '骚扰行为' },
          { kind: 'text', path: 'reasons.other', label: '其他原因' },
        ],
      },
      {
        kind: 'fields',
        title: '结果提示',
        fields: [
          { kind: 'text', path: 'toast.missingReason', label: '缺少原因提示' },
          { kind: 'text', path: 'toast.invalidTarget', label: '无效目标提示' },
          { kind: 'text', path: 'toast.invalidType', label: '无效类型提示' },
          { kind: 'text', path: 'toast.success', label: '成功提示' },
          { kind: 'text', path: 'toast.failed', label: '失败提示' },
          { kind: 'text', path: 'toast.networkError', label: '网络错误提示' },
        ],
      },
    ],
  },
  {
    key: 'ui.feedback',
    label: '反馈',
    description: '活动反馈步骤标题、问题项与提交提示。',
    sections: [
      {
        kind: 'fields',
        title: '基础文案',
        fields: [
          { kind: 'text', path: 'title', label: '标题' },
          { kind: 'text', path: 'positiveLabel', label: '正向按钮' },
          { kind: 'text', path: 'negativeLabel', label: '负向按钮' },
          { kind: 'text', path: 'problemSectionTitle', label: '问题分区标题' },
          { kind: 'text', path: 'nextStepLabel', label: '下一步提示' },
          { kind: 'text', path: 'targetSectionTitle', label: '反馈对象标题' },
          { kind: 'text', path: 'descriptionSectionTitle', label: '补充说明标题' },
          { kind: 'text', path: 'descriptionPlaceholder', label: '补充说明占位', description: '反馈补充输入框 placeholder。', wide: true },
          { kind: 'text', path: 'backLabel', label: '返回按钮' },
          { kind: 'text', path: 'submitLabel', label: '提交按钮' },
        ],
      },
      {
        kind: 'fields',
        title: '问题项',
        description: '每个问题项同时保留文案与图标 key。',
        fields: [
          { kind: 'text', path: 'problems.late.label', label: '迟到 文案' },
          { kind: 'text', path: 'problems.late.icon', label: '迟到 图标 key' },
          { kind: 'text', path: 'problems.no_show.label', label: '放鸽子 文案' },
          { kind: 'text', path: 'problems.no_show.icon', label: '放鸽子 图标 key' },
          { kind: 'text', path: 'problems.bad_attitude.label', label: '态度不好 文案' },
          { kind: 'text', path: 'problems.bad_attitude.icon', label: '态度不好 图标 key' },
          { kind: 'text', path: 'problems.not_as_described.label', label: '与描述不符 文案' },
          { kind: 'text', path: 'problems.not_as_described.icon', label: '与描述不符 图标 key' },
          { kind: 'text', path: 'problems.other.label', label: '其他问题 文案' },
          { kind: 'text', path: 'problems.other.icon', label: '其他问题 图标 key' },
        ],
      },
      {
        kind: 'fields',
        title: '结果提示',
        fields: [
          { kind: 'text', path: 'toast.missingProblem', label: '缺少问题提示' },
          { kind: 'text', path: 'toast.missingTarget', label: '缺少对象提示' },
          { kind: 'text', path: 'toast.success', label: '成功提示' },
          { kind: 'text', path: 'toast.failed', label: '失败提示' },
        ],
      },
    ],
  },
] as const

const DEFAULT_CONFIG_KEY = UI_CONFIGS[0].key

function FieldBlock({
  field,
  value,
  onChange,
}: {
  field: PathField
  value: string
  onChange: (nextValue: string) => void
}) {
  return (
    <div className={cn('space-y-2', field.wide ? 'md:col-span-2' : undefined)}>
      <Label>{field.label}</Label>
      {field.kind === 'textarea' ? (
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          className="min-h-[92px]"
        />
      ) : (
        <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={field.placeholder} />
      )}
      {field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}
    </div>
  )
}

export function UiCopyEditor({ onSelectConfig }: Props) {
  const [activeConfigKey, setActiveConfigKey] = useState<string>(DEFAULT_CONFIG_KEY)
  const [configValue, setConfigValue] = useState<Record<string, unknown>>({})
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => buildDefaultOpenState(UI_CONFIGS[0]))
  const { data, isLoading } = useAiConfigDetail(activeConfigKey)
  const updateConfig = useUpdateAiConfig()

  const activeConfig = useMemo(
    () => UI_CONFIGS.find((item) => item.key === activeConfigKey) ?? UI_CONFIGS[0],
    [activeConfigKey]
  )

  useEffect(() => {
    setConfigValue(cloneConfig(data?.configValue))
  }, [data?.configValue])

  useEffect(() => {
    setOpenSections((current) => ({
      ...buildDefaultOpenState(activeConfig),
      ...current,
    }))
  }, [activeConfig])

  const updateField = (path: string, nextValue: string) => {
    setConfigValue((current) => writePathValue(current, path, nextValue))
  }

  const updateStringListItem = (path: string, index: number, nextValue: string) => {
    setConfigValue((current) => {
      const items = readStringArray(current, path)
      items[index] = nextValue
      return writePathValue(current, path, items)
    })
  }

  const appendStringListItem = (path: string) => {
    setConfigValue((current) => {
      const items = readStringArray(current, path)
      return writePathValue(current, path, [...items, ''])
    })
  }

  const removeStringListItem = (path: string, index: number) => {
    setConfigValue((current) => {
      const items = readStringArray(current, path).filter((_, itemIndex) => itemIndex !== index)
      return writePathValue(current, path, items)
    })
  }

  const updateObjectListItem = (path: string, index: number, key: string, nextValue: string) => {
    setConfigValue((current) => {
      const items = readObjectArray(current, path)
      const nextItem = { ...(items[index] ?? {}), [key]: nextValue }
      items[index] = nextItem
      return writePathValue(current, path, items)
    })
  }

  const appendObjectListItem = (path: string, createItem: () => Record<string, string>) => {
    setConfigValue((current) => {
      const items = readObjectArray(current, path)
      return writePathValue(current, path, [...items, createItem()])
    })
  }

  const removeObjectListItem = (path: string, index: number) => {
    setConfigValue((current) => {
      const items = readObjectArray(current, path).filter((_, itemIndex) => itemIndex !== index)
      return writePathValue(current, path, items)
    })
  }

  const handleSave = () => {
    updateConfig.mutate({
      configKey: activeConfigKey,
      configValue,
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-4">
        <div className="space-y-1">
          <CardTitle className="text-lg">UI 文案配置</CardTitle>
          <p className="text-sm text-muted-foreground">
            用结构化表单维护对用户可见的正式文案，不再让前端组件藏一份真源。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => onSelectConfig(activeConfigKey)}>
            <History className="mr-1 h-4 w-4" />
            历史
          </Button>
          <Button size="sm" onClick={handleSave} disabled={updateConfig.isPending}>
            {updateConfig.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            保存
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={activeConfigKey} onValueChange={setActiveConfigKey} className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            {UI_CONFIGS.map((config) => (
              <TabsTrigger key={config.key} value={config.key}>
                {config.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
          <p className="text-sm font-medium">{activeConfig.key}</p>
          <p className="mt-1 text-sm text-muted-foreground">{activeConfig.description}</p>
        </div>

        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {activeConfig.sections.map((section) => (
              <Collapsible
                key={getSectionKey(activeConfig.key, section.title)}
                open={openSections[getSectionKey(activeConfig.key, section.title)]}
                onOpenChange={(open) =>
                  setOpenSections((current) => ({
                    ...current,
                    [getSectionKey(activeConfig.key, section.title)]: open,
                  }))
                }
              >
                <div className="rounded-2xl border border-border/60">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition hover:bg-muted/20"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold">{section.title}</p>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            {getSectionItemCount(section, configValue) ?? 0}
                          </span>
                        </div>
                        {section.description ? (
                          <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
                        ) : null}
                      </div>
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                          openSections[getSectionKey(activeConfig.key, section.title)] ? 'rotate-180' : undefined
                        )}
                      />
                    </button>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="border-t border-border/60 px-4 py-4">
                      {section.kind === 'fields' ? (
                        <div className="grid gap-4 md:grid-cols-2">
                          {section.fields.map((field) => (
                            <FieldBlock
                              key={field.path}
                              field={field}
                              value={readStringValue(configValue, field.path)}
                              onChange={(nextValue) => updateField(field.path, nextValue)}
                            />
                          ))}
                        </div>
                      ) : null}

                      {section.kind === 'string-list' ? (
                        <div className="space-y-3">
                          {readStringArray(configValue, section.path).map((item, index) => (
                            <div key={`${section.path}:${index}`} className="flex items-start gap-3">
                              <div className="flex-1 space-y-2">
                                <Label>{`${section.itemLabel} ${index + 1}`}</Label>
                                <Input
                                  value={item}
                                  placeholder={section.placeholder}
                                  onChange={(event) => updateStringListItem(section.path, index, event.target.value)}
                                />
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="mt-7"
                                onClick={() => removeStringListItem(section.path, index)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                          <Button type="button" variant="outline" size="sm" onClick={() => appendStringListItem(section.path)}>
                            <Plus className="mr-1 h-4 w-4" />
                            {section.addLabel}
                          </Button>
                        </div>
                      ) : null}

                      {section.kind === 'object-list' ? (
                        <div className="space-y-4">
                          {readObjectArray(configValue, section.path).map((item, index) => (
                            <div key={`${section.path}:${index}`} className="rounded-xl border border-border/50 p-4">
                              <div className="mb-4 flex items-center justify-between">
                                <p className="text-sm font-medium">{`${section.itemTitle} ${index + 1}`}</p>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeObjectListItem(section.path, index)}
                                >
                                  <Trash2 className="mr-1 h-4 w-4" />
                                  删除
                                </Button>
                              </div>
                              <div className="grid gap-4 md:grid-cols-2">
                                {section.fields.map((field) => {
                                  const fieldValue = typeof item[field.key] === 'string' ? (item[field.key] as string) : ''
                                  return (
                                    <div key={`${section.path}:${index}:${field.key}`} className={cn('space-y-2', field.multiline ? 'md:col-span-2' : undefined)}>
                                      <Label>{field.label}</Label>
                                      {field.multiline ? (
                                        <Textarea
                                          value={fieldValue}
                                          placeholder={field.placeholder}
                                          className="min-h-[92px]"
                                          onChange={(event) => updateObjectListItem(section.path, index, field.key, event.target.value)}
                                        />
                                      ) : (
                                        <Input
                                          value={fieldValue}
                                          placeholder={field.placeholder}
                                          onChange={(event) => updateObjectListItem(section.path, index, field.key, event.target.value)}
                                        />
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => appendObjectListItem(section.path, section.createItem)}
                          >
                            <Plus className="mr-1 h-4 w-4" />
                            {section.addLabel}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
