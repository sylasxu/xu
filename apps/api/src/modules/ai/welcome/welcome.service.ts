/**
 * Welcome Service - 欢迎卡片门面
 *
 * 从 ai.service.ts 分离，保持欢迎卡片逻辑独立
 */

import {
  db,
  users,
  activities,
  participants,
  agentTasks,
  sql,
  eq,
  and,
  gt,
  desc,
  inArray,
} from '@xu/db';
import { getConfigValue } from '../config/config.service';
import { getEnhancedUserProfile } from '../memory/working';
import type { EnhancedUserProfile } from '../memory';
import { reverseGeocode } from '../utils/geo';
import { getDiscussionReplySignals } from '../../chat/chat.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// ==========================================
// Welcome Card
// ==========================================

export interface WelcomeSection {
  id: string;
  title: string;
  icon?: string;
  items: Array<{
    type: 'draft' | 'suggestion' | 'explore';
    label: string;
    prompt: string;
    icon?: string;
    context?: unknown;
  }>;
}

// 社交档案 (v4.4 新增)
export interface SocialProfile {
  joinedActivities: number;
  hostedActivities: number;
  preferenceCompleteness: number;
}

export interface WelcomePendingActivity {
  id: string;
  title: string;
  type: string;
  startAt: string;
  locationName: string;
  locationHint: string;
  currentParticipants: number;
  maxParticipants: number;
  status: string;
}

// 快捷入口 (v4.4 新增)
export interface QuickPrompt {
  icon: string;
  text: string;
  prompt: string;
  action?: string;
  params?: Record<string, unknown>;
}

export type WelcomeFocusType =
  | 'post_activity_feedback'
  | 'discussion_reply'
  | 'draft_continue'
  | 'recruiting_result'
  | 'unfinished_intent';

export interface WelcomeFocus {
  type: WelcomeFocusType;
  label: string;
  prompt: string;
  priority: number;
  context?: unknown;
}

export interface WelcomeResponse {
  greeting: string;
  subGreeting?: string;
  sections: WelcomeSection[];
  pendingActivities?: WelcomePendingActivity[] | undefined;
  welcomeFocus?: WelcomeFocus | undefined;
  quickPrompts: QuickPrompt[];
  ui?: {
    composerPlaceholder: string;
    bottomQuickActions: string[];
    chatShell?: {
      composerHint: string;
      pendingActionTitle: string;
      pendingActionDefaultMessage: string;
      pendingActionLoginHint: string;
      pendingActionBindPhoneHint: string;
      pendingActionResumeLabel: string;
    };
    sidebar?: {
      title: string;
      messageCenterLabel: string;
      currentTasksTitle: string;
      currentTasksEmpty: string;
      historyTitle: string;
      searchPlaceholder: string;
      emptySearchResult: string;
      emptyHistory: string;
    };
  };
}

async function getUserActivityStats(userId: string): Promise<{
  joinedActivities: number;
  hostedActivities: number;
}> {
  const [createdResult, joinedResult] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(activities)
      .where(eq(activities.creatorId, userId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(participants)
      .where(and(eq(participants.userId, userId), eq(participants.status, 'joined'))),
  ]);

  return {
    joinedActivities: joinedResult[0]?.count ?? 0,
    hostedActivities: createdResult[0]?.count ?? 0,
  };
}

type WelcomeGreetingPeriod =
  | 'lateNight'
  | 'morning'
  | 'forenoon'
  | 'noon'
  | 'afternoon'
  | 'evening'
  | 'night';

interface WelcomeCopyConfig {
  fallbackNickname: string;
  subGreeting: string;
  stateSubGreetings: {
    hasDraft: string;
    pendingActivities: string;
    lowPreference: string;
    nearbyExplore: string;
  };
  greetingTemplates: Record<WelcomeGreetingPeriod, string>;
}

interface WelcomeUiConfig {
  composerPlaceholder: string;
  sectionTitles: {
    suggestions: string;
    explore: string;
  };
  exploreTemplates: {
    label: string;
    prompt: string;
  };
  suggestionItems: Array<{
    label: string;
    prompt: string;
    icon?: string;
  }>;
  quickPrompts: QuickPrompt[];
  bottomQuickActions: string[];
  chatShell: {
    composerHint: string;
    pendingActionTitle: string;
    pendingActionDefaultMessage: string;
    pendingActionLoginHint: string;
    pendingActionBindPhoneHint: string;
    pendingActionResumeLabel: string;
    runtimeStatus: {
      networkOfflineText: string;
      networkRetryText: string;
      networkRestoredToast: string;
      widgetErrorMessage: string;
      widgetErrorRetryText: string;
    };
  };
  sidebar: {
    title: string;
    messageCenterLabel: string;
    currentTasksTitle: string;
    currentTasksEmpty: string;
    historyTitle: string;
    searchPlaceholder: string;
    emptySearchResult: string;
    emptyHistory: string;
  };
}

