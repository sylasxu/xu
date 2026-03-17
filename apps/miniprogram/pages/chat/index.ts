/**
 * 活动群聊页面 (Lite_Chat)
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8
 * 
 * - 显示活动信息头部
 * - 实现消息发送和显示
 * - 实现轮询机制（5-10 秒）
 * - 实现 onHide 停止轮询、onShow 恢复轮询
 * - 实现归档状态（只读 + 提示）
 */
import { getChatByActivityIdMessages, postChatByActivityIdMessages } from '../../src/api/endpoints/chat/chat';
import { getActivitiesById } from '../../src/api/endpoints/activities/activities';
import type { GetChatByActivityIdMessagesParams } from '../../src/api/model';

// ==================== 类型定义 ====================

/** 消息类型 */
interface ChatMessage {
  id: string;
  content: string;
  senderId: string | null;
  senderNickname: string | null;
  senderAvatarUrl: string | null;
  type: string;
  createdAt: string;
  /** 是否是自己发送的 */
  isSelf: boolean;
  /** 是否是系统消息 */
  isSystem: boolean;
  /** 格式化后的时间 */
  formattedTime: string;
}

/** 活动信息 */
interface ActivityInfo {
  id: string;
  title: string;
  type: string;
  startAt: string;
  locationName: string;
  status: string;
  isArchived: boolean;
  currentParticipants: number;
  maxParticipants: number;
}

/** 页面数据 */
interface PageData {
  /** 活动 ID */
  activityId: string;
  /** 活动信息 */
  activity: ActivityInfo | null;
  /** 消息列表 */
  messages: ChatMessage[];
  /** 输入框内容 */
  inputValue: string;
  /** 滚动锚点 */
  scrollToMessage: string;
  /** 键盘高度 */
  keyboardHeight: number;
  /** 加载状态 */
  loading: boolean;
  /** 是否正在发送 */
  sending: boolean;
  /** 当前用户 ID */
  currentUserId: string;
  /** 是否已归档 */
  isArchived: boolean;
  /** 最后一条消息 ID（用于增量轮询） */
  lastMessageId: string;
  /** 是否正在轮询 */
  isPolling: boolean;
  /** 举报弹窗 */
  showReportSheet: boolean;
  /** 当前举报的消息 ID */
  reportMessageId: string;
}

/** 页面参数 */
interface PageOptions {
  activityId?: string;
}

const INITIAL_POLL_TIMER: number | null = null;

function readStorageString(key: string, fallback = ''): string {
  const value = wx.getStorageSync(key);
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function readResponseMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  if ('msg' in value && typeof value.msg === 'string' && value.msg.trim()) {
    return value.msg.trim();
  }

  if ('message' in value && typeof value.message === 'string' && value.message.trim()) {
    return value.message.trim();
  }

  return null;
}

// 轮询间隔（毫秒）
const POLL_INTERVAL = 5000; // 5 秒

