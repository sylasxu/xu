#!/usr/bin/env bun

import { agentTasks, and, db, eq, inArray, partnerIntents, users } from '@juchang/db';
import { app } from '../apps/api/src/index';

interface ApiError {
  code?: number;
  msg?: string;
}

interface UserProfile {
  id: string;
  wxOpenId: string | null;
  phoneNumber: string | null;
  nickname: string | null;
}

interface BootstrappedUser {
  user: UserProfile;
  token: string;
  isNewUser: boolean;
}

interface BootstrapResponse {
  users: BootstrappedUser[];
  msg: string;
}

interface LoginResponse {
  token: string;
}

interface PublicActivityResponse {
  id: string;
  title: string;
  status: string;
  currentParticipants: number;
  participants: Array<{ userId: string; nickname: string | null }>;
  recentMessages: Array<{ content: string; createdAt: string }>;
}

interface ActivityParticipantInfo {
  id: string;
  userId: string;
  status: string;
  joinedAt: string | null;
  user: {
    id: string;
    nickname: string | null;
    avatarUrl: string | null;
  } | null;
}

interface ChatMessagesResponse {
  messages: Array<{
    id: string;
    senderId: string | null;
    content: string;
    type: string;
    createdAt: string;
  }>;
  isArchived: boolean;
}

interface ChatActivitiesResponse {
  items: Array<{
    activityId: string;
    activityTitle: string;
    participantCount: number;
    lastMessage: string | null;
  }>;
  total: number;
  page: number;
  totalPages: number;
  totalUnread: number;
}

interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  activityId: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationListResponse {
  items: NotificationItem[];
  total: number;
  page: number;
  totalPages: number;
}

interface UnreadCountResponse {
  count: number;
}

interface MessageCenterResponse {
  unreadNotificationCount: number;
  totalUnread: number;
  chatActivities: {
    totalUnread: number;
  };
}

interface WelcomeResponse {
  greeting: string;
  subGreeting?: string;
  sections?: unknown[];
}

type FollowUpMode = 'review' | 'rebook' | 'kickoff';

interface AiChatRequestContext {
  client?: 'web' | 'miniprogram' | 'admin';
  locale?: string;
  timezone?: string;
  platformVersion?: string;
  lat?: number;
  lng?: number;
  activityId?: string;
  followUpMode?: FollowUpMode;
  entry?: string;
}

interface AiChatBlock {
  blockId: string;
  type: string;
  content?: string;
  title?: string;
  question?: string;
  level?: string;
  message?: string;
  schema?: Record<string, unknown>;
  initialValues?: Record<string, unknown>;
  fields?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  items?: Array<{
    label?: string;
    action?: string;
    params?: Record<string, unknown>;
  }>;
}

interface AiChatEnvelope {
  traceId: string;
  conversationId: string;
  turn: {
    turnId: string;
    role: 'assistant';
    status: 'completed' | 'streaming' | 'error';
    blocks: AiChatBlock[];
  };
}

interface AiConversationsResponse {
  items: Array<{
    id: string;
    userId: string;
    messageCount: number;
    userNickname: string | null;
  }>;
  total: number;
  hasMore: boolean;
  cursor: string | null;
}

interface CurrentTaskActionSnapshot {
  kind: string;
  label: string;
  action?: string;
  payload?: Record<string, unknown>;
  url?: string;
}

interface CurrentTaskSnapshot {
  id: string;
  taskType: string;
  currentStage: string;
  status: string;
  headline: string;
  summary: string;
  activityId?: string;
  primaryAction?: CurrentTaskActionSnapshot;
  secondaryAction?: CurrentTaskActionSnapshot;
}

interface CurrentTasksResponse {
  items: CurrentTaskSnapshot[];
  serverTime: string;
}

interface StoredActivityOutcome {
  activityId: string;
  activityTitle: string;
  activityType: string;
  locationName: string;
  attended: boolean | null;
  rebookTriggered: boolean;
  reviewSummary?: string | null;
  happenedAt: string;
  updatedAt: string;
}

interface ScenarioResult {
  name: string;
  passed: boolean;
  details: string[];
  error?: string;
}

interface ScenarioContext {
  users: BootstrappedUser[];
}

const ADMIN_PHONE = process.env.SMOKE_ADMIN_PHONE?.trim()
  || process.env.ADMIN_PHONE_WHITELIST?.split(',').map((phone) => phone.trim()).find(Boolean)
  || '13996092317';
const ADMIN_CODE = process.env.SMOKE_ADMIN_CODE?.trim()
  || process.env.ADMIN_SUPER_CODE?.trim()
  || '9999';