const DEFAULT_WELCOME_COPY_CONFIG: WelcomeCopyConfig = {
  fallbackNickname: '朋友',
  subGreeting: '今天想约什么局？',
  stateSubGreetings: {
    hasDraft: '你有一个草稿还没发出去，要不要现在继续？',
    pendingActivities: '你有 {count} 个待参加活动，先看看接下来怎么安排？',
    lowPreference: '告诉我你偏爱什么，我会更懂你。',
    nearbyExplore: '附近有新局，想直接看看吗？',
  },
  greetingTemplates: {
    lateNight: '夜深了，{nickname}～',
    morning: '早上好，{nickname}！',
    forenoon: '上午好，{nickname}！',
    noon: '中午好，{nickname}！',
    afternoon: '下午好，{nickname}！',
    evening: '晚上好，{nickname}！',
    night: '夜深了，{nickname}～',
  },
};

const DEFAULT_WELCOME_UI_CONFIG: WelcomeUiConfig = {
  composerPlaceholder: '你想找什么活动？',
  sectionTitles: {
    suggestions: '快速组局',
    explore: '探索附近',
  },
  exploreTemplates: {
    label: '看看{locationName}有什么局',
    prompt: '看看{locationName}附近有什么活动',
  },
  suggestionItems: [
    { label: '约饭局', prompt: '帮我组一个吃饭的局', icon: '🍜' },
    { label: '打游戏', prompt: '想找人一起打游戏', icon: '🎮' },
    { label: '运动', prompt: '想找人一起运动', icon: '🏃' },
    { label: '喝咖啡', prompt: '想约人喝咖啡聊天', icon: '☕' },
  ],
  quickPrompts: [
    { icon: '📍', text: '周末附近有什么活动？', prompt: '周末附近有什么活动' },
    { icon: '🏸', text: '帮我找个运动搭子', prompt: '帮我找个运动搭子' },
    { icon: '✨', text: '想组个周五晚的局', prompt: '想组个周五晚的局' },
  ],
  bottomQuickActions: ['快速组局', '找搭子', '附近活动', '我的草稿'],
  chatShell: {
    composerHint: '也可以直接说地方、时间、类型或你想找的人',
    pendingActionTitle: '待恢复动作',
    pendingActionDefaultMessage: '这一步已经挂起，登录后会继续替你办完。',
    pendingActionLoginHint: '完成登录后回到这里，我会自动继续。',
    pendingActionBindPhoneHint: '完成绑定手机号后回到这里，我会自动继续。',
    pendingActionResumeLabel: '我已完成，继续',
    runtimeStatus: {
      networkOfflineText: '网络连接已断开',
      networkRetryText: '重试',
      networkRestoredToast: '网络已恢复',
      widgetErrorMessage: '出了点问题',
      widgetErrorRetryText: '重试',
    },
  },
  sidebar: {
    title: 'xu',
    messageCenterLabel: '消息中心',
    currentTasksTitle: '现在最需要继续的事',
    currentTasksEmpty: '当前没有需要继续推进的事，新的进展会先出现在这里。',
    historyTitle: '历史会话',
    searchPlaceholder: '搜索历史会话',
    emptySearchResult: '没有找到匹配的历史会话。',
    emptyHistory: '还没有历史会话，发起第一条消息后这里就会出现。',
  },
};

const WELCOME_GREETING_PERIODS: WelcomeGreetingPeriod[] = [
  'lateNight',
  'morning',
  'forenoon',
  'noon',
  'afternoon',
  'evening',
  'night',
];

