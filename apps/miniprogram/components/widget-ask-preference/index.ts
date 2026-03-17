/**
 * Widget Ask Preference 组件
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
 * 
 * 多轮对话信息收集卡片
 * - 显示 AI 询问的问题
 * - 渲染选项按钮供用户快速选择
 * - 支持"随便/都可以"跳过按钮
 * - 点击后触发事件通知父组件
 * 
 * v4.7: 结构化动作
 * - 点击选项发送 select_preference action
 * - 点击跳过发送 skip_preference action
 */

import { useChatStore } from '../../src/stores/chat';

/** 选项结构 */
interface PreferenceOption {
  label: string;
  value: string;
  action?: string;
  params?: Record<string, unknown>;
}

/** 已收集信息 */
interface CollectedInfo {
  location?: string;
  type?: string;
}

interface ComponentData {
  isSubmitting: boolean;
}

interface ComponentProperties {
  questionType: WechatMiniprogram.Component.PropertyOption;
  question: WechatMiniprogram.Component.PropertyOption;
  options: WechatMiniprogram.Component.PropertyOption;
  allowSkip: WechatMiniprogram.Component.PropertyOption;
  collectedInfo: WechatMiniprogram.Component.PropertyOption;
  disabled: WechatMiniprogram.Component.PropertyOption;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readPreferenceOption(value: unknown): PreferenceOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const label = readText(value.label);
  const optionValue = readText(value.value) || label;
  const action = readText(value.action);
  const params = isRecord(value.params) ? value.params : undefined;

  if (!label || !optionValue) {
    return null;
  }

  return {
    label,
    value: optionValue,
    ...(action ? { action } : {}),
    ...(params ? { params } : {}),
  };
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    /** 询问类型：location=位置偏好，type=活动类型偏好 */
    questionType: {
      type: String,
      value: 'location',
    },
    /** 问题文本 */
    question: {
      type: String,
      value: '你想看哪个地方的活动呢？',
    },
    /** 选项列表 */
    options: {
      type: Array,
      value: [],
    },
    /** 是否允许跳过 */
    allowSkip: {
      type: Boolean,
      value: true,
    },
    /** 已收集的信息（用于上下文传递） */
    collectedInfo: {
      type: Object,
      value: {},
    },
    /** 是否禁用（已选择后禁用） */
    disabled: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    isSubmitting: false,
  },

  observers: {
    'question, options, disabled': function(_question: string, _options: PreferenceOption[], disabled: boolean) {
      if (!disabled && this.data.isSubmitting) {
        this.setData({ isSubmitting: false });
      }
    },
  },

  methods: {
    /**
     * 点击选项
     * v4.7: 发送结构化动作
     */
    onSelectOption(e: WechatMiniprogram.TouchEvent) {
      if (this.properties.disabled || this.data.isSubmitting) return;
      
      const option = readPreferenceOption(e.currentTarget.dataset?.option);
      if (!option) return;

      this.setData({ isSubmitting: true });
      
      // 触感反馈
      wx.vibrateShort({ type: 'light' });
      
      // 触发选择事件（保持向后兼容）
      this.triggerEvent('select', {
        questionType: this.properties.questionType,
        selectedOption: option,
        collectedInfo: this.properties.collectedInfo,
      });

      const actionPayload: Record<string, unknown> = {
        questionType: this.properties.questionType,
        selectedValue: option.value,
        selectedLabel: option.label,
        collectedInfo: this.properties.collectedInfo,
      };

      if (option.params && typeof option.params === 'object') {
        Object.assign(actionPayload, option.params);
      }
      
      // 发送结构化动作
      const chatStore = useChatStore.getState();
      chatStore.sendAction({
        action: option.action || 'select_preference',
        payload: actionPayload,
        source: 'widget_ask_preference',
        originalText: option.label,
      });
    },

    /**
     * 点击跳过按钮
     * v4.7: 发送结构化动作
     */
    onSkip() {
      if (this.properties.disabled || this.data.isSubmitting) return;

      this.setData({ isSubmitting: true });
      
      // 触感反馈
      wx.vibrateShort({ type: 'light' });
      
      // 触发跳过事件（保持向后兼容）
      this.triggerEvent('skip', {
        questionType: this.properties.questionType,
        collectedInfo: this.properties.collectedInfo,
      });
      
      // 发送结构化动作
      const chatStore = useChatStore.getState();
      chatStore.sendAction({
        action: 'skip_preference',
        payload: {
          questionType: this.properties.questionType,
          collectedInfo: this.properties.collectedInfo,
        },
        source: 'widget_ask_preference',
        originalText: '随便，你推荐吧',
      });
    },
  },
});
