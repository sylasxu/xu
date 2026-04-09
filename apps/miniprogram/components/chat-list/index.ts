/**
 * Chat List 组件
 * Requirements: 1.4, 3.1, 15.16
 * 
 * Chat-First 架构的对话流容器
 * - 无限滚动容器
 * - 用户消息（右侧对齐）和 AI 消息（左侧对齐）
 * - 新消息自动滚动到底部
 * - 新消息"上浮 + 淡入"组合动画
 */

// 滚动防抖定时器（模块级变量）
let scrollTimer: number | null = null;

interface ChatMessage {
  id: string;
}

interface ComponentData {
  scrollToView: string;
  scrollTop: number;
  isScrolling: boolean;
}

Component({
  options: {
    styleIsolation: 'apply-shared',
    virtualHost: true,
  },

  properties: {
    // 消息列表
    messages: {
      type: Array,
      value: [] as ChatMessage[],
    },
    // 是否正在加载
    loading: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    scrollToView: '',
    scrollTop: 0,
    isScrolling: false,
  } as ComponentData,

  observers: {
    /**
     * 监听消息列表变化
     * Requirements: 1.4 - 新消息自动滚动到底部
     */
    'messages': function(messages: ChatMessage[]) {
      if (messages && messages.length > 0) {
        // 延迟滚动，等待 DOM 更新
        setTimeout(() => {
          this.scrollToBottom();
        }, 100);
      }
    },
  },

  lifetimes: {
    attached() {
      // 初始滚动到底部
      this.scrollToBottom();
    },
    detached() {
      // 清理定时器
      if (scrollTimer !== null) {
        clearTimeout(scrollTimer);
        scrollTimer = null;
      }
    },
  },

  methods: {
    /**
     * 滚动到底部
     * Requirements: 1.4
     */
    scrollToBottom() {
      const messages = this.data.messages as ChatMessage[];
      if (messages && messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        this.setData({
          scrollToView: `msg-${lastMessage.id}`,
        });
      }
    },

    /**
     * 滚动事件处理
     */
    onScroll(e: WechatMiniprogram.ScrollViewScroll) {
      this.setData({
        scrollTop: e.detail.scrollTop,
        isScrolling: true,
      });
      
      // 防抖：滚动停止后重置状态
      if (scrollTimer !== null) {
        clearTimeout(scrollTimer);
      }
      scrollTimer = Number(setTimeout(() => {
        this.setData({ isScrolling: false });
      }, 150));
      
      this.triggerEvent('scroll', e.detail);
    },

    /**
     * 滚动到顶部事件
     */
    onScrollToUpper() {
      this.triggerEvent('loadmore');
    },

  },
});
