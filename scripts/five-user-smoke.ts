#!/usr/bin/env bun

import {
  assert,
  bootstrapUsers,
  buildCreatePayload,
  requestJson,
} from './regression-sandbox-utils';
import type {
  BootstrappedUser,
  ChatActivitiesResponse,
  ChatMessagesResponse,
  PublicActivityResponse,
} from './regression-sandbox-utils';
import { writeRegressionArtifact } from './regression-artifact';
import { findScenarioMatrixEntry } from './regression-scenario-matrix';

const USER_COUNT = Number.parseInt(process.env.SMOKE_USER_COUNT?.trim() || '5', 10);
const CLEANUP = Bun.argv.includes('--cleanup');

async function main(): Promise<void> {
  const startedAt = new Date();
  assert(Number.isFinite(USER_COUNT) && USER_COUNT >= 2 && USER_COUNT <= 5, 'SMOKE_USER_COUNT 必须在 2-5 之间');

  console.log('1/6 准备测试账号...');
  const users = await bootstrapUsers(USER_COUNT);
  console.log(`   已准备 ${users.length} 个账号`);

  const [creator, ...joiners] = users;
  assert(creator, '缺少发起人账号');
  assert(joiners.length > 0, '至少需要 1 个报名用户');

  console.log('2/6 创建活动...');
  const createPayload = buildCreatePayload({
    title: `五人验收局-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  });
  const created = await requestJson<{ id: string; msg: string }>({
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
  assert(publicAfterJoin.currentParticipants === users.length, `报名后人数应为 ${users.length}，实际为 ${publicAfterJoin.currentParticipants}`);
  assert(publicAfterJoin.participants.length === users.length, `公开参与者数量异常: ${publicAfterJoin.participants.length}`);

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

  const completedAt = new Date();
  const matrixEntry = findScenarioMatrixEntry('five-user-smoke');
  const artifactPath = await writeRegressionArtifact({
    runner: 'five-user-smoke',
    suite: 'core',
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    scenarioCount: 1,
    passedCount: 1,
    failedCount: 0,
    scenarios: [
      {
        id: 'five-user-smoke',
        passed: true,
        details: [
          `activityId=${activityId}`,
          `participants=${publicAfterJoin.currentParticipants}`,
          `messages=${chatMessages.messages.length}`,
          `chatActivities=${chatActivities.items.length}`,
          `cleanup=${CLEANUP}`,
        ],
        matrix: matrixEntry
          ? {
              runner: matrixEntry.runner,
              layer: matrixEntry.layer,
              suite: matrixEntry.suite,
              domain: matrixEntry.domain,
              branchLength: matrixEntry.branchLength,
              userGoal: matrixEntry.userGoal,
              prdSections: matrixEntry.prdSections,
              primarySurface: matrixEntry.primarySurface,
              scenarioType: matrixEntry.scenarioType,
              userMindsets: matrixEntry.userMindsets,
              trustRisks: matrixEntry.trustRisks,
              dropOffPoints: matrixEntry.dropOffPoints,
              expectedFeeling: matrixEntry.expectedFeeling,
              longFlowIds: matrixEntry.longFlowIds,
            }
          : null,
      },
    ],
    metadata: {
      userCount: USER_COUNT,
      cleanup: CLEANUP,
    },
  });
  console.log(`- Artifact: ${artifactPath}`);

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
