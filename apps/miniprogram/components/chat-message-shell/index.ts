/**
 * Message Bubble 组件
 * Requirements: 15.6, 15.7
 * 
 * 消息气泡组件
 * - 用户气泡样式（矢车菊蓝渐变 + 白色文字）
 * - AI 气泡样式（透明背景 + 深灰文字）
 * - 消息入场动画
 */

interface ComponentData {
  formattedContent: string;
}

interface ComponentProperties {
  role: WechatMiniprogram.Component.PropertyOption;
  content: WechatMiniprogram.Component.PropertyOption;
  timestamp: WechatMiniprogram.Component.PropertyOption;
  showTimestamp: WechatMiniprogram.Component.PropertyOption;
}

function readBubbleString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 消息角色：user 或 assistant
    role: {
      type: String,
      value: 'user',
    },
    // 消息内容
    content: {
      type: String,
      value: '',
    },
    // 时间戳
    timestamp: {
      type: String,
      value: '',
    },
    // 是否显示时间戳
    showTimestamp: {
      type: Boolean,
      value: false,
    },
    // 是否正在流式输出（显示打字光标）
    isStreaming: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    formattedContent: '',
  },

  observers: {
    'content': function(content: string) {
      // 简单的文本格式化（可扩展为 Markdown 解析）
      this.setData({
        formattedContent: this.formatContent(content),
      });
    },
  },

  methods: {
    /**
     * 格式化消息内容
     * 简单处理换行和链接
     */
    formatContent(content: string): string {
      if (!content) return '';
      
      // 处理换行
      let formatted = content.replace(/\n/g, '<br/>');
      
      // 处理链接（简单实现）
      formatted = formatted.replace(
        /(https?:\/\/[^\s]+)/g,
        '<a href="$1" class="link">$1</a>'
      );
      
      return formatted;
    },

    /**
     * 格式化时间戳
     */
    formatTimestamp(timestamp: string): string {
      if (!timestamp) return '';
      
      const date = new Date(timestamp);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      
      // 1 分钟内
      if (diff < 60000) {
        return '刚刚';
      }
      
      // 1 小时内
      if (diff < 3600000) {
        return `${Math.floor(diff / 60000)} 分钟前`;
      }
      
      // 今天
      if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      }
      
      // 昨天
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      if (date.toDateString() === yesterday.toDateString()) {
        return `昨天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
      }
      
      // 更早
      return date.toLocaleDateString('zh-CN', { 
        month: 'numeric', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    },

    /**
     * 长按复制
     */
    onLongPress() {
      const content = readBubbleString(this.properties.content) || '';
      if (!content) return;
      
      wx.setClipboardData({
        data: content,
        success: () => {
          wx.showToast({ title: '已复制', icon: 'success' });
        },
      });
    },
  },
});