function normalizeWelcomeCopyConfig(raw: unknown): WelcomeCopyConfig {
  if (!isRecord(raw)) {
    return DEFAULT_WELCOME_COPY_CONFIG;
  }

  const greetingTemplates = { ...DEFAULT_WELCOME_COPY_CONFIG.greetingTemplates };
  const greetingTemplatesInput = isRecord(raw.greetingTemplates) ? raw.greetingTemplates : null;
  if (greetingTemplatesInput) {
    for (const key of WELCOME_GREETING_PERIODS) {
      const next = getNonEmptyString(greetingTemplatesInput[key]);
      if (next) {
        greetingTemplates[key] = next;
      }
    }
  }

  return {
    fallbackNickname: getNonEmptyString(raw.fallbackNickname) ?? DEFAULT_WELCOME_COPY_CONFIG.fallbackNickname,
    subGreeting: getNonEmptyString(raw.subGreeting) ?? DEFAULT_WELCOME_COPY_CONFIG.subGreeting,
    stateSubGreetings: {
      hasDraft: getNonEmptyString(isRecord(raw.stateSubGreetings) ? raw.stateSubGreetings.hasDraft : null) ?? DEFAULT_WELCOME_COPY_CONFIG.stateSubGreetings.hasDraft,
      pendingActivities: getNonEmptyString(isRecord(raw.stateSubGreetings) ? raw.stateSubGreetings.pendingActivities : null) ?? DEFAULT_WELCOME_COPY_CONFIG.stateSubGreetings.pendingActivities,
      lowPreference: getNonEmptyString(isRecord(raw.stateSubGreetings) ? raw.stateSubGreetings.lowPreference : null) ?? DEFAULT_WELCOME_COPY_CONFIG.stateSubGreetings.lowPreference,
      nearbyExplore: getNonEmptyString(isRecord(raw.stateSubGreetings) ? raw.stateSubGreetings.nearbyExplore : null) ?? DEFAULT_WELCOME_COPY_CONFIG.stateSubGreetings.nearbyExplore,
    },
    greetingTemplates,
  };
}

