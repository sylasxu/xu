/**
 * 消息中心页面（结果导向版）
 * - 接入真实通知 API
 * - 增加待确认匹配卡（确认/取消）
 * - post_activity 点击后分流到复盘 / 再约
 */

import {
  getNotificationsMessageCenter,
  postNotificationsByIdRead,
  postNotificationsPendingMatchesByIdCancel,
  postNotificationsPendingMatchesByIdConfirm,
} from '../../src/api/endpoints/notifications/notifications';
import { getAiTasksCurrent as getCurrentAgentTasks } from '../../src/api/endpoints/ai/ai';
import type {
  NotificationMessageCenterResponsePendingMatchesItem,
  NotificationMessageCenterResponseSystemNotificationsItemsItemType,
} from '../../src/api/model';
import { useUserStore } from '../../src/stores/user';
import { useChatStore } from '../../src/stores/chat';
import { useAppStore, type MessageCenterFocusIntent } from '../../src/stores/app';
import { postActivityRebookFollowUp } from '../../src/services/activity-outcome';
import { getPendingMatchDetail, type PendingMatchDetailResponse } from '../../src/services/pending-match';

type NotificationType = NotificationMessageCenterResponseSystemNotificationsItemsItemType | 'match_pending';

interface SystemNotification {
  id: string;
  type: NotificationType;
  title: string;
  content: string;
  activityId: string;
  taskId?: string;
  read: boolean;
  createdAt: string;
  source: 'system' | 'match';
  matchId?: string;
  isTempOrganizer?: boolean;
}

interface ChatItem {
  activityId: string;
  activityTitle: string;
  activityImage?: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount: number;
  isArchived: boolean;
  participantCount: number;
}

interface PendingMatchDetailMemberView {
  userId: string;
  nickname: string;
  nicknameInitial: string;
  avatarUrl: string;
  isTempOrganizer: boolean;
  locationHint: string;
  timePreference: string;
  tags: string[];
  intentSummary: string;
}

interface PendingMatchDetailView {
  id: string;
  activityType: string;
  typeName: string;
  matchScore: number;
  commonTags: string[];
  locationHint: string;
  confirmDeadline: string;
  confirmDeadlineText: string;
  isTempOrganizer: boolean;
  organizerUserId: string;
  organizerDisplayName: string;
  nextActionOwner: 'self' | 'organizer';
  nextActionText: string;
  members: PendingMatchDetailMemberView[];
  icebreaker: {
    content: string;
    createdAt: string;
    createdAtText: string;
  } | null;
}

function readMessageCenterFocusIntent(value: unknown): MessageCenterFocusIntent | null {
  if (!isRecord(value)) {
    return null;
  }

  const taskId = typeof value.taskId === 'string' && value.taskId.trim() ? value.taskId.trim() : undefined;
  const matchId = typeof value.matchId === 'string' && value.matchId.trim() ? value.matchId.trim() : undefined;

  if (!taskId && !matchId) {
    return null;
  }

  return {
    ...(taskId ? { taskId } : {}),
    ...(matchId ? { matchId } : {}),
  };
}

type CurrentTaskActionKind = 'structured_action' | 'navigate' | 'switch_tab';

interface TaskChatPromptPayload {
  prompt: string;
  activityId?: string;
  followUpMode?: 'review' | 'rebook' | 'kickoff';
  entry?: string;
}

interface CurrentTaskAction {
  kind: CurrentTaskActionKind;
  label: string;
  action?: string;
  payload?: Record<string, unknown>;
  source?: string;
  originalText?: string;
  url?: string;
}

interface CurrentTaskItem {
  id: string;
  taskType: 'join_activity' | 'find_partner' | 'create_activity';
  taskTypeLabel: string;
  status: string;
  stageLabel: string;
  currentStage: string;
  headline: string;
  summary: string;
  primaryAction?: CurrentTaskAction;
  secondaryAction?: CurrentTaskAction;
}

interface MessagePageData {
  currentTasksNeedsAction: CurrentTaskItem[];
  currentTasksInProgress: CurrentTaskItem[];
  notifications: SystemNotification[];
  chatList: ChatItem[];
  loading: boolean;
  notificationExpanded: boolean;
  unreadNotificationCount: number;
  totalUnreadCount: number;
  pendingMatchActionId: string;
  showMatchDetail: boolean;
  matchDetailLoading: boolean;
  matchDetailError: string;
  selectedMatchDetail: PendingMatchDetailView | null;
}

