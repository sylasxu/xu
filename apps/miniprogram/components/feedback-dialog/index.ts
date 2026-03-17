/**
 * 差评反馈弹窗组件
 * Requirements: 13.1, 13.2, 13.3, 13.4
 * - 活动结束后弹出体验反馈弹窗
 * - 问题类型选择
 * - 指定反馈对象
 * - 提交反馈API
 */

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
  /** 问题类型选项 */
  problemOptions: ProblemOption[];
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

const FEEDBACK_DIALOG_DATA: FeedbackDialogData = {
  problemOptions: PROBLEM_OPTIONS,
  selectedProblem: null,
  selectedTargets: [],
  description: '',
  submitting: false,
  step: 1,
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
    // ==================== 事件处理 ====================

    /** 选择问题类型 (Requirements: 13.2) */
    onSelectProblem(e: WechatMiniprogram.TouchEvent) {
      const { value } = e.currentTarget.dataset as { value: ProblemType };
      this.setData({ selectedProblem: value });
    },

    /** 下一步 - 选择反馈对象 */
    onNextStep() {
      if (!this.data.selectedProblem) {
        wx.showToast({ title: '请选择问题类型', icon: 'none' });
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
      const { activityId, selectedProblem, selectedTargets, description, submitting } = this.data;

      if (submitting) return;

      if (!selectedProblem) {
        wx.showToast({ title: '请选择问题类型', icon: 'none' });
        return;
      }

      if (selectedTargets.length === 0) {
        wx.showToast({ title: '请选择反馈对象', icon: 'none' });
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

        wx.showToast({ title: '反馈已提交', icon: 'success' });

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
          title: (error as Error).message || '提交失败',
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
