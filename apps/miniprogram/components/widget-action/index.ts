/**
 * Widget Action 组件 (Simple Widget)
 * Requirements: Simple Widget Design, 快捷操作
 * 
 * 简单跳转按钮
 * - label + icon + url
 * - 使用 Halo Card Mini 样式（紧凑版渐变边框）
 * - 支持三种样式变体：primary / secondary / ghost
 * - 支持深色模式
 */

function readWidgetActionString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 按钮文字
    label: {
      type: String,
      value: '操作',
    },
    // 图标名称（TDesign icon）
    icon: {
      type: String,
      value: '',
    },
    // 跳转链接
    url: {
      type: String,
      value: '',
    },
    // 样式变体：primary / secondary / ghost
    variant: {
      type: String,
      value: 'secondary',
    },
    // 是否禁用
    disabled: {
      type: Boolean,
      value: false,
    },
    // 开放能力（如 share）
    openType: {
      type: String,
      value: '',
    },
  },

  methods: {
    /**
     * 点击按钮
     */
    onTap() {
      if (this.properties.disabled) return;
      
      // 触感反馈
      wx.vibrateShort({ type: 'light' });
      
      // 触发事件
      this.triggerEvent('tap');
      
      // 如果有 URL，执行跳转
      const url = readWidgetActionString(this.properties.url);
      if (url) {
        this.navigateTo(url);
      }
    },

    /**
     * 跳转页面
     */
    navigateTo(url: string) {
      if (!url) return;
      
      // 判断是否是 tabBar 页面
      const tabBarPages = ['/pages/home/index', '/pages/profile/index', '/pages/message/index'];
      const isTabBar = tabBarPages.some(page => url.startsWith(page));
      
      if (isTabBar) {
        wx.switchTab({ url });
      } else if (url.startsWith('http')) {
        // 外部链接，使用 webview
        wx.navigateTo({
          url: `/pages/webview/index?url=${encodeURIComponent(url)}`,
        });
      } else {
        wx.navigateTo({ url });
      }
    },

    /**
     * 分享按钮回调
     */
    onShareTap() {
      // 分享由 button open-type="share" 处理
      this.triggerEvent('share');
    },
  },
});
