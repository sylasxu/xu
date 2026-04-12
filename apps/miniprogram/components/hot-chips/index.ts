/**
 * Hot Chips 组件
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.10
 * 
 * 热词快捷入口组件
 * - 位置：首页 AI 输入框上方
 * - 外观：横向滚动的 Chip 列表
 * - 功能：点击后自动发送消息到 AI
 */

interface Keyword {
  id: string;
  keyword: string;
  matchType: 'exact' | 'prefix' | 'fuzzy';
  responseType: string;
  priority: number;
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 热词列表
    keywords: {
      type: Array,
      value: [] as Keyword[],
    },
  },
  methods: {
    /**
     * 点击 Chip - Requirements: 3.5, 3.6, 3.10
     */
    onChipClick(e: WechatMiniprogram.TouchEvent) {
      const { id, keyword } = e.currentTarget.dataset;
      
      // 埋点：记录点击事件 - Requirements: 3.10
      wx.reportEvent('hot_chip_click', {
        keyword_id: id,
        keyword_text: keyword,
      });

      // 触发自定义事件，传递关键词和 ID 到父组件 - Requirements: 3.5, 3.6
      this.triggerEvent('chipclick', {
        id,
        keyword,
      });
    },
  },
});
