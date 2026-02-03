/**
 * Chat Tool Mode - 活动详情页
 * Requirements: 4.1, 4.4, 4.5, 5.1, 5.2, 5.5
 * 
 * 半屏模式下的活动详情展示
 * - 支持 Skyline 渲染引擎
 * - 半屏布局（无顶部导航栏）
 * - 巨大的固定报名按钮
 * - 支持下滑关闭
 */

import { getActivitiesId, postActivitiesIdJoin } from '../../src/api/endpoints/activities/activities';

interface Activity {
  id: string;
  title: string;
  description: string | null;
  locationName: string;
  locationHint: string;
  startAt: string;
  type: string;
  maxParticipants: number;
  currentParticipants: number;
  status: string;
  creator: {
    id: string;
    nickname: string;
    avatarUrl: string | null;
  } | null;
}

interface PageData {
  activity: Activity | null;
  loading: boolean;
  joining: boolean;
  isChatToolMode: boolean;
  hasJoined: boolean;
  isFull: boolean;
  isCreator: boolean;
}

Page<PageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    activity: null,
    loading: true,
    joining: false,
    isChatToolMode: false,
    hasJoined: false,
    isFull: false,
    isCreator: false,
  },

  onLoad(options: { id?: string }) {
    const activityId = options.id;
    if (!activityId) {
      wx.showToast({ title: '活动不存在', icon: 'error' });
      return;
    }

    // 检测是否为 Chat Tool Mode
    this.checkChatToolMode();
    
    // 加载活动详情
    this.loadActivity(activityId);
  },

  /**
   * 检测当前是否处于聊天工具模式
   */
  checkChatToolMode() {
    try {
      // @ts-ignore - wx.getApiCategory 是新 API
      const apiCategory = wx.getApiCategory?.() || 'default';
      this.setData({
        isChatToolMode: apiCategory === 'chatTool',
      });
    } catch (e) {
      this.setData({ isChatToolMode: false });
    }
  },

  /**
   * 加载活动详情
   */
  async loadActivity(activityId: string) {
    this.setData({ loading: true });

    try {
      const response = await getActivitiesId(activityId);
      
      if (response.status === 200 && response.data) {
        const activity = response.data as Activity;
        const userId = wx.getStorageSync('userId') || '';
        
        this.setData({
          activity,
          loading: false,
          isFull: activity.currentParticipants >= activity.maxParticipants,
          isCreator: activity.creator?.id === userId,
          hasJoined: false,
        });
      } else {
        wx.showToast({ title: '加载失败', icon: 'error' });
        this.setData({ loading: false });
      }
    } catch (error) {
      console.error('Failed to load activity:', error);
      wx.showToast({ title: '网络错误', icon: 'error' });
      this.setData({ loading: false });
    }
  },

  /**
   * 报名活动
   */
  async onJoin() {
    const { activity, joining, hasJoined, isFull, isCreator } = this.data;
    
    if (!activity || joining || hasJoined || isFull || isCreator) {
      return;
    }

    // 检查登录状态
    const token = wx.getStorageSync('token') || '';
    if (!token) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    this.setData({ joining: true });

    try {
      const response = await postActivitiesIdJoin(activity.id);
      
      if (response.status === 200) {
        this.setData({
          joining: false,
          hasJoined: true,
        });
        
        // 更新参与人数
        if (this.data.activity) {
          this.setData({
            'activity.currentParticipants': this.data.activity.currentParticipants + 1,
          });
        }

        wx.showToast({ title: '报名成功！', icon: 'success' });

        // 震动反馈
        wx.vibrateShort({ type: 'medium' });
      } else {
        const errorMsg = (response.data as { msg?: string })?.msg || '报名失败';
        wx.showToast({ title: errorMsg, icon: 'error' });
        this.setData({ joining: false });
      }
    } catch (error) {
      console.error('Failed to join activity:', error);
      wx.showToast({ title: '网络错误', icon: 'error' });
      this.setData({ joining: false });
    }
  },

  /**
   * 关闭半屏（下滑关闭）
   */
  onClose() {
    if (this.data.isChatToolMode) {
      wx.navigateBack();
    }
  },

  /**
   * 格式化时间
   */
  formatTime(dateStr: string): string {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${month}月${day}日 ${hours}:${minutes}`;
  },

  /**
   * 获取活动类型显示名称
   */
  getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      food: '🍲 美食',
      entertainment: '🎮 娱乐',
      sports: '⚽ 运动',
      boardgame: '🎴 桌游',
      other: '✨ 其他',
    };
    return labels[type] || type;
  },
});
