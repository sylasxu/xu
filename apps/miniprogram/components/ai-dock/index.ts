/**
 * AI Dock 组件 (Floating Capsule)
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8, 15.1, 15.17
 * 
 * Chat-First 架构的超级输入坞
 * - 悬浮胶囊样式（距离底部/左右 32rpx，圆角 48rpx）
 * - Halo Card 渐变边框效果
 * - 输入框（placeholder: "你想找什么活动？"）
 * - [📋 粘贴] 快捷按钮 + 上箭头发送按钮
 * - 键盘弹起处理（adjust-position=false + 手动计算高度）
 * - 按钮 Scale Down 回弹效果 + wx.vibrateShort 触感反馈
 */

const _EXPAND_THRESHOLD = 10;

function shouldShowAssistHint(value: string): boolean {
  return value.trim().length > _EXPAND_THRESHOLD;
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 提示文案
    placeholder: {
      type: String,
      value: '你想找什么活动？',
    },
    // 是否禁用
    disabled: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    inputValue: '',
    canSend: false,
    isFocused: false,
    keyboardHeight: 0,
    bottomOffset: 32, // 默认底部偏移 32rpx
    safeAreaBottom: 0,
    showAssistHint: false,
  },

  lifetimes: {
    attached() {
      this.initSafeArea();
      this.bindKeyboardEvents();
    },
  },

  methods: {
    /**
     * 初始化安全区域
     */
    initSafeArea() {
      try {
        const systemInfo = wx.getSystemInfoSync();
        const safeAreaBottom = systemInfo.safeArea 
          ? systemInfo.screenHeight - systemInfo.safeArea.bottom 
          : 0;
        this.setData({ safeAreaBottom });
      } catch (error) {
        console.error('获取安全区域失败', error);
      }
    },

    /**
     * 绑定键盘事件
     * Requirements: 5.4 - 键盘弹起处理
     */
    bindKeyboardEvents() {
      // 监听键盘高度变化
      wx.onKeyboardHeightChange((res) => {
        const keyboardHeight = res.height;
        // 将 px 转换为 rpx (假设设计稿宽度 750rpx)
        const systemInfo = wx.getSystemInfoSync();
        const ratio = 750 / systemInfo.windowWidth;
        const keyboardHeightRpx = keyboardHeight * ratio;
        
        this.setData({
          keyboardHeight: keyboardHeightRpx,
          // 键盘弹起时，底部偏移 = 键盘高度 + 16rpx 间距
          bottomOffset: keyboardHeight > 0 ? keyboardHeightRpx + 16 : 32,
        });
      });
    },

    /**
     * 输入框聚焦
     * Requirements: 5.4
     */
    onInputFocus() {
      this.setData({ isFocused: true });
      this.triggerEvent('focus');
    },

    /**
     * 输入框失焦
     */
    onInputBlur() {
      this.setData({ isFocused: false });
      this.triggerEvent('blur');
    },

    /**
     * 输入内容变化
     * Requirements: 5.7
     */
    onInputChange(e: WechatMiniprogram.Input) {
      const value = e.detail.value;
      this.setData({
        inputValue: value,
        canSend: Boolean(value.trim()),
        showAssistHint: shouldShowAssistHint(value),
      });
    },

    /**
     * 确认输入（按回车或点击发送）
     * Requirements: 5.7
     */
    onInputConfirm() {
      const value = this.data.inputValue.trim();
      if (!value) return;

      // 触感反馈
      wx.vibrateShort({ type: 'light' });

      this.triggerEvent('send', { text: value });
      this.setData({
        inputValue: '',
        canSend: false,
        showAssistHint: false,
      });
    },

    /**
     * 点击发送按钮
     */
    onSendTap() {
      this.onInputConfirm();
    },

    /**
     * 点击粘贴按钮
     * Requirements: 5.5
     */
    onPasteTap() {
      // 触感反馈 - Requirements: 15.17
      wx.vibrateShort({ type: 'light' });

      wx.getClipboardData({
        success: (res) => {
          if (res.data) {
            this.setData({
              inputValue: res.data,
              canSend: Boolean(res.data.trim()),
              showAssistHint: shouldShowAssistHint(res.data),
            });
          } else {
            wx.showToast({ title: '剪贴板为空', icon: 'none' });
          }
        },
        fail: () => {
          wx.showToast({ title: '读取剪贴板失败', icon: 'none' });
        },
      });
    },

    /**
     * 清空输入
     */
    onClearTap() {
      // 触感反馈
      wx.vibrateShort({ type: 'light' });
      
      this.setData({
        inputValue: '',
        canSend: false,
        showAssistHint: false,
      });
    },

    /**
     * 设置输入值（供外部调用）
     */
    setValue(value: string) {
      this.setData({
        inputValue: value,
        canSend: Boolean(value.trim()),
        showAssistHint: shouldShowAssistHint(value),
      });
    },

    /**
     * 清空并聚焦（供外部调用）
     */
    clearAndFocus() {
      this.setData({
        inputValue: '',
        canSend: false,
        isFocused: true,
        showAssistHint: false,
      });
    },


  },
});