interface SocketMessage {
  type: 'message' | 'notification';
  data: {
    activityId?: string;
    message?: {
      id: string;
      content: string;
      senderId: string;
      createdAt: string;
    };
  };
}

function isSocketMessage(value: unknown): value is SocketMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  if ((record.type !== 'message' && record.type !== 'notification') || !record.data || typeof record.data !== 'object') {
    return false;
  }

  const data = record.data as Record<string, unknown>;
  if (data.activityId !== undefined && typeof data.activityId !== 'string') {
    return false;
  }

  if (data.message !== undefined) {
    if (!data.message || typeof data.message !== 'object') {
      return false;
    }

    const message = data.message as Record<string, unknown>;
    if (
      typeof message.id !== 'string' ||
      typeof message.content !== 'string' ||
      typeof message.senderId !== 'string' ||
      typeof message.createdAt !== 'string'
    ) {
      return false;
    }
  }

  return true;
}

function getErrorMessage(value: unknown, fallback: string): string {
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.msg === 'string' && record.msg.trim()) {
      return record.msg.trim();
    }
  }

  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readCurrentTaskAction(value: unknown): CurrentTaskAction | null {
  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.label !== 'string') {
    return null;
  }

  if (value.kind !== 'structured_action' && value.kind !== 'navigate' && value.kind !== 'switch_tab') {
    return null;
  }

  return {
    kind: value.kind,
    label: value.label,
    ...(typeof value.action === 'string' ? { action: value.action } : {}),
    ...(isRecord(value.payload) ? { payload: value.payload } : {}),
    ...(typeof value.source === 'string' ? { source: value.source } : {}),
    ...(typeof value.originalText === 'string' ? { originalText: value.originalText } : {}),
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
  };
}

function readCurrentTaskItem(value: unknown): CurrentTaskItem | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.taskType !== 'string' ||
    typeof value.taskTypeLabel !== 'string' ||
    typeof value.stageLabel !== 'string' ||
    typeof value.currentStage !== 'string' ||
    typeof value.headline !== 'string' ||
    typeof value.summary !== 'string'
  ) {
    return null;
  }

  if (value.taskType !== 'join_activity' && value.taskType !== 'find_partner' && value.taskType !== 'create_activity') {
    return null;
  }

  const primaryAction = readCurrentTaskAction(value.primaryAction);
  const secondaryAction = readCurrentTaskAction(value.secondaryAction);

  return {
    id: value.id,
    taskType: value.taskType,
    taskTypeLabel: value.taskTypeLabel,
    status: typeof value.status === 'string' ? value.status : 'active',
    stageLabel: value.stageLabel,
    currentStage: value.currentStage,
    headline: value.headline,
    summary: value.summary,
    ...(primaryAction ? { primaryAction } : {}),
    ...(secondaryAction ? { secondaryAction } : {}),
  };
}

function readTaskChatPromptPayload(value: unknown): TaskChatPromptPayload | null {
  if (!isRecord(value) || typeof value.prompt !== 'string' || !value.prompt.trim()) {
    return null;
  }

  const followUpMode = value.followUpMode === 'review' || value.followUpMode === 'rebook' || value.followUpMode === 'kickoff'
    ? value.followUpMode
    : undefined;

  return {
    prompt: value.prompt.trim(),
    ...(typeof value.activityId === 'string' && value.activityId.trim() ? { activityId: value.activityId.trim() } : {}),
    ...(followUpMode ? { followUpMode } : {}),
    ...(typeof value.entry === 'string' && value.entry.trim() ? { entry: value.entry.trim() } : {}),
  };
}

function needsAttentionFromInbox(task: CurrentTaskItem): boolean {
  if (task.status === 'waiting_auth') {
    return true;
  }

  if (task.taskType === 'find_partner') {
    return task.currentStage === 'match_ready' || task.currentStage === 'auth_gate';
  }

  if (task.taskType === 'join_activity') {
    return task.currentStage === 'post_activity'
      || task.currentStage === 'action_selected'
      || task.currentStage === 'auth_gate';
  }

  if (task.taskType === 'create_activity') {
    return task.currentStage === 'draft_ready'
      || task.currentStage === 'auth_gate';
  }

  return Boolean(task.primaryAction);
}