function normalizeWelcomeUiConfig(raw: unknown): WelcomeUiConfig {
  if (!isRecord(raw)) {
    return DEFAULT_WELCOME_UI_CONFIG;
  }

  const sectionTitlesInput = isRecord(raw.sectionTitles) ? raw.sectionTitles : null;
  const exploreTemplatesInput = isRecord(raw.exploreTemplates) ? raw.exploreTemplates : null;

  const suggestionItems = Array.isArray(raw.suggestionItems)
    ? raw.suggestionItems
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }

        const label = getNonEmptyString(item.label);
        const prompt = getNonEmptyString(item.prompt);
        const icon = getNonEmptyString(item.icon) ?? undefined;
        if (!label || !prompt) {
          return null;
        }

        return {
          label,
          prompt,
          ...(icon ? { icon } : {}),
        };
      })
      .filter((item): item is { label: string; prompt: string; icon?: string } => Boolean(item?.label && item.prompt))
    : [];

  const quickPrompts = Array.isArray(raw.quickPrompts)
    ? raw.quickPrompts
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }

        const text = getNonEmptyString(item.text);
        const prompt = getNonEmptyString(item.prompt);
        const icon = getNonEmptyString(item.icon);
        if (!text || !prompt || !icon) {
          return null;
        }

        return {
          icon,
          text,
          prompt,
        };
      })
      .filter((item): item is QuickPrompt => Boolean(item?.icon && item.text && item.prompt))
    : [];

  const bottomQuickActions = Array.isArray(raw.bottomQuickActions)
    ? raw.bottomQuickActions
      .map((item) => getNonEmptyString(item) ?? '')
      .filter(Boolean)
    : [];

  const sectionTitles = {
    suggestions: getNonEmptyString(sectionTitlesInput?.suggestions) ?? DEFAULT_WELCOME_UI_CONFIG.sectionTitles.suggestions,
    explore: getNonEmptyString(sectionTitlesInput?.explore) ?? DEFAULT_WELCOME_UI_CONFIG.sectionTitles.explore,
  };

  const exploreTemplates = {
    label: getNonEmptyString(exploreTemplatesInput?.label) ?? DEFAULT_WELCOME_UI_CONFIG.exploreTemplates.label,
    prompt: getNonEmptyString(exploreTemplatesInput?.prompt) ?? DEFAULT_WELCOME_UI_CONFIG.exploreTemplates.prompt,
  };

  const composerPlaceholder = getNonEmptyString(raw.composerPlaceholder) ?? DEFAULT_WELCOME_UI_CONFIG.composerPlaceholder;
  const chatShellInput = isRecord(raw.chatShell) ? raw.chatShell : null;
  const sidebarInput = isRecord(raw.sidebar) ? raw.sidebar : null;

  return {
    composerPlaceholder,
    sectionTitles,
    exploreTemplates,
    suggestionItems: suggestionItems.length ? suggestionItems : DEFAULT_WELCOME_UI_CONFIG.suggestionItems,
    quickPrompts: quickPrompts.length ? quickPrompts : DEFAULT_WELCOME_UI_CONFIG.quickPrompts,
    bottomQuickActions: bottomQuickActions.length ? bottomQuickActions : DEFAULT_WELCOME_UI_CONFIG.bottomQuickActions,
    chatShell: {
      composerHint: getNonEmptyString(chatShellInput?.composerHint) ?? DEFAULT_WELCOME_UI_CONFIG.chatShell.composerHint,
      pendingActionTitle: getNonEmptyString(chatShellInput?.pendingActionTitle) ?? DEFAULT_WELCOME_UI_CONFIG.chatShell.pendingActionTitle,
      pendingActionDefaultMessage: getNonEmptyString(chatShellInput?.pendingActionDefaultMessage) ?? DEFAULT_WELCOME_UI_CONFIG.chatShell.pendingActionDefaultMessage,
      pendingActionLoginHint: getNonEmptyString(chatShellInput?.pendingActionLoginHint) ?? DEFAULT_WELCOME_UI_CONFIG.chatShell.pendingActionLoginHint,
      pendingActionBindPhoneHint: getNonEmptyString(chatShellInput?.pendingActionBindPhoneHint) ?? DEFAULT_WELCOME_UI_CONFIG.chatShell.pendingActionBindPhoneHint,
      pendingActionResumeLabel: getNonEmptyString(chatShellInput?.pendingActionResumeLabel) ?? DEFAULT_WELCOME_UI_CONFIG.chatShell.pendingActionResumeLabel,
      runtimeStatus: {
        networkOfflineText: getNonEmptyString(isRecord(chatShellInput?.runtimeStatus) ? chatShellInput.runtimeStatus.networkOfflineText : null) ?? DEFAULT_WELCOME_UI_CONFIG.chatShell.runtimeStatus.networkOfflineText,
        networkRetryText: getNonEmptyString(isRecord(chatShellInput?.runtimeStatus) ? chatShellInput.runtimeStatus.networkRetryText : null) ?? DEFAULT_WELCOME_UI_CONFIG.chatShell.runtimeStatus.networkRetryText,
        networkRestoredToast: getNonEmptyString(isRecord(chatShellInput?.runtimeStatus) ? chatShellInput.runtimeStatus.networkRestoredToast : null) ?? DEFAULT_WELCOME_UI_CONFIG.chatShell.runtimeStatus.networkRestoredToast,
        widgetErrorMessage: getNonEmptyString(isRecord(chatShellInput?.runtimeStatus) ? chatShellInput.runtimeStatus.widgetErrorMessage : null) ?? DEFAULT_WELCOME_UI_CONFIG.chatShell.runtimeStatus.widgetErrorMessage,
        widgetErrorRetryText: getNonEmptyString(isRecord(chatShellInput?.runtimeStatus) ? chatShellInput.runtimeStatus.widgetErrorRetryText : null) ?? DEFAULT_WELCOME_UI_CONFIG.chatShell.runtimeStatus.widgetErrorRetryText,
      },
    },
    sidebar: {
      title: getNonEmptyString(sidebarInput?.title) ?? DEFAULT_WELCOME_UI_CONFIG.sidebar.title,
      messageCenterLabel: getNonEmptyString(sidebarInput?.messageCenterLabel) ?? DEFAULT_WELCOME_UI_CONFIG.sidebar.messageCenterLabel,
      currentTasksTitle: getNonEmptyString(sidebarInput?.currentTasksTitle) ?? DEFAULT_WELCOME_UI_CONFIG.sidebar.currentTasksTitle,
      currentTasksEmpty: getNonEmptyString(sidebarInput?.currentTasksEmpty) ?? DEFAULT_WELCOME_UI_CONFIG.sidebar.currentTasksEmpty,
      historyTitle: getNonEmptyString(sidebarInput?.historyTitle) ?? DEFAULT_WELCOME_UI_CONFIG.sidebar.historyTitle,
      searchPlaceholder: getNonEmptyString(sidebarInput?.searchPlaceholder) ?? DEFAULT_WELCOME_UI_CONFIG.sidebar.searchPlaceholder,
      emptySearchResult: getNonEmptyString(sidebarInput?.emptySearchResult) ?? DEFAULT_WELCOME_UI_CONFIG.sidebar.emptySearchResult,
      emptyHistory: getNonEmptyString(sidebarInput?.emptyHistory) ?? DEFAULT_WELCOME_UI_CONFIG.sidebar.emptyHistory,
    },
  };
}

