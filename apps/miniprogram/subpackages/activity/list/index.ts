/**
 * 活动列表页
 * Requirements: 8.5, 8.6, 8.7
 * 支持三种类型：created（我发布的）、joined（我参与的）、archived（已结束活动）
 */
import { getActivitiesUserByUserId } from '../../../src/api/endpoints/activities/activities';
import type { ActivityMyActivitiesResponseDataItem } from '../../../src/api/model';
import { useUserStore } from '../../../src/stores/user';

type ListType = 'created' | 'joined' | 'archived';

interface Activity {
  id: string;
  title: string;
  status: string;
  statusText: string;
  locationHint: string;
  locationName?: string;
  startAt: string;
  startAtText: string;
  currentParticipants: number;
  maxParticipants: number;
  isArchived?: boolean;
}

// 状态文本映射
const STATUS_TEXT: Record<string, string> = {
  draft: '草稿',
  active: '进行中',
  completed: '已完成',
  cancelled: '已取消',
};

Page({
  data: {
    type: 'created' as ListType,
    title: '我发布的',
    emptyText: '还没有发布过活动',
    activities: [] as Activity[],
    loading: false,
    refreshing: false,
  },

  onLoad(options: { type?: string }) {
    const type = (options.type || 'created') as ListType;

    const titleMap: Record<ListType, string> = {
      created: '我发布的',
      joined: '我参与的',
      archived: '已结束活动',
    };

    const emptyTextMap: Record<ListType, string> = {
      created: '还没有发布过活动',
      joined: '还没有参与过活动',
      archived: '还没有已结束活动',
    };

    this.setData({
      type,
      title: titleMap[type],
      emptyText: emptyTextMap[type],
    });

    this.loadActivities();
  },

  onShow() {
    // 每次显示时刷新数据
    if (this.data.type) {
      this.loadActivities();
    }
  },

  /**
   * 加载活动列表
   */
  async loadActivities() {
    if (this.data.loading) return;

    this.setData({ loading: true });

    try {
      const { type } = this.data;
      const userStore = useUserStore.getState();
      const userId = userStore.user?.id || '';
      if (!userId) {
        throw new Error('缺少用户ID，请重新登录');
      }
      
      // 调用 API 获取活动列表
      const response = await getActivitiesUserByUserId(userId, {
        type: type === 'archived' ? undefined : type,
      });

      if (response.status === 200) {
        let activities = response.data?.data || [];
        
        // 处理归档筛选 - CP-7: isArchived = now > startAt + 24h
        if (type === 'archived') {
          activities = activities.filter((a: ActivityMyActivitiesResponseDataItem) => a.isArchived === true);
        } else {
          activities = activities.filter((a: ActivityMyActivitiesResponseDataItem) => a.isArchived !== true);
        }

        // 格式化活动数据
        const formattedActivities: Activity[] = activities.map((a: ActivityMyActivitiesResponseDataItem) => ({
          id: a.id,
          title: a.title,
          status: a.status,
          statusText: STATUS_TEXT[a.status] || a.status,
          locationHint: a.locationHint || a.locationName || '未知地点',
          locationName: a.locationName,
          startAt: a.startAt,
          startAtText: this.formatTime(a.startAt),
          currentParticipants: a.currentParticipants || 0,
          maxParticipants: a.maxParticipants || 0,
          isArchived: a.isArchived,
        }));

        this.setData({ activities: formattedActivities });
      } else {
        const errorData = response.data as { msg?: string } | undefined;
        throw new Error(errorData?.msg || '加载失败');
      }
    } catch (err) {
      console.error('Load activities failed:', err);
      wx.showToast({
        title: '加载失败',
        icon: 'none',
      });
    } finally {
      this.setData({ loading: false, refreshing: false });
    }
  },

  /**
   * 格式化时间
   */
  formatTime(dateStr: string): string {
    if (!dateStr) return '';

    const date = new Date(dateStr);
    const now = new Date();

    const isToday = date.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow = date.toDateString() === tomorrow.toDateString();

    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;

    if (isToday) return `今天 ${timeStr}`;
    if (isTomorrow) return `明天 ${timeStr}`;

    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}月${day}日 ${timeStr}`;
  },

  /**
   * 下拉刷新
   */
  onRefresh() {
    this.setData({ refreshing: true });
    this.loadActivities();
  },

  /**
   * 跳转到活动详情
   */
  goToDetail(e: WechatMiniprogram.TouchEvent) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/subpackages/activity/detail/index?id=${id}`,
    });
  },

  /**
   * 返回 - CP-12: 页面栈长度为 1 时，返回按钮跳转首页
   */
  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: '/pages/home/index' });
    }
  },
});
