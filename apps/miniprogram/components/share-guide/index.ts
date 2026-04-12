/**
 * Share Guide 组件 - 分享引导蒙层 (v3.5 零成本地图方案)
 * Requirements: 7.1, 分享引导
 * 
 * 交互逻辑：
 * - 点击蒙层任意位置 → 关闭蒙层，回到 Chat 流
 * - 5 秒后自动淡出
 * 
 * v3.5 变更：移除地图缩略图，改为纯文字卡片
 */

import { useAppStore } from '../../src/stores/app'

interface ShareGuideData {
  visible: boolean
  activityTitle: string
  shareLocationName: string
  autoCloseTimer: number | null
}

interface ComponentProperties {
  show: WechatMiniprogram.Component.PropertyOption
  title: WechatMiniprogram.Component.PropertyOption
  locationName: WechatMiniprogram.Component.PropertyOption
  autoClose: WechatMiniprogram.Component.PropertyOption
  autoCloseDelay: WechatMiniprogram.Component.PropertyOption
}

interface ComponentMethods {
  updateFromStore: (state: ReturnType<typeof useAppStore.getState>) => void
  startAutoCloseTimer: () => void
  clearAutoCloseTimer: () => void
  onMaskTap: () => void
  preventTap: () => void
  preventScroll: () => void
  closeGuide: () => void
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

const SHARE_GUIDE_DATA: ShareGuideData = {
  visible: false,
  activityTitle: '',
  shareLocationName: '',
  autoCloseTimer: null,
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 是否显示（由外部控制）
    show: {
      type: Boolean,
      value: false,
    },
    // 活动标题
    title: {
      type: String,
      value: '',
    },
    // 位置名称
    locationName: {
      type: String,
      value: '',
    },
    // 是否自动关闭
    autoClose: {
      type: Boolean,
      value: true,
    },
    // 自动关闭延迟（毫秒）
    autoCloseDelay: {
      type: Number,
      value: 5000, // 5 秒
    },
  },

  data: {
    ...SHARE_GUIDE_DATA,
  },

  observers: {
    'show': function(show: boolean) {
      this.setData({ visible: show })
      
      if (show) {
        this.startAutoCloseTimer()
      } else {
        this.clearAutoCloseTimer()
      }
    },
    'title': function(title: string) {
      this.setData({ activityTitle: typeof title === 'string' ? title : '' })
    },
    'locationName': function(name: string) {
      this.setData({ shareLocationName: typeof name === 'string' ? name : '' })
    },
  },

  lifetimes: {
    attached() {
      // 订阅 appStore 的 isShareGuideVisible 状态
      const appStore = useAppStore.getState()
      this.updateFromStore(appStore)
      
      // 监听状态变化
      useAppStore.subscribe((state) => {
        this.updateFromStore(state)
      })
    },
    
    detached() {
      this.clearAutoCloseTimer()
    },
  },

  methods: {
    /**
     * 从 store 更新状态
     */
    updateFromStore(state: ReturnType<typeof useAppStore.getState>) {
      const shouldShow = state.isShareGuideVisible
      const data = state.shareGuideData
      
      if (this.data.visible !== shouldShow) {
        this.setData({ 
          visible: shouldShow,
          activityTitle: typeof data?.title === 'string' ? data.title : '',
          shareLocationName: typeof data?.locationName === 'string' ? data.locationName : '',
        })
        
        if (shouldShow) {
          this.startAutoCloseTimer()
        } else {
          this.clearAutoCloseTimer()
        }
      }
    },

    /**
     * 启动自动关闭定时器
     */
    startAutoCloseTimer() {
      if (!this.properties.autoClose) return
      
      this.clearAutoCloseTimer()
      
      const timer = Number(setTimeout(() => {
        this.closeGuide()
      }, readNumber(this.properties.autoCloseDelay, 5000)))
      
      this.setData({ autoCloseTimer: timer })
    },

    /**
     * 清除自动关闭定时器
     */
    clearAutoCloseTimer() {
      if (this.data.autoCloseTimer) {
        clearTimeout(this.data.autoCloseTimer)
        this.setData({ autoCloseTimer: null })
      }
    },

    /**
     * 点击蒙层
     */
    onMaskTap() {
      this.closeGuide()
    },

    /**
     * 阻止事件冒泡
     */
    preventTap() {
      // 阻止点击卡片时关闭蒙层
    },

    /**
     * 阻止滚动穿透
     */
    preventScroll() {
      // 阻止滚动
    },

    /**
     * 关闭引导
     */
    closeGuide() {
      this.clearAutoCloseTimer()
      this.setData({ visible: false })
      
      // 更新全局状态
      const appStore = useAppStore.getState()
      appStore.hideShareGuide()
      
      // 触发关闭事件
      this.triggerEvent('close')
    },
  },
})
