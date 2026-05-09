/**
 * 对话侧边栏组件
 *
 * - 用户资料卡
 * - 快捷操作行
 * - 按时间分组的历史会话列表
 */

interface SidebarConversation {
  id: string
  title: string
  messageCount: number
  lastMessageAt: string
  createdAt: string
  hasError: boolean
}

interface ConversationGroup {
  label: string
  conversations: SidebarConversation[]
}

interface ComponentData {
  visible: boolean
  animating: boolean
  showContent: boolean
  conversationGroups: ConversationGroup[]
  searchQuery: string
}

interface ComponentProperties {
  conversations: WechatMiniprogram.Component.PropertyOption
  userAvatar: WechatMiniprogram.Component.PropertyOption
  userNickname: WechatMiniprogram.Component.PropertyOption
  isLoading: WechatMiniprogram.Component.PropertyOption
  hasMore: WechatMiniprogram.Component.PropertyOption
}

function isToday(date: Date): boolean {
  const now = new Date()
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

function isYesterday(date: Date): boolean {
  const now = new Date()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  return (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  )
}

function isWithinDays(date: Date, days: number): boolean {
  const now = new Date()
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  return date >= cutoff
}

function groupConversations(items: SidebarConversation[]): ConversationGroup[] {
  const today: SidebarConversation[] = []
  const yesterday: SidebarConversation[] = []
  const last7Days: SidebarConversation[] = []
  const older: SidebarConversation[] = []

  for (const item of items) {
    const date = new Date(item.lastMessageAt || item.createdAt || Date.now())
    if (isToday(date)) {
      today.push(item)
    } else if (isYesterday(date)) {
      yesterday.push(item)
    } else if (isWithinDays(date, 7)) {
      last7Days.push(item)
    } else {
      older.push(item)
    }
  }

  const groups: ConversationGroup[] = []
  if (today.length > 0) groups.push({ label: '今天', conversations: today })
  if (yesterday.length > 0) groups.push({ label: '昨天', conversations: yesterday })
  if (last7Days.length > 0) groups.push({ label: '前7天', conversations: last7Days })
  if (older.length > 0) groups.push({ label: '更早', conversations: older })

  return groups
}

Component({
  options: {
    addGlobalClass: true,
  },

  properties: {
    conversations: {
      type: Array,
      value: [] as SidebarConversation[],
      observer() {
        this.updateGroups()
      },
    },
    userAvatar: {
      type: String,
      value: '',
    },
    userNickname: {
      type: String,
      value: '搭子',
    },
    isLoading: {
      type: Boolean,
      value: false,
    },
    hasMore: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    visible: false,
    animating: false,
    showContent: false,
    conversationGroups: [] as ConversationGroup[],
    searchQuery: '',
  } as ComponentData,

  lifetimes: {
    attached() {
      this.updateGroups()
    },
  },

  methods: {
    updateGroups() {
      const items = (this.properties.conversations || []) as SidebarConversation[]
      const query = this.data.searchQuery.trim().toLowerCase()
      const filtered = query
        ? items.filter((c) => (c.title || '').toLowerCase().includes(query))
        : items
      this.setData({
        conversationGroups: groupConversations(filtered),
      })
    },

    open() {
      if (this.data.visible || this.data.animating) return
      this.setData({ animating: true, visible: true })
      setTimeout(() => {
        this.setData({ showContent: true, animating: false })
      }, 50)
    },

    close() {
      if (!this.data.visible || this.data.animating) return
      this.setData({ animating: true, showContent: false })
      setTimeout(() => {
        this.setData({ visible: false, animating: false })
        this.triggerEvent('close')
      }, 300)
    },

    onOverlayTap() {
      this.close()
    },

    onConversationTap(e: WechatMiniprogram.TouchEvent) {
      const { id } = e.currentTarget.dataset
      if (typeof id !== 'string') return
      this.triggerEvent('conversationtap', { conversationId: id })
      this.close()
    },

    onNewChatTap() {
      this.triggerEvent('newchat')
      this.close()
    },

    onSettingsTap() {
      this.triggerEvent('settings')
      this.close()
    },

    onProfileTap() {
      this.triggerEvent('profile')
      this.close()
    },

    onSearchInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
      const value = typeof e.detail?.value === 'string' ? e.detail.value : ''
      this.setData({ searchQuery: value }, () => {
        this.updateGroups()
      })
    },

    onSearchClear() {
      this.setData({ searchQuery: '' }, () => {
        this.updateGroups()
      })
    },

    onLoadMore() {
      if (this.data.isLoading || !this.properties.hasMore) return
      this.triggerEvent('loadmore')
    },

    preventTouchMove(): boolean {
      return false
    },
  },
})
