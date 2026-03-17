/**
 * 半屏详情组件
 * Requirements: 4.3, 5.1, 5.2, 5.3
 *
 * 从底部滑入，覆盖 ~70% 屏幕，展示活动详情。
 * 底部固定操作栏（报名/分享），加载失败降级跳转详情页。
 */

import { useChatStore } from '../../src/stores/chat'
import { useUserStore } from '../../src/stores/user'
import { useAppStore } from '../../src/stores/app'
import { fetchWidgetData } from '../../src/utils/widget-fetcher'
import { executeWidgetAction } from '../../src/utils/widget-actions'
import type { ActionState } from '../../src/utils/widget-actions'
import { handleJoinSuccess } from '../../src/utils/join-flow'
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

      const currentUser = useUserStore.getState().user
      if (!currentUser?.phoneNumber) {
        this.close()
        useAppStore.getState().showAuthSheet({
          type: 'join',
          payload: {
            activityId: activity.id,
            title: activity.title,
            startAt: activity.startAt,
            locationName: activity.locationName,
            source: 'half_screen_detail',
          },
        })
        return
      }

      wx.vibrateShort({ type: 'light' })
      this.setData({ joinState: 'loading' })

      const result = await executeWidgetAction('join', {
        activityId: activity.id,
        title: activity.title,
        startAt: activity.startAt,
        locationName: activity.locationName,
      })

      if (result.state === 'success') {
        this.setData({ joinState: 'success' })

        useChatStore.getState().appendActionResult(
          'join',
          { activityId: activity.id, title: activity.title },
          true,
          `你已成功报名「${activity.title}」，一起去讨论区打个招呼吧`,
        )

        handleJoinSuccess({
          activityId: activity.id,
          title: activity.title,
          source: 'half_screen_detail',
        }, {
          onBeforeNavigate: () => {
            this.close()
          },
        })
        return
      }

      this.setData({ joinState: 'idle' })
      wx.showToast({ title: result.error || '报名失败', icon: 'none' })
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