const BASE_URL = 'http://localhost';
const USER_COUNT = 5;
const DEFAULT_TEST_MODEL = process.env.GENUI_TEST_MODEL?.trim() || 'deepseek-chat';
const scenarioArgIndex = Bun.argv.indexOf('--scenario');
const scenarioFilter = scenarioArgIndex >= 0 ? Bun.argv[scenarioArgIndex + 1] : '';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function hasLeakedToolCallText(value: string): boolean {
  const normalized = value.replace(/\s+/g, '');
  return /^call[a-zA-Z]+\(/.test(normalized);
}

function assertNoLeakedToolText(blocks: AiChatEnvelope['turn']['blocks'], label: string): void {
  for (const block of blocks) {
    if (block.type !== 'text' || typeof block.content !== 'string') {
      continue;
    }

    if (hasLeakedToolCallText(block.content)) {
      throw new Error(`${label} 出现伪 Tool 文本泄漏: ${block.content}`);
    }
  }
}

function findBlock(blocks: AiChatEnvelope['turn']['blocks'], type: string): AiChatBlock | undefined {
  return blocks.find((block) => block.type === type);
}

function hasTextContent(blocks: AiChatEnvelope['turn']['blocks']): boolean {
  return blocks.some((block) => block.type === 'text' && typeof block.content === 'string' && block.content.trim().length > 0);
}

function hasVisibleFeedback(blocks: AiChatEnvelope['turn']['blocks']): boolean {
  return blocks.some((block) => {
    if (block.type === 'text' && typeof block.content === 'string' && block.content.trim().length > 0) {
      return true;
    }

    if (block.type === 'alert' && typeof block.message === 'string' && block.message.trim().length > 0) {
      return true;
    }

    return false;
  });
}

function readAlertMeta(block: AiChatBlock): Record<string, unknown> | null {
  return block.type === 'alert' && block.meta && typeof block.meta === 'object'
    ? block.meta
    : null;
}

function findAlertBlock(blocks: AiChatEnvelope['turn']['blocks']): AiChatBlock | undefined {
  return blocks.find((block) => block.type === 'alert');
}

async function requestJson<T>(params: {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  token?: string;
  payload?: Record<string, unknown>;
}): Promise<T> {
  const response = await app.handle(
    new Request(`${BASE_URL}${params.path}`, {
      method: params.method,
      headers: {
        'content-type': 'application/json',
        ...(params.token ? { authorization: `Bearer ${params.token}` } : {}),
      },
      body: params.payload ? JSON.stringify(params.payload) : undefined,
    })
  );

  const bodyText = await response.text();
  const parsed = bodyText ? JSON.parse(bodyText) as T | ApiError : {};

  if (!response.ok) {
    const apiError = parsed as ApiError;
    throw new Error(`${params.method} ${params.path} 失败: HTTP ${response.status} ${apiError.msg || bodyText}`);
  }

  return parsed as T;
}

async function getAdminToken(): Promise<string> {
  const response = await requestJson<LoginResponse>({
    method: 'POST',
    path: '/auth/login',
    payload: {
      grantType: 'phone_otp',
      phone: ADMIN_PHONE,
      code: ADMIN_CODE,
    },
  });

  assert(response.token, '管理员登录后未返回 token');
  return response.token;
}


async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(
  producer: () => Promise<T | null>,
  options?: { retries?: number; delayMs?: number }
): Promise<T | null> {
  const retries = options?.retries ?? 6;
  const delayMs = options?.delayMs ?? 200;

  for (let index = 0; index < retries; index++) {
    const value = await producer();
    if (value) {
      return value;
    }
    if (index < retries - 1) {
      await sleep(delayMs);
    }
  }

  return null;
}

async function requestError(params: {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  token?: string;
  payload?: Record<string, unknown>;
}): Promise<{ status: number; msg: string }> {
  const response = await app.handle(
    new Request(`${BASE_URL}${params.path}`, {
      method: params.method,
      headers: {
        'content-type': 'application/json',
        ...(params.token ? { authorization: `Bearer ${params.token}` } : {}),
      },
      body: params.payload ? JSON.stringify(params.payload) : undefined,
    })
  );

  const bodyText = await response.text();
  const parsed = bodyText ? JSON.parse(bodyText) as ApiError : {};

  if (response.ok) {
    throw new Error(`${params.method} ${params.path} 预期失败，但返回成功`);
  }

  return {
    status: response.status,
    msg: parsed.msg || bodyText,
  };
}

function buildCreatePayload(overrides?: Partial<{
  title: string;
  description: string;
  location: [number, number];
  locationName: string;
  address: string;
  locationHint: string;
  startAt: string;
  type: 'food' | 'entertainment' | 'sports' | 'boardgame' | 'other';
  maxParticipants: number;
}>): Record<string, unknown> {
  const titleSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    title: `沙盘验收局-${titleSuffix}`,
    description: '用于多账号沙盘验收。',
    location: [106.551556, 29.563009],
    locationName: '重庆观音桥',
    address: '观音桥步行街',
    locationHint: '地铁站 3 号口见',
    startAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    type: 'food',
    maxParticipants: 5,
    ...overrides,
  };
}

async function bootstrapUsers(): Promise<BootstrappedUser[]> {
  const adminToken = await getAdminToken();
  const bootstrap = await requestJson<BootstrapResponse>({
    method: 'POST',
    path: '/auth/test-users/bootstrap',
    token: adminToken,
    payload: {
      phone: ADMIN_PHONE,
      code: ADMIN_CODE,
      count: USER_COUNT,
    },
  });

  assert(bootstrap.users.length === USER_COUNT, `期望准备 ${USER_COUNT} 个账号，实际得到 ${bootstrap.users.length}`);
  return bootstrap.users;
}

async function cleanupSandboxPartnerIntents(users: BootstrappedUser[]): Promise<void> {
  const userIds = users.map((item) => item.user.id);
  if (userIds.length === 0) {
    return;
  }

  await db
    .update(partnerIntents)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(and(
      inArray(partnerIntents.userId, userIds),
      eq(partnerIntents.status, 'active')
    ));
}

async function cleanupSandboxAgentTasks(users: BootstrappedUser[]): Promise<void> {
  const userIds = users.map((item) => item.user.id);
  if (userIds.length === 0) {
    return;
  }

  await db
    .update(agentTasks)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(and(
      inArray(agentTasks.userId, userIds),
      inArray(agentTasks.status, ['active', 'waiting_auth', 'waiting_async_result'])
    ));
}

async function createActivity(creator: BootstrappedUser, overrides?: Parameters<typeof buildCreatePayload>[0]) {
  const result = await requestJson<{ id: string; msg: string }>({
    method: 'POST',
    path: '/activities',
    token: creator.token,
    payload: buildCreatePayload(overrides),
  });
  return result.id;
}

async function joinActivity(activityId: string, user: BootstrappedUser) {
  return requestJson<{ success: boolean; msg: string; participantId: string }>({
    method: 'POST',
    path: `/activities/${activityId}/join`,
    token: user.token,
  });
}

async function quitActivity(activityId: string, user: BootstrappedUser) {
  return requestJson<{ success: boolean; msg: string }>({
    method: 'POST',
    path: `/activities/${activityId}/quit`,
    token: user.token,
  });
}

async function cancelActivity(activityId: string, creator: BootstrappedUser) {
  return requestJson<{ success: boolean; msg?: string }>({
    method: 'PATCH',
    path: `/activities/${activityId}/status`,
    token: creator.token,
    payload: { status: 'cancelled' },
  });
}

async function markActivityCompleted(activityId: string, creator: BootstrappedUser) {
  return requestJson<{ success: boolean; msg: string }>({
    method: 'PATCH',
    path: `/activities/${activityId}/status`,
    token: creator.token,
    payload: { status: 'completed' },
  });
}

async function getPublicActivity(activityId: string) {
  return requestJson<PublicActivityResponse>({
    method: 'GET',
    path: `/activities/${activityId}/public`,
  });
}

async function getActivityParticipants(activityId: string) {
  return requestJson<ActivityParticipantInfo[]>({
    method: 'GET',
    path: `/participants/activity/${activityId}`,
  });
}

async function getChatMessages(activityId: string, user: BootstrappedUser) {
  return requestJson<ChatMessagesResponse>({
    method: 'GET',
    path: `/chat/${activityId}/messages?limit=50`,
    token: user.token,
  });
}

async function listChatActivities(user: BootstrappedUser) {
  return requestJson<ChatActivitiesResponse>({
    method: 'GET',
    path: `/chat/activities?userId=${user.user.id}&page=1&limit=20`,
    token: user.token,
  });
}

async function sendChatMessage(activityId: string, user: BootstrappedUser, content: string) {
  return requestJson<{ id: string; msg: string }>({
    method: 'POST',
    path: `/chat/${activityId}/messages`,
    token: user.token,
    payload: { content },
  });
}

async function getNotifications(user: BootstrappedUser) {
  return requestJson<NotificationListResponse>({
    method: 'GET',
    path: `/notifications?userId=${user.user.id}&page=1&limit=20`,
    token: user.token,
  });
}

async function getUnreadCount(user: BootstrappedUser) {
  return requestJson<UnreadCountResponse>({
    method: 'GET',
    path: '/notifications/unread-count',
    token: user.token,
  });
}

async function markNotificationRead(user: BootstrappedUser, notificationId: string) {
  return requestJson<{ code: number; msg: string }>({
    method: 'POST',
    path: `/notifications/${notificationId}/read`,
    token: user.token,
  });
}