Page<PageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    activityId: '',
    activity: null,
    messages: [],
    inputValue: '',
    scrollToMessage: '',
    keyboardHeight: 0,
    loading: true,
    sending: false,
    currentUserId: '',
    isArchived: false,
    lastMessageId: '',
    isPolling: false,
    showReportSheet: false,
    reportMessageId: '',
  },

  // 轮询定时器
  _pollTimer: INITIAL_POLL_TIMER,

  onLoad(options: PageOptions) {
    const { activityId } = options;
    if (!activityId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      wx.navigateBack();
      return;
    }

    // 获取当前用户 ID
    const currentUserId = readStorageString('userId');

    this.setData({
      activityId,
      currentUserId,
    });

    // 加载数据
    this.loadActivityInfo();
    this.loadMessages();
  },

  /**
   * 页面显示时恢复轮询
   * Requirements: 11.6 - onShow 恢复轮询
   */
  onShow() {
    if (this.data.activityId && !this.data.isArchived) {
      this.startPolling();
    }
  },

  /**
   * 页面隐藏时停止轮询
   * Requirements: 11.5 - onHide 停止轮询
   */
  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  // ==================== 数据加载 ====================

  /**
   * 加载活动信息
   * Requirements: 11.2 - 显示活动信息头部
   */
  async loadActivityInfo() {
    try {
      const response = await getActivitiesById(this.data.activityId);
      if (response.status === 200 && response.data) {
        const data = response.data;

        const activity: ActivityInfo = {
          id: data.id,
          title: data.title,
          type: data.type,
          startAt: data.startAt,
          locationName: data.locationName,
          status: data.status,
          isArchived: data.isArchived || false,
          currentParticipants: data.currentParticipants || 0,
          maxParticipants: data.maxParticipants || 0,
        };

        this.setData({ 
          activity,
          isArchived: activity.isArchived,
        });

        // 设置导航栏标题
        wx.setNavigationBarTitle({ title: activity.title });
      }
    } catch (error) {
      console.error('加载活动信息失败', error);
      wx.showToast({ title: '加载活动信息失败', icon: 'none' });
    }
  },

  /**
   * 加载消息列表
   * Requirements: 11.2 - 显示消息列表
   */
  async loadMessages(isPolling = false) {
    if (!isPolling) {
      this.setData({ loading: true });
    }

    try {
      const params: GetChatByActivityIdMessagesParams = {
        limit: 50,
      };

      // 增量获取：使用 since 参数
      if (isPolling && this.data.lastMessageId) {
        params.since = this.data.lastMessageId;
      }

      const response = await getChatByActivityIdMessages(this.data.activityId, params);

      if (response.status === 200 && response.data) {
        const { messages: rawMessages, isArchived } = response.data;

        // 更新归档状态
        if (isArchived !== this.data.isArchived) {
          this.setData({ isArchived });
          
          // 如果变为归档状态，停止轮询
          if (isArchived) {
            this.stopPolling();
          }
        }

        // 格式化消息
        const newMessages: ChatMessage[] = (rawMessages || []).map((msg) => ({
          id: msg.id,
          content: msg.content,
          senderId: msg.senderId,
          senderNickname: msg.senderNickname,
          senderAvatarUrl: msg.senderAvatarUrl,
          type: msg.type,
          createdAt: msg.createdAt,
          isSelf: msg.senderId === this.data.currentUserId,
          isSystem: msg.type === 'system' || !msg.senderId,
          formattedTime: this.formatTime(msg.createdAt),
        }));

        if (isPolling && newMessages.length > 0) {
          // 增量更新：追加新消息
          const messages = [...this.data.messages, ...newMessages];
          const lastMessageId = newMessages[newMessages.length - 1].id;
          
          this.setData({
            messages,
            lastMessageId,
            loading: false,
          });
          
          // 滚动到底部
          this.scrollToBottom();
        } else if (!isPolling) {
          // 首次加载
          const lastMessageId = newMessages.length > 0 
            ? newMessages[newMessages.length - 1].id 
            : '';
          
          this.setData({
            messages: newMessages,
            lastMessageId,
            loading: false,
          });
          
          // 滚动到底部
          this.scrollToBottom();
          
          // 开始轮询（如果未归档）
          if (!isArchived) {
            this.startPolling();
          }
        }
      }
    } catch (error) {
      console.error('加载消息失败', error);
      if (!isPolling) {
        this.setData({ loading: false });
        wx.showToast({ title: '加载消息失败', icon: 'none' });
      }
    }
  },

  // ==================== 轮询机制 ====================

  /**
   * 开始轮询
   * Requirements: 11.4 - 每 5-10 秒轮询新消息
   */
  startPolling() {
    if (this.data.isPolling || this.data.isArchived) {
      return;
    }

    this.setData({ isPolling: true });
    
    this._pollTimer = Number(setInterval(() => {
      this.loadMessages(true);
    }, POLL_INTERVAL));
  },

  /**
   * 停止轮询
   * Requirements: 11.5 - onHide 停止轮询
   */
  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this.setData({ isPolling: false });
  },

  // ==================== 事件处理 ====================

  /**
   * 输入框内容变化
   */
  onInputChange(e: WechatMiniprogram.Input) {
    this.setData({ inputValue: e.detail.value });
  },

  /**
   * 键盘高度变化
   */
  onKeyboardHeightChange(e: WechatMiniprogram.CustomEvent<{ height: number }>) {
    const { height } = e.detail;
    this.setData({ keyboardHeight: height });

    if (height > 0) {
      this.scrollToBottom();
    }
  },

  /**
   * 输入框失焦
   */
  onInputBlur() {
    this.setData({ keyboardHeight: 0 });
  },

  /**
   * 发送消息
   * Requirements: 11.3 - 发送文本消息
   */
  async onSendMessage() {
    const { inputValue, activityId, sending, isArchived } = this.data;

    if (!inputValue.trim() || sending) return;

    // 检查是否已归档
    // Requirements: 11.7, 11.8 - 归档状态禁用发送
    if (isArchived) {
      wx.showToast({ title: '群聊已归档，无法发送消息', icon: 'none' });
      return;
    }

    this.setData({ sending: true });

    try {
      const response = await postChatByActivityIdMessages(activityId, {
        content: inputValue.trim(),
      });

      if (response.status === 200) {
        // 清空输入框
        this.setData({ inputValue: '' });

        // 本地添加消息（乐观更新）
        const userInfo = {
          nickname: readStorageString('userNickname', '我'),
          avatarUrl: readStorageString('userAvatarUrl'),
        };
        
        const localMessage: ChatMessage = {
          id: response.data.id || `local_${Date.now()}`,
          content: inputValue.trim(),
          senderId: this.data.currentUserId,
          senderNickname: userInfo.nickname,
          senderAvatarUrl: userInfo.avatarUrl,
          type: 'text',
          createdAt: new Date().toISOString(),
          isSelf: true,
          isSystem: false,
          formattedTime: this.formatTime(new Date().toISOString()),
        };

        const messages = [...this.data.messages, localMessage];
        this.setData({ 
          messages,
          lastMessageId: localMessage.id,
        });
        this.scrollToBottom();
      } else {
        throw new Error(readResponseMessage(response.data) || '发送失败');
      }
    } catch (error) {
      console.error('发送消息失败', error);
      wx.showToast({
        title: error instanceof Error ? error.message : '发送失败',
        icon: 'none',
      });
    } finally {
      this.setData({ sending: false });
    }
  },

  /**
   * 点击活动头部，跳转到活动详情
   */
  onActivityTap() {
    wx.navigateTo({
      url: `/subpackages/activity/detail/index?id=${this.data.activityId}`,
    });
  },

  /**
   * 返回上一页
   */
  onBackTap() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: '/pages/home/index' });
    }
  },

  /**
   * 长按消息举报
   */
  onMessageLongPress(e: WechatMiniprogram.CustomEvent<{}, {}, { id: string; isSelf: boolean }>) {
    const { id, isSelf } = e.currentTarget.dataset;
    
    // 不能举报自己的消息
    if (isSelf) return;
    
    const token = readStorageString('token');
    if (!token) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    // 触感反馈
    wx.vibrateShort({ type: 'light' });

    this.setData({
      reportMessageId: id,
      showReportSheet: true,
    });
  },

  /**
   * 关闭举报弹窗
   */
  onReportClose() {
    this.setData({
      showReportSheet: false,
      reportMessageId: '',
    });
  },

  /**
   * 举报成功回调
   */
  onReportSuccess() {
    this.setData({
      showReportSheet: false,
      reportMessageId: '',
    });
  },

  // ==================== 辅助方法 ====================

  /**
   * 滚动到底部
   */
  scrollToBottom() {
    const { messages } = this.data;
    if (messages.length > 0) {
      setTimeout(() => {
        this.setData({
          scrollToMessage: `msg-${messages[messages.length - 1].id}`,
        });
      }, 100);
    }
  },

  /**
   * 格式化时间
   */
  formatTime(dateStr: string): string {
    if (!dateStr) return '';

    const date = new Date(dateStr);
    const now = new Date();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;

    // 今天只显示时间
    if (date.toDateString() === now.toDateString()) {
      return timeStr;
    }

    // 昨天
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return `昨天 ${timeStr}`;
    }

    // 其他日期
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}/${day} ${timeStr}`;
  },

  /**
   * 获取活动类型图标
   */
  getTypeIcon(type: string): string {
    const iconMap: Record<string, string> = {
      food: 'restaurant',
      sports: 'sports',
      boardgame: 'extension',
      entertainment: 'movie',
      other: 'more',
    };
    return iconMap[type] || 'more';
  },
});
