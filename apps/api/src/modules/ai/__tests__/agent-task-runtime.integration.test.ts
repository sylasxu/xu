import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'bun:test';
import {
  activities,
  agentTaskEvents,
  agentTasks,
  conversations,
  conversationMessages,
  db,
  desc,
  eq,
  inArray,
  intentMatches,
  sql,
  userMemories,
} from '@juchang/db';
import { app } from '../../../index';
import {
  listCurrentAgentTaskSnapshots,
  markJoinTaskDiscussionEntered,
  recordCreateTaskDraftReady,
  recordCreateTaskPublished,
  recordJoinTaskFulfillmentOutcome,
  recordJoinTaskReviewOutcome,
  syncCreateTaskFromChatResponse,
  syncJoinTaskFromChatResponse,
  syncPartnerTaskFromChatResponse,
} from '../task-runtime/agent-task.service';
import type { GenUIBlock, GenUIRequest } from '@juchang/genui-contract';

interface ApiError {
  code?: number;
  msg?: string;
}

interface AdminLoginResponse {
  token: string;
}

interface BootstrappedUser {
  user: {
    id: string;
  };
  token: string;
}

interface BootstrapResponse {
  users: BootstrappedUser[];
}

interface ChatTurnResponse {
  conversationId: string;
  turn: {
    blocks: GenUIBlock[];
  };
}

const ADMIN_PHONE = process.env.SMOKE_ADMIN_PHONE?.trim()
  || process.env.ADMIN_PHONE_WHITELIST?.split(',').map((phone) => phone.trim()).find(Boolean)
  || '13996092317';
const ADMIN_CODE = process.env.SMOKE_ADMIN_CODE?.trim()
  || process.env.ADMIN_SUPER_CODE?.trim()
  || '9999';
const BASE_URL = 'http://localhost';

const createdTaskIds = new Set<string>();
const createdActivityIds = new Set<string>();
const createdConversationIds = new Set<string>();
const createdIntentMatchIds = new Set<string>();
let testUser: BootstrappedUser | null = null;

