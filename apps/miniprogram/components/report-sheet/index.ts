/**
 * 举报弹窗组件
 * Requirements: 7.3, 7.4, 7.5, 7.6
 * 
 * 功能：
 * - 举报类型选择（活动/消息/用户）
 * - 举报原因选择
 * - 举报说明输入
 * - 调用 POST /reports API
 */

import { postReports } from '../../src/api/endpoints/reports/reports'

/** 举报类型 */
type ReportType = 'activity' | 'message' | 'user'

/** 举报原因 */
type ReportReason = 'inappropriate' | 'fake' | 'harassment' | 'other'

/** 举报原因选项 */
interface ReasonOption {
  value: ReportReason
  label: string
}

/** 组件属性 */
interface ReportSheetProps {
  /** 是否显示 */
  visible: boolean
  /** 举报类型 */
  type: ReportType
  /** 被举报的目标 ID */
  targetId: string
}

/** 组件数据 */
interface ReportSheetData {
  /** 举报原因选项 */
  reasonOptions: ReasonOption[]
  /** 选中的举报原因 */
  selectedReason: ReportReason | null
  /** 举报说明 */
  description: string
  /** 提交状态 */
  submitting: boolean
}

// 举报原因选项
const REASON_OPTIONS: ReasonOption[] = [
  { value: 'inappropriate', label: '违规内容' },
  { value: 'fake', label: '虚假信息' },
  { value: 'harassment', label: '骚扰行为' },
  { value: 'other', label: '其他' },
]

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    type: {
      type: String,
      value: 'activity' as ReportType,
    },
    targetId: {
      type: String,
      value: '',
    },
  },

  data: {
    reasonOptions: REASON_OPTIONS,
    selectedReason: null as ReportReason | null,
    description: '',
    submitting: false,
  } as ReportSheetData,

  observers: {
    visible(val: boolean) {
      if (val) {
        // 重置状态
        this.setData({
          selectedReason: null,
          description: '',
        })
      }
    },
  },

  methods: {
    /** 选择举报原因 */
    onReasonChange(e: WechatMiniprogram.CustomEvent) {
      this.setData({ selectedReason: e.detail.value as ReportReason })
    },

    /** 输入举报说明 */
    onDescriptionInput(e: WechatMiniprogram.Input) {
      this.setData({ description: e.detail.value })
    },

    /** 关闭弹窗 */
    onClose() {
      this.triggerEvent('close')
    },

    /** 提交举报 (Requirements: 7.5, 7.6) */
    async onSubmit() {
      const { selectedReason, description, submitting } = this.data
      const { type, targetId } = this.properties as unknown as ReportSheetProps

      if (submitting) return

      // 验证
      if (!selectedReason) {
        wx.showToast({ title: '请选择举报原因', icon: 'none' })
        return
      }

      if (!targetId) {
        wx.showToast({ title: '举报目标无效', icon: 'none' })
        return
      }

      this.setData({ submitting: true })

      try {
        const response = await postReports({
          type,
          reason: selectedReason,
          targetId,
          description: description || undefined,
        })

        const statusCode = Number(response.status)
        if (statusCode >= 200 && statusCode < 300) {
          // 触感反馈
          wx.vibrateShort({ type: 'light' })

          wx.showToast({ title: '举报已提交', icon: 'success' })

          // 关闭弹窗
          this.triggerEvent('close')
          this.triggerEvent('success')
        } else {
          const errorData = response.data as { msg?: string; message?: string }
          wx.showToast({
            title: errorData?.msg || errorData?.message || '举报失败',
            icon: 'none',
          })
        }
      } catch (error: any) {
        console.error('举报失败:', error)
        wx.showToast({
          title: error?.message || '网络错误，请重试',
          icon: 'none',
        })
      } finally {
        this.setData({ submitting: false })
      }
    },

    /** 阻止冒泡 */
    noop() {},
  },
})
