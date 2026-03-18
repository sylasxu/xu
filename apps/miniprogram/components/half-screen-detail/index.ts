/**
 * 半屏详情组件
 * Requirements: 4.3, 5.1, 5.2, 5.3
 *
 * 从底部滑入，覆盖 ~70% 屏幕，展示活动详情。
 * 底部固定操作栏（报名/分享），加载失败降级跳转详情页。
 */

import { useChatStore } from '../../src/stores/chat'
import { fetchWidgetData } from '../../src/utils/widget-fetcher'
import type { ActionState } from '../../src/utils/widget-actions'
import { buildJoinStructuredAction } from '../../src/utils/join-flow'
import type { ActivityDetailResponse } from '../../src/api/model'

type ActivityDetail = ActivityDetailResponse;

interface ComponentData {
  activity: ActivityDetail | null;
  loading: boolean;
  joinState: ActionState;
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    visible: { type: Boolean, value: false },
    activityId: { type: String, value: '' },
  },

  data: {
    activity: null as ActivityDetail | null,
    loading: true,
    joinState: 'idle' as ActionState,
  },

  observers: {
    'visible, activityId': function (visible: boolean, activityId: string) {
      if (visible && activityId) {
        this.loadDetail(activityId)
      }
      if (!visible) {
        this.setData({ activity: null, loading: true, joinState: 'idle' })
      }
    },
  },

  methods: {
    /** 加载活动详情 */
    async loadDetail(activityId: string) {
      this.setData({ loading: true })

      const result = await fetchWidgetData('activity_detail', { id: activityId })

      if (result.state === 'error' || !result.data) {
        this.close()
        wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${activityId}` })
        return
      }

      this.setData({
        activity: result.data,
        loading: false,
      })
    },

    /** 关闭半屏 */
    close() {
      this.triggerEvent('close')
    },

    /** 点击遮罩关闭 */
    onMaskTap() {
      this.close()
    },

    /** 阻止内容区域事件冒泡 */
    onContentTap() {
      // noop — 阻止冒泡到 mask
    },

    /** 报名 */
    async onJoinTap() {
      const activity = this.data.activity
      if (!activity || this.data.joinState === 'loading') return

      const pendingAction = buildJoinStructuredAction({
        activityId: activity.id,
        title: activity.title,
        startAt: activity.startAt,
        locationName: activity.locationName,
        source: 'half_screen_detail',
      })

      wx.vibrateShort({ type: 'light' })
      this.setData({ joinState: 'loading' })
      this.close()

      useChatStore.getState().sendAction({
        action: pendingAction.action,
        payload: pendingAction.payload,
        source: pendingAction.source,
        originalText: pendingAction.originalText,
      })

      this.setData({ joinState: 'idle' })
    },

    /** 分享 */
    onShareTap() {
      const activity = this.data.activity
      if (!activity) return
      this.triggerEvent('share', { activityId: activity.id, title: activity.title })
    },

    /** 查看完整详情 */
    onViewFullDetail() {
      const activity = this.data.activity
      if (!activity) return
      this.close()
      wx.navigateTo({ url: `/subpackages/activity/detail/index?id=${activity.id}` })
    },
  },
})
