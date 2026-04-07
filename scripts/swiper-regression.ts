#!/usr/bin/env bun

import {
  activities,
  and,
  db,
  eq,
  inArray,
  partnerIntents,
  sql,
  users,
} from '@juchang/db';
import { app } from '../apps/api/src/index';
import { readAiChatEnvelope } from './ai-chat-sse';
import { indexActivities } from '../apps/api/src/modules/ai/rag';

interface ApiError {
  code?: number;
  msg?: string;
}

interface UserProfile {
  id: string;
  nickname: string | null;
  phoneNumber: string | null;
}

interface BootstrappedUser {
  user: UserProfile;
  token: string;
}

interface BootstrapResponse {
  users: BootstrappedUser[];
}

interface LoginResponse {
  token: string;
}

interface CreateActivityResponse {
  id: string;
}

interface NearbyActivitiesResponse {
  data: Array<{ id: string; title: string }>;
  total: number;
}

interface AiChatBlock {
  type: string;
  title?: string;
  items?: unknown[];
  meta?: Record<string, unknown>;
  preview?: Record<string, unknown>;
  interaction?: Record<string, unknown>;
}

interface AiChatEnvelope {
  conversationId: string;
  response: {
    blocks: AiChatBlock[];
  };
}

const ADMIN_PHONE = process.env.SMOKE_ADMIN_PHONE?.trim()
  || process.env.ADMIN_PHONE_WHITELIST?.split(',').map((phone) => phone.trim()).find(Boolean)
  || '13996092317';
const ADMIN_CODE = process.env.SMOKE_ADMIN_CODE?.trim()
  || process.env.ADMIN_SUPER_CODE?.trim()
  || '9999';
const BASE_URL = 'http://localhost';
const USER_COUNT = 5;
const ACTIVITY_TITLE_PREFIX = '【Swiper验收】';
const PARTNER_RAW_INPUT_PREFIX = '【Swiper验收】';
const DEFAULT_AI_MODEL = process.env.GENUI_TEST_MODEL?.trim() || 'deepseek-chat';
const CENTER = {
  lat: 29.58567,
  lng: 106.52988,
  locationName: '观音桥',
};

const ACTIVITY_FIXTURES = [
  {
    title: `${ACTIVITY_TITLE_PREFIX}观音桥桌游热场`,
    description: '本地验收用，确保附近桌游活动可以稳定进 swiper。',
    location: [106.52988, 29.58567] as [number, number],
    address: '观音桥步行街 A 口',
    locationHint: '观音桥 3 号口碰头',
    startOffsetHours: 5,
  },
  {
    title: `${ACTIVITY_TITLE_PREFIX}北城天街拼桌局`,
    description: '本地验收用，适合临时补位。',
    location: [106.5311, 29.58612] as [number, number],
    address: '北城天街 B1',
    locationHint: '商场中庭集合',
    startOffsetHours: 7,
  },
  {
    title: `${ACTIVITY_TITLE_PREFIX}轻策略桌游夜`,
    description: '本地验收用，偏轻松社交。',
    location: [106.52896, 29.58482] as [number, number],
    address: '观音桥九街附近',
    locationHint: '门口等一下就行',
    startOffsetHours: 9,
  },
  {
    title: `${ACTIVITY_TITLE_PREFIX}周五拼桌补位`,
    description: '本地验收用，验证多活动结果。',
    location: [106.52793, 29.58521] as [number, number],
    address: '观音桥商圈',
    locationHint: '店里二楼靠窗',
    startOffsetHours: 11,
  },
  {
    title: `${ACTIVITY_TITLE_PREFIX}新手友好桌游局`,
    description: '本地验收用，验证活动结果足够多时的引用模式。',
    location: [106.53045, 29.58702] as [number, number],
    address: '北仓文创街区',
    locationHint: '街口咖啡店门口见',
    startOffsetHours: 13,
  },
  {
    title: `${ACTIVITY_TITLE_PREFIX}周末狼人杀补位`,
    description: '本地验收用，保证活动列表超过 5 条。',
    location: [106.53218, 29.58544] as [number, number],
    address: '观音桥远东百货附近',
    locationHint: '提前到的先占座',
    startOffsetHours: 15,
  },
] as const;

