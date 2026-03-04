/**
 * Widget Dashboard 组件
 * Requirements: 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 7.0
 * v4.4 重构: 增加社交档案卡片和快捷入口
 * 
 * 进场欢迎卡片
 * - 动态问候语（API 返回）
 * - 社交档案卡片（参与/发起统计 + 偏好完善引导）
 * - 快捷入口（预设 Prompt）
 * - 分组快捷操作（draft/suggestions/explore）
 * - 待参加活动列表（最多 3 个）
 */

// 活动类型
interface Activity {
  id: string;
  title: string;
  type: string;
  startAt: string;
  locationName?: string;
  locationHint?: string;
  currentParticipants?: number;
  maxParticipants?: number;
}

// 快捷项类型 (v3.10)
type QuickItemType = 'draft' | 'suggestion' | 'explore';

// 快捷项
interface QuickItem {
  type: QuickItemType;
  icon?: string;
  label: string;
  prompt: string;
  context?: Record<string, unknown>;
}

// 分组
interface WelcomeSection {
  id: string;
  icon: string;
  title: string;
  items: QuickItem[];
}

// 社交档案 (v4.4 新增)
interface SocialProfile {
  participationCount: number;
  activitiesCreatedCount: number;
  preferenceCompleteness: number;
}

// 快捷入口 (v4.4 新增)
interface QuickPrompt {
  icon: string;
  text: string;
  prompt: string;
}

interface ComponentData {
  greeting: string;
  subGreeting: string;
  sections: WelcomeSection[];
  displayActivities: Activity[];
  hasActivities: boolean;
  hasSections: boolean;
  // v4.4 新增
  socialProfile: SocialProfile | null;
  quickPrompts: QuickPrompt[];
  hasSocialProfile: boolean;
  hasQuickPrompts: boolean;
  // 从 properties 同步
  nickname: string;
  ui: {
    bottomQuickActions?: string[];
    profileHints?: {
      low?: string;
      medium?: string;
      high?: string;
    };
  } | null;
}

Component({
  options: {
    styleIsolation: 'apply-shared',
  },

  properties: {
    // 用户昵称
    nickname: {
      type: String,
      value: '搭子',
    },
    // 待参加活动列表
    activities: {
      type: Array,
      value: [] as Activity[],
    },
    // v3.10: API 返回的问候语
    greeting: {
      type: String,
      value: '',
    },
    // v3.10: API 返回的副标题
    subGreeting: {
      type: String,
      value: '',
    },
    // v3.10: 分组列表
    sections: {
      type: Array,
      value: [] as WelcomeSection[],
    },
    // v4.4: 社交档案
    socialProfile: {
      type: Object,
      value: {} as any,
    },
    // v4.4: 快捷入口
    quickPrompts: {
      type: Array,
      value: [] as QuickPrompt[],
    },
    ui: {
      type: Object,
      value: {} as any,
    },
  },

  data: {
    greeting: '',
    subGreeting: '',
    sections: [] as WelcomeSection[],
    displayActivities: [] as Activity[],
    hasActivities: false,
    hasSections: false,
    // v4.4 新增
    socialProfile: null as SocialProfile | null,
    quickPrompts: [] as QuickPrompt[],
    hasSocialProfile: false,
    hasQuickPrompts: false,
    nickname: '搭子',
    ui: null,
  } as ComponentData,

  observers: {
    'activities': function(activities: Activity[]) {
      // 最多显示 3 个活动
      const displayActivities = (activities || []).slice(0, 3);
      this.setData({
        displayActivities,
        hasActivities: displayActivities.length > 0,
      });
    },
    'greeting, subGreeting': function() {
      this.updateGreeting();
    },
    'sections': function(sections: WelcomeSection[]) {
      this.setData({
        sections: sections || [],
        hasSections: (sections || []).length > 0,
      });
    },
    // v4.4 新增
    'socialProfile': function(profile: SocialProfile | null) {
      // 检查是否有有效数据（空对象视为无数据）
      const hasValidProfile = profile && typeof profile === 'object' && 'participationCount' in profile;
      this.setData({
        socialProfile: hasValidProfile ? profile : null,
        hasSocialProfile: !!hasValidProfile,
      });
    },
    'quickPrompts': function(prompts: QuickPrompt[]) {
      this.setData({
        quickPrompts: prompts || [],
        hasQuickPrompts: (prompts || []).length > 0,
      });
    },
    'ui': function(ui: ComponentData['ui']) {
      this.setData({
        ui: ui && typeof ui === 'object' ? ui : null,
      });
    },
  },

  lifetimes: {
    attached() {
      this.updateGreeting();
    },
  },

  methods: {
    /**
     * 更新问候语
     * v3.10: 使用 welcome API 返回的问候语字段
     */
    updateGreeting() {
      const apiGreeting = this.properties.greeting as string;
      const apiSubGreeting = this.properties.subGreeting as string;

      this.setData({
        greeting: apiGreeting || '你好～',
        subGreeting: apiSubGreeting || '今天想约什么局？',
      });
    },

    /**
     * 点击活动卡片
     */
    onActivityTap(e: WechatMiniprogram.TouchEvent) {
      const { id } = e.currentTarget.dataset;
      if (!id) return;
      
      this.triggerEvent('activitytap', { id });
      wx.navigateTo({
        url: `/subpackages/activity/detail/index?id=${id}`,
      });
    },

    /**
     * 点击快捷项
     * v3.10: 统一处理所有类型的快捷项
     */
    onQuickItemTap(e: WechatMiniprogram.TouchEvent) {
      const item = e.currentTarget.dataset.item as QuickItem;
      if (!item) return;

      // 触发通用事件
      this.triggerEvent('quickitemtap', { item });

      // 根据类型执行不同操作
      switch (item.type) {
        case 'draft': {
          // 继续草稿 → 发送 prompt 或跳转
          const activityId = item.context?.activityId as string;
          if (activityId) {
            wx.navigateTo({
              url: `/subpackages/activity/confirm/index?activityId=${activityId}`,
            });
          } else {
            this.triggerEvent('prompttap', { prompt: item.prompt });
          }
          break;
        }
        case 'suggestion': {
          // 快速组局建议 → 发送 prompt
          this.triggerEvent('prompttap', { prompt: item.prompt });
          break;
        }
        case 'explore': {
          // 探索附近 → 发送 prompt
          this.triggerEvent('prompttap', { prompt: item.prompt });
          break;
        }
      }
    },

    /**
     * 点击查看全部活动
     */
    onViewAllTap() {
      this.triggerEvent('viewall');
      wx.navigateTo({
        url: '/subpackages/activity/list/index?type=joined',
      });
    },

    /**
     * v4.4: 快捷入口点击
     */
    onQuickPromptTap(e: WechatMiniprogram.CustomEvent<{ prompt: string; text: string }>) {
      this.triggerEvent('prompttap', { prompt: e.detail.prompt });
    },
  },
});