async function getMessageCenter(user: BootstrappedUser) {
  return requestJson<MessageCenterResponse>({
    method: 'GET',
    path: `/notifications/message-center?userId=${user.user.id}&notificationPage=1&notificationLimit=10&chatPage=1&chatLimit=10`,
    token: user.token,
  });
}

async function getAiWelcome(user?: BootstrappedUser) {
  return requestJson<WelcomeResponse>({
    method: 'GET',
    path: '/ai/welcome?lat=29.56&lng=106.55',
    token: user?.token,
  });
}

async function postAiChat(params: {
  user?: BootstrappedUser;
  text: string;
  conversationId?: string;
  context?: AiChatRequestContext;
}) {
  return requestJson<AiChatEnvelope>({
    method: 'POST',
    path: '/ai/chat',
    token: params.user?.token,
    payload: {
      ...(params.conversationId ? { conversationId: params.conversationId } : {}),
      input: { type: 'text', text: params.text },
      ai: { model: DEFAULT_TEST_MODEL },
      context: {
        client: 'web',
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
        ...params.context,
      },
      stream: false,
    },
  });
}

async function postAiAction(params: {
  user?: BootstrappedUser;
  action: string;
  actionId?: string;
  conversationId?: string;
  payload?: Record<string, unknown>;
  displayText?: string;
  context?: AiChatRequestContext;
}) {
  return requestJson<AiChatEnvelope>({
    method: 'POST',
    path: '/ai/chat',
    token: params.user?.token,
    payload: {
      ...(params.conversationId ? { conversationId: params.conversationId } : {}),
      input: {
        type: 'action',
        action: params.action,
        actionId: params.actionId || `smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ...(params.payload ? { params: params.payload } : {}),
        ...(params.displayText ? { displayText: params.displayText } : {}),
      },
      ai: { model: DEFAULT_TEST_MODEL },
      context: {
        client: 'web',
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
        ...params.context,
      },
      stream: false,
    },
  });
}

async function getAiConversations(user: BootstrappedUser) {
  return requestJson<AiConversationsResponse>({
    method: 'GET',
    path: `/ai/conversations?userId=${user.user.id}&limit=20`,
    token: user.token,
  });
}

async function getAiCurrentTasks(user: BootstrappedUser) {
  return requestJson<CurrentTasksResponse>({
    method: 'GET',
    path: '/ai/tasks/current',
    token: user.token,
  });
}

async function postAiDiscussionEntered(params: {
  user: BootstrappedUser;
  activityId: string;
  entry?: string;
}) {
  return requestJson<{ code: number; msg: string }>({
    method: 'POST',
    path: '/ai/tasks/discussion-entered',
    token: params.user.token,
    payload: {
      activityId: params.activityId,
      ...(params.entry ? { entry: params.entry } : {}),
    },
  });
}

async function confirmFulfillment(params: {
  activityId: string;
  creator: BootstrappedUser;
  participants: Array<{ userId: string; fulfilled: boolean }>;
}) {
  return requestJson<{
    activityId: string;
    attendedCount: number;
    noShowCount: number;
    totalSubmitted: number;
    msg: string;
  }>({
    method: 'POST',
    path: '/participants/confirm-fulfillment',
    token: params.creator.token,
    payload: {
      activityId: params.activityId,
      participants: params.participants,
    },
  });
}

async function markRebookFollowUp(activityId: string, user: BootstrappedUser) {
  return requestJson<{ code: number; msg: string }>({
    method: 'POST',
    path: '/participants/rebook-follow-up',
    token: user.token,
    payload: { activityId },
  });
}

function readActivityOutcomesFromWorkingMemory(workingMemory: string | null): StoredActivityOutcome[] {
  if (!workingMemory) {
    return [];
  }

  try {
    const parsed = JSON.parse(workingMemory) as {
      version?: unknown;
      activityOutcomes?: unknown;
    };

    if (parsed.version !== 2 || !Array.isArray(parsed.activityOutcomes)) {
      return [];
    }

    return parsed.activityOutcomes.flatMap((item): StoredActivityOutcome[] => {
      if (typeof item !== 'object' || item === null) {
        return [];
      }

      const outcome = item as Partial<StoredActivityOutcome>;
      if (
        typeof outcome.activityId !== 'string'
        || typeof outcome.activityTitle !== 'string'
        || typeof outcome.activityType !== 'string'
        || typeof outcome.locationName !== 'string'
        || !(outcome.attended === null || typeof outcome.attended === 'boolean')
        || typeof outcome.rebookTriggered !== 'boolean'
        || typeof outcome.happenedAt !== 'string'
        || typeof outcome.updatedAt !== 'string'
      ) {
        return [];
      }

      if (
        outcome.reviewSummary !== undefined
        && outcome.reviewSummary !== null
        && typeof outcome.reviewSummary !== 'string'
      ) {
        return [];
      }

      return [outcome];
    });
  } catch {
    return [];
  }
}

async function getUserActivityOutcome(userId: string, activityId: string): Promise<StoredActivityOutcome | null> {
  const [record] = await db
    .select({ workingMemory: users.workingMemory })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!record) {
    return null;
  }

  return readActivityOutcomesFromWorkingMemory(record.workingMemory)
    .find((item) => item.activityId === activityId) ?? null;
}

async function withActivity<T>(creator: BootstrappedUser, run: (activityId: string) => Promise<T>, overrides?: Parameters<typeof buildCreatePayload>[0]) {
  const activityId = await createActivity(creator, overrides);
  try {
    return await run(activityId);
  } finally {
    await cancelActivity(activityId, creator).catch(() => null);
  }
}

async function scenarioBasicDiscussionFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [creator, ...joiners] = context.users;
  const details: string[] = [];

  await withActivity(creator, async (activityId) => {
    for (const joiner of joiners) {
      await joinActivity(activityId, joiner);
    }

    const contents = [
      '帮你把局组好了！今晚 7 点观音桥见。',
      '收到，我 6:50 到。',
      '我带桌游暖场，大家别空腹来。',
    ];

    await sendChatMessage(activityId, creator, contents[0]);
    await sendChatMessage(activityId, joiners[0], contents[1]);
    await sendChatMessage(activityId, joiners[1], contents[2]);

    const publicActivity = await getPublicActivity(activityId);
    assert(publicActivity.currentParticipants === 5, `基础链路人数异常: ${publicActivity.currentParticipants}`);

    const messages = await getChatMessages(activityId, joiners[0]);
    assert(messages.messages.length >= 7, `基础链路消息数过少: ${messages.messages.length}`);
    for (const content of contents) {
      assert(messages.messages.some((item) => item.content === content), `讨论区缺少消息: ${content}`);
    }

    const chatActivities = await listChatActivities(joiners[0]);
    assert(chatActivities.items.some((item) => item.activityId === activityId), '群聊列表里看不到新活动');

    details.push(`活动 ${activityId} 完成创建、报名、讨论区发言`);
    details.push(`公开人数=${publicActivity.currentParticipants}，消息数=${messages.messages.length}`);
  });

  return { name: 'basic-discussion-flow', passed: true, details };
}

async function scenarioCapacityLimit(context: ScenarioContext): Promise<ScenarioResult> {
  const [creator, user2, user3, user4, user5] = context.users;
  const details: string[] = [];

  await withActivity(creator, async (activityId) => {
    await joinActivity(activityId, user2);
    await joinActivity(activityId, user3);
    await joinActivity(activityId, user4);

    const fullError = await requestError({
      method: 'POST',
      path: `/activities/${activityId}/join`,
      token: user5.token,
    });
    assert(fullError.msg.includes('活动人数已满'), `满员提示异常: ${fullError.msg}`);

    const publicActivity = await getPublicActivity(activityId);
    assert(publicActivity.currentParticipants === 4, `满员场景人数异常: ${publicActivity.currentParticipants}`);

    details.push(`活动 ${activityId} 满员拦截成功`);
    details.push(`第 5 个尝试报名用户被拦截：${fullError.msg}`);
  }, { maxParticipants: 4 });

  return { name: 'capacity-limit', passed: true, details };
}

async function scenarioDuplicateAndRejoin(context: ScenarioContext): Promise<ScenarioResult> {
  const [creator, user2] = context.users;
  const details: string[] = [];

  await withActivity(creator, async (activityId) => {
    await joinActivity(activityId, user2);

    const duplicateError = await requestError({
      method: 'POST',
      path: `/activities/${activityId}/join`,
      token: user2.token,
    });
    assert(duplicateError.msg.includes('您已报名此活动'), `重复报名提示异常: ${duplicateError.msg}`);

    await quitActivity(activityId, user2);
    const afterQuit = await getPublicActivity(activityId);
    assert(afterQuit.currentParticipants === 1, `退出后人数异常: ${afterQuit.currentParticipants}`);

    await joinActivity(activityId, user2);
    const afterRejoin = await getPublicActivity(activityId);
    assert(afterRejoin.currentParticipants === 2, `重新加入后人数异常: ${afterRejoin.currentParticipants}`);

    details.push(`活动 ${activityId} 重复报名被拦截，退出后可重新加入`);
    details.push(`退出后人数=${afterQuit.currentParticipants}，重进后人数=${afterRejoin.currentParticipants}`);
  });

  return { name: 'duplicate-and-rejoin', passed: true, details };
}

async function scenarioPermissionGuards(context: ScenarioContext): Promise<ScenarioResult> {
  const [creator, user2, user3, user4, outsider] = context.users;
  const details: string[] = [];

  await withActivity(creator, async (activityId) => {
    await joinActivity(activityId, user2);
    await joinActivity(activityId, user3);
    await joinActivity(activityId, user4);

    const creatorJoinError = await requestError({
      method: 'POST',
      path: `/activities/${activityId}/join`,
      token: creator.token,
    });
    assert(creatorJoinError.msg.includes('不能报名自己创建的活动'), `创建者报名提示异常: ${creatorJoinError.msg}`);

    const outsiderChatError = await requestError({
      method: 'POST',
      path: `/chat/${activityId}/messages`,
      token: outsider.token,
      payload: { content: '我没报名，但我想发言。' },
    });
    assert(outsiderChatError.msg.includes('您不是该活动的参与者'), `非参与者发言提示异常: ${outsiderChatError.msg}`);

    const nonCreatorStatusError = await requestError({
      method: 'PATCH',
      path: `/activities/${activityId}/status`,
      token: user2.token,
      payload: { status: 'cancelled' },
    });
    assert(nonCreatorStatusError.msg.includes('只有活动发起人可以更新状态'), `非创建者更新状态提示异常: ${nonCreatorStatusError.msg}`);

    details.push(`活动 ${activityId} 权限闸门正常`);
    details.push('创建者自报拦截、非参与者发言拦截、非创建者改状态拦截全部通过');
  }, { maxParticipants: 4 });

  return { name: 'permission-guards', passed: true, details };
}

async function scenarioCancelVisibility(context: ScenarioContext): Promise<ScenarioResult> {
  const [creator, user2] = context.users;
  const details: string[] = [];

  const activityId = await createActivity(creator, { maxParticipants: 5 });
  try {
    await joinActivity(activityId, user2);

    const beforeCancel = await getPublicActivity(activityId);
    assert(beforeCancel.status === 'active', `取消前状态异常: ${beforeCancel.status}`);

    await cancelActivity(activityId, creator);

    const publicError = await requestError({
      method: 'GET',
      path: `/activities/${activityId}/public`,
    });
    assert(publicError.status === 404, `取消后公开详情状态码异常: ${publicError.status}`);

    const joinAfterCancel = await requestError({
      method: 'POST',
      path: `/activities/${activityId}/join`,
      token: user2.token,
    });
    assert(joinAfterCancel.msg.includes('活动不在招募中') || joinAfterCancel.msg.includes('您已报名此活动'), `取消后报名提示异常: ${joinAfterCancel.msg}`);

    details.push(`活动 ${activityId} 取消后不再公开可见`);
    details.push(`公开详情状态码=${publicError.status}，报名提示=${joinAfterCancel.msg}`);
  } finally {
    await cancelActivity(activityId, creator).catch(() => null);
  }

  return { name: 'cancel-visibility', passed: true, details };
}

async function scenarioNotificationsFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [creator, joiner] = context.users;
  const details: string[] = [];

  const activityId = await createActivity(creator, {
    title: `通知验收局-${Date.now()}`,
    description: '通知链路验收',
  });

  try {
    const creatorUnreadBefore = await getUnreadCount(creator);

    await joinActivity(activityId, joiner);

    const joinNotification = await waitFor(async () => {
      const creatorNotifications = await getNotifications(creator);
      return creatorNotifications.items.find((item) => item.activityId === activityId && item.type === 'join') ?? null;
    });
    assert(joinNotification, '创建者未收到 join 通知');
    assert(joinNotification.content.includes(joiner.user.nickname || '测试用户2'), `join 通知内容异常: ${joinNotification.content}`);

    const creatorUnreadAfterJoin = await getUnreadCount(creator);
    assert(creatorUnreadAfterJoin.count >= creatorUnreadBefore.count + 1, `join 后未读数未增加: before=${creatorUnreadBefore.count}, after=${creatorUnreadAfterJoin.count}`);

    await markNotificationRead(creator, joinNotification.id);
    const creatorNotificationsAfterRead = await getNotifications(creator);
    const readNotification = creatorNotificationsAfterRead.items.find((item) => item.id === joinNotification.id);
    assert(readNotification?.isRead === true, '标记已读后通知状态未更新');

    const creatorUnreadAfterRead = await getUnreadCount(creator);
    assert(creatorUnreadAfterRead.count <= creatorUnreadAfterJoin.count - 1, `标记已读后未读数未回落: afterJoin=${creatorUnreadAfterJoin.count}, afterRead=${creatorUnreadAfterRead.count}`);

    await cancelActivity(activityId, creator);

    const cancelledNotification = await waitFor(async () => {
      const joinerNotifications = await getNotifications(joiner);
      return joinerNotifications.items.find((item) => item.activityId === activityId && item.type === 'cancelled') ?? null;
    });
    assert(cancelledNotification, '报名用户未收到 cancelled 通知');

    const messageCenter = await getMessageCenter(joiner);
    assert(messageCenter.unreadNotificationCount >= 1, '消息中心未统计通知未读');
    assert(messageCenter.totalUnread >= messageCenter.unreadNotificationCount, '消息中心总未读小于通知未读');

    details.push(`活动 ${activityId} 的 join/cancel 通知链路通过`);
    details.push(`创建者 unread ${creatorUnreadBefore.count} -> ${creatorUnreadAfterJoin.count} -> ${creatorUnreadAfterRead.count}`);
    details.push(`报名用户收到了 cancelled 通知，消息中心 totalUnread=${messageCenter.totalUnread}`);
  } finally {
    await cancelActivity(activityId, creator).catch(() => null);
  }

  return { name: 'notifications-flow', passed: true, details };
}

async function scenarioPostActivityFollowUpFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [creator, joiner] = context.users;
  const details: string[] = [];
  const activityTitle = `活动后跟进验收局-${Date.now()}`;
  const activityId = await createActivity(creator, {
    title: activityTitle,
    description: '用于验证活动完成后的 review / rebook 写回。',
  });

  await joinActivity(activityId, joiner);
  await sendChatMessage(activityId, creator, '今晚结束后记得回来复盘一下，看看下次还约不约。');

  const completed = await markActivityCompleted(activityId, creator);
  assert(completed.success === true, `活动完成状态更新失败: ${completed.msg}`);

  const afterCompletedMessages = await getChatMessages(activityId, joiner);
  assert(
    afterCompletedMessages.messages.some((item) => item.content.includes('已确认成局')),
    '活动完成后讨论区缺少“已确认成局”系统消息',
  );

  const joinedParticipants = (await getActivityParticipants(activityId))
    .filter((item) => item.status === 'joined');
  assert(joinedParticipants.length >= 2, `履约确认前 joined 参与者数量异常: ${joinedParticipants.length}`);

  const fulfillment = await confirmFulfillment({
    activityId,
    creator,
    participants: joinedParticipants.map((item) => ({
      userId: item.userId,
      fulfilled: true,
    })),
  });
  assert(fulfillment.noShowCount === 0, `履约确认缺席人数异常: ${fulfillment.noShowCount}`);
  assert(fulfillment.totalSubmitted === joinedParticipants.length, `履约确认提交人数异常: ${fulfillment.totalSubmitted}`);

  const afterFulfillmentMessages = await getChatMessages(activityId, joiner);
  assert(
    afterFulfillmentMessages.messages.some((item) => item.content.includes('履约确认完成')),
    '履约确认后讨论区缺少系统总结消息',
  );

  const initialOutcome = await waitFor(
    async () => getUserActivityOutcome(joiner.user.id, activityId),
    { retries: 8, delayMs: 300 },
  );
  assert(initialOutcome, '履约确认后参与者 workingMemory 未写入 activityOutcome');
  assert(initialOutcome.attended === true, `参与者 attended 写回异常: ${initialOutcome.attended}`);
  assert(initialOutcome.rebookTriggered === false, '履约确认后不应提前写入 rebookTriggered');
  assert(
    typeof initialOutcome.reviewSummary === 'string' && initialOutcome.reviewSummary.includes('真实履约结果'),
    `履约确认后的初始 reviewSummary 异常: ${initialOutcome.reviewSummary}`,
  );

  const reviewTurn = await postAiChat({
    user: joiner,
    text: `我刚结束「${activityTitle}」（activityId: ${activityId}），帮我先做一份复盘：亮点、槽点、下次优化和一句可直接发群里的总结。`,
    context: {
      activityId,
      followUpMode: 'review',
      entry: 'message_center_post_activity',
    },
  });
  assertNoLeakedToolText(reviewTurn.turn.blocks, '活动后 review 复盘');
  assert(
    hasTextContent(reviewTurn.turn.blocks),
    `活动后 review 复盘没有返回文本块: ${JSON.stringify(reviewTurn.turn.blocks)}`,
  );

  const reviewedOutcome = await waitFor(async () => {
    const outcome = await getUserActivityOutcome(joiner.user.id, activityId);
    if (!outcome) {
      return null;
    }

    const reviewSummary = outcome.reviewSummary?.trim();
    if (!reviewSummary || reviewSummary === initialOutcome.reviewSummary) {
      return null;
    }

    return outcome;
  }, { retries: 8, delayMs: 300 });
  assert(reviewedOutcome, '活动后 review 未写回新的 reviewSummary');
  assert(reviewedOutcome.rebookTriggered === false, 'review 写回不应顺带开启 rebookTriggered');

  const rebookResult = await markRebookFollowUp(activityId, joiner);
  assert(rebookResult.code === 200, `记录再约意愿失败: ${rebookResult.msg}`);

  const rebookedOutcome = await waitFor(async () => {
    const outcome = await getUserActivityOutcome(joiner.user.id, activityId);
    return outcome?.rebookTriggered ? outcome : null;
  }, { retries: 8, delayMs: 300 });
  assert(rebookedOutcome, '活动后 rebook 未写回 rebookTriggered=true');
  assert(
    rebookedOutcome.reviewSummary === reviewedOutcome.reviewSummary,
    '记录再约意愿时不应覆盖已有的 reviewSummary',
  );

  details.push(`活动 ${activityId} 已串通 completed -> confirm-fulfillment -> review -> rebook`);
  details.push(`参与者初始复盘="${initialOutcome.reviewSummary}"`);
  details.push(`AI 复盘后写回摘要="${reviewedOutcome.reviewSummary}"`);
  details.push(`再约标记已落库，rebookTriggered=${rebookedOutcome.rebookTriggered}`);

  return { name: 'post-activity-follow-up-flow', passed: true, details };
}

async function scenarioAiExploreWithoutLocationFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [user] = context.users;
  const details: string[] = [];

  const firstTurn = await postAiChat({ user, text: '周末附近有什么活动' });
  assert(typeof firstTurn.conversationId === 'string' && firstTurn.conversationId.length > 0, 'AI 探索首轮未返回 conversationId');
  assertNoLeakedToolText(firstTurn.turn.blocks, 'AI 无位置探索首轮');
  assert(
    firstTurn.turn.blocks.some((block) => block.type === 'choice'),
    `AI 无位置探索首轮未返回位置选择卡: ${JSON.stringify(firstTurn.turn.blocks)}`,
  );

  const secondTurn = await postAiChat({
    user,
    conversationId: firstTurn.conversationId,
    text: '解放碑',
  });
  assertNoLeakedToolText(secondTurn.turn.blocks, 'AI 位置追答');
  assert(
    secondTurn.turn.blocks.some((block) => block.type === 'choice'),
    `AI 位置追答后未返回类型选择卡: ${JSON.stringify(secondTurn.turn.blocks)}`,
  );

  const thirdTurn = await postAiChat({
    user,
    conversationId: firstTurn.conversationId,
    text: '火锅',
  });
  assertNoLeakedToolText(thirdTurn.turn.blocks, 'AI 类型追答');
  assert(
    thirdTurn.turn.blocks.some((block) => block.type === 'list' || block.type === 'cta-group'),
    `AI 类型追答后未进入 explore 链路: ${JSON.stringify(thirdTurn.turn.blocks)}`,
  );

  details.push(`会话 ${firstTurn.conversationId} 对“周末附近有什么活动”先返回位置卡`);
  details.push('输入“解放碑”后返回类型卡，输入“火锅”后进入 explore/下一步承接');

  return { name: 'ai-explore-without-location-flow', passed: true, details };
}

async function scenarioAiLocationFollowupFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [user] = context.users;
  const details: string[] = [];

  await cleanupSandboxAgentTasks([user]);

  const firstTurn = await postAiChat({ user, text: '想组个周五晚的局' });
  assert(typeof firstTurn.conversationId === 'string' && firstTurn.conversationId.length > 0, 'AI 追问链路未返回 conversationId');
  assertNoLeakedToolText(firstTurn.turn.blocks, 'AI 首轮追问');
  assert(
    hasVisibleFeedback(firstTurn.turn.blocks),
    `AI 首轮未返回用户可见追问: ${JSON.stringify(firstTurn.turn.blocks)}`,
  );

  const secondTurn = await postAiChat({
    user,
    conversationId: firstTurn.conversationId,
    text: '解放碑',
  });
  assertNoLeakedToolText(secondTurn.turn.blocks, 'AI 地点追答');
  assert(
    secondTurn.turn.blocks.some((block) => block.type === 'choice' || block.type === 'form' || block.type === 'cta-group'),
    `AI 地点追答后未返回下一步交互组件: ${JSON.stringify(secondTurn.turn.blocks)}`,
  );

  const thirdTurn = await postAiChat({
    user,
    conversationId: firstTurn.conversationId,
    text: '桌游',
  });
  assertNoLeakedToolText(thirdTurn.turn.blocks, 'AI 类型追答');
  assert(
    thirdTurn.turn.blocks.some((block) =>
      block.type === 'list'
      || block.type === 'cta-group'
      || block.type === 'entity-card'
      || block.type === 'form'
    ),
    `AI 类型追答后未进入后续承接链路: ${JSON.stringify(thirdTurn.turn.blocks)}`,
  );

  details.push(`会话 ${firstTurn.conversationId} 首轮已返回可继续追答的建局提示`);
  details.push('二轮输入“解放碑”后返回下一步交互组件，三轮输入“桌游”后进入结果或建局承接链路');

  return { name: 'ai-location-followup-flow', passed: true, details };
}

async function scenarioAiPartnerIntentFormFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [user] = context.users;
  const details: string[] = [];

  await cleanupSandboxAgentTasks([user]);
  await cleanupSandboxPartnerIntents([user]);

  const firstTurn = await postAiAction({
    user,
    action: 'find_partner',
    displayText: '观音桥周围有人打麻将没得？',
    payload: {
      type: 'boardgame',
      locationName: '观音桥',
      rawInput: '观音桥周围有人打麻将没得？',
      lat: 29.563009,
      lng: 106.551556,
    },
  });

  assert(typeof firstTurn.conversationId === 'string' && firstTurn.conversationId.length > 0, '找搭子首轮未返回 conversationId');
  assertNoLeakedToolText(firstTurn.turn.blocks, '找搭子首轮');
  assert(hasTextContent(firstTurn.turn.blocks), `找搭子首轮缺少说明文本: ${JSON.stringify(firstTurn.turn.blocks)}`);

  const formBlock = findBlock(firstTurn.turn.blocks, 'form');
  assert(formBlock, `找搭子首轮未返回 form block: ${JSON.stringify(firstTurn.turn.blocks)}`);
  assert(formBlock.schema && typeof formBlock.schema === 'object', '找搭子 form block 缺少 schema');

  const formSchema = formBlock.schema as Record<string, unknown>;
  assert(formSchema.formType === 'partner_intent', `找搭子 formType 异常: ${JSON.stringify(formSchema)}`);
  assert(formSchema.submitAction === 'submit_partner_intent_form', `找搭子 submitAction 异常: ${JSON.stringify(formSchema)}`);
  assert(Array.isArray(formSchema.fields) && formSchema.fields.length >= 5, '找搭子表单字段数量异常');

  const firstInitialValues = formBlock.initialValues as Record<string, unknown> | undefined;
  assert(firstInitialValues?.activityType === 'boardgame', `找搭子默认类型异常: ${JSON.stringify(firstInitialValues)}`);
  assert(firstInitialValues?.location === '观音桥', `找搭子默认位置异常: ${JSON.stringify(firstInitialValues)}`);

  const secondTurn = await postAiAction({
    user,
    action: 'submit_partner_intent_form',
    conversationId: firstTurn.conversationId,
    displayText: '提交找搭子偏好',
    payload: {
      rawInput: '观音桥周围有人打麻将没得？',
      activityType: 'boardgame',
      timeRange: 'tonight',
      location: '观音桥',
      budgetType: 'AA',
      tags: ['Quiet'],
      note: '三缺一，能接受新手',
      lat: 29.563009,
      lng: 106.551556,
    },
  });

  assertNoLeakedToolText(secondTurn.turn.blocks, '找搭子提交');
  assert(hasVisibleFeedback(secondTurn.turn.blocks), `找搭子提交后缺少可见反馈: ${JSON.stringify(secondTurn.turn.blocks)}`);

  const ctaBlock = findBlock(secondTurn.turn.blocks, 'cta-group');
  assert(ctaBlock && Array.isArray(ctaBlock.items) && ctaBlock.items.length > 0, `找搭子提交后缺少 cta-group: ${JSON.stringify(secondTurn.turn.blocks)}`);
  assert(
    ctaBlock.items.some((item) => item.action === 'explore_nearby' || item.action === 'find_partner'),
    `找搭子提交后的后续动作异常: ${JSON.stringify(ctaBlock.items)}`
  );

  details.push(`会话 ${firstTurn.conversationId} 首轮返回正文 + partner_intent form`);
  details.push('提交表单后返回文本反馈和后续 CTA，没有再走纯文字问卷');

  return { name: 'ai-partner-intent-form-flow', passed: true, details };
}

async function scenarioAiDraftSettingsFormFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [user] = context.users;
  const details: string[] = [];

  await cleanupSandboxAgentTasks([user]);

  const createPayload = {
    description: '我想在观音桥组个桌游局，明晚一起玩',
    locationName: '观音桥',
    type: 'boardgame',
    lat: 29.563009,
    lng: 106.551556,
  };

  const createTurn = await postAiAction({
    user,
    action: 'create_activity',
    displayText: '我想在观音桥组个桌游局',
    payload: createPayload,
  });

  assert(typeof createTurn.conversationId === 'string' && createTurn.conversationId.length > 0, '创建草稿未返回 conversationId');
  assertNoLeakedToolText(createTurn.turn.blocks, '创建草稿');
  const draftBlock = findBlock(createTurn.turn.blocks, 'entity-card');
  assert(draftBlock?.fields, `创建草稿后缺少 draft card: ${JSON.stringify(createTurn.turn.blocks)}`);

  const activityId = typeof draftBlock.fields.activityId === 'string' ? draftBlock.fields.activityId : '';
  assert(activityId, `创建草稿后缺少 activityId: ${JSON.stringify(draftBlock.fields)}`);

  try {
    const editTurn = await postAiAction({
      user,
      action: 'edit_draft',
      conversationId: createTurn.conversationId,
      displayText: '改下时间',
      payload: {
        activityId,
        title: typeof draftBlock.fields.title === 'string' ? draftBlock.fields.title : '活动草稿',
        type: typeof draftBlock.fields.type === 'string' ? draftBlock.fields.type : 'boardgame',
        startAt: typeof draftBlock.fields.startAt === 'string' ? draftBlock.fields.startAt : '',
        locationName: typeof draftBlock.fields.locationName === 'string' ? draftBlock.fields.locationName : '观音桥',
        locationHint: typeof draftBlock.fields.locationHint === 'string' ? draftBlock.fields.locationHint : '观音桥附近',
        maxParticipants: typeof draftBlock.fields.maxParticipants === 'string' ? draftBlock.fields.maxParticipants : '6',
        lat: createPayload.lat,
        lng: createPayload.lng,
        field: 'time',
      },
    });

    assertNoLeakedToolText(editTurn.turn.blocks, '编辑草稿');
    const formBlock = findBlock(editTurn.turn.blocks, 'form');
    assert(formBlock?.schema, `编辑草稿后缺少 form block: ${JSON.stringify(editTurn.turn.blocks)}`);
    const formSchema = formBlock.schema as Record<string, unknown>;
    assert(formSchema.formType === 'draft_settings', `草稿设置 formType 异常: ${JSON.stringify(formSchema)}`);
    assert(formSchema.submitAction === 'save_draft_settings', `草稿设置 submitAction 异常: ${JSON.stringify(formSchema)}`);

    const saveTurn = await postAiAction({
      user,
      action: 'save_draft_settings',
      conversationId: createTurn.conversationId,
      displayText: '保存草稿设置',
      payload: {
        ...(formBlock.initialValues || {}),
        activityId,
        slot: 'tomorrow_20_00',
        maxParticipants: '8',
        lat: createPayload.lat,
        lng: createPayload.lng,
      },
    });

    assertNoLeakedToolText(saveTurn.turn.blocks, '保存草稿设置');
    assert(hasVisibleFeedback(saveTurn.turn.blocks), `保存草稿设置后缺少可见反馈: ${JSON.stringify(saveTurn.turn.blocks)}`);
    assert(findBlock(saveTurn.turn.blocks, 'entity-card'), `保存草稿设置后缺少更新后的 draft card: ${JSON.stringify(saveTurn.turn.blocks)}`);
    assert(findBlock(saveTurn.turn.blocks, 'cta-group'), `保存草稿设置后缺少下一步 CTA: ${JSON.stringify(saveTurn.turn.blocks)}`);

    details.push(`活动 ${activityId} 支持 edit_draft -> draft_settings form -> save_draft_settings`);
    details.push('草稿编辑不再回退成文字问答，保存后会返回更新后的草稿卡');

    return { name: 'ai-draft-settings-form-flow', passed: true, details };
  } finally {
    await cancelActivity(activityId, user).catch(() => null);
  }
}

async function scenarioAiJoinAuthResumeDiscussionFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [creator, joiner] = context.users;
  const details: string[] = [];

  await cleanupSandboxAgentTasks([joiner]);

  await withActivity(creator, async (activityId) => {
    const guestTurn = await postAiAction({
      action: 'join_activity',
      displayText: '报名这个活动',
      payload: {
        activityId,
        title: '沙盘验收报名局',
        source: 'widget_explore',
      },
      context: {
        client: 'web',
        entry: 'h5_auth_resume_regression',
      },
    });

    assert(typeof guestTurn.conversationId === 'string' && guestTurn.conversationId.length > 0, '游客报名首轮未返回 conversationId');
    assertNoLeakedToolText(guestTurn.turn.blocks, '游客报名挂起');

    const guestAlert = findAlertBlock(guestTurn.turn.blocks);
    assert(guestAlert, `游客报名首轮缺少 alert: ${JSON.stringify(guestTurn.turn.blocks)}`);
    const guestMeta = readAlertMeta(guestAlert);
    assert(guestMeta, `游客报名 alert 缺少 meta: ${JSON.stringify(guestAlert)}`);
    assert(guestMeta.authRequired && typeof guestMeta.authRequired === 'object', `游客报名未返回 authRequired meta: ${JSON.stringify(guestMeta)}`);

    const authRequired = guestMeta.authRequired as Record<string, unknown>;
    assert(authRequired.mode === 'login' || authRequired.mode === 'bind_phone', `游客报名 auth mode 异常: ${JSON.stringify(authRequired)}`);
    assert(authRequired.pendingAction && typeof authRequired.pendingAction === 'object', `游客报名缺少 pendingAction: ${JSON.stringify(authRequired)}`);

    const pendingAction = authRequired.pendingAction as Record<string, unknown>;
    assert(pendingAction.action === 'join_activity', `游客报名 pendingAction.action 异常: ${JSON.stringify(pendingAction)}`);

    const resumeTurn = await postAiAction({
      user: joiner,
      action: 'join_activity',
      conversationId: guestTurn.conversationId,
      displayText: '继续刚才那步',
      payload: {
        activityId,
        title: '沙盘验收报名局',
        source: 'widget_explore',
      },
      context: {
        client: 'web',
        entry: 'h5_auth_resume_regression',
      },
    });

    assertNoLeakedToolText(resumeTurn.turn.blocks, '登录后恢复报名');
    const resumeAlert = findAlertBlock(resumeTurn.turn.blocks);
    assert(resumeAlert, `恢复报名后缺少 alert: ${JSON.stringify(resumeTurn.turn.blocks)}`);
    const resumeMeta = readAlertMeta(resumeAlert);
    assert(resumeMeta, `恢复报名 alert 缺少 meta: ${JSON.stringify(resumeAlert)}`);
    assert(resumeMeta.navigationIntent === 'open_discussion', `恢复报名后未返回 open_discussion: ${JSON.stringify(resumeMeta)}`);
    assert(
      resumeMeta.navigationPayload
      && typeof resumeMeta.navigationPayload === 'object'
      && (resumeMeta.navigationPayload as Record<string, unknown>).activityId === activityId,
      `恢复报名 navigationPayload 异常: ${JSON.stringify(resumeMeta)}`
    );

    const participants = await getActivityParticipants(activityId);
    assert(
      participants.some((item) => item.userId === joiner.user.id && item.status === 'joined'),
      `恢复报名后参与记录未写入: ${JSON.stringify(participants)}`
    );

    const joinedTasks = await getAiCurrentTasks(joiner);
    const joinedTask = joinedTasks.items.find((item) => item.taskType === 'join_activity' && item.activityId === activityId);
    assert(joinedTask, `恢复报名后未找到 join task: ${JSON.stringify(joinedTasks.items)}`);
    assert(joinedTask.currentStage === 'joined', `恢复报名后 task stage 应为 joined: ${JSON.stringify(joinedTask)}`);
    assert(
      joinedTask.primaryAction?.kind === 'navigate' || joinedTask.primaryAction?.kind === 'structured_action',
      `恢复报名后 primaryAction 异常: ${JSON.stringify(joinedTask)}`
    );

    const discussionEntered = await postAiDiscussionEntered({
      user: joiner,
      activityId,
      entry: 'join_success',
    });
    assert(discussionEntered.code === 200, `discussion entered 回写失败: ${JSON.stringify(discussionEntered)}`);

    const discussionTasks = await getAiCurrentTasks(joiner);
    const discussionTask = discussionTasks.items.find((item) => item.taskType === 'join_activity' && item.activityId === activityId);
    assert(discussionTask, `discussion entered 后未找到 join task: ${JSON.stringify(discussionTasks.items)}`);
    assert(discussionTask.currentStage === 'discussion', `discussion entered 后 stage 应为 discussion: ${JSON.stringify(discussionTask)}`);

    details.push(`活动 ${activityId} 游客触发 join_activity 后返回 authRequired + pendingAction`);
    details.push('登录后恢复同一动作，返回 open_discussion 并成功写入报名记录');
    details.push('discussion-entered 回写后，task stage 从 joined 推进到 discussion');
  }, {
    title: 'H5 挂起恢复验收局',
    maxParticipants: 5,
  });

  return { name: 'ai-join-auth-resume-discussion-flow', passed: true, details };
}

async function scenarioAiAccessFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [user1, user2] = context.users;
  const details: string[] = [];

  const anonWelcome = await getAiWelcome();
  assert(typeof anonWelcome.greeting === 'string' && anonWelcome.greeting.length > 0, '游客欢迎语为空');
  assert(Array.isArray(anonWelcome.sections) && anonWelcome.sections.length > 0, '游客欢迎卡片缺少 sections');

  const authWelcome = await getAiWelcome(user1);
  assert(authWelcome.greeting.includes(user1.user.nickname || ''), `登录欢迎语未带昵称: ${authWelcome.greeting}`);

  const anonChat = await postAiChat({ text: '你好，帮我打个招呼' });
  assert(typeof anonChat.conversationId === 'string' && anonChat.conversationId.length > 0, '游客 AI 对话未返回 conversationId');
  assert(anonChat.turn.blocks.some((block) => block.type === 'text' && typeof block.content === 'string' && block.content.length > 0), '游客 AI 对话未返回文本块');
  assertNoLeakedToolText(anonChat.turn.blocks, '游客 AI 对话');

  const authChat = await postAiChat({ user: user1, text: '你好，我想找人吃火锅' });
  assert(typeof authChat.conversationId === 'string' && authChat.conversationId.length > 0, '登录 AI 对话未返回 conversationId');
  assert(authChat.turn.blocks.some((block) => block.type === 'text' && typeof block.content === 'string' && block.content.length > 0), '登录 AI 对话未返回文本块');
  assertNoLeakedToolText(authChat.turn.blocks, '登录 AI 对话');

  const ownConversations = await getAiConversations(user1);
  assert(ownConversations.items.some((item) => item.id === authChat.conversationId), '登录 AI 对话未持久化到会话列表');

  const conversationsForbidden = await requestError({
    method: 'GET',
    path: `/ai/conversations?userId=${user1.user.id}&limit=20`,
    token: user2.token,
  });
  assert(conversationsForbidden.status === 403, `跨账号查看会话状态码异常: ${conversationsForbidden.status}`);
  assert(conversationsForbidden.msg.includes('无权限访问该用户会话'), `跨账号查看会话提示异常: ${conversationsForbidden.msg}`);

  const hijackForbidden = await requestError({
    method: 'POST',
    path: '/ai/chat',
    token: user2.token,
    payload: {
      conversationId: authChat.conversationId,
      input: { type: 'text', text: '我要继续这段对话' },
      ai: { model: DEFAULT_TEST_MODEL },
      context: { client: 'web', locale: 'zh-CN', timezone: 'Asia/Shanghai' },
      stream: false,
    },
  });
  assert(hijackForbidden.status === 403, `跨账号劫持会话状态码异常: ${hijackForbidden.status}`);
  assert(hijackForbidden.msg.includes('无权限访问该会话'), `跨账号劫持会话提示异常: ${hijackForbidden.msg}`);

  details.push(`游客 AI 欢迎卡和聊天可用，conversationId=${anonChat.conversationId}`);
  details.push(`登录 AI 会话已持久化，conversationId=${authChat.conversationId}`);
  details.push('跨账号查看会话和劫持会话都被 403 拦截');

  return { name: 'ai-access-flow', passed: true, details };
}

const scenarios = [
  scenarioBasicDiscussionFlow,
  scenarioCapacityLimit,
  scenarioDuplicateAndRejoin,
  scenarioPermissionGuards,
  scenarioCancelVisibility,
  scenarioNotificationsFlow,
  scenarioPostActivityFollowUpFlow,
  scenarioAiExploreWithoutLocationFlow,
  scenarioAiLocationFollowupFlow,
  scenarioAiJoinAuthResumeDiscussionFlow,
  scenarioAiPartnerIntentFormFlow,
  scenarioAiDraftSettingsFormFlow,
  scenarioAiAccessFlow,
];

async function main() {
  const users = await bootstrapUsers();
  await cleanupSandboxPartnerIntents(users);
  await cleanupSandboxAgentTasks(users);
  const context: ScenarioContext = { users };

  const selectedScenarios = scenarioFilter
    ? scenarios.filter((scenario) => {
        const scenarioName = scenario.name.replace(/^scenario/, '').replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
        return scenarioName.includes(scenarioFilter.toLowerCase());
      })
    : scenarios;

  assert(selectedScenarios.length > 0, `没有匹配到场景: ${scenarioFilter}`);

  const results: ScenarioResult[] = [];

  for (const scenario of selectedScenarios) {
    const scenarioName = scenario.name.replace(/^scenario/, '').replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    console.log(`\n>>> ${scenarioName}`);
    try {
      const result = await scenario(context);
      results.push(result);
      console.log(`PASS ${result.name}`);
      for (const detail of result.details) {
        console.log(`- ${detail}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name: scenarioName, passed: false, details: [], error: message });
      console.log(`FAIL ${scenarioName}`);
      console.log(`- ${message}`);
    }
  }

  console.log('\n=== Sandbox Summary ===');
  for (const result of results) {
    console.log(`- ${result.passed ? 'PASS' : 'FAIL'} ${result.name}`);
    if (result.error) {
      console.log(`  ${result.error}`);
    }
  }

  const failed = results.filter((item) => !item.passed);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`sandbox-regression failed: ${message}`);
    process.exit(1);
  })
  .then(() => {
    process.exit(0);
  });
