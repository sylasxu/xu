/**
 * Widget Share 组件
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 13.1, 13.2, 13.3, 13.4
 * 
 * 创建成功卡片 (v3.5 零成本地图方案)
 * - 显示原生分享卡片预览
 * - 使用位置文字卡片替代静态地图（零成本）
 * - 实现 [📤 分享到群] 按钮
 * - 实现 [👀 查看详情] 按钮
 * - 使用 AI 生成的骚气标题
 */

import { openMapNavigation } from '../../src/config/index';

// 活动数据类型
interface ActivityData {
  id: string;
  title: string;
  type: string;
  startAt: string;
  location: [number, number]; // [lng, lat]
  locationName: string;
  locationHint?: string;
  maxParticipants: number;
  currentParticipants?: number;
  shareTitle?: string; // AI 生成的骚气标题
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readLocation(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }

  const lng = readNumber(value[0]);
  const lat = readNumber(value[1]);
  if (lng === null || lat === null) {
    return null;
  }

  return [lng, lat];
}

function readActivityData(value: unknown): ActivityData | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id);
  const title = readString(value.title);
  const type = readString(value.type);
  const startAt = readString(value.startAt);
  const location = readLocation(value.location);
  const locationName = readString(value.locationName);
  const maxParticipants = readNumber(value.maxParticipants);

  if (!id || !title || !type || !startAt || !location || !locationName || maxParticipants === null) {
    return null;
  }

  const activity: ActivityData = {
    id,
    title,
    type,
    startAt,
    location,
    locationName,
    maxParticipants,
  };

  const locationHint = readString(value.locationHint);
  const shareTitle = readString(value.shareTitle);
  const currentParticipants = readNumber(value.currentParticipants);

  if (locationHint) {
    activity.locationHint = locationHint;
  }
  if (shareTitle) {
    activity.shareTitle = shareTitle;
  }
  if (currentParticipants !== null) {
    activity.currentParticipants = currentParticipants;
  }

  return activity;
}

const EMPTY_ACTIVITY: ActivityData = {
  id: '',
  title: '',
  type: '',
  startAt: '',
  location: [0, 0],
  locationName: '',
  maxParticipants: 0,
};

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 活动数据
    activity: {
      type: Object,
      value: EMPTY_ACTIVITY,
    },
  },

  data: {
    formattedTime: '',
    shareTitle: '',
    participantsText: '',
  },

  lifetimes: {
    attached() {
      // 启用分享功能
      // 注意：实际分享需要在页面的 onShareAppMessage 中处理
      // 这里只是确保分享菜单可用
    },
  },

  observers: {
    'activity': function(activity: unknown) {
      const resolvedActivity = readActivityData(activity);
      if (!resolvedActivity) return;
      
      // 格式化时间
      const formattedTime = this.formatTime(resolvedActivity.startAt);
      
      // 生成骚气分享标题 - Requirements: 13.2
      const shareTitle = this.generateShareTitle(resolvedActivity);
      
      // 参与人数
      const current = resolvedActivity.currentParticipants || 1;
      const max = resolvedActivity.maxParticipants;
      const remaining = max - current;
      const participantsText = remaining > 0 
        ? `还差 ${remaining} 人` 
        : '人数已满';
      
      this.setData({
        formattedTime,
        shareTitle,
        participantsText,
      });
    },
  },

  methods: {
    /**
     * 生成骚气分享标题 - Requirements: 13.2
     * 优先使用 AI 生成的标题，否则根据活动信息生成
     */
    generateShareTitle(activity: ActivityData): string {
      // 如果有 AI 生成的标题，直接使用
      if (activity.shareTitle) {
        return activity.shareTitle;
      }
      
      // 计算空位数
      const current = activity.currentParticipants || 1;
      const max = activity.maxParticipants;
      const remaining = max - current;
      
      // 根据活动类型和空位数生成标题
      let title = '';
      if (remaining > 0) {
        title = `🔥 ${activity.title}，${remaining}缺1，速来！`;
      } else {
        title = `🎉 ${activity.title}，已满员！`;
      }
      
      // 添加地点信息
      if (activity.locationName) {
        title = `${title.replace('！', '')}@${activity.locationName}！`;
      }
      
      return title;
    },

    /**
     * 格式化时间
     */
    formatTime(dateStr: string): string {
      if (!dateStr) return '';
      
      const date = new Date(dateStr);
      const now = new Date();
      
      // 判断是否是今天
      const isToday = date.toDateString() === now.toDateString();
      
      // 判断是否是明天
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = date.toDateString() === tomorrow.toDateString();
      
      // 格式化时间
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;
      
      if (isToday) {
        return `今天 ${timeStr}`;
      }
      
      if (isTomorrow) {
        return `明天 ${timeStr}`;
      }
      
      // 其他日期
      const month = date.getMonth() + 1;
      const day = date.getDate();
      return `${month}月${day}日 ${timeStr}`;
    },

    /**
     * 点击位置卡片 - 打开原生地图导航
     */
    onLocationTap() {
      const activity = readActivityData(this.properties.activity);
      if (!activity) return;
      
      const [lng, lat] = activity.location;
      
      // 使用微信原生 API 打开地图
      openMapNavigation({
        latitude: lat,
        longitude: lng,
        name: activity.locationName,
        address: activity.locationHint || '',
      });
    },

    /**
     * 点击分享到群
     * Requirements: 7.3, 7.4, 13.1
     * 
     * 注意：button 的 open-type="share" 会自动触发页面的 onShareAppMessage
     * 这里只需要触发事件通知父组件
     */
    onShareTap() {
      const activity = readActivityData(this.properties.activity);
      if (!activity) return;
      
      // 触感反馈
      wx.vibrateShort({ type: 'light' });
      
      // 触发分享事件，通知父组件
      this.triggerEvent('share', { 
        activity,
        shareTitle: this.data.shareTitle,
      });
    },

    /**
     * 点击查看详情
     * Requirements: 7.5, 7.6
     */
    onViewDetail() {
      const activity = readActivityData(this.properties.activity);
      if (!activity) return;
      
      // 触感反馈
      wx.vibrateShort({ type: 'light' });
      
      // 触发事件
      this.triggerEvent('viewdetail', { activity });
      
      // 跳转到活动详情页
      wx.navigateTo({
        url: `/subpackages/activity/detail/index?id=${activity.id}`,
      });
    },
  },
});
