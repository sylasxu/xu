/**
 * AI 输入栏组件
 * Requirements: 2.1, 2.2, 2.6
 */

interface AiInputBarData {
  isExpanded: boolean;
  inputValue: string;
}

const AI_INPUT_BAR_DATA: AiInputBarData = {
  isExpanded: false,
  inputValue: '',
};

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 提示文案
    placeholder: {
      type: String,
      value: '本周想玩什么...',
    },
    value: {
      type: String,
      value: '',
    },
    welcome: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    ...AI_INPUT_BAR_DATA,
  },

  observers: {
    value(nextValue: string) {
      if (typeof nextValue === 'string' && nextValue !== this.data.inputValue) {
        this.setData({
          inputValue: nextValue,
          isExpanded: Boolean(nextValue.trim()) || this.data.isExpanded,
        });
      }
    },
  },

  methods: {
    /**
     * 点击输入栏展开 - Requirements: 2.2
     */
    onBarTap() {
      if (!this.data.isExpanded) {
        this.setData({ isExpanded: true });
        this.triggerEvent('expand');
      }
    },

    /**
     * 输入框聚焦
     */
    onInputFocus() {
      this.setData({ isExpanded: true });
    },

    /**
     * 输入框失焦
     */
    onInputBlur() {
      // 如果输入框为空，收起
      if (!this.data.inputValue.trim()) {
        this.setData({ isExpanded: false });
        this.triggerEvent('collapse');
      }
    },

    /**
     * 输入内容变化 - Requirements: 2.3, 2.6
     */
    onInputChange(e: WechatMiniprogram.Input) {
      const value = e.detail.value;
      this.setData({ inputValue: value });
      this.triggerEvent('inputchange', { value });
    },

    /**
     * 确认输入（按回车或点击发送）
     */
    onInputConfirm() {
      const value = this.data.inputValue.trim();
      if (!value) return;
      this.triggerEvent('send', { text: value });
    },

    /**
     * 清空输入
     */
    onClearTap() {
      this.setData({ inputValue: '' });
      this.triggerEvent('inputchange', { value: '' });
    },

    /**
     * 收起输入栏
     */
    collapse() {
      this.setData({
        isExpanded: false,
        inputValue: '',
      });
      this.triggerEvent('inputchange', { value: '' });
      this.triggerEvent('collapse');
    },

    setValue(value: string) {
      this.setData({
        inputValue: value,
        isExpanded: Boolean(value.trim()),
      });
      this.triggerEvent('inputchange', { value });
    },
  },
});
