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

import type {
  QuickItem,
  QuickPrompt,
  SocialProfile,
  WelcomePendingActivity,
  WelcomeResponse,
  WelcomeSection,
} from '../../src/services/welcome';

type Activity = WelcomePendingActivity;
type WelcomeUi = WelcomeResponse['ui'];

interface WidgetDashboardData {
  greeting: string;
  subGreeting: string;
  sections: WelcomeSection[];
  displayActivities: Activity[];
  hasActivities: boolean;
  hasSections: boolean;
  // v4.4 新增
  displaySocialProfile: SocialProfile | null;
  displayQuickPrompts: QuickPrompt[];
  hasSocialProfile: boolean;
  hasQuickPrompts: boolean;
  // 从 properties 同步
  nickname: string;
  displayUi: WelcomeUi | null;
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

function readSocialProfile(value: unknown): SocialProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  const joinedActivities = readNumber(value.joinedActivities);
  const hostedActivities = readNumber(value.hostedActivities);
  const preferenceCompleteness = readNumber(value.preferenceCompleteness);

  if (
    joinedActivities === null ||
    hostedActivities === null ||
    preferenceCompleteness === null
  ) {
    return null;
  }

  return {
    joinedActivities,
    hostedActivities,
    preferenceCompleteness,
  };
}

function readQuickPrompt(value: unknown): QuickPrompt | null {
  if (!isRecord(value)) {
    return null;
  }

  const icon = readString(value.icon);
  const text = readString(value.text);
  const prompt = readString(value.prompt);

  if (!icon || !text || !prompt) {
    return null;
  }

  return { icon, text, prompt };
}

function readQuickPrompts(value: unknown): QuickPrompt[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => readQuickPrompt(item))
    .filter((item): item is QuickPrompt => item !== null);
}

function readQuickItem(value: unknown): QuickItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const label = readString(value.label);
  const prompt = readString(value.prompt);
  const icon = readString(value.icon) ?? undefined;
  const context = value.context;

  switch (value.type) {
    case 'draft':
    case 'suggestion':
    case 'explore':
      if (!label || !prompt) {
        return null;
      }
      return {
        type: value.type,
        icon,
        label,
        prompt,
        context,
      };
    default:
      return null;
  }
}

function readActivityIdFromContext(context: unknown): string | null {
  if (!isRecord(context)) {
    return null;
  }

  return readString(context.activityId);
}

function readWelcomeUi(value: unknown): WelcomeUi | null {
  if (!isRecord(value)) {
    return null;
  }

  const composerPlaceholder = readString(value.composerPlaceholder);
  const bottomQuickActions = Array.isArray(value.bottomQuickActions)
    ? value.bottomQuickActions.filter((item): item is string => typeof item === 'string')
    : [];
  const profileHints = isRecord(value.profileHints) ? value.profileHints : null;

  if (!composerPlaceholder || !profileHints) {
    return null;
  }

  const low = readString(profileHints.low);
  const medium = readString(profileHints.medium);
  const high = readString(profileHints.high);

  if (!low || !medium || !high) {
    return null;
  }

  return {
    composerPlaceholder,
    bottomQuickActions,
    profileHints: { low, medium, high },
  };
}

const WIDGET_DASHBOARD_DATA: WidgetDashboardData = {
  greeting: '',
  subGreeting: '',
  sections: [],
  displayActivities: [],
  hasActivities: false,
  hasSections: false,
  displaySocialProfile: null,
  displayQuickPrompts: [],
  hasSocialProfile: false,
  hasQuickPrompts: false,
  nickname: '搭子',
  displayUi: null,
};

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
      value: [],
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
      value: [],
    },
    // v4.4: 社交档案
    socialProfile: {
      type: Object,
      value: {},
    },
    // v4.4: 快捷入口
    quickPrompts: {
      type: Array,
      value: [],
    },
    ui: {
      type: Object,
      value: {},
    },
  },

  data: {
    ...WIDGET_DASHBOARD_DATA,
  },

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
      const resolvedProfile = readSocialProfile(profile);
      this.setData({
        displaySocialProfile: resolvedProfile,
        hasSocialProfile: resolvedProfile !== null,
      });
    },
    'quickPrompts': function(prompts: unknown) {
      const resolvedPrompts = readQuickPrompts(prompts);
      this.setData({
        displayQuickPrompts: resolvedPrompts,
        hasQuickPrompts: resolvedPrompts.length > 0,
      });
    },
    'ui': function(ui: unknown) {
      this.setData({
        displayUi: readWelcomeUi(ui),
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
      const apiGreeting = readString(this.properties.greeting);
      const apiSubGreeting = readString(this.properties.subGreeting);

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
    },

    /**
     * 点击快捷项
     * v3.10: 统一处理所有类型的快捷项
     */
    onQuickItemTap(e: WechatMiniprogram.TouchEvent) {
      const item = readQuickItem(e.currentTarget.dataset.item);
      if (!item) return;

      this.triggerEvent('quickitemtap', { item });
    },

    /**
     * 点击查看全部活动
     */
    onViewAllTap() {
      this.triggerEvent('viewall');
    },

    /**
     * v4.4: 快捷入口点击
     */
    onQuickPromptTap(e: WechatMiniprogram.CustomEvent<{ prompt: string; text: string }>) {
      this.triggerEvent('prompttap', { prompt: e.detail.prompt });
    },

    onPreferenceTap() {
      this.triggerEvent('preferencetap');
    },
  },
});
