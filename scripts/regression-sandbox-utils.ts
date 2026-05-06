
import { activities, agentTasks, agentTaskEvents, and, conversations, db, desc, eq, inArray, or, participants, partnerIntents, userMemories, users } from '@xu/db';
import { app } from '../apps/api/src/index';
import { resetQuota } from '../apps/api/src/modules/ai/guardrails/rate-limiter';
import { readAiChatEnvelope } from './ai-chat-sse';
import { writeRegressionArtifact } from './regression-artifact';
import { findScenarioMatrixEntry } from './regression-scenario-matrix';

export interface ApiError {
  code?: number;
  msg?: string;
}

export interface UserProfile {
  id: string;
  wxOpenId: string | null;
  phoneNumber: string | null;
  nickname: string | null;
}

export interface BootstrappedUser {
  user: UserProfile;
  token: string;
  isNewUser: boolean;
}

export interface BootstrapResponse {
  users: BootstrappedUser[];
  msg: string;
}

export interface LoginResponse {
  token: string;
}

export interface PublicActivityResponse {
  id: string;
  title: string;
  status: string;
  currentParticipants: number;
  participants: Array<{ userId: string; nickname: string | null }>;
  recentMessages: Array<{ content: string; createdAt: string }>;
}

export interface ActivityParticipantInfo {
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

export interface ChatMessagesResponse {
  messages: Array<{
    id: string;
    senderId: string | null;
    content: string;
    type: string;
    createdAt: string;
  }>;
  isArchived: boolean;
}

export interface ChatActivitiesResponse {
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

export interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  activityId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  total: number;
  page: number;
  totalPages: number;
}

export interface UnreadCountResponse {
  count: number;
}

export interface MessageCenterResponse {
  actionItems: Array<{
    id: string;
    type: string;
    title: string;
    summary: string;
    statusLabel: string;
    activityId: string | null;
    primaryAction: {
      kind: string;
      label: string;
      prompt?: string;
      activityId?: string;
      activityMode?: ActivityMode;
      entry?: string;
    };
  }>;
  pendingMatches: PendingMatchItem[];
  unreadNotificationCount: number;
  totalUnread: number;
  chatActivities: {
    items: Array<{
      activityId: string;
      activityTitle: string;
      lastMessage: string | null;
      unreadCount: number;
    }>;
    totalUnread: number;
  };
}

export interface PendingMatchItem {
  id: string;
  activityType: string;
  typeName: string;
  locationHint: string;
  taskId: string | null;
  isTempOrganizer: boolean;
}

export interface PendingMatchListResponse {
  items: PendingMatchItem[];
}

export interface PendingMatchConfirmResponse {
  code: number;
  msg: string;
  activityId?: string;
}

export interface PendingMatchDetailResponse {
  id: string;
  nextActionOwner: 'self' | 'organizer';
  continuationTitle: string;
  continuationText: string;
  nextActionText: string;
  members: Array<{
    userId: string;
    isTempOrganizer: boolean;
    intentSummary: string;
  }>;
}

export interface WelcomeResponse {
  greeting: string;
  subGreeting?: string;
  sections?: unknown[];
}

export type ActivityMode = 'review' | 'rebook' | 'kickoff';

export interface AiChatRequestContext {
  client?: 'web' | 'miniprogram' | 'admin';
  locale?: string;
  timezone?: string;
  platformVersion?: string;
  lat?: number;
  lng?: number;
  activityId?: string;
  activityMode?: ActivityMode;
  entry?: string;
}

export interface AiChatBlock {
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

export interface AiChatEnvelope {
  traceId: string;
  conversationId: string;
  response: {
    responseId: string;
    role: 'assistant';
    status: 'completed' | 'streaming' | 'error';
    blocks: AiChatBlock[];
  };
}

export interface AiConversationsResponse {
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

export interface CurrentTaskActionSnapshot {
  kind: string;
  label: string;
  action?: string;
  payload?: Record<string, unknown>;
  url?: string;
}

export interface CurrentTaskSnapshot {
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

export interface CurrentTasksResponse {
  items: CurrentTaskSnapshot[];
  serverTime: string;
}

export type PartnerScenarioType = 'local_partner' | 'destination_companion' | 'fill_seat';

export interface PartnerFlowFixture {
  id: string;
  scenarioType: PartnerScenarioType;
  rawInput: string;
  activityType: string;
  sportType?: string;
  locationName: string;
  locationHint: string;
  locationKeywords: string[];
  timePreference: string;
  timeKeywords: string[];
  description: string;
  lat: number;
  lng: number;
  destinationText?: string;
}

export interface StoredActivityOutcome {
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

export interface ScenarioResult {
  name: string;
  passed: boolean;
  details: string[];
  error?: string;
  durationMs?: number;
}

export interface ScenarioContext {
  users: BootstrappedUser[];
}

export const ADMIN_PHONE = process.env.SMOKE_ADMIN_PHONE?.trim()
  || process.env.ADMIN_PHONE_WHITELIST?.split(',').map((phone) => phone.trim()).find(Boolean)
  || '13996092317';
export const ADMIN_CODE = process.env.SMOKE_ADMIN_CODE?.trim()
  || process.env.ADMIN_SUPER_CODE?.trim()
  || '9999';
export const BASE_URL = 'http://localhost';
export const USER_COUNT = 5;
export const DEFAULT_TEST_MODEL = process.env.GENUI_TEST_MODEL?.trim() || 'moonshot/kimi-k2.5';

export const LOCAL_PARTNER_FIXTURE: PartnerFlowFixture = {
  id: 'local-boardgame',
  scenarioType: 'local_partner',
  rawInput: '南山周六晚找桌游搭子，能接受新手，最好别鸽',
  activityType: 'boardgame',
  locationName: '南山',
  locationHint: '南山',
  locationKeywords: ['南山'],
  timePreference: '周六晚上',
  timeKeywords: ['周六', '周末'],
  description: '找能稳定赴约、接受新手的桌游搭子',
  lat: 29.533009,
  lng: 106.601556,
};

export const DESTINATION_COMPANION_FIXTURE: PartnerFlowFixture = {
  id: 'destination-music-festival',
  scenarioType: 'destination_companion',
  rawInput: '周六去泸州音乐节，想找个能一起出发的同去搭子',
  activityType: 'entertainment',
  locationName: '泸州音乐节',
  locationHint: '重庆出发',
  locationKeywords: ['泸州', '音乐节', '重庆出发'],
  destinationText: '泸州音乐节',
  timePreference: '周六',
  timeKeywords: ['周六', '周末'],
  description: '想找能一起出发、时间能对上的同行搭子',
  lat: 29.533009,
  lng: 106.601556,
};

export const FILL_SEAT_FIXTURE: PartnerFlowFixture = {
  id: 'fill-seat-mahjong',
  scenarioType: 'fill_seat',
  rawInput: '今晚观音桥麻将三缺一，想补一个不鸽的人',
  activityType: 'entertainment',
  locationName: '观音桥',
  locationHint: '观音桥',
  locationKeywords: ['观音桥'],
  timePreference: '今晚',
  timeKeywords: ['今晚', '今天'],
  description: '已有三个人，想补一个能准时到的搭子',
  lat: 29.563009,
  lng: 106.551556,
};

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function hasLeakedToolCallText(value: string): boolean {
  const normalized = value.replace(/\s+/g, '');
  return /^call[a-zA-Z]+\(/.test(normalized);
}

export function assertNoLeakedToolText(blocks: AiChatEnvelope['response']['blocks'], label: string): void {
  for (const block of blocks) {
    if (block.type !== 'text' || typeof block.content !== 'string') {
      continue;
    }

    if (hasLeakedToolCallText(block.content)) {
      throw new Error(`${label} 出现伪 Tool 文本泄漏: ${block.content}`);
    }
  }
}

export function findBlock(blocks: AiChatEnvelope['response']['blocks'], type: string): AiChatBlock | undefined {
  return blocks.find((block) => block.type === type);
}

export function hasTextContent(blocks: AiChatEnvelope['response']['blocks']): boolean {
  return blocks.some((block) => block.type === 'text' && typeof block.content === 'string' && block.content.trim().length > 0);
}

export function extractVisibleText(blocks: AiChatEnvelope['response']['blocks']): string {
  return blocks
    .filter((block) => block.type === 'text' && typeof block.content === 'string' && block.content.trim().length > 0)
    .map((block) => block.content!.trim())
    .join('\n');
}

export function hasVisibleFeedback(blocks: AiChatEnvelope['response']['blocks']): boolean {
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

export function readAlertMeta(block: AiChatBlock): Record<string, unknown> | null {
  return block.type === 'alert' && block.meta && typeof block.meta === 'object'
    ? block.meta
    : null;
}

export function findAlertBlock(blocks: AiChatEnvelope['response']['blocks']): AiChatBlock | undefined {
  return blocks.find((block) => block.type === 'alert');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function buildPartnerPayload(fixture: PartnerFlowFixture): Record<string, unknown> {
  return {
    rawInput: fixture.rawInput,
    prompt: fixture.rawInput,
    scenarioType: fixture.scenarioType,
    activityType: fixture.activityType,
    type: fixture.activityType,
    ...(fixture.sportType ? { sportType: fixture.sportType } : {}),
    location: fixture.locationName,
    locationName: fixture.locationName,
    locationHint: fixture.locationHint,
    timePreference: fixture.timePreference,
    timeText: fixture.timePreference,
    description: fixture.description,
    lat: fixture.lat,
    lng: fixture.lng,
    ...(fixture.destinationText ? { destinationText: fixture.destinationText } : {}),
  };
}

export function assertPartnerSearchResultSafety(blocks: AiChatEnvelope['response']['blocks'], label: string): void {
  const listBlocks = blocks.filter((block) => block.type === 'list');
  for (const block of listBlocks) {
    const serialized = JSON.stringify(block);
    assert(!/"phoneNumber"\s*:/.test(serialized), `${label} 泄露 phoneNumber 字段: ${serialized}`);
    assert(!/"purePhoneNumber"\s*:/.test(serialized), `${label} 泄露 purePhoneNumber 字段: ${serialized}`);
    assert(!/"wxOpenId"\s*:/.test(serialized), `${label} 泄露 wxOpenId 字段: ${serialized}`);
    assert(!/"wxId"\s*:/.test(serialized), `${label} 泄露 wxId 字段: ${serialized}`);
    assert(!/"lat"\s*:/.test(serialized), `${label} 泄露精确 lat 字段: ${serialized}`);
    assert(!/"lng"\s*:/.test(serialized), `${label} 泄露精确 lng 字段: ${serialized}`);
    assert(!/"latitude"\s*:/.test(serialized), `${label} 泄露精确 latitude 字段: ${serialized}`);
    assert(!/"longitude"\s*:/.test(serialized), `${label} 泄露精确 longitude 字段: ${serialized}`);
    assert(!/(?<!\d)1[3-9]\d{9}(?!\d)/.test(serialized), `${label} 泄露手机号形态内容: ${serialized}`);
    assert(!/(微信号|wxid|wechat)/i.test(serialized), `${label} 泄露微信联系方式形态内容: ${serialized}`);
  }
}

export function findCtaActionInput(
  blocks: AiChatEnvelope['response']['blocks'],
  actionName: string,
  actionId: string,
  label: string,
): { action: string; actionId: string; displayText: string; params?: Record<string, unknown> } {
  for (const block of blocks) {
    if (block.type !== 'cta-group' || !Array.isArray(block.items)) {
      continue;
    }

    for (const item of block.items) {
      if (!isRecord(item)) {
        continue;
      }

      const action = typeof item.action === 'string' ? item.action.trim() : '';
      if (action !== actionName) {
        continue;
      }

      return {
        action,
        actionId,
        displayText: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : action,
        ...(isRecord(item.params) ? { params: item.params } : {}),
      };
    }
  }

  throw new Error(`${label} 缺少 CTA action=${actionName}`);
}

export async function requestJson<T>(params: {
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

export async function requestText(params: {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  token?: string;
  payload?: Record<string, unknown>;
}): Promise<{ status: number; body: string }> {
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

  return {
    status: response.status,
    body: await response.text(),
  };
}

export async function getAdminToken(): Promise<string> {
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

export function decodeTokenPayload(token: string): Record<string, unknown> {
  const payloadSegment = token.split('.')[1];
  assert(payloadSegment, 'JWT 缺少 payload 段');

  const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return JSON.parse(Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8')) as Record<string, unknown>;
}

export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor<T>(
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

export async function requestError(params: {
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
  let parsed: ApiError = {};
  if (bodyText) {
    try {
      parsed = JSON.parse(bodyText) as ApiError;
    } catch {
      parsed = { msg: bodyText };
    }
  }

  if (response.ok) {
    throw new Error(`${params.method} ${params.path} 预期失败，但返回成功`);
  }

  return {
    status: response.status,
    msg: parsed.msg || bodyText,
  };
}

export function buildCreatePayload(overrides?: Partial<{
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

export async function bootstrapUsers(count?: number): Promise<BootstrappedUser[]> {
  const targetCount = count ?? USER_COUNT;
  const adminToken = await getAdminToken();
  const bootstrap = await requestJson<BootstrapResponse>({
    method: 'POST',
    path: '/auth/test-users/bootstrap',
    token: adminToken,
    payload: {
      phone: ADMIN_PHONE,
      code: ADMIN_CODE,
      count: targetCount,
    },
  });

  assert(bootstrap.users.length === targetCount, `期望准备 ${targetCount} 个账号，实际得到 ${bootstrap.users.length}`);
  return bootstrap.users;
}

export async function cleanupSandboxPartnerIntents(users: BootstrappedUser[]): Promise<void> {
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

export async function cleanupSandboxAgentTasks(users: BootstrappedUser[]): Promise<void> {
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

export async function cleanupSandboxActivities(users: BootstrappedUser[]): Promise<void> {
  const userIds = users.map((item) => item.user.id);
  if (userIds.length === 0) {
    return;
  }

  const [ownedRows, joinedRows] = await Promise.all([
    db
      .select({ activityId: activities.id })
      .from(activities)
      .where(inArray(activities.creatorId, userIds)),
    db
      .select({ activityId: participants.activityId })
      .from(participants)
      .where(inArray(participants.userId, userIds)),
  ]);

  const activityIds = [...new Set([...ownedRows, ...joinedRows].map((item) => item.activityId))];
  if (activityIds.length === 0) {
    return;
  }

  await db
    .update(activities)
    .set({
      status: 'cancelled',
      embedding: null,
      updatedAt: new Date(),
    })
    .where(inArray(activities.id, activityIds));
}

export async function cleanupSandboxConversations(users: BootstrappedUser[]): Promise<void> {
  const userIds = users.map((item) => item.user.id);
  if (userIds.length === 0) {
    return;
  }

  const convRows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(inArray(conversations.userId, userIds));

  const conversationIds = convRows.map((r) => r.id);
  if (conversationIds.length === 0) {
    return;
  }

  await db
    .update(agentTasks)
    .set({
      entryConversationId: null,
      latestConversationId: null,
      updatedAt: new Date(),
    })
    .where(
      or(
        inArray(agentTasks.entryConversationId, conversationIds),
        inArray(agentTasks.latestConversationId, conversationIds),
      )
    );

  await db
    .delete(agentTaskEvents)
    .where(inArray(agentTaskEvents.conversationId, conversationIds));

  await db
    .delete(conversations)
    .where(inArray(conversations.id, conversationIds));
}

export async function cleanupSandboxUserMemories(users: BootstrappedUser[]): Promise<void> {
  const userIds = users.map((item) => item.user.id);
  if (userIds.length === 0) {
    return;
  }

  await db
    .delete(userMemories)
    .where(inArray(userMemories.userId, userIds));
}

export function resetSandboxRateLimits(users: BootstrappedUser[]): void {
  for (const item of users) {
    resetQuota(item.user.id);
  }
}

export async function createActivity(creator: BootstrappedUser, overrides?: Parameters<typeof buildCreatePayload>[0]) {
  const result = await requestJson<{ id: string; msg: string }>({
    method: 'POST',
    path: '/activities',
    token: creator.token,
    payload: buildCreatePayload(overrides),
  });
  return result.id;
}

export async function joinActivity(activityId: string, user: BootstrappedUser) {
  return requestJson<{
    success: boolean;
    msg: string;
    participantId: string | null;
    joinResult: 'joined' | 'already_joined' | 'waitlisted' | 'closed';
    navigationIntent: 'open_discussion' | 'stay_on_detail';
  }>({
    method: 'POST',
    path: `/activities/${activityId}/join`,
    token: user.token,
  });
}

export async function quitActivity(activityId: string, user: BootstrappedUser) {
  return requestJson<{ success: boolean; msg: string }>({
    method: 'POST',
    path: `/activities/${activityId}/quit`,
    token: user.token,
  });
}

export async function cancelActivity(activityId: string, creator: BootstrappedUser) {
  return requestJson<{ success: boolean; msg?: string }>({
    method: 'PATCH',
    path: `/activities/${activityId}/status`,
    token: creator.token,
    payload: { status: 'cancelled' },
  });
}

export async function markActivityCompleted(activityId: string, creator: BootstrappedUser) {
  return requestJson<{ success: boolean; msg: string }>({
    method: 'PATCH',
    path: `/activities/${activityId}/status`,
    token: creator.token,
    payload: { status: 'completed' },
  });
}

export async function getPublicActivity(activityId: string) {
  return requestJson<PublicActivityResponse>({
    method: 'GET',
    path: `/activities/${activityId}/public`,
  });
}

export async function getActivityParticipants(activityId: string) {
  return requestJson<ActivityParticipantInfo[]>({
    method: 'GET',
    path: `/participants/activity/${activityId}`,
  });
}

export async function getChatMessages(activityId: string, user: BootstrappedUser) {
  return requestJson<ChatMessagesResponse>({
    method: 'GET',
    path: `/chat/${activityId}/messages?limit=50`,
    token: user.token,
  });
}

export async function listChatActivities(user: BootstrappedUser) {
  return requestJson<ChatActivitiesResponse>({
    method: 'GET',
    path: `/chat/activities?userId=${user.user.id}&page=1&limit=20`,
    token: user.token,
  });
}

export async function listChatActivitiesForTarget(targetUserId: string, requesterToken: string) {
  return requestJson<ChatActivitiesResponse>({
    method: 'GET',
    path: `/chat/activities?userId=${targetUserId}&page=1&limit=20`,
    token: requesterToken,
  });
}

export async function sendChatMessage(activityId: string, user: BootstrappedUser, content: string) {
  return requestJson<{ id: string; msg: string }>({
    method: 'POST',
    path: `/chat/${activityId}/messages`,
    token: user.token,
    payload: { content },
  });
}

export async function getNotifications(user: BootstrappedUser) {
  return requestJson<NotificationListResponse>({
    method: 'GET',
    path: `/notifications?userId=${user.user.id}&page=1&limit=20`,
    token: user.token,
  });
}

export async function getUnreadCount(user: BootstrappedUser) {
  return requestJson<UnreadCountResponse>({
    method: 'GET',
    path: '/notifications/unread-count',
    token: user.token,
  });
}

export async function markNotificationRead(user: BootstrappedUser, notificationId: string) {
  return requestJson<{ code: number; msg: string }>({
    method: 'POST',
    path: `/notifications/${notificationId}/read`,
    token: user.token,
  });
}

export async function getMessageCenter(user: BootstrappedUser) {
  return requestJson<MessageCenterResponse>({
    method: 'GET',
    path: `/notifications/message-center?userId=${user.user.id}&notificationPage=1&notificationLimit=10&chatPage=1&chatLimit=10`,
    token: user.token,
  });
}

export async function getPendingMatches(user: BootstrappedUser) {
  return requestJson<PendingMatchListResponse>({
    method: 'GET',
    path: `/notifications/pending-matches?userId=${user.user.id}`,
    token: user.token,
  });
}

export async function confirmPendingMatch(user: BootstrappedUser, matchId: string) {
  return requestJson<PendingMatchConfirmResponse>({
    method: 'POST',
    path: `/notifications/pending-matches/${matchId}/confirm`,
    token: user.token,
  });
}

export async function cancelPendingMatch(user: BootstrappedUser, matchId: string) {
  return requestJson<{ code: number; msg: string }>({
    method: 'POST',
    path: `/notifications/pending-matches/${matchId}/cancel`,
    token: user.token,
  });
}

export async function getPendingMatchDetail(user: BootstrappedUser, matchId: string) {
  return requestJson<PendingMatchDetailResponse>({
    method: 'GET',
    path: `/notifications/pending-matches/${matchId}?userId=${user.user.id}`,
    token: user.token,
  });
}

export async function getAiWelcome(user?: BootstrappedUser) {
  return requestJson<WelcomeResponse>({
    method: 'GET',
    path: '/ai/welcome?lat=29.56&lng=106.55',
    token: user?.token,
  });
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function ensureSandboxConversation(user: BootstrappedUser | undefined, conversationId: string | undefined, title: string): Promise<void> {
  if (!user || !conversationId || !isUuidLike(conversationId)) {
    return;
  }

  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (existing) {
    return;
  }

  await db.insert(conversations).values({
    id: conversationId,
    userId: user.user.id,
    title: title.slice(0, 40),
  });
}

export async function postAiChat(params: {
  user?: BootstrappedUser;
  text: string;
  conversationId?: string;
  context?: AiChatRequestContext;
}) {
  await ensureSandboxConversation(params.user, params.conversationId, params.text);

  const response = await requestText({
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
    },
  });

  if (response.status !== 200) {
    throw new Error(`POST /ai/chat 失败: HTTP ${response.status} ${response.body}`);
  }

  return readAiChatEnvelope<AiChatEnvelope>(response.body, 'sandbox postAiChat');
}

export async function postAiAction(params: {
  user?: BootstrappedUser;
  action: string;
  actionId?: string;
  conversationId?: string;
  payload?: Record<string, unknown>;
  displayText?: string;
  context?: AiChatRequestContext;
}) {
  await ensureSandboxConversation(params.user, params.conversationId, params.displayText || params.action);

  const response = await requestText({
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
    },
  });

  if (response.status !== 200) {
    throw new Error(`POST /ai/chat 失败: HTTP ${response.status} ${response.body}`);
  }

  return readAiChatEnvelope<AiChatEnvelope>(response.body, 'sandbox postAiAction');
}

export async function getAiConversations(user: BootstrappedUser) {
  return requestJson<AiConversationsResponse>({
    method: 'GET',
    path: `/ai/conversations?userId=${user.user.id}&limit=20`,
    token: user.token,
  });
}

export async function getAiCurrentTasks(user: BootstrappedUser) {
  return requestJson<CurrentTasksResponse>({
    method: 'GET',
    path: '/ai/tasks/current',
    token: user.token,
  });
}

export async function postAiDiscussionEntered(params: {
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

export async function confirmFulfillment(params: {
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

export async function markRebookFollowUp(activityId: string, user: BootstrappedUser) {
  return requestJson<{
    code: number;
    msg: string;
    nextAction?: {
      label: string;
      prompt: string;
      activityMode: 'review' | 'rebook';
      entry: string;
    };
  }>({
    method: 'POST',
    path: '/participants/rebook-follow-up',
    token: user.token,
    payload: { activityId },
  });
}

export async function recordActivitySelfFeedback(params: {
  activityId: string;
  user: BootstrappedUser;
  feedback: 'positive' | 'neutral' | 'failed';
}) {
  return requestJson<{
    code: number;
    msg: string;
    nextAction?: {
      label: string;
      prompt: string;
      activityMode: 'review' | 'rebook';
      entry: string;
    };
  }>({
    method: 'POST',
    path: '/participants/self-feedback',
    token: params.user.token,
    payload: {
      activityId: params.activityId,
      feedback: params.feedback,
    },
  });
}

export async function getUserActivityOutcome(userId: string, activityId: string): Promise<StoredActivityOutcome | null> {
  const records = await db
    .select({
      metadata: userMemories.metadata,
    })
    .from(userMemories)
    .where(and(
      eq(userMemories.userId, userId),
      eq(userMemories.memoryType, 'activity_outcome'),
    ))
    .orderBy(desc(userMemories.updatedAt))
    .limit(20);

  const record = records.find((item) => {
    const metadata = item.metadata as Record<string, unknown>;
    return metadata.activityId === activityId;
  });
  if (!record) return null;

  const metadata = record.metadata as Record<string, unknown>;
  if (metadata.activityId !== activityId) {
    return null;
  }

  const attended = metadata.attended;
  const rebookTriggered = metadata.rebookTriggered;
  const reviewSummary = metadata.reviewSummary;
  const activityTitle = metadata.activityTitle;
  const activityType = metadata.activityType;
  const locationName = metadata.locationName;
  const happenedAt = metadata.happenedAt;
  const updatedAt = metadata.updatedAt;

  if (
    typeof activityTitle !== 'string'
    || typeof activityType !== 'string'
    || typeof locationName !== 'string'
    || typeof happenedAt !== 'string'
    || typeof updatedAt !== 'string'
    || !(attended === null || typeof attended === 'boolean')
    || typeof rebookTriggered !== 'boolean'
    || !(
      reviewSummary === undefined
      || reviewSummary === null
      || typeof reviewSummary === 'string'
    )
  ) {
    return null;
  }

  return {
    activityId,
    activityTitle,
    activityType,
    locationName,
    attended,
    rebookTriggered,
    reviewSummary: typeof reviewSummary === 'string' ? reviewSummary : null,
    happenedAt,
    updatedAt,
  };
}

export async function withActivity<T>(creator: BootstrappedUser, run: (activityId: string) => Promise<T>, overrides?: Parameters<typeof buildCreatePayload>[0]) {
  const activityId = await createActivity(creator, overrides);
  try {
    return await run(activityId);
  } finally {
    await cancelActivity(activityId, creator).catch(() => null);
  }
}
