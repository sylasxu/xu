/**
 * 差评反馈弹窗组件
 * Requirements: 13.1, 13.2, 13.3, 13.4
 * - 活动结束后弹出体验反馈弹窗
 * - 问题类型选择
 * - 指定反馈对象
 * - 提交反馈API
 */

import { getParticipantsFeedbackMeta } from '../../src/api/endpoints/participants/participants'
import type { ParticipantFeedbackMetaResponse } from '../../src/api/model'

// ==================== 类型定义 ====================

/** 问题类型 */
type ProblemType = 'late' | 'no_show' | 'bad_attitude' | 'not_as_described' | 'other';

/** 问题类型选项 */
interface ProblemOption {
  value: ProblemType;
  label: string;
  icon: string;
}

/** 参与者信息 */
interface Participant {
  userId: string;
  nickname: string;
  avatarUrl: string;
}

/** 组件属性 - 运行时数据 */
interface FeedbackDialogPropertiesData {
  /** 是否显示 */
  visible: boolean;
  /** 活动 ID */
  activityId: string;
  /** 参与者列表（可选择反馈对象） */
  participants: Participant[];
}

/** 组件数据 */
interface FeedbackDialogData {
  title: string;
  positiveLabel: string;
  negativeLabel: string;
  problemSectionTitle: string;
  nextStepLabel: string;
  targetSectionTitle: string;
  descriptionSectionTitle: string;
  descriptionPlaceholder: string;
  backLabel: string;
  submitLabel: string;
  /** 问题类型选项 */
  problemOptions: ProblemOption[];
  toast: ParticipantFeedbackMetaResponse['toast'];
  /** 选中的问题类型 */
  selectedProblem: ProblemType | null;
  /** 选中的反馈对象 */
  selectedTargets: string[];
  /** 补充说明 */
  description: string;
  /** 提交状态 */
  submitting: boolean;
  /** 当前步骤：1-选择问题类型，2-选择反馈对象 */
  step: number;
}

// 问题类型选项 (Requirements: 13.2)
const PROBLEM_OPTIONS: ProblemOption[] = [
  { value: 'late', label: '迟到', icon: 'time' },
  { value: 'no_show', label: '放鸽子', icon: 'close-circle' },
  { value: 'bad_attitude', label: '态度不好', icon: 'dissatisfaction' },
  { value: 'not_as_described', label: '与描述不符', icon: 'error-circle' },
  { value: 'other', label: '其他问题', icon: 'ellipsis' },
];

const DEFAULT_FEEDBACK_META: ParticipantFeedbackMetaResponse = {
  title: '活动体验如何？',
  positiveLabel: '挺好的',
  negativeLabel: '有问题',
  problemSectionTitle: '遇到什么问题？',
  nextStepLabel: '下一步：选择反馈对象',
  targetSectionTitle: '选择反馈对象',
  descriptionSectionTitle: '补充说明（选填）',
  descriptionPlaceholder: '请描述具体情况...',
  backLabel: '返回',
  submitLabel: '提交反馈',
  problems: PROBLEM_OPTIONS,
  toast: {
    missingProblem: '请选择问题类型',
    missingTarget: '请选择反馈对象',
    success: '反馈已提交',
    failed: '提交失败',
  },
}

