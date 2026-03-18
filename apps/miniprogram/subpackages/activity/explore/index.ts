/**
 * 沉浸式地图页 - 探索附近
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8
 * 
 * 使用原生 `<map>` 组件实现全屏可交互地图（免费，无需 Key）
 * - 显示活动 Markers（限制 ≤ 20 个）
 * - 点击 Marker 显示 activity-preview-sheet（轻量预览）
 * - 地图拖拽后自动加载新区域活动（防抖）
 * - 底部 Sheet 显示活动列表
 */

import { getActivitiesNearby } from '../../../src/api/endpoints/activities/activities'
import { useChatStore } from '../../../src/stores/chat'
import { useAppStore } from '../../../src/stores/app'
import type { ActivityNearbyResponseDataItem } from '../../../src/api/model'
import type { ActivityType } from '../../../src/types/global'
import { buildJoinStructuredAction, type JoinFlowPayload } from '../../../src/utils/join-flow'

// 活动类型
interface Activity {
  id: string
  title: string
  type: string
  locationName: string
  locationHint?: string
  latitude: number
  longitude: number
  distance: number
  startAt: string
  currentParticipants: number
  maxParticipants: number
  creatorId?: string
}

// 地图 Marker 类型
interface MapMarker {
  id: number
  latitude: number
  longitude: number
  iconPath?: string
  width: number
  height: number
  callout?: {
    content: string
    display: string
    borderRadius: number
    padding: number
    bgColor: string
    color: string
    fontSize: number
  }
}

const systemInfo = wx.getSystemInfoSync()