function splitMessageInboxTasks(tasks: CurrentTaskItem[]): {
  needsAction: CurrentTaskItem[];
  inProgress: CurrentTaskItem[];
} {
  const needsAction: CurrentTaskItem[] = [];
  const inProgress: CurrentTaskItem[] = [];

  tasks.forEach((task) => {
    if (needsAttentionFromInbox(task)) {
      needsAction.push(task);
      return;
    }

    inProgress.push(task);
  });

  return { needsAction, inProgress };
}

type PromptContextOverrides = {
  activityId?: string;
  followUpMode?: 'review' | 'rebook' | 'kickoff';
  entry?: string;
}

const getAppInstance = () => {
  return getApp<{
    globalData: {
      socket?: WechatMiniprogram.SocketTask;
    };
    setUnreadNum?: (num: number) => void;
  }>();
};

function toStringValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function normalizeNotificationActivityTitle(title: string): string {
  return title.replace(/^活动后反馈[：:\s]*/g, '').trim();
}

Page<MessagePageData, WechatMiniprogram.Page.CustomOption>({
  data: {
    currentTasksNeedsAction: [],
    currentTasksInProgress: [],
    notifications: [],
    chatList: [],
    loading: true,
    notificationExpanded: true,
    unreadNotificationCount: 0,
    totalUnreadCount: 0,
    pendingMatchActionId: '',
    showMatchDetail: false,
    matchDetailLoading: false,
    matchDetailError: '',
    selectedMatchDetail: null,
  },

  onLoad() {
    this.loadData();
    this.loadCurrentTasks();
    this.setupWebSocket();
    void this.consumeMessageCenterFocus();
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ value: 'message' });
    }
    this.loadData();
    this.loadCurrentTasks();
    void this.consumeMessageCenterFocus();
  },

  onPullDownRefresh() {
    Promise.all([this.loadData(), this.loadCurrentTasks()]).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadData(): Promise<void> {
    this.setData({ loading: true });

    try {
      const messageCenterData = await this.loadMessageCenterData();

      this.setData({
        notifications: messageCenterData.notifications,
        chatList: messageCenterData.chatList,
        unreadNotificationCount: messageCenterData.unreadNotificationCount,
        totalUnreadCount: messageCenterData.totalUnreadCount,
        loading: false,
      });

      getAppInstance().setUnreadNum?.(messageCenterData.totalUnreadCount);
    } catch (error) {
      console.error('加载消息数据失败', error);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async loadCurrentTasks(): Promise<void> {
    const userId = this.getCurrentUserId();
    if (!userId) {
      this.setData({
        currentTasksNeedsAction: [],
        currentTasksInProgress: [],
      });
      return;
    }

    try {
      const response = await getCurrentAgentTasks();
      if (response.status !== 200 || !response.data || !Array.isArray(response.data.items)) {
        this.setData({
          currentTasksNeedsAction: [],
          currentTasksInProgress: [],
        });
        return;
      }

      const currentTasks = response.data.items
        .map((item) => readCurrentTaskItem(item))
        .filter((item): item is CurrentTaskItem => item !== null);
      const inboxTasks = splitMessageInboxTasks(currentTasks);

      this.setData({
        currentTasksNeedsAction: inboxTasks.needsAction,
        currentTasksInProgress: inboxTasks.inProgress,
      });
    } catch (error) {
      console.error('加载当前任务失败', error);
      this.setData({
        currentTasksNeedsAction: [],
        currentTasksInProgress: [],
      });
    }
  },

  getCurrentUserId(): string {
    return useUserStore.getState().user?.id || '';
  },

  async loadMessageCenterData(): Promise<{
    notifications: SystemNotification[];
    chatList: ChatItem[];
    unreadNotificationCount: number;
    totalUnreadCount: number;
  }> {
    const userId = this.getCurrentUserId();
    if (!userId) {
      return {
        notifications: [],
        chatList: [],
        unreadNotificationCount: 0,
        totalUnreadCount: 0,
      };
    }

    const response = await getNotificationsMessageCenter({
      userId,
      notificationPage: 1,
      notificationLimit: 20,
      chatPage: 1,
      chatLimit: 20,
    });
    if (response.status !== 200) {
      throw new Error(response.data.msg || '消息中心加载失败');
    }

    const systemNotifications = response.data.systemNotifications.items.map((item) => {
      const createdAtRaw = toStringValue(item.createdAt);
      return {
        id: item.id,
        type: item.type,
        title: item.title,
        content: item.content || this.getNotificationFallbackContent(item.type),
        activityId: item.activityId || '',
        ...(typeof item.taskId === 'string' && item.taskId.trim() ? { taskId: item.taskId.trim() } : {}),
        read: !!item.isRead,
        createdAt: this.formatTime(createdAtRaw),
        source: 'system' as const,
      };
    });
    const pendingMatches = response.data.pendingMatches.map((item) => this.mapPendingMatchToNotification(item));

    const chatList = response.data.chatActivities.items.map((item) => {
      const lastMessageTime = toStringValue(item.lastMessageTime);
      return {
        activityId: item.activityId,
        activityTitle: item.activityTitle,
        activityImage: item.activityImage || '',
        lastMessage: item.lastMessage || '还没人说话，发句开场吧',
        lastMessageTime: lastMessageTime ? this.formatTime(lastMessageTime) : '',
        unreadCount: item.unreadCount || 0,
        isArchived: !!item.isArchived,
        participantCount: item.participantCount || 0,
      } satisfies ChatItem;
    });

    return {
      notifications: [...pendingMatches, ...systemNotifications],
      chatList,
      unreadNotificationCount: response.data.unreadNotificationCount || 0,
      totalUnreadCount: response.data.totalUnread || 0,
    };
  },

  mapPendingMatchToNotification(item: NotificationMessageCenterResponsePendingMatchesItem): SystemNotification {
    const commonTags = item.commonTags.slice(0, 3).join('、');
    const scoreText = `匹配度 ${item.matchScore}%`;
    const tagText = commonTags ? `，共同偏好：${commonTags}` : '';
    const deadlineText = this.formatTime(item.confirmDeadline);
    const content = item.isTempOrganizer
      ? `${scoreText}，地点：${item.locationHint}${tagText}。请在 ${deadlineText} 前确认是否成局。`
      : `${scoreText}，地点：${item.locationHint}${tagText}。已提醒召集人确认，先去聊聊吧。`;

    return {
      id: `match_${item.id}`,
      type: 'match_pending',
      title: `找到合拍搭子（${item.typeName}）`,
      content,
      activityId: '',
      ...(typeof item.taskId === 'string' && item.taskId.trim() ? { taskId: item.taskId.trim() } : {}),
      read: false,
      createdAt: this.formatTime(item.confirmDeadline),
      source: 'match',
      matchId: item.id,
      isTempOrganizer: item.isTempOrganizer,
    };
  },

  getNotificationFallbackContent(type: NotificationMessageCenterResponseSystemNotificationsItemsItemType): string {
    const map: Record<NotificationMessageCenterResponseSystemNotificationsItemsItemType, string> = {
      join: '有新成员加入你的活动',
      quit: '有成员退出了活动',
      activity_start: '活动即将开始，记得准时到场',
      completed: '活动已完成，欢迎继续组局',
      cancelled: '活动已取消',
      new_participant: '活动有新人加入，快去打个招呼',
      post_activity: '活动结束了，来聊聊这次体验',
      activity_reminder: '活动提醒已送达',
    };
    return map[type] || '你有一条新通知';
  },


  mapPendingMatchDetail(detail: PendingMatchDetailResponse): PendingMatchDetailView {
    return {
      id: detail.id,
      activityType: detail.activityType,
      typeName: detail.typeName,
      matchScore: detail.matchScore,
      commonTags: detail.commonTags,
      locationHint: detail.locationHint,
      confirmDeadline: detail.confirmDeadline,
      confirmDeadlineText: this.formatTime(detail.confirmDeadline),
      isTempOrganizer: detail.isTempOrganizer,
      organizerUserId: detail.organizerUserId,
      organizerDisplayName: detail.organizerNickname || '召集人',
      nextActionOwner: detail.nextActionOwner,
      nextActionText: detail.nextActionText,
      members: detail.members.map((member) => {
        const nickname = member.nickname || (member.isTempOrganizer ? '召集人' : '匹配成员');
        return {
          userId: member.userId,
          nickname,
          nicknameInitial: nickname.slice(0, 1),
          avatarUrl: member.avatarUrl || '',
          isTempOrganizer: member.isTempOrganizer,
          locationHint: member.locationHint,
          timePreference: member.timePreference || '时间待沟通',
          tags: member.tags || [],
          intentSummary: member.intentSummary,
        };
      }),
      icebreaker: detail.icebreaker
        ? {
            content: detail.icebreaker.content,
            createdAt: detail.icebreaker.createdAt,
            createdAtText: this.formatTime(detail.icebreaker.createdAt),
          }
        : null,
    };
  },

  async openPendingMatchDetail(matchId: string) {
    const userId = this.getCurrentUserId();
    if (!userId || !matchId) {
      return;
    }

    this.setData({
      showMatchDetail: true,
      matchDetailLoading: true,
      matchDetailError: '',
      selectedMatchDetail: null,
    });

    try {
      const response = await getPendingMatchDetail(matchId, userId);
      if (response.status !== 200) {
        throw new Error(getErrorMessage(response.data, '加载匹配详情失败'));
      }

      this.setData({
        selectedMatchDetail: this.mapPendingMatchDetail(response.data),
        matchDetailLoading: false,
      });
    } catch (error) {
      console.error('加载待确认匹配详情失败', error);
      this.setData({
        matchDetailLoading: false,
        matchDetailError: error instanceof Error ? error.message : '加载详情失败，请稍后再试',
      });
    }
  },

  async consumeMessageCenterFocus() {
    const appStore = useAppStore.getState();
    const focus = appStore.messageCenterFocus;
    if (!focus?.matchId) {
      return;
    }

    appStore.clearMessageCenterFocus();
    await this.openPendingMatchDetail(focus.matchId);
  },

  closeMatchDetail() {
    this.setData({
      showMatchDetail: false,
      matchDetailLoading: false,
      matchDetailError: '',
      selectedMatchDetail: null,
    });
  },

  onMatchDetailVisibleChange() {
    this.closeMatchDetail();
  },

  noop() {},

  async recordRebookFollowUp(activityId: string) {
    if (!activityId) {
      return;
    }

    try {
      const response = await postActivityRebookFollowUp(activityId);
      if (response.status !== 200) {
        console.warn('记录再约意愿失败', response.data);
      }
    } catch (error) {
      console.error('记录再约意愿失败', error);
    }
  },

  setupWebSocket() {
    const socket = getAppInstance().globalData?.socket;
    if (!socket) return;

    socket.onMessage((result) => {
      try {
        if (typeof result.data !== 'string') {
          return;
        }

        const parsed: unknown = JSON.parse(result.data);
        if (!isSocketMessage(parsed)) {
          return;
        }

        const data = parsed;
        if (data.type === 'message' && data.data.activityId && data.data.message) {
          this.handleNewMessage(data.data.activityId, data.data.message);
        }
      } catch (error) {
        console.error('解析 WebSocket 消息失败', error);
      }
    });
  },

  handleNewMessage(_activityId: string, _message: { content: string; createdAt: string }) {
    // 不做本地累加，统一回源服务端真实统计
    this.loadData().catch((error: unknown) => {
      console.error('刷新消息统计失败', error);
    });
  },

  toggleNotificationExpand() {
    this.setData({ notificationExpanded: !this.data.notificationExpanded });
  },

  getAllCurrentTasks(): CurrentTaskItem[] {
    return [
      ...this.data.currentTasksNeedsAction,
      ...this.data.currentTasksInProgress,
    ];
  },

  findCurrentTaskById(taskId: string): CurrentTaskItem | null {
    if (!taskId) {
      return null;
    }

    return this.getAllCurrentTasks().find((task: CurrentTaskItem) => task.id === taskId) || null;
  },

  async onNotificationTap(e: WechatMiniprogram.TouchEvent) {
    const { id, type, activityId, source, isTempOrganizer, matchId, taskId } = e.currentTarget.dataset as {
      id: string;
      type: NotificationType;
      activityId?: string;
      source: 'system' | 'match';
      isTempOrganizer?: boolean | string;
      matchId?: string;
      taskId?: string;
    };
    const canConfirm = isTempOrganizer === true || isTempOrganizer === 'true';

    if (source === 'system' && id) {
      await this.markNotificationRead(id, type !== 'post_activity');
    }

    if (type === 'post_activity') {
      const title = this.data.notifications.find((item) => item.id === id)?.title || '';
      this.promptPostActivityAction(activityId || '', title);
      return;
    }

    if (type === 'match_pending') {
      if (!matchId) {
        wx.showToast({
          title: canConfirm ? '直接点右侧按钮确认或取消' : '已提醒召集人确认，确认后会自动成局',
          icon: 'none',
        });
        return;
      }

      await this.openPendingMatchDetail(matchId);
      return;
    }

    const currentTask = taskId ? this.findCurrentTaskById(taskId) : null;
    if (currentTask?.primaryAction) {
      await this.executeCurrentTaskAction(currentTask.primaryAction);
      return;
    }

    if (currentTask?.secondaryAction) {
      await this.executeCurrentTaskAction(currentTask.secondaryAction);
      return;
    }

    if (activityId) {
      wx.navigateTo({
        url: `/subpackages/activity/detail/index?id=${activityId}`,
      });
    }
  },

  async markNotificationRead(notificationId: string, shouldReload = true) {
    try {
      const response = await postNotificationsByIdRead(notificationId);
      if (response.status !== 200) {
        throw new Error(response.data.msg || '标记已读失败');
      }
      if (shouldReload) {
        await this.loadData();
      }
    } catch (error) {
      console.error('标记通知已读失败', error);
    }
  },

  async onMatchConfirmTap(e: WechatMiniprogram.TouchEvent) {
    const { matchId } = e.currentTarget.dataset as { matchId: string };
    if (!matchId || this.data.pendingMatchActionId) {
      return;
    }

    this.setData({ pendingMatchActionId: matchId });

    try {
      const response = await postNotificationsPendingMatchesByIdConfirm(matchId);
      if (response.status !== 200) {
        throw new Error(response.data.msg || '确认失败，请稍后再试');
      }

      wx.showToast({ title: response.data.msg || '确认成功', icon: 'none' });
      this.closeMatchDetail();
      await this.loadData();
      await this.loadCurrentTasks();

      if (response.data.activityId) {
        wx.navigateTo({
          url: `/subpackages/activity/detail/index?id=${response.data.activityId}`,
        });
      }
    } catch (error) {
      console.error('确认待处理匹配失败', error);
      wx.showToast({
        title: error instanceof Error ? error.message : '确认失败，请稍后再试',
        icon: 'none',
      });
    } finally {
      this.setData({ pendingMatchActionId: '' });
    }
  },

  async onMatchCancelTap(e: WechatMiniprogram.TouchEvent) {
    const { matchId } = e.currentTarget.dataset as { matchId: string };
    if (!matchId || this.data.pendingMatchActionId) {
      return;
    }

    this.setData({ pendingMatchActionId: matchId });

    try {
      const response = await postNotificationsPendingMatchesByIdCancel(matchId);
      if (response.status !== 200) {
        throw new Error(response.data.msg || '取消失败，请稍后再试');
      }

      wx.showToast({ title: response.data.msg || '已取消匹配', icon: 'none' });
      this.closeMatchDetail();
      await this.loadData();
      await this.loadCurrentTasks();
    } catch (error) {
      console.error('取消待处理匹配失败', error);
      wx.showToast({
        title: error instanceof Error ? error.message : '取消失败，请稍后再试',
        icon: 'none',
      });
    } finally {
      this.setData({ pendingMatchActionId: '' });
    }
  },

  promptPostActivityAction(activityId: string, title: string) {
    wx.showActionSheet({
      itemList: ['先做复盘', '去再约'],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) {
          this.startFeedbackReview(activityId, title);
          return;
        }
        if (tapIndex === 1) {
          void this.startRebookFromNotification(activityId, title);
        }
      },
    });
  },

  startFeedbackReview(activityId: string, title: string) {
    const activityTitle = normalizeNotificationActivityTitle(title);
    const activityHint = activityTitle ? `「${activityTitle}」` : '这场活动';
    const activityRef = activityId ? `（activityId: ${activityId}）` : '';
    const prompt = `我刚结束${activityHint}${activityRef}，帮我先做一份复盘：亮点、槽点、下次优化和一句可直接发群里的总结。`;

    this.openHomeWithPrompt(prompt, {
      ...(activityId ? { activityId } : {}),
      followUpMode: 'review',
      entry: 'message_center_post_activity',
    });
  },

  async startRebookFromNotification(activityId: string, title: string) {
    await this.recordRebookFollowUp(activityId);

    const activityTitle = normalizeNotificationActivityTitle(title);
    const activityHint = activityTitle ? `「${activityTitle}」` : '这场活动';
    const activityRef = activityId ? `（activityId: ${activityId}）` : '';
    const prompt = `基于我刚结束的${activityHint}${activityRef}，帮我快速再约一场：延续合适的人、给个新时间建议，并直接生成一段可发送的招呼文案。`;

    this.openHomeWithPrompt(prompt, {
      ...(activityId ? { activityId } : {}),
      followUpMode: 'rebook',
      entry: 'message_center_post_activity',
    });
  },

  openHomeWithPrompt(prompt: string, contextOverrides?: PromptContextOverrides) {
    useChatStore.getState().sendMessage(prompt, contextOverrides);
    wx.switchTab({ url: '/pages/home/index' });
  },

  async executeCurrentTaskAction(action: CurrentTaskAction) {
    if (action.kind === 'structured_action') {
      if (!action.action) {
        return;
      }

      if (action.action === 'start_follow_up_chat') {
        const promptPayload = readTaskChatPromptPayload(action.payload);
        if (!promptPayload) {
          return;
        }

        if (promptPayload.followUpMode === 'rebook' && promptPayload.activityId) {
          await this.recordRebookFollowUp(promptPayload.activityId);
        }

        this.openHomeWithPrompt(promptPayload.prompt, {
          ...(promptPayload.activityId ? { activityId: promptPayload.activityId } : {}),
          ...(promptPayload.followUpMode ? { followUpMode: promptPayload.followUpMode } : {}),
          ...(promptPayload.entry ? { entry: promptPayload.entry } : {}),
        });
        return;
      }

      useChatStore.getState().sendAction({
        action: action.action,
        payload: action.payload || {},
        source: action.source,
        originalText: action.originalText,
      });
      return;
    }

    if (!action.url) {
      return;
    }

    if (action.kind === 'switch_tab' && action.url === '/pages/message/index') {
      const focusIntent = readMessageCenterFocusIntent(action.payload);
      if (focusIntent?.matchId) {
        await this.openPendingMatchDetail(focusIntent.matchId);
        return;
      }

      useAppStore.getState().setMessageCenterFocus(focusIntent);
      wx.switchTab({ url: action.url });
      return;
    }

    if (action.kind === 'switch_tab') {
      wx.switchTab({ url: action.url });
      return;
    }

    wx.navigateTo({ url: action.url });
  },

  onCurrentTaskActionTap(e: WechatMiniprogram.CustomEvent<{ action?: CurrentTaskAction }>) {
    const action = readCurrentTaskAction(e.detail?.action);
    if (!action) {
      return;
    }

    void this.executeCurrentTaskAction(action);
  },

  onChatTap(e: WechatMiniprogram.TouchEvent) {
    const { activityId } = e.currentTarget.dataset as { activityId: string };
    wx.navigateTo({
      url: `/pages/chat/index?activityId=${activityId}`,
    });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: '/pages/home/index' });
    }
  },

  formatTime(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      return dateStr;
    }

    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60 * 1000) {
      return '刚刚';
    }
    if (diff < 60 * 60 * 1000) {
      return `${Math.floor(diff / (60 * 1000))}分钟前`;
    }
    if (date.toDateString() === now.toDateString()) {
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return '昨天';
    }

    return `${date.getMonth() + 1}/${date.getDate()}`;
  },
});