const PARTNER_FIXTURES = [
  {
    rawInput: `${PARTNER_RAW_INPUT_PREFIX}想找观音桥周六晚上一起打桌游的人，最好能接轻策略和热场游戏`,
    locationHint: '观音桥',
    timePreference: '周六晚上',
    tags: ['桌游', '轻策略', '好沟通'],
    location: [106.52952, 29.58594] as [number, number],
  },
  {
    rawInput: `${PARTNER_RAW_INPUT_PREFIX}想约观音桥周六晚上拼桌，能接受新手，主要想找稳定搭子`,
    locationHint: '观音桥',
    timePreference: '周六晚上',
    tags: ['桌游', '新手友好', '稳定'],
    location: [106.53084, 29.58648] as [number, number],
  },
  {
    rawInput: `${PARTNER_RAW_INPUT_PREFIX}周六晚上在观音桥找桌游搭子，偏社交向，来得快最好`,
    locationHint: '观音桥',
    timePreference: '周六晚上',
    tags: ['桌游', '社交向', '临时补位'],
    location: [106.52871, 29.58493] as [number, number],
  },
  {
    rawInput: `${PARTNER_RAW_INPUT_PREFIX}观音桥周六晚上找人一起开桌游，AA，节奏轻松`,
    locationHint: '观音桥',
    timePreference: '周六晚上',
    tags: ['桌游', 'AA', '轻松'],
    location: [106.53142, 29.58573] as [number, number],
  },
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

async function requestText(params: {
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
  assert(bootstrap.users.every((item) => typeof item.user.phoneNumber === 'string' && item.user.phoneNumber.length > 0), '测试账号手机号未绑定，无法发布活动');
  return bootstrap.users;
}

async function resetCreateQuota(userIds: string[]): Promise<void> {
  if (userIds.length === 0) {
    return;
  }

  await db
    .update(users)
    .set({
      aiCreateQuotaToday: 9,
      updatedAt: new Date(),
    })
    .where(inArray(users.id, userIds));
}

async function cleanupSeededActivities(userIds: string[]): Promise<void> {
  if (userIds.length === 0) {
    return;
  }

  await db
    .update(activities)
    .set({
      status: 'cancelled',
      embedding: null,
      updatedAt: new Date(),
    })
    .where(and(
      inArray(activities.creatorId, userIds),
      sql`${activities.title} LIKE ${`${ACTIVITY_TITLE_PREFIX}%`}`,
      eq(activities.status, 'active'),
    ));
}

async function cleanupPartnerIntents(userIds: string[]): Promise<void> {
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
      eq(partnerIntents.status, 'active'),
    ));
}

function buildCreatePayload(fixture: typeof ACTIVITY_FIXTURES[number]): Record<string, unknown> {
  return {
    title: fixture.title,
    description: fixture.description,
    location: fixture.location,
    locationName: CENTER.locationName,
    address: fixture.address,
    locationHint: fixture.locationHint,
    startAt: new Date(Date.now() + fixture.startOffsetHours * 60 * 60 * 1000).toISOString(),
    type: 'boardgame',
    maxParticipants: 6,
  };
}

async function createActivity(creator: BootstrappedUser, fixture: typeof ACTIVITY_FIXTURES[number]): Promise<string> {
  const response = await requestJson<CreateActivityResponse>({
    method: 'POST',
    path: '/activities',
    token: creator.token,
    payload: buildCreatePayload(fixture),
  });

  return response.id;
}

