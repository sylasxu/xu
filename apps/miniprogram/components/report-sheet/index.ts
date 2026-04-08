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

import { postReports } from '../../src/api/endpoints/internal/internal'
import type { ReportCreateRequest } from '../../src/api/model'

/** 举报类型 */
type ReportType = ReportCreateRequest['type']

/** 举报原因 */
type ReportReason = ReportCreateRequest['reason']

/** 举报原因选项 */
interface ReasonOption {
  value: ReportReason
  label: string
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

const REPORT_SHEET_DATA: ReportSheetData = {
  reasonOptions: REASON_OPTIONS,
  selectedReason: null,
  description: '',
  submitting: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readReportType(value: unknown): ReportType | null {
  switch (value) {
    case 'activity':
    case 'message':
    case 'user':
      return value
    default:
      return null
  }
}

function readReportReason(value: unknown): ReportReason | null {
  switch (value) {
    case 'inappropriate':
    case 'fake':
    case 'harassment':
    case 'other':
      return value
    default:
      return null
  }
}

function readReportErrorMessage(value: unknown): string | null {
  if (!isRecord(value)) {
    return null
  }

  return readString(value.msg) || readString(value.message)
}

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
      value: 'activity',
    },
    targetId: {
      type: String,
      value: '',
    },
  },

  data: {
    ...REPORT_SHEET_DATA,
  },

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
      const selectedReason = readReportReason(e.detail.value)
      if (!selectedReason) {
        return
      }

      this.setData({ selectedReason })
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
      const type = readReportType(this.properties.type)
      const targetId = readString(this.properties.targetId)

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

      if (!type) {
        wx.showToast({ title: '举报类型无效', icon: 'none' })
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
          wx.showToast({
            title: readReportErrorMessage(response.data) || '举报失败',
            icon: 'none',
          })
        }
      } catch (error: unknown) {
        console.error('举报失败:', error)
        wx.showToast({
          title: error instanceof Error ? error.message : '网络错误，请重试',
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