function resolveWelcomePeriod(hour: number): WelcomeGreetingPeriod {
  if (hour < 6) return 'lateNight';
  if (hour < 9) return 'morning';
  if (hour < 12) return 'forenoon';
  if (hour < 14) return 'noon';
  if (hour < 18) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(vars)) {
    output = output.split(`{${key}}`).join(value);
  }
  return output;
}

function renderWelcomeTemplate(template: string, nickname: string): string {
  return renderTemplate(template, {
    nickname,
    name: nickname,
  });
}

function clampWelcomeTitle(title: string, maxLength = 12): string {
  const normalized = title.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1))}…`;
}

const OPEN_WELCOME_TASK_STATUSES = ['active', 'waiting_auth', 'waiting_async_result'] as const;

function buildActivityOutcomeWelcomeFocus(
  profile: EnhancedUserProfile,
  now: Date,
): WelcomeFocus | undefined {
  const recentOutcome = (profile.activityOutcomes || [])
    .filter((outcome) => {
      const ageMs = now.getTime() - outcome.updatedAt.getTime();
      return ageMs >= 0 && ageMs <= 30 * 24 * 60 * 60 * 1000;
    })
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .find((outcome) => outcome.attended !== null);

  if (!recentOutcome) {
    return undefined;
  }

  const title = clampWelcomeTitle(recentOutcome.activityTitle, 10);
  const context = {
    activityId: recentOutcome.activityId,
    activityTitle: recentOutcome.activityTitle,
    activityType: recentOutcome.activityType,
    locationName: recentOutcome.locationName,
    entry: 'activity_outcome_memory',
    outcome: recentOutcome.attended === false ? 'failed' : 'attended',
    rebookTriggered: recentOutcome.rebookTriggered,
    ...(recentOutcome.reviewSummary ? { reviewSummary: recentOutcome.reviewSummary } : {}),
  };

  if (recentOutcome.attended === false) {
    return {
      type: 'post_activity_feedback',
      label: `换个方式再组「${title}」`,
      prompt: `上次「${recentOutcome.activityTitle}」没成局，结合这次真实结果，帮我换个更容易成局的新方案。`,
      priority: 6,
      context,
    };
  }

  if (recentOutcome.rebookTriggered) {
    return {
      type: 'post_activity_feedback',
      label: `继续沿用「${title}」的经验`,
      prompt: `结合上次「${recentOutcome.activityTitle}」的真实结果，帮我找一个相近但更合适的下一场活动。`,
      priority: 6,
      context,
    };
  }

  return {
    type: 'post_activity_feedback',
    label: `顺着「${title}」再约`,
    prompt: `上次「${recentOutcome.activityTitle}」挺顺利，结合地点、类型和反馈，帮我快速再约一场。`,
    priority: 6,
    context,
  };
}

function buildPostActivityFeedbackPrompts(activityTitle: string, activityId: string): QuickPrompt[] {
  const title = clampWelcomeTitle(activityTitle, 16);
  return [
    {
      icon: '✓',
      text: '挺顺利',
      prompt: `这次「${title}」挺顺利，帮我记录一下反馈。`,
      action: 'record_activity_feedback',
      params: {
        activityId,
        feedback: 'positive',
        reviewSummary: `这次「${title}」挺顺利。`,
      },
    },
    {
      icon: '·',
      text: '一般',
      prompt: `这次「${title}」一般，帮我记录一下并看看要不要调整。`,
      action: 'record_activity_feedback',
      params: {
        activityId,
        feedback: 'neutral',
        reviewSummary: `这次「${title}」一般，需要后续再优化。`,
      },
    },
    {
      icon: '×',
      text: '没成局',
      prompt: `这次「${title}」没成局，帮我记录一下并分析原因。`,
      action: 'record_activity_feedback',
      params: {
        activityId,
        feedback: 'failed',
        reviewSummary: `这次「${title}」没成局。`,
      },
    },
  ];
}

function buildActivityOutcomeMemoryQuickPrompts(params: {
  activityTitle: string;
  outcome: 'attended' | 'failed';
  rebookTriggered?: boolean;
  prompt: string;
}): QuickPrompt[] {
  if (params.outcome === 'failed') {
    return [
      {
        icon: '↺',
        text: '换个方式再组',
        prompt: params.prompt,
      },
      ...DEFAULT_WELCOME_UI_CONFIG.quickPrompts.slice(0, 2),
    ];
  }

  if (params.rebookTriggered) {
    return [
      {
        icon: '↺',
        text: '沿用上次经验',
        prompt: params.prompt,
      },
      ...DEFAULT_WELCOME_UI_CONFIG.quickPrompts.slice(0, 2),
    ];
  }

  return [
    {
      icon: '↺',
      text: '顺着这次再约',
      prompt: params.prompt,
    },
    ...DEFAULT_WELCOME_UI_CONFIG.quickPrompts.slice(0, 2),
  ];
}

function buildUnfinishedIntentLabel(stage: string, status: string): string {
  if (stage === 'match_ready') {
    return '有新匹配';
  }

  if (stage === 'draft_ready') {
    return '草稿待确认';
  }

  if (status === 'waiting_async_result') {
    return '结果待查看';
  }

  return '继续这件事';
}

async function selectWelcomeFocus(userId: string, now: Date): Promise<WelcomeFocus | undefined> {
  const [postActivityTask] = await db
    .select({
      taskId: agentTasks.id,
      activityId: agentTasks.activityId,
      goalText: agentTasks.goalText,
      activityTitle: activities.title,
    })
    .from(agentTasks)
    .innerJoin(activities, eq(agentTasks.activityId, activities.id))
    .where(and(
      eq(agentTasks.userId, userId),
      eq(agentTasks.taskType, 'join_activity'),
      eq(agentTasks.currentStage, 'post_activity'),
      inArray(agentTasks.status, OPEN_WELCOME_TASK_STATUSES),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(1);

  if (postActivityTask) {
    const title = postActivityTask.activityTitle || postActivityTask.goalText;
    return {
      type: 'post_activity_feedback',
      label: `这次「${clampWelcomeTitle(title, 10)}」怎么样？`,
      prompt: `这次「${title}」怎么样？帮我记录这次活动反馈。`,
      priority: 1,
      context: {
        taskId: postActivityTask.taskId,
        activityId: postActivityTask.activityId,
        activityTitle: title,
      },
    };
  }

  const [discussionFocus] = await getDiscussionReplySignals({
    userId,
    limit: 1,
  });

  if (discussionFocus) {
    const senderPrefix = discussionFocus.lastMessageSenderNickname
      ? `${discussionFocus.lastMessageSenderNickname}：`
      : '';
    return {
      type: 'discussion_reply',
      label: `去接「${clampWelcomeTitle(discussionFocus.activityTitle, 10)}」的讨论`,
      prompt: discussionFocus.lastMessage || '进入讨论区',
      priority: 2,
      context: {
        activityId: discussionFocus.activityId,
        activityTitle: discussionFocus.activityTitle,
        entry: 'welcome_discussion_reply',
        unreadCount: discussionFocus.unreadCount,
        summary: discussionFocus.lastMessage
          ? `${senderPrefix}${discussionFocus.lastMessage}`
          : undefined,
      },
    };
  }

  const [draftTask] = await db
    .select({
      taskId: agentTasks.id,
      currentStage: agentTasks.currentStage,
      goalText: agentTasks.goalText,
      activityId: agentTasks.activityId,
      activityTitle: activities.title,
    })
    .from(agentTasks)
    .leftJoin(activities, eq(agentTasks.activityId, activities.id))
    .where(and(
      eq(agentTasks.userId, userId),
      eq(agentTasks.taskType, 'create_activity'),
      inArray(agentTasks.status, OPEN_WELCOME_TASK_STATUSES),
      inArray(agentTasks.currentStage, ['draft_collecting', 'draft_ready']),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(1);

  if (draftTask) {
    const title = draftTask.activityTitle || draftTask.goalText;
    return {
      type: 'draft_continue',
      label: draftTask.currentStage === 'draft_ready'
        ? `确认「${clampWelcomeTitle(title, 10)}」草稿`
        : `继续完善「${clampWelcomeTitle(title, 10)}」`,
      prompt: `继续处理：${draftTask.goalText}`,
      priority: 3,
      context: {
        taskId: draftTask.taskId,
        activityId: draftTask.activityId,
        activityTitle: title,
      },
    };
  }

  const [recruitingActivity] = await db
    .select({
      id: activities.id,
      title: activities.title,
      currentParticipants: activities.currentParticipants,
      maxParticipants: activities.maxParticipants,
    })
    .from(activities)
    .where(and(
      eq(activities.creatorId, userId),
      eq(activities.status, 'active'),
      gt(activities.startAt, now),
      sql`${activities.currentParticipants} < ${activities.maxParticipants}`,
    ))
    .orderBy(sql`${activities.startAt} ASC`)
    .limit(1);

  if (recruitingActivity) {
    const remaining = Math.max(recruitingActivity.maxParticipants - recruitingActivity.currentParticipants, 0);
    return {
      type: 'recruiting_result',
      label: `「${clampWelcomeTitle(recruitingActivity.title, 10)}」还差 ${remaining} 人`,
      prompt: `继续处理「${recruitingActivity.title}」的招人结果，还差 ${remaining} 人，帮我看看下一步怎么推进。`,
      priority: 4,
      context: {
        activityId: recruitingActivity.id,
        remaining,
      },
    };
  }

  const openTasks = await db
    .select({
      taskId: agentTasks.id,
      taskType: agentTasks.taskType,
      currentStage: agentTasks.currentStage,
      status: agentTasks.status,
      goalText: agentTasks.goalText,
      activityId: agentTasks.activityId,
      partnerIntentId: agentTasks.partnerIntentId,
      intentMatchId: agentTasks.intentMatchId,
    })
    .from(agentTasks)
    .where(and(
      eq(agentTasks.userId, userId),
      inArray(agentTasks.status, OPEN_WELCOME_TASK_STATUSES),
    ))
    .orderBy(desc(agentTasks.updatedAt))
    .limit(5);

  const unfinishedTask = openTasks.find((task) => task.currentStage !== 'post_activity');
  if (!unfinishedTask) {
    return undefined;
  }

  return {
    type: 'unfinished_intent',
    label: buildUnfinishedIntentLabel(unfinishedTask.currentStage, unfinishedTask.status),
    prompt: `继续处理：${unfinishedTask.goalText}`,
    priority: 5,
    context: {
      taskId: unfinishedTask.taskId,
      taskType: unfinishedTask.taskType,
      currentStage: unfinishedTask.currentStage,
      status: unfinishedTask.status,
      activityId: unfinishedTask.activityId,
      partnerIntentId: unfinishedTask.partnerIntentId,
      intentMatchId: unfinishedTask.intentMatchId,
    },
  };
}

export function generateGreeting(
  nickname: string | null,
  config: WelcomeCopyConfig = DEFAULT_WELCOME_COPY_CONFIG,
): string {
  const hour = new Date().getHours();
  const name = nickname?.trim() || config.fallbackNickname;
  const period = resolveWelcomePeriod(hour);
  return renderWelcomeTemplate(config.greetingTemplates[period], name);
}

export async function getWelcomeCard(
  userId: string | null,
  nickname: string | null,
  location: { lat: number; lng: number } | null
): Promise<WelcomeResponse> {
  const welcomeCopyRaw = await getConfigValue<unknown>('welcome.copy', DEFAULT_WELCOME_COPY_CONFIG);
  const welcomeCopy = normalizeWelcomeCopyConfig(welcomeCopyRaw);
  const welcomeUiRaw = await getConfigValue<unknown>('welcome.ui', DEFAULT_WELCOME_UI_CONFIG);
  const welcomeUi = normalizeWelcomeUiConfig(welcomeUiRaw);
  const greeting = generateGreeting(nickname, welcomeCopy);
  const sections: WelcomeSection[] = [];
  const now = new Date();

  // 已登录用户的状态判断
  let preferenceCompleteness: number | null = null;
  let pendingActivities: WelcomePendingActivity[] = [];
  let hasDraftActivity = false;
  let welcomeFocus: WelcomeFocus | undefined;

  if (userId) {
    const [profile, selectedWelcomeFocus] = await Promise.all([
      getEnhancedUserProfile(userId),
      selectWelcomeFocus(userId, now),
    ]);
    welcomeFocus = selectedWelcomeFocus ?? buildActivityOutcomeWelcomeFocus(profile, now);

    const preferencesCount = profile.preferences.length;
    const locationsCount = profile.frequentLocations.length;
    const preferenceCompleteness = Math.min(100, preferencesCount * 15 + locationsCount * 10);

    const [draftRows, activeRows] = await Promise.all([
      db
        .select({
          id: activities.id,
          title: activities.title,
        })
        .from(activities)
        .where(and(
          eq(activities.creatorId, userId),
          eq(activities.status, 'draft'),
          gt(activities.startAt, now),
        ))
        .orderBy(desc(activities.updatedAt))
        .limit(1),
      db
        .select({
          id: activities.id,
          title: activities.title,
          type: activities.type,
          startAt: activities.startAt,
          locationName: activities.locationName,
          locationHint: activities.locationHint,
          currentParticipants: activities.currentParticipants,
          maxParticipants: activities.maxParticipants,
          status: activities.status,
        })
        .from(participants)
        .innerJoin(activities, eq(participants.activityId, activities.id))
        .where(and(
          eq(participants.userId, userId),
          eq(participants.status, 'joined'),
          eq(activities.status, 'active'),
          gt(activities.startAt, now),
        ))
        .orderBy(sql`${activities.startAt} ASC`)
        .limit(3),
    ]);

    if (draftRows.length > 0) {
      const draft = draftRows[0];
      hasDraftActivity = true;
      sections.push({
        id: 'draft',
        title: '继续上次草稿',
        items: [
          {
            type: 'draft',
            label: `继续完善「${clampWelcomeTitle(draft.title)}」`,
            prompt: `继续完善我的活动草稿：${draft.title}`,
            context: { activityId: draft.id },
          },
        ],
      });
    }

    pendingActivities = activeRows.map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      startAt: item.startAt.toISOString(),
      locationName: item.locationName,
      locationHint: item.locationHint,
      currentParticipants: item.currentParticipants,
      maxParticipants: item.maxParticipants,
      status: item.status,
    }));
  }

  // 快速组局建议
  const suggestions: WelcomeSection = {
    id: 'suggestions',
    title: welcomeUi.sectionTitles.suggestions,
    icon: '✨',
    items: welcomeUi.suggestionItems.map((item) => ({
      type: 'suggestion' as const,
      label: item.label,
      prompt: item.prompt,
      ...(item.icon ? { icon: item.icon } : {}),
    })),
  };
  sections.push(suggestions);

  // 探索附近（有位置时显示）
  if (location) {
    const locationName = await reverseGeocode(location.lat, location.lng);
    const explore: WelcomeSection = {
      id: 'explore',
      title: welcomeUi.sectionTitles.explore,
      icon: '📍',
      items: [
        {
          type: 'explore',
          label: renderTemplate(welcomeUi.exploreTemplates.label, { locationName, location: locationName }),
          prompt: renderTemplate(welcomeUi.exploreTemplates.prompt, { locationName, location: locationName }),
          icon: '🗺️',
          context: { locationName, lat: location.lat, lng: location.lng },
        },
      ],
    };
    sections.push(explore);
  }

  let subGreeting = welcomeCopy.subGreeting;

  if (hasDraftActivity) {
    subGreeting = welcomeCopy.stateSubGreetings.hasDraft;
  } else if (pendingActivities.length > 0) {
    subGreeting = renderTemplate(welcomeCopy.stateSubGreetings.pendingActivities, { count: String(pendingActivities.length) });
  } else if (preferenceCompleteness !== null && preferenceCompleteness < 30) {
    subGreeting = welcomeCopy.stateSubGreetings.lowPreference;
  } else if (location) {
    subGreeting = welcomeCopy.stateSubGreetings.nearbyExplore;
  }

  // 快捷入口（v4.4 新增）
  const focusContext = isRecord(welcomeFocus?.context) ? welcomeFocus.context : null;
  const focusActivityTitle = getNonEmptyString(focusContext?.activityTitle);
  const focusActivityId = getNonEmptyString(focusContext?.activityId);
  const focusEntry = getNonEmptyString(focusContext?.entry);
  const focusOutcome = getNonEmptyString(focusContext?.outcome);
  const focusRebookTriggered = typeof focusContext?.rebookTriggered === 'boolean'
    ? focusContext.rebookTriggered
    : false;
  const quickPrompts = welcomeFocus?.type === 'post_activity_feedback'
    && focusEntry !== 'activity_outcome_memory'
    && focusActivityTitle
    && focusActivityId
    ? buildPostActivityFeedbackPrompts(focusActivityTitle, focusActivityId)
    : welcomeFocus?.type === 'post_activity_feedback'
      && focusEntry === 'activity_outcome_memory'
      && focusActivityTitle
      && (focusOutcome === 'attended' || focusOutcome === 'failed')
      ? buildActivityOutcomeMemoryQuickPrompts({
          activityTitle: focusActivityTitle,
          outcome: focusOutcome,
          rebookTriggered: focusRebookTriggered,
          prompt: welcomeFocus.prompt,
        })
    : hasDraftActivity ? [] : welcomeUi.quickPrompts;

  return {
    greeting,
    subGreeting,
    sections,
    pendingActivities,
    welcomeFocus,
    quickPrompts,
    ui: {
      composerPlaceholder: welcomeUi.composerPlaceholder,
      bottomQuickActions: welcomeUi.bottomQuickActions,
      chatShell: welcomeUi.chatShell,
      sidebar: welcomeUi.sidebar,
    },
  };
}
