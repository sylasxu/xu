/**
 * 活动卡片组件
 * Requirements: 2.5, 2.6 - 点击Pin显示活动简要信息，点击卡片跳转详情页
 */
import { getActivitiesById } from '../../src/api/index';

interface Activity {
  id: string;
  title?: string;
  latitude?: number;
  longitude?: number;
  locationHint?: string;
  activityType?: string;
  startAt?: string;
  status?: string;
}

interface ActivityDetail {
  id: string;
  title: string;
  description?: string;
  startAt?: string;
  endAt?: string;
  locationName?: string;
  address?: string;
  locationHint?: string;
  maxParticipants?: number;
  currentParticipants?: number;
  type?: string;
  creator?: {
    id: string;
    nickname?: string;
    avatarUrl?: string;
  };
}

interface ComponentData {
  activityDetail: ActivityDetail | null;
  loading: boolean;
  error: boolean;
}

interface ComponentProperties {
  activity: Activity | null;
  mode: string;
  showDistance: boolean;
}

const ACTIVITY_TYPE_MAP: Record<string, string> = {
  food: '美食',
  entertainment: '娱乐',
  sports: '运动',
  boardgame: '桌游',
  other: '其他',
};

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    activity: {
      type: Object,
      value: {} as Activity,
    },
    mode: {
      type: String,
      value: 'popup',
    },
    showDistance: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    activityDetail: null as ActivityDetail | null,
    loading: false,
    error: false,
  },

  observers: {
    'activity.id': function (activityId: string) {
      if (activityId && this.properties.mode === 'popup') {
        this.loadActivityDetail(activityId);
      }
    },
  },

  lifetimes: {
    attached() {
      const { activity, mode } = this.properties;
      if (activity?.id && mode === 'popup') {
        this.loadActivityDetail(activity.id);
      }
    },
  },

  methods: {
    async loadActivityDetail(activityId: string) {
      if (!activityId) return;

      this.setData({ loading: true, error: false });

      try {
        const response = await getActivitiesById(activityId);

        if (response.status === 200) {
          this.setData({
            activityDetail: response.data as ActivityDetail,
            loading: false,
          });
        } else {
          throw new Error('获取活动详情失败');
        }
      } catch (error) {
        console.error('加载活动详情失败', error);
        this.setData({
          loading: false,
          error: true,
        });
      }
    },

    onCardTap() {
      this.triggerEvent('tap', {
        activity: this.properties.activity,
        activityDetail: this.data.activityDetail,
      });
    },

    onCreatorTap() {
      const { activityDetail } = this.data;
      if (activityDetail?.creator) {
        this.triggerEvent('creatortap', {
          creator: activityDetail.creator,
        });
      }
    },

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

    getActivityTypeText(type: string): string {
      return ACTIVITY_TYPE_MAP[type] || type;
    },
  },
});