const FEEDBACK_DIALOG_DATA: FeedbackDialogData = {
  title: DEFAULT_FEEDBACK_META.title,
  positiveLabel: DEFAULT_FEEDBACK_META.positiveLabel,
  negativeLabel: DEFAULT_FEEDBACK_META.negativeLabel,
  problemSectionTitle: DEFAULT_FEEDBACK_META.problemSectionTitle,
  nextStepLabel: DEFAULT_FEEDBACK_META.nextStepLabel,
  targetSectionTitle: DEFAULT_FEEDBACK_META.targetSectionTitle,
  descriptionSectionTitle: DEFAULT_FEEDBACK_META.descriptionSectionTitle,
  descriptionPlaceholder: DEFAULT_FEEDBACK_META.descriptionPlaceholder,
  backLabel: DEFAULT_FEEDBACK_META.backLabel,
  submitLabel: DEFAULT_FEEDBACK_META.submitLabel,
  problemOptions: DEFAULT_FEEDBACK_META.problems,
  toast: DEFAULT_FEEDBACK_META.toast,
  selectedProblem: null,
  selectedTargets: [],
  description: '',
  submitting: false,
  step: 1,
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readProblemType(value: unknown): ProblemType | null {
  switch (value) {
    case 'late':
    case 'no_show':
    case 'bad_attitude':
    case 'not_as_described':
    case 'other':
      return value
    default:
      return null
  }
}

function normalizeFeedbackMeta(meta: ParticipantFeedbackMetaResponse | null | undefined): ParticipantFeedbackMetaResponse {
  if (!meta) {
    return DEFAULT_FEEDBACK_META
  }

  return {
    title: readString(meta.title) || DEFAULT_FEEDBACK_META.title,
    positiveLabel: readString(meta.positiveLabel) || DEFAULT_FEEDBACK_META.positiveLabel,
    negativeLabel: readString(meta.negativeLabel) || DEFAULT_FEEDBACK_META.negativeLabel,
    problemSectionTitle: readString(meta.problemSectionTitle) || DEFAULT_FEEDBACK_META.problemSectionTitle,
    nextStepLabel: readString(meta.nextStepLabel) || DEFAULT_FEEDBACK_META.nextStepLabel,
    targetSectionTitle: readString(meta.targetSectionTitle) || DEFAULT_FEEDBACK_META.targetSectionTitle,
    descriptionSectionTitle: readString(meta.descriptionSectionTitle) || DEFAULT_FEEDBACK_META.descriptionSectionTitle,
    descriptionPlaceholder: readString(meta.descriptionPlaceholder) || DEFAULT_FEEDBACK_META.descriptionPlaceholder,
    backLabel: readString(meta.backLabel) || DEFAULT_FEEDBACK_META.backLabel,
    submitLabel: readString(meta.submitLabel) || DEFAULT_FEEDBACK_META.submitLabel,
    problems: Array.isArray(meta.problems) && meta.problems.length > 0
      ? meta.problems
          .map((item) => {
            const value = readProblemType(item?.value)
            const label = readString(item?.label)
            const icon = readString(item?.icon)
            if (!value || !label || !icon) {
              return null
            }

            return { value, label, icon }
          })
          .filter((item): item is ProblemOption => Boolean(item))
      : DEFAULT_FEEDBACK_META.problems,
    toast: {
      missingProblem: readString(meta.toast?.missingProblem) || DEFAULT_FEEDBACK_META.toast.missingProblem,
      missingTarget: readString(meta.toast?.missingTarget) || DEFAULT_FEEDBACK_META.toast.missingTarget,
      success: readString(meta.toast?.success) || DEFAULT_FEEDBACK_META.toast.success,
      failed: readString(meta.toast?.failed) || DEFAULT_FEEDBACK_META.toast.failed,
    },
  }
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    activityId: {
      type: String,
      value: '',
    },
    participants: {
      type: Array,
      value: [],
    },
  },

  data: {
    ...FEEDBACK_DIALOG_DATA,
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
          selectedProblem: null,
          selectedTargets: [],
          description: '',
          step: 1,
        });
      }
    },
  },

  methods: {
    async loadMeta() {
      try {
        const response = await getParticipantsFeedbackMeta()
        const meta = normalizeFeedbackMeta(response.data)
        this.setData({
          title: meta.title,
          positiveLabel: meta.positiveLabel,
          negativeLabel: meta.negativeLabel,
          problemSectionTitle: meta.problemSectionTitle,
          nextStepLabel: meta.nextStepLabel,
          targetSectionTitle: meta.targetSectionTitle,
          descriptionSectionTitle: meta.descriptionSectionTitle,
          descriptionPlaceholder: meta.descriptionPlaceholder,
          backLabel: meta.backLabel,
          submitLabel: meta.submitLabel,
          problemOptions: meta.problems,
          toast: meta.toast,
        })
      } catch (error) {
        console.warn('加载反馈元数据失败，使用默认文案', error)
      }
    },

    // ==================== 事件处理 ====================

    /** 选择问题类型 (Requirements: 13.2) */
    onSelectProblem(e: WechatMiniprogram.TouchEvent) {
      const { value } = e.currentTarget.dataset as { value: ProblemType };
      this.setData({ selectedProblem: value });
    },

    /** 下一步 - 选择反馈对象 */
    onNextStep() {
      const { toast } = this.data
      if (!this.data.selectedProblem) {
        wx.showToast({ title: toast.missingProblem, icon: 'none' });
        return;
      }
      this.setData({ step: 2 });
    },

    /** 上一步 */
    onPrevStep() {
      this.setData({ step: 1 });
    },

    /** 切换反馈对象选择 (Requirements: 13.3) */
    onToggleTarget(e: WechatMiniprogram.TouchEvent) {
      const { userId } = e.currentTarget.dataset as { userId: string };
      const { selectedTargets } = this.data;

      const index = selectedTargets.indexOf(userId);
      if (index >= 0) {
        selectedTargets.splice(index, 1);
      } else {
        selectedTargets.push(userId);
      }

      this.setData({ selectedTargets: [...selectedTargets] });
    },

    /** 输入补充说明 */
    onDescriptionInput(e: WechatMiniprogram.Input) {
      this.setData({ description: e.detail.value });
    },

    /** 点击"挺好的" (Requirements: 13.4) */
    onGoodFeedback() {
      this.triggerEvent('close');
      this.triggerEvent('feedback', { type: 'good' });
    },

    /** 关闭弹窗 (Requirements: 13.4) */
    onClose() {
      this.triggerEvent('close');
    },

    /** 提交反馈 (Requirements: 13.3) */
    async onSubmit() {
      const { activityId, selectedProblem, selectedTargets, description, submitting, toast } = this.data;

      if (submitting) return;

      if (!selectedProblem) {
        wx.showToast({ title: toast.missingProblem, icon: 'none' });
        return;
      }

      if (selectedTargets.length === 0) {
        wx.showToast({ title: toast.missingTarget, icon: 'none' });
        return;
      }

      this.setData({ submitting: true });

      try {
        // TODO: 调用反馈 API
        // const response = await postFeedback({
        //   activityId,
        //   problemType: selectedProblem,
        //   targetUserIds: selectedTargets,
        //   description,
        // });

        // 模拟 API 调用
        await new Promise((resolve) => setTimeout(resolve, 500));

        wx.showToast({ title: toast.success, icon: 'success' });

        this.triggerEvent('close');
        this.triggerEvent('feedback', {
          type: 'problem',
          problemType: selectedProblem,
          targetUserIds: selectedTargets,
          description,
        });
      } catch (error) {
        console.error('提交反馈失败', error);
        wx.showToast({
          title: (error as Error).message || toast.failed,
          icon: 'none',
        });
      } finally {
        this.setData({ submitting: false });
      }
    },

    /** 阻止冒泡 */
    noop() {},
  },
});