Page({
  data: {
    // 系统信息
    statusBarHeight: systemInfo.statusBarHeight,
    
    // 地图状态
    latitude: 29.5647, // 重庆默认坐标
    longitude: 106.5507,
    scale: 14,
    markers: [] as MapMarker[],
    
    // 活动数据
    activities: [] as Activity[],
    loading: false,
    
    // 筛选
    activeFilter: 'all',
    
    // Bottom Sheet 状态
    sheetExpanded: false,
    
    // 预览浮层
    showPreview: false,
    selectedActivity: null as Activity | null,
    isJoined: false,
    
    // 防抖定时器
    regionChangeTimer: null as number | null,
    
    // 来源参数（从 Widget_Explore 传入）
    fromWidget: false,
    
    // 动画状态
    animateIn: false,
    animateOut: false,
  },

  onLoad(options: { lat?: string; lng?: string; results?: string; animate?: string }) {
    // 如果有传入坐标，使用传入的坐标
    if (options.lat && options.lng) {
      this.setData({
        latitude: parseFloat(options.lat),
        longitude: parseFloat(options.lng),
        fromWidget: true,
      })
    }
    
    // 处理展开动画
    if (options.animate === 'expand') {
      // 延迟触发入场动画
      setTimeout(() => {
        this.setData({ animateIn: true })
      }, 50)
    } else {
      this.setData({ animateIn: true })
    }
    
    // 如果有传入结果数据，直接使用
    if (options.results) {
      try {
        const results = JSON.parse(decodeURIComponent(options.results))
        this.processActivities(results)
      } catch (e) {
        console.error('Parse results failed:', e)
        this.loadNearbyActivities()
      }
    } else {
      // 否则获取当前位置并加载
      if (!options.lat || !options.lng) {
        this.getCurrentLocation()
      } else {
        this.loadNearbyActivities()
      }
    }
  },

  onShow() {
    // 页面显示时刷新数据
    if (!this.data.fromWidget) {
      this.loadNearbyActivities()
    }
  },

  /**
   * 获取当前位置
   */
  getCurrentLocation() {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        this.setData({
          latitude: res.latitude,
          longitude: res.longitude,
        })
        this.loadNearbyActivities()
      },
      fail: () => {
        wx.showToast({
          title: '获取位置失败，使用默认位置',
          icon: 'none',
        })
        this.loadNearbyActivities()
      },
    })
  },

  /**
   * 加载附近活动
   * Requirements: 18.5
   */
  async loadNearbyActivities() {
    this.setData({ loading: true })
    
    try {
      const { latitude, longitude, activeFilter } = this.data
      
      const response = await getActivitiesNearby({
        lat: latitude,
        lng: longitude,
        type: activeFilter === 'all' ? undefined : activeFilter as ActivityType,
        radius: 5000, // 5km
      })
      
      if (response.status === 200 && response.data) {
        this.processActivities(response.data.data || [])
      }
    } catch (err) {
      console.error('Load nearby activities failed:', err)
      wx.showToast({
        title: '加载失败，请重试',
        icon: 'none',
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  /**
   * 处理活动数据
   */
  processActivities(activities: any[]) {
    // 限制最多 20 个 Markers
    const limitedActivities = activities.slice(0, 20)
    
    // 转换为页面数据格式
    const formattedActivities: Activity[] = limitedActivities.map((item: any) => ({
      id: item.id,
      title: item.title,
      type: item.type || 'other',
      locationName: item.locationName || item.locationHint || '位置待定',
      locationHint: item.locationHint,
      latitude: item.latitude || item.lat,
      longitude: item.longitude || item.lng,
      distance: item.distance || 0,
      startAt: item.startAt,
      currentParticipants: item.currentParticipants || 0,
      maxParticipants: item.maxParticipants || 10,
      creatorId: item.creatorId,
    }))
    
    // 生成 Markers
    // 使用地图默认红色 marker 样式，通过 callout 显示活动标题
    const markers: MapMarker[] = formattedActivities.map((activity, index) => {
      const marker: any = {
        id: index,
        latitude: activity.latitude,
        longitude: activity.longitude,
        width: 28,
        height: 36,
        callout: {
          content: activity.title,
          display: 'BYCLICK',
          borderRadius: 8,
          padding: 8,
          bgColor: '#FFFFFF',
          color: '#1F2937',
          fontSize: 12,
        },
      }
      
      return marker as MapMarker
    })
    
    this.setData({
      activities: formattedActivities,
      markers,
    })
  },

  /**
   * 筛选变化
   * Requirements: 18.3
   */
  onFilterChange(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const { value } = e.detail
    this.setData({ activeFilter: value })
    this.loadNearbyActivities()
  },

  /**
   * 地图区域变化（防抖）
   * Requirements: 18.5
   */
  onRegionChange(e: WechatMiniprogram.RegionChange) {
    if (e.type === 'end' && e.causedBy === 'drag') {
      // 清除之前的定时器
      if (this.data.regionChangeTimer) {
        clearTimeout(this.data.regionChangeTimer)
      }
      
      // 设置新的定时器（500ms 防抖）
      const timer = setTimeout(() => {
        // 获取地图中心点
        const mapCtx = wx.createMapContext('exploreMap')
        mapCtx.getCenterLocation({
          success: (res) => {
            this.setData({
              latitude: res.latitude,
              longitude: res.longitude,
              fromWidget: false, // 用户拖拽后，不再使用 Widget 传入的数据
            })
            this.loadNearbyActivities()
          },
        })
      }, 500)
      
      this.setData({ regionChangeTimer: Number(timer) })
    }
  },

  /**
   * 点击 Marker
   * Requirements: 18.4
   */
  onMarkerTap(e: WechatMiniprogram.MarkerTap) {
    const markerId = e.detail?.markerId ?? (e.detail as { markerId?: number })?.markerId
    if (markerId === undefined) return
    const activity = this.data.activities[markerId]
    
    if (activity) {
      // 检查是否已报名（TODO: 从参与者列表中检查）
      const isJoined = false
      
      this.setData({
        selectedActivity: activity,
        showPreview: true,
        isJoined,
      })
      
      // 触感反馈
      wx.vibrateShort({ type: 'light' })
    }
  },

  /**
   * 关闭预览浮层
   */
  onPreviewHide() {
    this.setData({
      showPreview: false,
      selectedActivity: null,
    })
  },

  findActivityById(activityId: string): Activity | null {
    const selectedActivity = this.data.selectedActivity
    if (selectedActivity?.id === activityId) {
      return selectedActivity
    }

    return this.data.activities.find((item: Activity) => item.id === activityId) || null
  },

  async submitJoin(payload: JoinFlowPayload) {
    const pendingAction = buildJoinStructuredAction({
      ...payload,
      source: payload.source || 'activity_explore',
    })

    this.setData({
      showPreview: false,
      selectedActivity: null,
    })

    useChatStore.getState().sendAction({
      action: pendingAction.action,
      payload: pendingAction.payload,
      source: pendingAction.source,
      originalText: pendingAction.originalText,
    })
  },

  /**
   * 查看活动详情
   * Requirements: 18.6
   */
  onViewDetail(e: WechatMiniprogram.CustomEvent<{ activityId: string }>) {
    const { activityId } = e.detail
    this.setData({ showPreview: false })
    
    wx.navigateTo({
      url: `/subpackages/activity/detail/index?id=${activityId}`,
    })
  },

  /**
   * 快速报名
   * Requirements: 18.4
   */
  async onJoin(e: WechatMiniprogram.CustomEvent<{ activityId: string }>) {
    const { activityId } = e.detail
    const activity = this.findActivityById(activityId)
    if (!activity) {
      wx.showToast({ title: '活动信息缺失', icon: 'none' })
      return
    }

    await this.submitJoin({
      activityId: activity.id,
      title: activity.title,
      startAt: activity.startAt,
      locationName: activity.locationName,
      source: 'activity_explore',
    })
  },

  onAuthSuccess() {
    // Auth Sheet 内部已刷新用户信息，这里保持静默即可
  },

  onPendingAction(e: WechatMiniprogram.CustomEvent<{ type: 'structured_action'; action: string; payload: Record<string, unknown>; source?: string; originalText?: string }>) {
    const pendingAction = e.detail
    if (pendingAction?.type !== 'structured_action' || typeof pendingAction.action !== 'string') {
      return
    }

    useAppStore.getState().clearPendingAction()
    useChatStore.getState().sendAction({
      action: pendingAction.action,
      payload: pendingAction.payload,
      source: pendingAction.source,
      originalText: pendingAction.originalText,
    })
  },

  /**
   * 切换 Sheet 展开状态
   * Requirements: 18.7
   */
  toggleSheet() {
    this.setData({ sheetExpanded: !this.data.sheetExpanded })
    wx.vibrateShort({ type: 'light' })
  },

  /**
   * 点击活动列表项
   * Requirements: 18.6
   */
  onActivityTap(e: WechatMiniprogram.CustomEvent<{ activity: Activity }>) {
    const { activity } = e.detail
    
    wx.navigateTo({
      url: `/subpackages/activity/detail/index?id=${activity.id}`,
    })
  },

  /**
   * 返回
   * Requirements: 18.8 - 使用收缩动画
   */
  goBack() {
    // 触发收缩动画
    this.setData({ animateOut: true })
    
    // 等待动画完成后返回
    setTimeout(() => {
      const pages = getCurrentPages()
      if (pages.length > 1) {
        wx.navigateBack()
      } else {
        wx.reLaunch({ url: '/pages/home/index' })
      }
    }, 200) // 动画持续时间
  },

  /**
   * 点击地图空白处关闭预览
   */
  onMapTap() {
    if (this.data.showPreview) {
      this.setData({
        showPreview: false,
        selectedActivity: null,
      })
    }
  },
})
