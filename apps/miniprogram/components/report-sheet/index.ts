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
import { getReportsMeta } from '../../src/api/endpoints/reports/reports'
import type { ReportCreateRequest, ReportMetaResponse } from '../../src/api/model'

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
  /** 标题映射 */
  titleByType: ReportMetaResponse['titleByType']
  /** 分区标题 */
  sectionTitles: ReportMetaResponse['sectionTitles']
  /** 举报原因选项 */
  reasonOptions: ReasonOption[]
  /** 举报说明占位 */
  descriptionPlaceholder: string
  /** 提交按钮文案 */
  submitLabel: string
  /** toast 文案 */
  toast: ReportMetaResponse['toast']
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

const DEFAULT_REPORT_META: ReportMetaResponse = {
  titleByType: {
    activity: '举报活动',
    message: '举报消息',
    user: '举报用户',
  },
  sectionTitles: {
    reason: '请选择举报原因',
    description: '补充说明（可选）',
  },
  descriptionPlaceholder: '请描述具体问题...',
  submitLabel: '提交举报',
  reasons: REASON_OPTIONS,
  toast: {
    missingReason: '请选择举报原因',
    invalidTarget: '举报目标无效',
    invalidType: '举报类型无效',
    success: '举报已提交',
    failed: '举报失败',
    networkError: '网络错误，请重试',
  },
}

const REPORT_SHEET_DATA: ReportSheetData = {
  titleByType: DEFAULT_REPORT_META.titleByType,
  sectionTitles: DEFAULT_REPORT_META.sectionTitles,
  reasonOptions: DEFAULT_REPORT_META.reasons,
  descriptionPlaceholder: DEFAULT_REPORT_META.descriptionPlaceholder,
  submitLabel: DEFAULT_REPORT_META.submitLabel,
  toast: DEFAULT_REPORT_META.toast,
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

function normalizeReportMeta(meta: ReportMetaResponse | null | undefined): ReportMetaResponse {
  if (!meta) {
    return DEFAULT_REPORT_META
  }

  return {
    titleByType: {
      activity: readString(meta.titleByType?.activity) || DEFAULT_REPORT_META.titleByType.activity,
      message: readString(meta.titleByType?.message) || DEFAULT_REPORT_META.titleByType.message,
      user: readString(meta.titleByType?.user) || DEFAULT_REPORT_META.titleByType.user,
    },
    sectionTitles: {
      reason: readString(meta.sectionTitles?.reason) || DEFAULT_REPORT_META.sectionTitles.reason,
      description: readString(meta.sectionTitles?.description) || DEFAULT_REPORT_META.sectionTitles.description,
    },
    descriptionPlaceholder: readString(meta.descriptionPlaceholder) || DEFAULT_REPORT_META.descriptionPlaceholder,
    submitLabel: readString(meta.submitLabel) || DEFAULT_REPORT_META.submitLabel,
    reasons: Array.isArray(meta.reasons) && meta.reasons.length > 0
      ? meta.reasons
          .map((item) => {
            const value = readReportReason(item?.value)
            const label = readString(item?.label)
            if (!value || !label) {
              return null
            }

            return { value, label }
          })
          .filter((item): item is ReasonOption => Boolean(item))
      : DEFAULT_REPORT_META.reasons,
    toast: {
      missingReason: readString(meta.toast?.missingReason) || DEFAULT_REPORT_META.toast.missingReason,
      invalidTarget: readString(meta.toast?.invalidTarget) || DEFAULT_REPORT_META.toast.invalidTarget,
      invalidType: readString(meta.toast?.invalidType) || DEFAULT_REPORT_META.toast.invalidType,
      success: readString(meta.toast?.success) || DEFAULT_REPORT_META.toast.success,
      failed: readString(meta.toast?.failed) || DEFAULT_REPORT_META.toast.failed,
      networkError: readString(meta.toast?.networkError) || DEFAULT_REPORT_META.toast.networkError,
    },
  }
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

  lifetimes: {
    attached() {
      void this.loadMeta()
    },
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
    async loadMeta() {
      try {
        const response = await getReportsMeta()
        const meta = normalizeReportMeta(response.data)
        this.setData({
          titleByType: meta.titleByType,
          sectionTitles: meta.sectionTitles,
          reasonOptions: meta.reasons,
          descriptionPlaceholder: meta.descriptionPlaceholder,
          submitLabel: meta.submitLabel,
          toast: meta.toast,
        })
      } catch (error) {
        console.warn('加载举报元数据失败，使用默认文案', error)
      }
    },

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
      const { selectedReason, description, submitting, toast } = this.data
      const type = readReportType(this.properties.type)
      const targetId = readString(this.properties.targetId)

      if (submitting) return

      // 验证
      if (!selectedReason) {
        wx.showToast({ title: toast.missingReason, icon: 'none' })
        return
      }

      if (!targetId) {
        wx.showToast({ title: toast.invalidTarget, icon: 'none' })
        return
      }

      if (!type) {
        wx.showToast({ title: toast.invalidType, icon: 'none' })
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

          wx.showToast({ title: toast.success, icon: 'success' })

          // 关闭弹窗
          this.triggerEvent('close')
          this.triggerEvent('success')
        } else {
          wx.showToast({
            title: readReportErrorMessage(response.data) || toast.failed,
            icon: 'none',
          })
        }
      } catch (error: unknown) {
        console.error('举报失败:', error)
        wx.showToast({
          title: error instanceof Error ? error.message : toast.networkError,
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
