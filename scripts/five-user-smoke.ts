#!/usr/bin/env bun

import { app } from '../apps/api/src/index';

interface ApiError {
  code?: number;
  msg?: string;
}

interface BootstrappedUser {
  user: {
    id: string;
    wxOpenId: string | null;
    phoneNumber: string | null;
    nickname: string | null;
  };
  token: string;
  isNewUser: boolean;
}

interface BootstrapResponse {
  users: BootstrappedUser[];
  msg: string;
}

interface AdminLoginResponse {
  token: string;
}

interface CreateActivityResponse {
  id: string;
  msg: string;
}

interface PublicActivityResponse {
  id: string;
  title: string;
  status: string;
  currentParticipants: number;
  participants: Array<{ userId: string; nickname: string | null }>;
  recentMessages: Array<{ content: string; createdAt: string }>;
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

const ADMIN_PHONE = process.env.SMOKE_ADMIN_PHONE?.trim()
  || process.env.ADMIN_PHONE_WHITELIST?.split(',').map((phone) => phone.trim()).find(Boolean)
  || '13996092317';
const ADMIN_CODE = process.env.SMOKE_ADMIN_CODE?.trim()
  || process.env.ADMIN_SUPER_CODE?.trim()
  || '9999';
const USER_COUNT = Number.parseInt(process.env.SMOKE_USER_COUNT?.trim() || '5', 10);
const CLEANUP = Bun.argv.includes('--cleanup');
const BASE_URL = 'http://localhost';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson<T>(params: {
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH';
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
  const response = await requestJson<AdminLoginResponse>({
    method: 'POST',
    path: '/auth/admin/login',
    payload: {
      phone: ADMIN_PHONE,
      code: ADMIN_CODE,
    },
  });

  assert(response.token, '管理员登录后未返回 token');
  return response.token;
}

function buildCreatePayload() {
  const startAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const titleSuffix = new Date().toISOString().replace(/[:.]/g, '-');

  return {
    title: `五人验收局-${titleSuffix}`,
    description: '用于本地验收创建活动、报名和讨论区主链路。',
    location: [106.551556, 29.563009],
    locationName: '重庆观音桥',
    address: '观音桥步行街',
    locationHint: '地铁站 3 号口见',
    startAt,
    type: 'food',
    maxParticipants: 5,
  } as const;
}

async function main(): Promise<void> {
  assert(Number.isFinite(USER_COUNT) && USER_COUNT >= 2 && USER_COUNT <= 5, 'SMOKE_USER_COUNT 必须在 2-5 之间');

  console.log('1/6 准备测试账号...');
  const adminToken = await getAdminToken();
  const bootstrap = await requestJson<BootstrapResponse>({
    method: 'POST',
    path: '/auth/admin/bootstrap-test-users',
    token: adminToken,
    payload: {
      phone: ADMIN_PHONE,
      code: ADMIN_CODE,
      count: USER_COUNT,
    },
  });

  assert(bootstrap.users.length === USER_COUNT, `期望准备 ${USER_COUNT} 个账号，实际得到 ${bootstrap.users.length}`);
  console.log(`   ${bootstrap.msg}`);

  const [creator, ...joiners] = bootstrap.users;
  assert(creator, '缺少发起人账号');
  assert(joiners.length > 0, '至少需要 1 个报名用户');

  console.log('2/6 创建活动...');
  const createPayload = buildCreatePayload();
  const created = await requestJson<CreateActivityResponse>({
    method: 'POST',
    path: '/activities',
    token: creator.token,
    payload: createPayload,
  });
  const activityId = created.id;
  assert(activityId, '创建活动后未返回 activityId');
  console.log(`   活动已创建: ${activityId}`);

  console.log('3/6 校验公开详情初始状态...');
  const initialPublic = await requestJson<PublicActivityResponse>({
    method: 'GET',
    path: `/activities/${activityId}/public`,
  });
  assert(initialPublic.status === 'active', `新活动状态异常: ${initialPublic.status}`);
  assert(initialPublic.currentParticipants === 1, `创建后人数应为 1，实际为 ${initialPublic.currentParticipants}`);

  console.log('4/6 批量报名...');
  for (const [index, joiner] of joiners.entries()) {
    const joined = await requestJson<{ success: boolean; msg: string; participantId: string }>({
      method: 'POST',
      path: `/activities/${activityId}/join`,
      token: joiner.token,
    });
    assert(joined.participantId, `第 ${index + 2} 个用户报名后未返回 participantId`);
    console.log(`   ${joiner.user.nickname || joiner.user.phoneNumber} 报名成功`);
  }

  const publicAfterJoin = await requestJson<PublicActivityResponse>({
    method: 'GET',
    path: `/activities/${activityId}/public`,
  });
  assert(publicAfterJoin.currentParticipants === bootstrap.users.length, `报名后人数应为 ${bootstrap.users.length}，实际为 ${publicAfterJoin.currentParticipants}`);
  assert(publicAfterJoin.participants.length === bootstrap.users.length, `公开参与者数量异常: ${publicAfterJoin.participants.length}`);

  console.log('5/6 发送讨论区消息...');
  const discussionSenders = [creator, joiners[0], joiners[1]].filter(Boolean) as BootstrappedUser[];
  const messageContents = [
    '帮你把局组好了！今晚 7 点观音桥见。',
    '收到，我 6:50 到。',
    '我带桌游暖场，大家别空腹来。',
  ];
  const expectedMessageContents = messageContents.slice(0, discussionSenders.length);

  for (const [index, sender] of discussionSenders.entries()) {
    const content = expectedMessageContents[index] || `验收消息 ${index + 1}`;
    const sent = await requestJson<{ id: string; msg: string }>({
      method: 'POST',
      path: `/chat/${activityId}/messages`,
      token: sender.token,
      payload: { content },
    });
    assert(sent.id, `第 ${index + 1} 条讨论消息发送失败`);
  }

  const chatMessages = await requestJson<ChatMessagesResponse>({
    method: 'GET',
    path: `/chat/${activityId}/messages?limit=20`,
    token: joiners[0].token,
  });
  assert(chatMessages.isArchived === false, '新活动讨论区不应归档');
  const expectedMinimumMessages = joiners.length + expectedMessageContents.length;
  assert(chatMessages.messages.length >= expectedMinimumMessages, `消息数过少，实际为 ${chatMessages.messages.length}`);

  for (const expectedContent of expectedMessageContents) {
    assert(
      chatMessages.messages.some((message) => message.content === expectedContent),
      `讨论区缺少消息: ${expectedContent}`
    );
  }

  const chatActivities = await requestJson<ChatActivitiesResponse>({
    method: 'GET',
    path: `/chat/activities?userId=${joiners[0].user.id}&page=1&limit=10`,
    token: joiners[0].token,
  });
  assert(
    chatActivities.items.some((item) => item.activityId === activityId),
    '群聊列表中没有刚报名的活动'
  );

  console.log('6/6 汇总结果...');
  console.log('');
  console.log('五人业务验收通过');
  console.log(`- 活动 ID: ${activityId}`);
  console.log(`- 发起人: ${creator.user.nickname || creator.user.phoneNumber}`);
  console.log(`- 报名人数: ${publicAfterJoin.currentParticipants}`);
  console.log(`- 讨论区消息数: ${chatMessages.messages.length}`);
  console.log(`- 群聊列表命中: ${chatActivities.items.length}`);

  if (CLEANUP) {
    await requestJson<{ success: boolean; msg?: string }>({
      method: 'PATCH',
      path: `/activities/${activityId}/status`,
      token: creator.token,
      payload: { status: 'cancelled' },
    });
    console.log('- 已将验收活动标记为取消');
  }
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`five-user-smoke failed: ${message}`);
    process.exit(1);
  })
  .then(() => {
    process.exit(0);
  });