async function seedPartnerIntent(owner: BootstrappedUser, fixture: typeof PARTNER_FIXTURES[number]): Promise<string> {
  const [inserted] = await db
    .insert(partnerIntents)
    .values({
      userId: owner.user.id,
      activityType: 'boardgame',
      locationHint: fixture.locationHint,
      location: sql`ST_SetSRID(ST_MakePoint(${fixture.location[0]}, ${fixture.location[1]}), 4326)`,
      timePreference: fixture.timePreference,
      metaData: {
        tags: fixture.tags,
        rawInput: fixture.rawInput,
      },
      status: 'active',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      updatedAt: new Date(),
    })
    .returning({ id: partnerIntents.id });

  return inserted.id;
}

async function ensureActivitiesIndexed(activityIds: string[]): Promise<void> {
  const rows = await db
    .select()
    .from(activities)
    .where(inArray(activities.id, activityIds));

  assert(rows.length === activityIds.length, `活动造数不完整，期望 ${activityIds.length} 条，实际 ${rows.length} 条`);
  await indexActivities(rows, { batchSize: 3, delayMs: 0 });

  const indexedRows = await db
    .select({
      id: activities.id,
      embedding: activities.embedding,
    })
    .from(activities)
    .where(inArray(activities.id, activityIds));

  assert(
    indexedRows.every((item) => Array.isArray(item.embedding) && item.embedding.length > 0),
    `活动 embedding 未全部生成成功: ${JSON.stringify(indexedRows.map((item) => ({
      id: item.id,
      indexed: Array.isArray(item.embedding) && item.embedding.length > 0,
    })))}`
  );
}

async function getNearbyActivities(): Promise<NearbyActivitiesResponse> {
  return requestJson<NearbyActivitiesResponse>({
    method: 'GET',
    path: `/activities/nearby?lat=${CENTER.lat}&lng=${CENTER.lng}&radius=5000&type=boardgame&limit=12`,
  });
}