async function requestJson<T>(params: {
  method: 'GET' | 'POST';
  path: string;
  token?: string;
  payload?: Record<string, unknown>;
}): Promise<T> {
  const response = await app.handle(
    new Request(`${BASE_URL}${params.path}`, {
      method: params.method,
      headers: {
        ...(params.payload ? { 'content-type': 'application/json' } : {}),
        ...(params.token ? { authorization: `Bearer ${params.token}` } : {}),
      },
      ...(params.payload ? { body: JSON.stringify(params.payload) } : {}),
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
    path: '/auth/login',
    payload: {
      grantType: 'phone_otp',
      phone: ADMIN_PHONE,
      code: ADMIN_CODE,
    },
  });

  return response.token;
}

async function bootstrapUser(): Promise<BootstrappedUser> {
  const adminToken = await getAdminToken();
  const response = await requestJson<BootstrapResponse>({
    method: 'POST',
    path: '/auth/test-users/bootstrap',
    token: adminToken,
    payload: {
      phone: ADMIN_PHONE,
      code: ADMIN_CODE,
      count: 1,
    },
  });

  const [user] = response.users;
  if (!user) {
    throw new Error('未获取到测试用户');
  }

  return user;
}

function buildFollowUpRequest(activityId: string): GenUIRequest {
  return {
    input: {
      type: 'text',
      text: `帮我复盘一下这场活动（activityId: ${activityId}）`,
    },
    context: {
      client: 'miniprogram',
      activityId,
      activityMode: 'review',
      entry: 'message_center_post_activity',
    },
  };
}

function buildJoinAuthRequiredBlocks(activityId: string): GenUIBlock[] {
  return [
    {
      blockId: 'auth-required-alert',
      type: 'alert',
      level: 'warning',
      message: '请先登录后继续报名',
      meta: {
        authRequired: {
          mode: 'login',
          pendingAction: {
            action: 'join_activity',
            payload: {
              activityId,
            },
            source: 'widget_explore',
            originalText: '报名这个活动',
          },
        },
      },
    },
  ];
}

function buildJoinSuccessBlocks(activityId: string): GenUIBlock[] {
  return [
    {
      blockId: 'join-success-alert',
      type: 'alert',
      level: 'success',
      message: '报名成功',
      meta: {
        navigationIntent: 'open_discussion',
        navigationPayload: {
          activityId,
        },
      },
    },
  ];
}

function buildPartnerSearchResultBlocks(): GenUIBlock[] {
  return [
    {
      blockId: 'partner-search-results',
      type: 'list',
      title: '先看看这些搭子',
      items: [
        {
          id: 'candidate-intent-1',
          title: '爱打羽毛球的搭子',
        },
      ],
      meta: {
        listKind: 'partner_search_results',
      },
    },
  ];
}

function buildCreateAuthRequiredBlocks(): GenUIBlock[] {
  return [
    {
      blockId: 'create-auth-required-alert',
      type: 'alert',
      level: 'warning',
      message: '请先登录后继续创建活动',
      meta: {
        authRequired: {
          mode: 'login',
          pendingAction: {
            action: 'create_activity',
            payload: {
              title: '周五桌游局',
              type: 'boardgame',
              locationName: '观音桥',
              maxParticipants: 6,
            },
            source: 'widget_draft',
            originalText: '先生成草稿',
          },
        },
      },
    },
  ];
}

function buildDraftSettingsFormBlocks(): GenUIBlock[] {
  return [
    {
      blockId: 'draft-settings-form',
      type: 'form',
      dedupeKey: 'draft_settings_form',
      title: '改改草稿设置',
      schema: {
        submitAction: 'save_draft_settings',
        fields: [
          {
            name: 'locationName',
            label: '地点',
            type: 'text',
          },
        ],
      },
    } as unknown as GenUIBlock,
  ];
}

function buildDraftReadyBlocks(params: {
  activityId: string;
  title: string;
  type: string;
  locationName: string;
  startAt: string;
  maxParticipants: number;
}): GenUIBlock[] {
  return [
    {
      blockId: 'activity-draft-card',
      type: 'entity-card',
      dedupeKey: 'activity_draft',
      title: params.title,
      fields: {
        activityId: params.activityId,
        title: params.title,
        type: params.type,
        locationName: params.locationName,
        startAt: params.startAt,
        maxParticipants: params.maxParticipants,
      },
    } as unknown as GenUIBlock,
  ];
}

describe('Agent Task Runtime Integration', () => {
  beforeAll(async () => {
    testUser = await bootstrapUser();
  });

  afterEach(async () => {
    const taskIds = Array.from(createdTaskIds);
    createdTaskIds.clear();
    if (taskIds.length > 0) {
      await db
        .delete(agentTaskEvents)
        .where(inArray(agentTaskEvents.taskId, taskIds));
      await db
        .delete(conversationMessages)
        .where(inArray(conversationMessages.taskId, taskIds));
    }

    const conversationIds = Array.from(createdConversationIds);
    createdConversationIds.clear();
    if (conversationIds.length > 0) {
      await db
        .delete(agentTaskEvents)
        .where(inArray(agentTaskEvents.conversationId, conversationIds));
      await db
        .delete(conversationMessages)
        .where(inArray(conversationMessages.conversationId, conversationIds));
    }

    const activityIds = Array.from(createdActivityIds);
    createdActivityIds.clear();
    if (activityIds.length > 0) {
      await db
        .delete(userMemories)
        .where(inArray(sql<string>`${userMemories.metadata}->>'activityId'`, activityIds));
      await db
        .delete(agentTaskEvents)
        .where(inArray(agentTaskEvents.activityId, activityIds));
      await db
        .delete(conversationMessages)
        .where(inArray(conversationMessages.activityId, activityIds));
    }

    if (taskIds.length > 0) {
      await db
        .delete(agentTasks)
        .where(inArray(agentTasks.id, taskIds));
    }

    if (activityIds.length > 0) {
      await db
        .delete(agentTasks)
        .where(inArray(agentTasks.activityId, activityIds));
    }

    if (conversationIds.length > 0) {
      await db
        .delete(agentTasks)
        .where(inArray(agentTasks.entryConversationId, conversationIds));
      await db
        .delete(agentTasks)
        .where(inArray(agentTasks.latestConversationId, conversationIds));
    }

    const intentMatchIds = Array.from(createdIntentMatchIds);
    createdIntentMatchIds.clear();
    if (intentMatchIds.length > 0) {
      await db
        .delete(intentMatches)
        .where(inArray(intentMatches.id, intentMatchIds));
    }

    if (activityIds.length > 0) {
      await db
        .delete(activities)
        .where(inArray(activities.id, activityIds));
    }

    if (conversationIds.length > 0) {
      await db
        .delete(conversations)
        .where(inArray(conversations.id, conversationIds));
    }
  });

  it('records discussion_entered only once for the same join task', async () => {
    expect(testUser).toBeDefined();

    const activityId = randomUUID();
    const taskId = randomUUID();

    await db.insert(activities).values({
      id: activityId,
      creatorId: testUser!.user.id,
      title: '讨论区幂等测试局',
      description: '验证 discussion_entered 不重复写入',
      location: { x: 106.52988, y: 29.58567 },
      locationName: '观音桥',
      address: '观音桥步行街',
      locationHint: '地铁站附近',
      startAt: new Date('2026-03-17T20:00:00+08:00'),
      type: 'food',
      maxParticipants: 4,
      currentParticipants: 2,
      status: 'active',
    });
    createdActivityIds.add(activityId);

    await db.insert(agentTasks).values({
      id: taskId,
      userId: testUser!.user.id,
      taskType: 'join_activity',
      status: 'active',
      currentStage: 'joined',
      goalText: '报名后进入讨论区',
      activityId,
    });
    createdTaskIds.add(taskId);

    await markJoinTaskDiscussionEntered({
      userId: testUser!.user.id,
      activityId,
      entry: 'join_success',
    });
    await markJoinTaskDiscussionEntered({
      userId: testUser!.user.id,
      activityId,
      entry: 'join_success',
    });

    const [task] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, taskId))
      .limit(1);
    const events = await db
      .select()
      .from(agentTaskEvents)
      .where(eq(agentTaskEvents.taskId, taskId));

    expect(task?.currentStage).toBe('discussion');
    expect(events.filter((event) => event.eventType === 'discussion_entered')).toHaveLength(1);
  });

  it('does not reopen a completed join task when follow-up chat arrives later', async () => {
    expect(testUser).toBeDefined();

    const activityId = randomUUID();
    const taskId = randomUUID();
    const conversationId = randomUUID();

    await db.insert(activities).values({
      id: activityId,
      creatorId: testUser!.user.id,
      title: '活动后跟进收口局',
      description: '验证 completed task 不被 follow-up reopen',
      location: { x: 106.52988, y: 29.58567 },
      locationName: '观音桥',
      address: '观音桥步行街',
      locationHint: '地铁站附近',
      startAt: new Date('2026-03-16T20:00:00+08:00'),
      type: 'food',
      maxParticipants: 4,
      currentParticipants: 2,
      status: 'completed',
    });
    createdActivityIds.add(activityId);
    await db.insert(conversations).values({
      id: conversationId,
      userId: testUser!.user.id,
      title: '活动后跟进不重开测试会话',
    });
    createdConversationIds.add(conversationId);

    await db.insert(agentTasks).values({
      id: taskId,
      userId: testUser!.user.id,
      taskType: 'join_activity',
      status: 'completed',
      currentStage: 'done',
      goalText: '这场活动已经收尾',
      activityId,
      completedAt: new Date('2026-03-16T23:00:00+08:00'),
    });
    createdTaskIds.add(taskId);

    await syncJoinTaskFromChatResponse({
      userId: testUser!.user.id,
      conversationId,
      request: buildFollowUpRequest(activityId),
      blocks: [],
      outcome: null,
    });

    const [task] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, taskId))
      .limit(1);
    const tasks = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.activityId, activityId))
      .orderBy(desc(agentTasks.updatedAt));
    const events = await db
      .select()
      .from(agentTaskEvents)
      .where(eq(agentTaskEvents.taskId, taskId));

    tasks.forEach((item) => createdTaskIds.add(item.id));

    expect(task?.status).toBe('completed');
    expect(task?.currentStage).toBe('done');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe(taskId);
    expect(events).toHaveLength(0);
  });

  it('promotes an active discussion task into post_activity on the same task id', async () => {
    expect(testUser).toBeDefined();

    const activityId = randomUUID();
    const taskId = randomUUID();
    const conversationId = randomUUID();

    await db.insert(activities).values({
      id: activityId,
      creatorId: testUser!.user.id,
      title: '活动后承接同任务测试局',
      description: '验证 discussion -> post_activity 继续使用同一条 join task',
      location: { x: 106.52988, y: 29.58567 },
      locationName: '观音桥',
      address: '观音桥步行街',
      locationHint: '地铁站附近',
      startAt: new Date('2026-03-16T20:00:00+08:00'),
      type: 'food',
      maxParticipants: 4,
      currentParticipants: 2,
      status: 'completed',
    });
    createdActivityIds.add(activityId);

    await db.insert(conversations).values({
      id: conversationId,
      userId: testUser!.user.id,
      title: '活动后承接测试会话',
    });
    createdConversationIds.add(conversationId);

    await db.insert(agentTasks).values({
      id: taskId,
      userId: testUser!.user.id,
      taskType: 'join_activity',
      status: 'active',
      currentStage: 'discussion',
      goalText: '继续在讨论区推进这场活动',
      activityId,
      entryConversationId: conversationId,
      latestConversationId: conversationId,
    });
    createdTaskIds.add(taskId);

    await syncJoinTaskFromChatResponse({
      userId: testUser!.user.id,
      conversationId,
      request: buildFollowUpRequest(activityId),
      blocks: [],
      outcome: null,
    });

    const tasks = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.activityId, activityId))
      .orderBy(desc(agentTasks.updatedAt));
    const events = await db
      .select()
      .from(agentTaskEvents)
      .where(eq(agentTaskEvents.taskId, taskId));

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe(taskId);
    expect(tasks[0]?.status).toBe('active');
    expect(tasks[0]?.currentStage).toBe('post_activity');
    expect(tasks[0]?.slotSummary).toMatchObject({
      activityId,
      activityMode: 'review',
      entry: 'message_center_post_activity',
    });
    expect(events.filter((event) => event.eventType === 'stage_changed')).toHaveLength(1);
    expect(events.filter((event) => event.toStage === 'post_activity')).toHaveLength(1);
  });

  it('does not duplicate post_activity stage events when the same follow-up is resumed twice', async () => {
    expect(testUser).toBeDefined();

    const activityId = randomUUID();
    const taskId = randomUUID();
    const conversationId = randomUUID();

    await db.insert(activities).values({
      id: activityId,
      creatorId: testUser!.user.id,
      title: '活动后幂等推进测试局',
      description: '验证重复进入 follow-up 不会重复写 stage_changed',
      location: { x: 106.52988, y: 29.58567 },
      locationName: '观音桥',
      address: '观音桥步行街',
      locationHint: '地铁站附近',
      startAt: new Date('2026-03-16T20:00:00+08:00'),
      type: 'food',
      maxParticipants: 4,
      currentParticipants: 2,
      status: 'completed',
    });
    createdActivityIds.add(activityId);

    await db.insert(conversations).values({
      id: conversationId,
      userId: testUser!.user.id,
      title: '活动后幂等推进测试会话',
    });
    createdConversationIds.add(conversationId);

    await db.insert(agentTasks).values({
      id: taskId,
      userId: testUser!.user.id,
      taskType: 'join_activity',
      status: 'active',
      currentStage: 'post_activity',
      goalText: '继续活动后复盘',
      activityId,
      entryConversationId: conversationId,
      latestConversationId: conversationId,
      slotSummary: {
        activityId,
        activityMode: 'review',
        entry: 'message_center_post_activity',
      },
    });
    createdTaskIds.add(taskId);

    await syncJoinTaskFromChatResponse({
      userId: testUser!.user.id,
      conversationId,
      request: buildFollowUpRequest(activityId),
      blocks: [],
      outcome: null,
    });

    const events = await db
      .select()
      .from(agentTaskEvents)
      .where(eq(agentTaskEvents.taskId, taskId));

    expect(events).toHaveLength(0);
  });

  it('resumes the same join task after auth gate instead of creating a new one', async () => {
    expect(testUser).toBeDefined();

    const activityId = randomUUID();
    const conversationId = randomUUID();

    await db.insert(activities).values({
      id: activityId,
      creatorId: testUser!.user.id,
      title: '报名恢复同一任务测试局',
      description: '验证 auth gate 恢复后继续的是同一条 join task',
      location: { x: 106.52988, y: 29.58567 },
      locationName: '观音桥',
      address: '观音桥步行街',
      locationHint: '地铁站附近',
      startAt: new Date('2026-03-17T20:00:00+08:00'),
      type: 'food',
      maxParticipants: 4,
      currentParticipants: 1,
      status: 'active',
    });
    createdActivityIds.add(activityId);
    await db.insert(conversations).values({
      id: conversationId,
      userId: testUser!.user.id,
      title: '报名恢复测试会话',
    });
    createdConversationIds.add(conversationId);

    const request: GenUIRequest = {
      conversationId,
      input: {
        type: 'action',
        action: 'join_activity',
        actionId: 'join-auth-resume-test',
        params: {
          activityId,
          source: 'widget_explore',
        },
        displayText: '报名这个活动',
      },
      context: {
        client: 'miniprogram',
        entry: 'join_auth_resume_test',
      },
    };

    await syncJoinTaskFromChatResponse({
      userId: testUser!.user.id,
      conversationId,
      request,
      blocks: buildJoinAuthRequiredBlocks(activityId),
      outcome: null,
    });

    const [blockedTask] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.activityId, activityId))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1);

    expect(blockedTask).toBeDefined();
    createdTaskIds.add(blockedTask!.id);
    expect(blockedTask?.status).toBe('waiting_auth');
    expect(blockedTask?.currentStage).toBe('auth_gate');
    expect(blockedTask?.pendingAction).toMatchObject({
      action: 'join_activity',
    });

    await syncJoinTaskFromChatResponse({
      userId: testUser!.user.id,
      conversationId,
      request,
      blocks: buildJoinSuccessBlocks(activityId),
      outcome: 'joined',
    });

    const tasks = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.activityId, activityId))
      .orderBy(desc(agentTasks.updatedAt));
    const events = await db
      .select()
      .from(agentTaskEvents)
      .where(eq(agentTaskEvents.taskId, blockedTask!.id));

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe(blockedTask?.id);
    expect(tasks[0]?.status).toBe('active');
    expect(tasks[0]?.currentStage).toBe('joined');
    expect(tasks[0]?.pendingAction).toBeNull();
    expect(events.filter((event) => event.eventType === 'auth_blocked')).toHaveLength(1);
    expect(events.filter((event) => event.eventType === 'auth_resumed')).toHaveLength(1);
  });

  it('does not append task_completed twice when later outcomes enrich the same task', async () => {
    expect(testUser).toBeDefined();

    const activityId = '96969696-9696-4969-8969-969696969696';

    await db.insert(activities).values({
      id: activityId,
      creatorId: testUser!.user.id,
      title: '结果写回幂等测试局',
      description: '验证 task_completed 不重复追加',
      location: { x: 106.52988, y: 29.58567 },
      locationName: '观音桥',
      address: '观音桥步行街',
      locationHint: '地铁站附近',
      startAt: new Date('2026-03-16T20:00:00+08:00'),
      type: 'food',
      maxParticipants: 4,
      currentParticipants: 2,
      status: 'completed',
    });
    createdActivityIds.add(activityId);

    await recordJoinTaskFulfillmentOutcome({
      userId: testUser!.user.id,
      activityId,
      attended: true,
      summary: '真实履约结果：全部到场。',
    });

    const [createdTask] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.activityId, activityId))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1);

    expect(createdTask).toBeDefined();
    createdTaskIds.add(createdTask!.id);

    await recordJoinTaskReviewOutcome({
      userId: testUser!.user.id,
      activityId,
      reviewSummary: '这次氛围很好，下次可以再约。',
    });

    const [task] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, createdTask!.id))
      .limit(1);
    const events = await db
      .select()
      .from(agentTaskEvents)
      .where(eq(agentTaskEvents.activityId, activityId));

    expect(task?.status).toBe('completed');
    expect(task?.currentStage).toBe('done');
    expect(task?.resultOutcome).toBe('review_recorded');
    expect(task?.resultSummary).toContain('这次氛围很好');
    expect(events.filter((event) => event.eventType === 'task_completed')).toHaveLength(1);
    expect(events.filter((event) => event.eventType === 'outcome_recorded')).toHaveLength(2);
  });

  it('records welcome post-activity feedback through /ai/chat structured action', async () => {
    expect(testUser).toBeDefined();

    const activityId = '97979797-9797-4979-8979-979797979797';

    await db.insert(activities).values({
      id: activityId,
      creatorId: testUser!.user.id,
      title: '首页反馈闭环测试局',
      description: '验证 welcome feedback action 写回真实结果',
      location: { x: 106.52988, y: 29.58567 },
      locationName: '观音桥',
      address: '观音桥步行街',
      locationHint: '地铁站附近',
      startAt: new Date('2026-03-16T20:00:00+08:00'),
      type: 'food',
      maxParticipants: 4,
      currentParticipants: 1,
      status: 'completed',
    });
    createdActivityIds.add(activityId);

    const response = await requestJson<ChatTurnResponse>({
      method: 'POST',
      path: '/ai/chat',
      token: testUser!.token,
      payload: {
        input: {
          type: 'action',
          action: 'record_activity_feedback',
          actionId: randomUUID(),
          displayText: '这次挺顺利',
          params: {
            activityId,
            feedback: 'positive',
            reviewSummary: '这次氛围很好，下次可以再约。',
          },
        },
        context: {
          client: 'web',
          locale: 'zh-CN',
          timezone: 'Asia/Shanghai',
          entry: 'welcome_post_activity_feedback',
        },
      },
    });
    createdConversationIds.add(response.conversationId);

    const [task] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.activityId, activityId))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1);
    expect(task).toBeDefined();
    createdTaskIds.add(task!.id);

    const events = await db
      .select()
      .from(agentTaskEvents)
      .where(eq(agentTaskEvents.activityId, activityId));

    expect(task?.status).toBe('completed');
    expect(task?.currentStage).toBe('done');
    expect(task?.resultOutcome).toBe('fulfilled');
    expect(task?.resultSummary).toContain('这次氛围很好');
    expect(events.filter((event) => event.eventType === 'outcome_recorded')).toHaveLength(1);
    expect(events.filter((event) => event.eventType === 'task_completed')).toHaveLength(1);
    expect(response.turn.blocks.some((block) => block.type === 'cta-group')).toBe(true);
  });

  it('resumes the same create task after auth gate and promotes it to draft_ready', async () => {
    expect(testUser).toBeDefined();

    const activityId = randomUUID();
    const conversationId = randomUUID();

    await db.insert(conversations).values({
      id: conversationId,
      userId: testUser!.user.id,
      title: '发局 auth gate 恢复测试会话',
    });
    createdConversationIds.add(conversationId);

    const request: GenUIRequest = {
      conversationId,
      input: {
        type: 'action',
        action: 'create_activity',
        actionId: 'create-auth-resume-test',
        params: {
          title: '周五桌游局',
          type: 'boardgame',
          locationName: '观音桥',
          maxParticipants: 6,
        },
        displayText: '先生成草稿',
      },
      context: {
        client: 'miniprogram',
        entry: 'create_auth_resume_test',
      },
    };

    await syncCreateTaskFromChatResponse({
      userId: testUser!.user.id,
      conversationId,
      request,
      blocks: buildCreateAuthRequiredBlocks(),
    });

    const [blockedTask] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.latestConversationId, conversationId))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1);

    expect(blockedTask).toBeDefined();
    createdTaskIds.add(blockedTask!.id);
    expect(blockedTask?.taskType).toBe('create_activity');
    expect(blockedTask?.status).toBe('waiting_auth');
    expect(blockedTask?.currentStage).toBe('auth_gate');
    expect(blockedTask?.pendingAction).toMatchObject({
      action: 'create_activity',
    });

    await db.insert(activities).values({
      id: activityId,
      creatorId: testUser!.user.id,
      title: '周五桌游局',
      description: '验证 create auth gate 恢复后继续同一条任务',
      location: { x: 106.52988, y: 29.58567 },
      locationName: '观音桥',
      address: '观音桥步行街',
      locationHint: '观音桥商圈',
      startAt: new Date('2026-03-28T20:00:00+08:00'),
      type: 'boardgame',
      maxParticipants: 6,
      currentParticipants: 1,
      status: 'draft',
    });
    createdActivityIds.add(activityId);

    await syncCreateTaskFromChatResponse({
      userId: testUser!.user.id,
      conversationId,
      request: {
        ...request,
        context: {
          ...request.context,
          activityId,
        },
      },
      blocks: buildDraftReadyBlocks({
        activityId,
        title: '周五桌游局',
        type: 'boardgame',
        locationName: '观音桥',
        startAt: '2026-03-28T20:00:00+08:00',
        maxParticipants: 6,
      }),
    });

    const tasks = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.activityId, activityId))
      .orderBy(desc(agentTasks.updatedAt));
    const events = await db
      .select()
      .from(agentTaskEvents)
      .where(eq(agentTaskEvents.taskId, blockedTask!.id));

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe(blockedTask?.id);
    expect(tasks[0]?.status).toBe('active');
    expect(tasks[0]?.currentStage).toBe('draft_ready');
    expect(tasks[0]?.pendingAction).toBeNull();
    expect(events.filter((event) => event.eventType === 'auth_blocked')).toHaveLength(1);
    expect(events.filter((event) => event.eventType === 'auth_resumed')).toHaveLength(1);
  });

  it('keeps create_activity on the same task when draft settings are edited', async () => {
    expect(testUser).toBeDefined();

    const activityId = randomUUID();
    const conversationId = randomUUID();

    await db.insert(conversations).values({
      id: conversationId,
      userId: testUser!.user.id,
      title: '发局草稿编辑测试会话',
    });
    createdConversationIds.add(conversationId);

    const createRequest: GenUIRequest = {
      conversationId,
      input: {
        type: 'action',
        action: 'create_activity',
        actionId: 'create-draft-runtime-test',
        params: {
          title: '周五桌游局',
          type: 'boardgame',
          locationName: '观音桥',
          maxParticipants: 6,
        },
        displayText: '先生成草稿',
      },
      context: {
        client: 'miniprogram',
        entry: 'create_draft_runtime_test',
      },
    };

    await syncCreateTaskFromChatResponse({
      userId: testUser!.user.id,
      conversationId,
      request: createRequest,
      blocks: buildDraftSettingsFormBlocks(),
    });

    const [draftCollectingTask] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.latestConversationId, conversationId))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1);

    expect(draftCollectingTask).toBeDefined();
    createdTaskIds.add(draftCollectingTask!.id);
    expect(draftCollectingTask?.taskType).toBe('create_activity');
    expect(draftCollectingTask?.currentStage).toBe('draft_collecting');
    expect(draftCollectingTask?.activityId).toBeNull();

    await db.insert(activities).values({
      id: activityId,
      creatorId: testUser!.user.id,
      title: '周五桌游局',
      description: '验证保存草稿设置不会分叉 create task',
      location: { x: 106.52988, y: 29.58567 },
      locationName: '解放碑',
      address: '解放碑步行街',
      locationHint: '解放碑商圈',
      startAt: new Date('2026-03-29T20:00:00+08:00'),
      type: 'boardgame',
      maxParticipants: 8,
      currentParticipants: 1,
      status: 'draft',
    });
    createdActivityIds.add(activityId);

    await syncCreateTaskFromChatResponse({
      userId: testUser!.user.id,
      conversationId,
      request: {
        conversationId,
        input: {
          type: 'action',
          action: 'save_draft_settings',
          actionId: 'save-draft-settings-runtime-test',
          params: {
            activityId,
            title: '周六桌游局',
            type: 'boardgame',
            locationName: '解放碑',
            startAt: '2026-03-29T20:00:00+08:00',
            maxParticipants: 8,
          },
          displayText: '保存草稿设置',
        },
        context: {
          client: 'miniprogram',
          activityId,
          entry: 'save_draft_settings_runtime_test',
        },
      },
      blocks: buildDraftReadyBlocks({
        activityId,
        title: '周六桌游局',
        type: 'boardgame',
        locationName: '解放碑',
        startAt: '2026-03-29T20:00:00+08:00',
        maxParticipants: 8,
      }),
    });

    const tasks = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.latestConversationId, conversationId))
      .orderBy(desc(agentTasks.updatedAt));

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.id).toBe(draftCollectingTask?.id);
    expect(tasks[0]?.currentStage).toBe('draft_ready');
    expect(tasks[0]?.activityId).toBe(activityId);
    expect(tasks[0]?.slotSummary).toMatchObject({
      title: '周六桌游局',
      type: 'boardgame',
      locationName: '解放碑',
      startAt: '2026-03-29T20:00:00+08:00',
      maxParticipants: 8,
      activityId,
    });
  });

  it('records create_activity publication as published then done on the same task', async () => {
    expect(testUser).toBeDefined();

    const activityId = randomUUID();

    await db.insert(activities).values({
      id: activityId,
      creatorId: testUser!.user.id,
      title: '周六桌游局',
      description: '验证发布草稿后 create task 会进入 done',
      location: { x: 106.52988, y: 29.58567 },
      locationName: '解放碑',
      address: '解放碑步行街',
      locationHint: '解放碑商圈',
      startAt: new Date('2026-03-29T20:00:00+08:00'),
      type: 'boardgame',
      maxParticipants: 8,
      currentParticipants: 1,
      status: 'draft',
    });
    createdActivityIds.add(activityId);

    await recordCreateTaskDraftReady({
      userId: testUser!.user.id,
      activityId,
      title: '周六桌游局',
      type: 'boardgame',
      locationName: '解放碑',
      startAt: '2026-03-29T20:00:00+08:00',
      maxParticipants: 8,
      source: 'draft_ready_test',
    });

    const [draftTask] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.activityId, activityId))
      .orderBy(desc(agentTasks.updatedAt))
      .limit(1);

    expect(draftTask).toBeDefined();
    createdTaskIds.add(draftTask!.id);
    expect(draftTask?.currentStage).toBe('draft_ready');

    await recordCreateTaskPublished({
      userId: testUser!.user.id,
      activityId,
      title: '周六桌游局',
      locationName: '解放碑',
    });

    const [task] = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.id, draftTask!.id))
      .limit(1);
    const events = await db
      .select()
      .from(agentTaskEvents)
      .where(eq(agentTaskEvents.taskId, draftTask!.id));

    expect(task?.status).toBe('completed');
    expect(task?.currentStage).toBe('done');
    expect(task?.resultOutcome).toBe('published');
    expect(task?.resultSummary).toContain('已正式发布');
    expect(events.filter((event) => event.toStage === 'published')).toHaveLength(1);
    expect(events.filter((event) => event.eventType === 'task_completed')).toHaveLength(1);
  });

  it('keeps search-first partner flows before match_ready until a real match exists', async () => {
    expect(testUser).toBeDefined();

    const conversationId = randomUUID();

    await db.insert(conversations).values({
      id: conversationId,
      userId: testUser!.user.id,
      title: '找搭子搜索先行测试会话',
    });
    createdConversationIds.add(conversationId);

    const request: GenUIRequest = {
      conversationId,
      input: {
        type: 'action',
        action: 'search_partners',
        actionId: 'partner-search-runtime-test',
        params: {
          rawInput: '想找个周末羽毛球搭子',
          activityType: 'sports',
          sportType: 'badminton',
          locationHint: '观音桥',
          timePreference: '周六晚上',
        },
        displayText: '帮我搜搜羽毛球搭子',
      },
      context: {
        client: 'miniprogram',
        entry: 'partner_search_runtime_test',
      },
    };

    await syncPartnerTaskFromChatResponse({
      userId: testUser!.user.id,
      conversationId,
      request,
      blocks: buildPartnerSearchResultBlocks(),
    });

    const tasks = await db
      .select()
      .from(agentTasks)
      .where(eq(agentTasks.latestConversationId, conversationId))
      .orderBy(desc(agentTasks.updatedAt));
    const partnerTask = tasks.find((task) => task.taskType === 'find_partner');

    expect(partnerTask).toBeDefined();
    createdTaskIds.add(partnerTask!.id);
    expect(partnerTask?.currentStage).toBe('preference_collecting');
    expect(partnerTask?.status).toBe('active');
    expect(partnerTask?.intentMatchId).toBeNull();
    expect(partnerTask?.partnerIntentId).toBeNull();

    const snapshots = await listCurrentAgentTaskSnapshots(testUser!.user.id);
    const snapshot = snapshots.find((item) => item.id === partnerTask!.id);

    expect(snapshot?.currentStage).toBe('preference_collecting');
    expect(snapshot?.stageLabel).toBe('补偏好');
    expect(snapshot?.primaryAction).toMatchObject({
      kind: 'structured_action',
      action: 'find_partner',
      label: '继续补偏好',
    });
  });

  it('surfaces real partner matches as match_ready snapshots with a message-center action', async () => {
    expect(testUser).toBeDefined();

    const taskId = randomUUID();
    const matchId = randomUUID();
    await db.insert(intentMatches).values({
      id: matchId,
      activityType: 'sports',
      matchScore: 92,
      commonTags: ['周末', '羽毛球'],
      centerLocation: { x: 106.52988, y: 29.58567 },
      centerLocationHint: '观音桥',
      tempOrganizerId: testUser!.user.id,
      intentIds: [],
      userIds: [testUser!.user.id],
      outcome: 'pending',
      confirmDeadline: new Date('2026-03-30T20:00:00+08:00'),
    });
    createdIntentMatchIds.add(matchId);

    await db.insert(agentTasks).values({
      id: taskId,
      userId: testUser!.user.id,
      taskType: 'find_partner',
      status: 'waiting_async_result',
      currentStage: 'match_ready',
      goalText: '帮我找个周末羽毛球搭子',
      intentMatchId: matchId,
      slotSummary: {
        activityType: 'sports',
        sportType: 'badminton',
        locationHint: '观音桥',
        timePreference: '周六晚上',
      },
    });
    createdTaskIds.add(taskId);

    const snapshots = await listCurrentAgentTaskSnapshots(testUser!.user.id);
    const snapshot = snapshots.find((item) => item.id === taskId);

    expect(snapshot?.currentStage).toBe('match_ready');
    expect(snapshot?.primaryAction).toMatchObject({
      kind: 'switch_tab',
      label: '去确认匹配',
      url: '/pages/message/index',
      payload: {
        taskId,
        matchId,
      },
    });
  });
});