async function postAiAction(params: {
  user: BootstrappedUser;
  action: string;
  displayText: string;
  payload: Record<string, unknown>;
}): Promise<AiChatEnvelope> {
  const response = await requestText({
    method: 'POST',
    path: '/ai/chat',
    token: params.user.token,
    payload: {
      input: {
        type: 'action',
        action: params.action,
        actionId: `swiper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        displayText: params.displayText,
        params: params.payload,
      },
      ai: {
        model: DEFAULT_AI_MODEL,
      },
      context: {
        client: 'miniprogram',
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
        entry: 'swiper_regression',
      },
    },
  });

  if (response.status !== 200) {
    throw new Error(`POST /ai/chat 失败: HTTP ${response.status} ${response.body}`);
  }

  return readAiChatEnvelope<AiChatEnvelope>(response.body, 'swiper-regression postAiAction');
}

function findFirstListBlock(blocks: AiChatBlock[]): AiChatBlock {
  const block = blocks.find((item) => item.type === 'list');
  assert(block, `未找到 list block: ${JSON.stringify(blocks)}`);
  return block;
}

function readBlockItems(block: AiChatBlock): unknown[] {
  return Array.isArray(block.items) ? block.items : [];
}

function readPreviewTotal(block: AiChatBlock): number {
  return isRecord(block.preview) && typeof block.preview.total === 'number'
    ? block.preview.total
    : 0;
}

function readListPresentation(block: AiChatBlock): string {
  return isRecord(block.meta) && typeof block.meta.listPresentation === 'string'
    ? block.meta.listPresentation
    : '';
}

function readListKind(block: AiChatBlock): string {
  return isRecord(block.meta) && typeof block.meta.listKind === 'string'
    ? block.meta.listKind
    : '';
}

function readSwipeable(block: AiChatBlock): boolean {
  return isRecord(block.interaction) && block.interaction.swipeable === true;
}

async function verifyExploreSwiper(viewer: BootstrappedUser): Promise<string> {
  const envelope = await postAiAction({
    user: viewer,
    action: 'explore_nearby',
    displayText: '看观音桥附近的桌游局',
    payload: {
      locationName: CENTER.locationName,
      lat: CENTER.lat,
      lng: CENTER.lng,
      type: 'boardgame',
    },
  });

  const listBlock = findFirstListBlock(envelope.response.blocks);
  const items = readBlockItems(listBlock);
  const previewTotal = readPreviewTotal(listBlock);
  const listPresentation = readListPresentation(listBlock);
  const visibleCount = items.length > 0 ? items.length : previewTotal;

  assert(listPresentation === 'immersive-carousel', `活动卡片未进入 swiper 呈现: ${JSON.stringify(listBlock)}`);
  assert(visibleCount >= 2, `活动卡片结果不足，无法验证 swiper: ${JSON.stringify(listBlock)}`);

  if (items.length > 0) {
    assert(readSwipeable(listBlock), `活动卡片多结果时缺少 swipeable 标记: ${JSON.stringify(listBlock)}`);
  }

  return `活动探索已返回 swiper 卡片，结果数=${visibleCount}${items.length > 0 ? '（inline）' : '（reference）'}`;
}

async function verifyPartnerSwiper(viewer: BootstrappedUser): Promise<string> {
  const envelope = await postAiAction({
    user: viewer,
    action: 'search_partners',
    displayText: '开始找桌游搭子',
    payload: {
      rawInput: '帮我找观音桥周六晚上桌游搭子',
      activityType: 'boardgame',
      location: CENTER.locationName,
      locationName: CENTER.locationName,
      timePreference: '周六晚上',
      description: '观音桥周六晚上想找桌游搭子，最好能一起拼桌',
      lat: CENTER.lat,
      lng: CENTER.lng,
    },
  });

  const listBlock = findFirstListBlock(envelope.response.blocks);
  const items = readBlockItems(listBlock);
  const listKind = readListKind(listBlock);
  const listPresentation = readListPresentation(listBlock);

  assert(listKind === 'partner_search_results', `搭子卡片 listKind 异常: ${JSON.stringify(listBlock)}`);
  assert(listPresentation === 'partner-carousel', `搭子卡片未进入 swiper 呈现: ${JSON.stringify(listBlock)}`);
  assert(items.length >= 2, `搭子候选不足，无法验证 swiper: ${JSON.stringify(listBlock)}`);

  return `搭子搜索已返回 swiper 卡片，候选数=${items.length}`;
}

async function main(): Promise<void> {
  const users = await bootstrapUsers();
  const userIds = users.map((item) => item.user.id);

  await resetCreateQuota(userIds);
  await cleanupSeededActivities(userIds);
  await cleanupPartnerIntents(userIds);

  const activityCreators = [users[0], users[1], users[2]];
  const activityIds: string[] = [];

  for (const [index, fixture] of ACTIVITY_FIXTURES.entries()) {
    const creator = activityCreators[index % activityCreators.length];
    activityIds.push(await createActivity(creator, fixture));
  }

  await ensureActivitiesIndexed(activityIds);

  const partnerOwnerIds: string[] = [];
  for (const [index, fixture] of PARTNER_FIXTURES.entries()) {
    const owner = users[index];
    partnerOwnerIds.push(await seedPartnerIntent(owner, fixture));
  }

  const nearby = await getNearbyActivities();
  assert(nearby.total >= 6, `附近活动接口结果不足: total=${nearby.total}`);

  const viewer = users[4];
  const exploreSummary = await verifyExploreSwiper(viewer);
  const partnerSummary = await verifyPartnerSwiper(viewer);

  console.log('');
  console.log('Swiper regression passed.');
  console.log(exploreSummary);
  console.log(partnerSummary);
  console.log(`已造活动 ${activityIds.length} 条，附近接口可见 ${nearby.total} 条。`);
  console.log(`已造搭子意向 ${partnerOwnerIds.length} 条。`);
  console.log('');
  console.log('手动查看时可直接输入：');
  console.log('1. 观音桥附近有什么桌游局');
  console.log('2. 帮我找观音桥周六晚上桌游搭子');
  console.log('');
  console.log(`活动标题前缀：${ACTIVITY_TITLE_PREFIX}`);
  console.log(`搭子原始文案前缀：${PARTNER_RAW_INPUT_PREFIX}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
