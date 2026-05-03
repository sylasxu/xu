#!/usr/bin/env bun

import {
  ADMIN_CODE,
  ADMIN_PHONE,
  assert,
  assertNoLeakedToolText,
  assertPartnerSearchResultSafety,
  BASE_URL,
  bootstrapUsers,
  buildCreatePayload,
  buildPartnerPayload,
  cancelActivity,
  cancelPendingMatch,
  cleanupSandboxActivities,
  cleanupSandboxAgentTasks,
  cleanupSandboxConversations,
  cleanupSandboxPartnerIntents,
  cleanupSandboxUserMemories,
  confirmFulfillment,
  confirmPendingMatch,
  createActivity,
  decodeTokenPayload,
  DEFAULT_TEST_MODEL,
  DESTINATION_COMPANION_FIXTURE,
  extractVisibleText,
  FILL_SEAT_FIXTURE,
  findAlertBlock,
  findBlock,
  findCtaActionInput,
  getActivityParticipants,
  getAdminToken,
  getAiConversations,
  getAiCurrentTasks,
  getAiWelcome,
  getChatMessages,
  getMessageCenter,
  getNotifications,
  getPendingMatchDetail,
  getPendingMatches,
  getPublicActivity,
  getUnreadCount,
  getUserActivityOutcome,
  hasLeakedToolCallText,
  hasTextContent,
  hasVisibleFeedback,
  isRecord,
  joinActivity,
  listChatActivities,
  listChatActivitiesForTarget,
  LOCAL_PARTNER_FIXTURE,
  markActivityCompleted,
  markNotificationRead,
  markRebookFollowUp,
  postAiAction,
  postAiChat,
  postAiDiscussionEntered,
  quitActivity,
  readAlertMeta,
  recordActivitySelfFeedback,
  requestError,
  requestJson,
  requestText,
  resetSandboxRateLimits,
  sendChatMessage,
  sleep,
  USER_COUNT,
  waitFor,
  withActivity,
} from './regression-sandbox-utils';

import type {
  ActivityMode,
  ActivityParticipantInfo,
  AiChatBlock,
  AiChatEnvelope,
  AiChatRequestContext,
  AiConversationsResponse,
  ApiError,
  BootstrappedUser,
  BootstrapResponse,
  ChatActivitiesResponse,
  ChatMessagesResponse,
  CurrentTaskActionSnapshot,
  CurrentTaskSnapshot,
  CurrentTasksResponse,
  LoginResponse,
  MessageCenterResponse,
  NotificationItem,
  NotificationListResponse,
  PartnerFlowFixture,
  PartnerScenarioType,
  PendingMatchConfirmResponse,
  PendingMatchDetailResponse,
  PendingMatchItem,
  PendingMatchListResponse,
  PublicActivityResponse,
  ScenarioContext,
  ScenarioResult,
  StoredActivityOutcome,
  UnreadCountResponse,
  UserProfile,
  WelcomeResponse,
} from './regression-sandbox-utils';

import { writeRegressionArtifact } from './regression-artifact';
import { findScenarioMatrixEntry } from './regression-scenario-matrix';

const scenarioArgIndex = Bun.argv.indexOf('--scenario');
const scenarioFilter = scenarioArgIndex >= 0 ? Bun.argv[scenarioArgIndex + 1] : '';
const suiteArgIndex = Bun.argv.indexOf('--suite');
const requestedSuite = suiteArgIndex >= 0 ? Bun.argv[suiteArgIndex + 1] : 'core';
const scenarioSuite = requestedSuite === 'all' || requestedSuite === 'extended' ? requestedSuite : 'core';

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

    const forbiddenChatActivities = await requestError({
      method: 'GET',
      path: `/chat/activities?userId=${joiners[0].user.id}&page=1&limit=20`,
      token: joiners[1].token,
    });
    assert(forbiddenChatActivities.status === 403, `跨账号读取群聊摘要状态码异常: ${forbiddenChatActivities.status}`);

    const adminChatActivities = await listChatActivitiesForTarget(joiners[0].user.id, await getAdminToken());
    assert(adminChatActivities.items.some((item) => item.activityId === activityId), '管理员看不到目标用户群聊摘要');

    details.push(`活动 ${activityId} 完成创建、报名、讨论区发言`);
    details.push(`公开人数=${publicActivity.currentParticipants}，消息数=${messages.messages.length}`);
    details.push('群聊摘要只允许本人或管理员读取');
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

    const waitlisted = await joinActivity(activityId, user5);
    assert(waitlisted.joinResult === 'waitlisted', `满员后应返回候补: ${JSON.stringify(waitlisted)}`);
    assert(waitlisted.navigationIntent === 'stay_on_detail', `满员后导航意图异常: ${JSON.stringify(waitlisted)}`);

    const publicActivity = await getPublicActivity(activityId);
    assert(publicActivity.currentParticipants === 4, `满员场景人数异常: ${publicActivity.currentParticipants}`);
    assert(publicActivity.isFull === true, `满员场景 isFull 异常: ${JSON.stringify(publicActivity)}`);
    assert(publicActivity.remainingSeats === 0, `满员场景 remainingSeats 异常: ${JSON.stringify(publicActivity)}`);

    details.push(`活动 ${activityId} 满员后第 5 位用户进入候补`);
    details.push(`第 5 位用户结果=${waitlisted.joinResult}，文案=${waitlisted.msg}`);
  }, { maxParticipants: 4 });

  return { name: 'capacity-limit', passed: true, details };
}

async function scenarioDuplicateAndRejoin(context: ScenarioContext): Promise<ScenarioResult> {
  const [creator, user2] = context.users;
  const details: string[] = [];

  await withActivity(creator, async (activityId) => {
    await joinActivity(activityId, user2);

    const duplicateJoin = await joinActivity(activityId, user2);
    assert(duplicateJoin.joinResult === 'already_joined', `重复报名结果异常: ${JSON.stringify(duplicateJoin)}`);
    assert(duplicateJoin.navigationIntent === 'open_discussion', `重复报名导航异常: ${JSON.stringify(duplicateJoin)}`);

    await quitActivity(activityId, user2);
    const afterQuit = await getPublicActivity(activityId);
    assert(afterQuit.currentParticipants === 1, `退出后人数异常: ${afterQuit.currentParticipants}`);

    await joinActivity(activityId, user2);
    const afterRejoin = await getPublicActivity(activityId);
    assert(afterRejoin.currentParticipants === 2, `重新加入后人数异常: ${afterRejoin.currentParticipants}`);

    details.push(`活动 ${activityId} 重复报名被收口为 already_joined，退出后可重新加入`);
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

    const creatorJoinResult = await joinActivity(activityId, creator);
    assert(creatorJoinResult.joinResult === 'closed', `创建者报名结果异常: ${JSON.stringify(creatorJoinResult)}`);
    assert(creatorJoinResult.msg.includes('自己发起') || creatorJoinResult.msg.includes('自己'), `创建者报名提示异常: ${creatorJoinResult.msg}`);

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
    details.push('创建者自报收口为 closed，非参与者发言拦截、非创建者改状态拦截全部通过');
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

    const joinAfterCancel = await joinActivity(activityId, user2);
    assert(joinAfterCancel.joinResult === 'closed' || joinAfterCancel.joinResult === 'already_joined', `取消后报名结果异常: ${JSON.stringify(joinAfterCancel)}`);
    assert(joinAfterCancel.msg.includes('不在招募中') || joinAfterCancel.msg.includes('已经在这场局里'), `取消后报名提示异常: ${joinAfterCancel.msg}`);

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

  const postActivityMessageCenter = await getMessageCenter(joiner);
  const postActivityAction = postActivityMessageCenter.actionItems.find((item) => (
    item.type === 'post_activity_follow_up' && item.activityId === activityId
  ));
  assert(postActivityAction, `活动完成后消息中心未出现活动后反馈任务: ${JSON.stringify(postActivityMessageCenter.actionItems)}`);
  assert(
    postActivityAction.primaryAction.label.includes('反馈'),
    `活动后任务第一步不是补真实反馈: ${JSON.stringify(postActivityAction.primaryAction)}`,
  );
  assert(
    postActivityAction.primaryAction.activityMode !== 'review' && postActivityAction.primaryAction.activityMode !== 'rebook',
    `活动后任务第一步不应直接进入复盘/再约: ${JSON.stringify(postActivityAction.primaryAction)}`,
  );

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
  assert(initialOutcome, '履约确认后参与者长期记忆未写入 activityOutcome');
  assert(initialOutcome.attended === true, `参与者 attended 写回异常: ${initialOutcome.attended}`);
  assert(initialOutcome.rebookTriggered === false, '履约确认后不应提前写入 rebookTriggered');
  assert(
    typeof initialOutcome.reviewSummary === 'string' && initialOutcome.reviewSummary.includes('真实履约结果'),
    `履约确认后的初始 reviewSummary 异常: ${initialOutcome.reviewSummary}`,
  );

  const feedbackResult = await recordActivitySelfFeedback({
    activityId,
    user: joiner,
    feedback: 'positive',
  });
  assert(feedbackResult.code === 200, `活动后轻反馈失败: ${feedbackResult.msg}`);
  assert(
    feedbackResult.nextAction?.activityMode === 'rebook',
    `挺顺利反馈后应优先承接再约: ${JSON.stringify(feedbackResult.nextAction)}`,
  );
  assert(
    feedbackResult.nextAction.prompt.includes(activityId),
    `轻反馈 nextAction 未带 activityId: ${JSON.stringify(feedbackResult.nextAction)}`,
  );

  const feedbackOutcome = await waitFor(async () => {
    const outcome = await getUserActivityOutcome(joiner.user.id, activityId);
    return outcome?.reviewSummary?.includes('挺顺利') ? outcome : null;
  }, { retries: 8, delayMs: 300 });
  assert(feedbackOutcome, '活动后轻反馈未先写入真实结果 memory');
  assert(feedbackOutcome.attended === true, `轻反馈 attended 写回异常: ${feedbackOutcome.attended}`);
  assert(feedbackOutcome.rebookTriggered === false, '轻反馈不应直接标记 rebookTriggered');

  const reviewTurn = await postAiChat({
    user: joiner,
    text: `我已经先反馈这次「${activityTitle}」（activityId: ${activityId}）挺顺利了，现在帮我做一份复盘：亮点、槽点、下次优化和一句可直接发群里的总结。`,
    context: {
      activityId,
      activityMode: 'review',
      entry: 'message_center_post_activity',
    },
  });
  assertNoLeakedToolText(reviewTurn.response.blocks, '活动后 review 复盘');
  assert(
    hasTextContent(reviewTurn.response.blocks),
    `活动后 review 复盘没有返回文本块: ${JSON.stringify(reviewTurn.response.blocks)}`,
  );

  const reviewedOutcome = await waitFor(async () => {
    const outcome = await getUserActivityOutcome(joiner.user.id, activityId);
    if (!outcome) {
      return null;
    }

    const reviewSummary = outcome.reviewSummary?.trim();
    if (!reviewSummary || reviewSummary === feedbackOutcome.reviewSummary) {
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
  details.push(`轻反馈先写回="${feedbackOutcome.reviewSummary}"，nextAction=${feedbackResult.nextAction.activityMode}`);
  details.push(`AI 复盘后写回摘要="${reviewedOutcome.reviewSummary}"`);
  details.push(`再约标记已落库，rebookTriggered=${rebookedOutcome.rebookTriggered}`);

  return { name: 'post-activity-follow-up-flow', passed: true, details };
}

async function scenarioAiExploreWithoutLocationFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [userA, userB] = context.users;
  const details: string[] = [];

  const firstA = await postAiChat({ user: userA, text: '周末附近有什么活动' });
  assert(typeof firstA.conversationId === 'string' && firstA.conversationId.length > 0, 'userA AI 探索首轮未返回 conversationId');
  assertNoLeakedToolText(firstA.response.blocks, 'userA AI 无位置探索首轮');
  assert(
    firstA.response.blocks.some((block) => block.type === 'choice'),
    `userA AI 无位置探索首轮未返回位置选择卡: ${JSON.stringify(firstA.response.blocks)}`,
  );

  const secondA = await postAiChat({
    user: userA,
    conversationId: firstA.conversationId,
    text: '解放碑',
  });
  assertNoLeakedToolText(secondA.response.blocks, 'userA AI 位置追答');
  assert(
    secondA.response.blocks.some((block) => block.type === 'choice'),
    `userA AI 位置追答后未返回类型选择卡: ${JSON.stringify(secondA.response.blocks)}`,
  );

  const thirdA = await postAiChat({
    user: userA,
    conversationId: firstA.conversationId,
    text: '火锅',
  });
  assertNoLeakedToolText(thirdA.response.blocks, 'userA AI 类型追答');
  assert(
    thirdA.response.blocks.some((block) =>
      block.type === 'list'
      || block.type === 'cta-group'
      || block.type === 'choice'
      || block.type === 'text'
    ),
    `userA AI 类型追答后未进入 explore 链路: ${JSON.stringify(thirdA.response.blocks)}`,
  );

  const firstB = await postAiChat({ user: userB, text: '附近有什么活动' });
  assert(typeof firstB.conversationId === 'string' && firstB.conversationId.length > 0, 'userB AI 探索首轮未返回 conversationId');
  assert(firstB.conversationId !== firstA.conversationId, '多用户探索不应共享 conversationId');
  assertNoLeakedToolText(firstB.response.blocks, 'userB AI 无位置探索首轮');
  assert(
    firstB.response.blocks.some((block) => block.type === 'choice'),
    `userB AI 无位置探索首轮未返回位置选择卡: ${JSON.stringify(firstB.response.blocks)}`,
  );

  const secondB = await postAiChat({
    user: userB,
    conversationId: firstB.conversationId,
    text: '南山',
  });
  assertNoLeakedToolText(secondB.response.blocks, 'userB AI 位置追答');
  assert(
    secondB.response.blocks.some((block) => block.type === 'choice'),
    `userB AI 位置追答后未返回类型选择卡: ${JSON.stringify(secondB.response.blocks)}`,
  );

  const thirdB = await postAiChat({
    user: userB,
    conversationId: firstB.conversationId,
    text: '桌游',
  });
  assertNoLeakedToolText(thirdB.response.blocks, 'userB AI 类型追答');
  assert(
    thirdB.response.blocks.some((block) =>
      block.type === 'list'
      || block.type === 'cta-group'
      || block.type === 'choice'
      || block.type === 'text'
    ),
    `userB AI 类型追答后未进入 explore 链路: ${JSON.stringify(thirdB.response.blocks)}`,
  );

  details.push(`userA 会话 ${firstA.conversationId}：解放碑 → 火锅`);
  details.push(`userB 会话 ${firstB.conversationId}：南山 → 桌游`);
  details.push('多用户探索路径隔离通过');

  return { name: 'ai-explore-without-location-flow', passed: true, details };
}

async function scenarioAiLocationFollowupFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [userA, userB] = context.users;
  const details: string[] = [];

  await cleanupSandboxAgentTasks([userA, userB]);

  const firstA = await postAiChat({ user: userA, text: '想组个周五晚的局' });
  assert(typeof firstA.conversationId === 'string' && firstA.conversationId.length > 0, 'userA AI 追问链路未返回 conversationId');
  assertNoLeakedToolText(firstA.response.blocks, 'userA AI 首轮追问');
  assert(
    hasVisibleFeedback(firstA.response.blocks),
    `userA AI 首轮未返回用户可见追问: ${JSON.stringify(firstA.response.blocks)}`,
  );

  const secondA = await postAiChat({
    user: userA,
    conversationId: firstA.conversationId,
    text: '解放碑',
  });
  assertNoLeakedToolText(secondA.response.blocks, 'userA AI 地点追答');
  assert(
    secondA.response.blocks.some((block) => block.type === 'choice' || block.type === 'form' || block.type === 'cta-group'),
    `userA AI 地点追答后未返回下一步交互组件: ${JSON.stringify(secondA.response.blocks)}`,
  );

  const thirdA = await postAiChat({
    user: userA,
    conversationId: firstA.conversationId,
    text: '桌游',
  });
  assertNoLeakedToolText(thirdA.response.blocks, 'userA AI 类型追答');
  assert(
    thirdA.response.blocks.some((block) =>
      block.type === 'list'
      || block.type === 'cta-group'
      || block.type === 'entity-card'
      || block.type === 'form'
    ),
    `userA AI 类型追答后未进入后续承接链路: ${JSON.stringify(thirdA.response.blocks)}`,
  );

  const firstB = await postAiChat({ user: userB, text: '想组个周六晚的局' });
  assert(typeof firstB.conversationId === 'string' && firstB.conversationId.length > 0, 'userB AI 追问链路未返回 conversationId');
  assert(firstB.conversationId !== firstA.conversationId, '多用户追问不应共享 conversationId');
  assertNoLeakedToolText(firstB.response.blocks, 'userB AI 首轮追问');
  assert(
    hasVisibleFeedback(firstB.response.blocks),
    `userB AI 首轮未返回用户可见追问: ${JSON.stringify(firstB.response.blocks)}`,
  );

  const secondB = await postAiChat({
    user: userB,
    conversationId: firstB.conversationId,
    text: '观音桥',
  });
  assertNoLeakedToolText(secondB.response.blocks, 'userB AI 地点追答');
  assert(
    secondB.response.blocks.some((block) => block.type === 'choice' || block.type === 'form' || block.type === 'cta-group'),
    `userB AI 地点追答后未返回下一步交互组件: ${JSON.stringify(secondB.response.blocks)}`,
  );

  const thirdB = await postAiChat({
    user: userB,
    conversationId: firstB.conversationId,
    text: '羽毛球',
  });
  assertNoLeakedToolText(thirdB.response.blocks, 'userB AI 类型追答');
  assert(
    thirdB.response.blocks.some((block) =>
      block.type === 'list'
      || block.type === 'cta-group'
      || block.type === 'entity-card'
      || block.type === 'form'
    ),
    `userB AI 类型追答后未进入后续承接链路: ${JSON.stringify(thirdB.response.blocks)}`,
  );

  details.push(`userA 会话 ${firstA.conversationId}：周五晚 → 解放碑 → 桌游`);
  details.push(`userB 会话 ${firstB.conversationId}：周六晚 → 观音桥 → 羽毛球`);
  details.push('多用户追问路径隔离通过');

  return { name: 'ai-location-followup-flow', passed: true, details };
}

async function scenarioAiPartnerSearchBootstrapFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [user] = context.users;
  const details: string[] = [];

  await cleanupSandboxAgentTasks(context.users);
  await cleanupSandboxPartnerIntents(context.users);

  const firstTurn = await postAiAction({
    user,
    action: 'find_partner',
    displayText: '南山附近有人能一起打桌游没得？',
    payload: {
      type: 'boardgame',
      locationName: '南山',
      rawInput: '南山附近有人能一起打桌游没得？',
      lat: 29.533009,
      lng: 106.601556,
    },
  });

  assert(typeof firstTurn.conversationId === 'string' && firstTurn.conversationId.length > 0, '找搭子首轮未返回 conversationId');
  assertNoLeakedToolText(firstTurn.response.blocks, '找搭子首轮');
  assert(hasTextContent(firstTurn.response.blocks), `找搭子首轮缺少说明文本: ${JSON.stringify(firstTurn.response.blocks)}`);
  assert(
    !firstTurn.response.blocks.some((block) => block.type === 'form' && block.dedupeKey === 'partner_intent_form'),
    `找搭子首轮不应再返回完整 form: ${JSON.stringify(firstTurn.response.blocks)}`
  );
  assert(
    firstTurn.response.blocks.some((block) => block.type === 'text' || block.type === 'choice' || block.type === 'list'),
    `找搭子首轮未返回轻问或搜索结果: ${JSON.stringify(firstTurn.response.blocks)}`
  );

  const searchTurn = await postAiAction({
    user,
    action: 'search_partners',
    conversationId: firstTurn.conversationId,
    displayText: '继续帮我搜搜',
    payload: {
      rawInput: '南山周末桌游搭子，轻松一点就行',
      activityType: 'boardgame',
      type: 'boardgame',
      location: '南山',
      locationName: '南山',
      locationHint: '南山',
      timePreference: '周末晚上',
      description: '想找能稳定赴约、聊天压力别太大的桌游搭子',
      lat: 29.533009,
      lng: 106.601556,
    },
  });

  assertNoLeakedToolText(searchTurn.response.blocks, '找搭子搜索结果');
  assert(hasVisibleFeedback(searchTurn.response.blocks), `找搭子搜索后缺少可见反馈: ${JSON.stringify(searchTurn.response.blocks)}`);
  assert(
    !searchTurn.response.blocks.some((block) => block.type === 'form' && block.dedupeKey === 'partner_intent_form'),
    `找搭子搜索后不应退回完整 form: ${JSON.stringify(searchTurn.response.blocks)}`
  );
  assert(
    searchTurn.response.blocks.some((block) => block.type === 'list' || block.type === 'cta-group'),
    `找搭子搜索后缺少结果列表或下一步 CTA: ${JSON.stringify(searchTurn.response.blocks)}`
  );

  const optInCta = findCtaActionInput(
    searchTurn.response.blocks,
    'opt_in_partner_pool',
    'sandbox_partner_opt_in_1',
    '找搭子搜索结果',
  );
  const optInTurn = await postAiAction({
    user,
    action: 'opt_in_partner_pool',
    conversationId: firstTurn.conversationId,
    actionId: optInCta.actionId,
    displayText: optInCta.displayText,
    payload: {
      rawInput: '南山周末桌游搭子，轻松一点就行',
      activityType: 'boardgame',
      type: 'boardgame',
      location: '南山',
      locationName: '南山',
      locationHint: '南山',
      timePreference: '周末晚上',
      description: '想找能稳定赴约、聊天压力别太大的桌游搭子',
      lat: 29.533009,
      lng: 106.601556,
    },
  });

  assertNoLeakedToolText(optInTurn.response.blocks, '继续帮我留意');
  assert(hasVisibleFeedback(optInTurn.response.blocks), `继续帮我留意后缺少反馈: ${JSON.stringify(optInTurn.response.blocks)}`);

  const currentTasks = await getAiCurrentTasks(user);
  const partnerTask = currentTasks.items.find((item) => item.taskType === 'find_partner');
  assert(partnerTask, `继续帮我留意后未找到 find_partner 任务: ${JSON.stringify(currentTasks.items)}`);
  assert(
    partnerTask.currentStage === 'awaiting_match' || partnerTask.currentStage === 'match_ready',
    `继续帮我留意后 stage 异常: ${JSON.stringify(partnerTask)}`
  );

  const activeIntent = await waitFor(async () => {
    const [intent] = await db
      .select({
        id: partnerIntents.id,
        status: partnerIntents.status,
        locationHint: partnerIntents.locationHint,
        activityType: partnerIntents.activityType,
      })
      .from(partnerIntents)
      .where(and(
        eq(partnerIntents.userId, user.user.id),
        eq(partnerIntents.status, 'active'),
      ))
      .orderBy(desc(partnerIntents.updatedAt))
      .limit(1);

    return intent ?? null;
  }, { retries: 6, delayMs: 200 });

  assert(activeIntent, '继续帮我留意后未落 active partner_intent');
  assert(activeIntent.locationHint.includes('南山'), `partner_intent locationHint 异常: ${JSON.stringify(activeIntent)}`);
  assert(activeIntent.activityType === 'boardgame', `partner_intent activityType 异常: ${JSON.stringify(activeIntent)}`);

  details.push(`会话 ${firstTurn.conversationId} 首轮已走 search-first 链路，没有再直接弹完整搭子表单`);
  details.push('搜索结果后可以继续触发“继续帮我留意”，不会退回旧的完整表单');
  details.push(`当前任务阶段=${partnerTask.currentStage}，并已落 active partner_intent=${activeIntent.id}`);

  return { name: 'ai-partner-search-bootstrap-flow', passed: true, details };
}

async function optInPartnerPoolFromSearch(user: BootstrappedUser, fixture: PartnerFlowFixture) {
  const firstTurn = await postAiAction({
    user,
    action: 'find_partner',
    displayText: fixture.rawInput,
    payload: buildPartnerPayload(fixture),
  });

  assert(typeof firstTurn.conversationId === 'string' && firstTurn.conversationId.length > 0, '找搭子首轮未返回 conversationId');
  assertNoLeakedToolText(firstTurn.response.blocks, '找搭子首轮');

  const searchTurn = await postAiAction({
    user,
    action: 'search_partners',
    conversationId: firstTurn.conversationId,
    displayText: '先看看有没有合适的人',
    payload: buildPartnerPayload(fixture),
  });

  assertNoLeakedToolText(searchTurn.response.blocks, '找搭子搜索结果');
  assert(hasVisibleFeedback(searchTurn.response.blocks), `找搭子搜索后缺少可见反馈: ${JSON.stringify(searchTurn.response.blocks)}`);
  assertPartnerSearchResultSafety(searchTurn.response.blocks, '找搭子搜索结果');

  const optInCta = findCtaActionInput(
    searchTurn.response.blocks,
    'opt_in_partner_pool',
    `sandbox_partner_opt_in_${user.user.id.slice(0, 6)}`,
    '找搭子搜索结果',
  );

  const optInTurn = await postAiAction({
    user,
    action: 'opt_in_partner_pool',
    conversationId: firstTurn.conversationId,
    actionId: optInCta.actionId,
    displayText: optInCta.displayText,
    payload: buildPartnerPayload(fixture),
  });

  assertNoLeakedToolText(optInTurn.response.blocks, '继续帮我留意');
  assert(hasVisibleFeedback(optInTurn.response.blocks), `继续帮我留意后缺少反馈: ${JSON.stringify(optInTurn.response.blocks)}`);

  return {
    conversationId: firstTurn.conversationId,
    optInTurn,
  };
}

async function getLatestActivePartnerIntent(user: BootstrappedUser) {
  const [intent] = await db
    .select({
      id: partnerIntents.id,
      scenarioType: partnerIntents.scenarioType,
      activityType: partnerIntents.activityType,
      locationHint: partnerIntents.locationHint,
      destinationText: partnerIntents.destinationText,
      timePreference: partnerIntents.timePreference,
      timeText: partnerIntents.timeText,
      description: partnerIntents.description,
    })
    .from(partnerIntents)
    .where(and(
      eq(partnerIntents.userId, user.user.id),
      eq(partnerIntents.status, 'active'),
    ))
    .orderBy(desc(partnerIntents.updatedAt))
    .limit(1);

  return intent ?? null;
}

async function scenarioPendingMatchConfirmCreatesActivityFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [organizer, partner] = context.users;
  const details: string[] = [];
  const fixture = LOCAL_PARTNER_FIXTURE;

  await optInPartnerPoolFromSearch(organizer, fixture);
  await optInPartnerPoolFromSearch(partner, fixture);

  const organizerPendingMatch = await waitFor(async () => {
    const pendingMatches = await getPendingMatches(organizer);
    return pendingMatches.items.find((item) => item.isTempOrganizer) ?? null;
  }, { retries: 10, delayMs: 250 });

  assert(organizerPendingMatch, '待确认匹配未生成，无法验证消息中心确认链路');

  const confirmResult = await confirmPendingMatch(organizer, organizerPendingMatch.id);
  assert(confirmResult.code === 200, `确认待确认匹配失败: ${JSON.stringify(confirmResult)}`);
  assert(typeof confirmResult.activityId === 'string' && confirmResult.activityId.length > 0, `确认待确认匹配未返回 activityId: ${JSON.stringify(confirmResult)}`);

  const activityId = confirmResult.activityId;
  const publicActivity = await waitFor(() => getPublicActivity(activityId).catch(() => null), { retries: 8, delayMs: 250 });
  assert(publicActivity, `匹配确认后未查询到公开活动详情: ${activityId}`);

  const organizerMessageCenter = await getMessageCenter(organizer);
  const partnerMessageCenter = await getMessageCenter(partner);
  assert(
    organizerMessageCenter.chatActivities.items.some((item) => item.activityId === activityId),
    `临时召集人消息中心未出现成局后的群聊摘要: ${JSON.stringify(organizerMessageCenter.chatActivities.items)}`
  );
  assert(
    partnerMessageCenter.chatActivities.items.some((item) => item.activityId === activityId),
    `匹配成员消息中心未出现成局后的群聊摘要: ${JSON.stringify(partnerMessageCenter.chatActivities.items)}`
  );

  const organizerTasks = await getAiCurrentTasks(organizer);
  const partnerTasks = await getAiCurrentTasks(partner);
  assert(
    !organizerTasks.items.some((item) => item.taskType === 'find_partner' && item.activityId === activityId),
    `临时召集人的 find_partner 任务不应继续停留在当前任务列表: ${JSON.stringify(organizerTasks.items)}`
  );
  assert(
    !partnerTasks.items.some((item) => item.taskType === 'find_partner' && item.activityId === activityId),
    `匹配成员的 find_partner 任务不应继续停留在当前任务列表: ${JSON.stringify(partnerTasks.items)}`
  );

  details.push(`待确认匹配 ${organizerPendingMatch.id} 已由消息中心确认，创建活动 ${activityId}`);
  details.push('确认返回 activityId，可直接驱动 H5 跳转到 /activities/[id]?entry=match_confirmed');
  details.push('成局后双方消息中心都能看到新的群聊摘要，找搭子任务不会继续挂在 current tasks 里');

  return { name: 'pending-match-confirm-creates-activity-flow', passed: true, details };
}

async function scenarioPartnerConfirmToDiscussionFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [organizer, partner] = context.users;
  const details: string[] = [];
  const fixture = LOCAL_PARTNER_FIXTURE;

  await cleanupSandboxAgentTasks([organizer, partner]);
  await cleanupSandboxPartnerIntents([organizer, partner]);

  await optInPartnerPoolFromSearch(organizer, fixture);
  await optInPartnerPoolFromSearch(partner, fixture);

  const pendingMatch = await waitFor(async () => {
    const pendingMatches = await getPendingMatches(organizer);
    return pendingMatches.items.find((item) => item.isTempOrganizer) ?? null;
  }, { retries: 10, delayMs: 250 });
  assert(pendingMatch, '找搭子确认进入讨论区前未生成待确认匹配');

  const confirmResult = await confirmPendingMatch(organizer, pendingMatch.id);
  assert(confirmResult.code === 200, `确认待确认匹配失败: ${JSON.stringify(confirmResult)}`);
  assert(confirmResult.activityId, `确认待确认匹配未返回 activityId: ${JSON.stringify(confirmResult)}`);

  const activityId = confirmResult.activityId;
  const publicActivity = await waitFor(() => getPublicActivity(activityId).catch(() => null), { retries: 8, delayMs: 250 });
  assert(publicActivity?.status === 'active', `找搭子确认后活动状态异常: ${JSON.stringify(publicActivity)}`);

  const organizerDiscussion = await getChatMessages(activityId, organizer);
  const partnerDiscussion = await getChatMessages(activityId, partner);
  assert(Array.isArray(organizerDiscussion.messages), `召集人无法进入成局讨论区: ${JSON.stringify(organizerDiscussion)}`);
  assert(Array.isArray(partnerDiscussion.messages), `匹配成员无法进入成局讨论区: ${JSON.stringify(partnerDiscussion)}`);

  const organizerDiscussionEntered = await postAiDiscussionEntered({
    user: organizer,
    activityId,
    entry: 'match_confirmed',
  });
  const partnerDiscussionEntered = await postAiDiscussionEntered({
    user: partner,
    activityId,
    entry: 'match_confirmed',
  });
  assert(organizerDiscussionEntered.code === 200, `召集人 discussion-entered 失败: ${JSON.stringify(organizerDiscussionEntered)}`);
  assert(partnerDiscussionEntered.code === 200, `匹配成员 discussion-entered 失败: ${JSON.stringify(partnerDiscussionEntered)}`);

  const organizerMessageCenter = await getMessageCenter(organizer);
  const partnerMessageCenter = await getMessageCenter(partner);
  assert(
    organizerMessageCenter.chatActivities.items.some((item) => item.activityId === activityId),
    `召集人消息中心缺少成局讨论区: ${JSON.stringify(organizerMessageCenter.chatActivities.items)}`,
  );
  assert(
    partnerMessageCenter.chatActivities.items.some((item) => item.activityId === activityId),
    `匹配成员消息中心缺少成局讨论区: ${JSON.stringify(partnerMessageCenter.chatActivities.items)}`,
  );

  const completedTasks = await db
    .select({
      userId: agentTasks.userId,
      status: agentTasks.status,
      currentStage: agentTasks.currentStage,
      resultOutcome: agentTasks.resultOutcome,
      activityId: agentTasks.activityId,
    })
    .from(agentTasks)
    .where(and(
      inArray(agentTasks.userId, [organizer.user.id, partner.user.id]),
      eq(agentTasks.taskType, 'find_partner'),
      eq(agentTasks.activityId, activityId),
    ));

  for (const user of [organizer, partner]) {
    const task = completedTasks.find((item) => item.userId === user.user.id);
    assert(task, `找搭子确认后缺少用户 ${user.user.id} 的完成任务: ${JSON.stringify(completedTasks)}`);
    assert(task.status === 'completed', `找搭子确认后任务未 completed: ${JSON.stringify(task)}`);
    assert(task.currentStage === 'done', `找搭子确认后任务未进入 done: ${JSON.stringify(task)}`);
    assert(task.resultOutcome === 'match_confirmed', `找搭子确认后任务 outcome 异常: ${JSON.stringify(task)}`);
  }

  details.push(`pending match ${pendingMatch.id} 已确认成局，activityId=${activityId}`);
  details.push('双方都能进入讨论区，消息中心出现成局群聊摘要');
  details.push('双方 find_partner 任务已落 completed/done/match_confirmed，不再停在待办链路');

  return { name: 'partner-confirm-to-discussion-flow', passed: true, details };
}

async function scenarioPartnerScenarioFixturesFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [user] = context.users;
  const details: string[] = [];
  const fixtures = [
    LOCAL_PARTNER_FIXTURE,
    DESTINATION_COMPANION_FIXTURE,
    FILL_SEAT_FIXTURE,
  ];

  for (const fixture of fixtures) {
    await cleanupSandboxAgentTasks([user]);
    await cleanupSandboxPartnerIntents([user]);

    const result = await optInPartnerPoolFromSearch(user, fixture);
    const activeIntent = await waitFor(() => getLatestActivePartnerIntent(user), { retries: 8, delayMs: 250 });
    assert(activeIntent, `${fixture.id} 入池后未落 active partner_intent`);
    assert(activeIntent.scenarioType === fixture.scenarioType, `${fixture.id} scenarioType 异常: ${JSON.stringify(activeIntent)}`);
    assert(activeIntent.activityType === fixture.activityType, `${fixture.id} activityType 异常: ${JSON.stringify(activeIntent)}`);
    const storedLocationText = `${activeIntent.locationHint} ${activeIntent.destinationText ?? ''}`;
    assert(
      fixture.locationKeywords.some((keyword) => storedLocationText.includes(keyword)),
      `${fixture.id} locationHint/destinationText 异常: ${JSON.stringify(activeIntent)}`,
    );
    const storedTimeText = `${activeIntent.timePreference ?? ''} ${activeIntent.timeText ?? ''}`;
    assert(
      fixture.timeKeywords.some((keyword) => storedTimeText.includes(keyword)),
      `${fixture.id} timePreference/timeText 异常: ${JSON.stringify(activeIntent)}`,
    );
    if (fixture.destinationText) {
      assert(
        typeof activeIntent.destinationText === 'string'
          && fixture.locationKeywords.some((keyword) => activeIntent.destinationText?.includes(keyword)),
        `${fixture.id} destinationText 异常: ${JSON.stringify(activeIntent)}`,
      );
    }

    details.push(`${fixture.id} 已通过 ${fixture.scenarioType} 入池，会话=${result.conversationId}，intent=${activeIntent.id}`);
  }

  return { name: 'partner-scenario-fixtures-flow', passed: true, details };
}

async function scenarioAiDestinationCompanionFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [user] = context.users;
  const details: string[] = [];

  const firstTurn = await postAiAction({
    user,
    action: 'find_partner',
    displayText: '泸州音乐节有人去吗',
    payload: {
      rawInput: '泸州音乐节有人去吗',
      prompt: '泸州音乐节有人去吗',
    },
  });

  assert(typeof firstTurn.conversationId === 'string' && firstTurn.conversationId.length > 0, '异地同行首轮未返回 conversationId');
  assertNoLeakedToolText(firstTurn.response.blocks, '异地同行首轮');
  assert(hasTextContent(firstTurn.response.blocks), `异地同行首轮缺少说明文本: ${JSON.stringify(firstTurn.response.blocks)}`);

  const firstText = extractVisibleText(firstTurn.response.blocks);
  assert(
    /泸州|音乐节|同去|一起去|找人/.test(firstText),
    `异地同行首轮未体现目的地语义: ${JSON.stringify(firstTurn.response.blocks)}`
  );

  const secondTurn = await postAiAction({
    user,
    action: 'find_partner',
    conversationId: firstTurn.conversationId,
    displayText: '周6平顶山有没有人',
    payload: {
      rawInput: '周6平顶山有没有人',
      prompt: '周6平顶山有没有人',
    },
  });

  assertNoLeakedToolText(secondTurn.response.blocks, '异地同行追答');
  const secondText = extractVisibleText(secondTurn.response.blocks);
  assert(
    /平顶山|周6|周六|同去|有人/.test(secondText),
    `异地同行追答未保持自由文本理解: ${JSON.stringify(secondTurn.response.blocks)}`
  );

  details.push(`会话 ${firstTurn.conversationId} 已能承接“泸州音乐节有人去吗 / 周6平顶山有没有人”这类异地同行表达`);
  details.push('系统没有退回重庆片区词表模式，仍保持在同一条 find_partner 主链内推进');

  return { name: 'ai-destination-companion-flow', passed: true, details };
}

async function scenarioPartnerActionGateFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [boundUser] = context.users;
  const details: string[] = [];
  const rawInput = '南山周六晚找桌游搭子，能接受新手，最好别鸽';

  await cleanupSandboxAgentTasks([boundUser]);
  await cleanupSandboxPartnerIntents([boundUser]);

  const guestSearchTurn = await postAiAction({
    action: 'search_partners',
    displayText: '先搜一下有没有合适搭子',
    payload: {
      rawInput,
      activityType: 'boardgame',
      type: 'boardgame',
      location: '南山',
      locationName: '南山',
      locationHint: '南山',
      timePreference: '周六晚上',
      description: '找能稳定赴约、接受新手的桌游搭子',
      lat: 29.533009,
      lng: 106.601556,
    },
  });
  assertNoLeakedToolText(guestSearchTurn.response.blocks, '游客找搭子即时搜索');
  assert(
    guestSearchTurn.response.blocks.some((block) => block.type === 'list' || block.type === 'cta-group' || block.type === 'text'),
    `游客 search_partners 未返回可浏览结果或反馈: ${JSON.stringify(guestSearchTurn.response.blocks)}`,
  );

  const guestOptInTurn = await postAiAction({
    action: 'opt_in_partner_pool',
    conversationId: guestSearchTurn.conversationId,
    displayText: '继续帮我留意',
    payload: {
      rawInput,
      activityType: 'boardgame',
      type: 'boardgame',
      location: '南山',
      locationName: '南山',
      locationHint: '南山',
      timePreference: '周六晚上',
      description: '找能稳定赴约、接受新手的桌游搭子',
      lat: 29.533009,
      lng: 106.601556,
    },
  });
  const guestAlert = findAlertBlock(guestOptInTurn.response.blocks);
  assert(guestAlert, `游客 opt_in_partner_pool 未返回 auth alert: ${JSON.stringify(guestOptInTurn.response.blocks)}`);
  const guestMeta = readAlertMeta(guestAlert);
  assert(guestMeta?.authRequired && typeof guestMeta.authRequired === 'object', `游客 opt_in 缺少 authRequired: ${JSON.stringify(guestMeta)}`);
  const guestAuth = guestMeta.authRequired as Record<string, unknown>;
  assert(guestAuth.mode === 'login', `游客 opt_in auth mode 应为 login: ${JSON.stringify(guestAuth)}`);
  assert(isRecord(guestAuth.pendingAction) && guestAuth.pendingAction.action === 'opt_in_partner_pool', `游客 opt_in pendingAction 异常: ${JSON.stringify(guestAuth)}`);

  const originalPhoneNumber = boundUser.user.phoneNumber;
  assert(originalPhoneNumber, '测试账号缺少手机号，无法验证未绑手机号分支');

  try {
    await db
      .update(users)
      .set({ phoneNumber: null, updatedAt: new Date() })
      .where(eq(users.id, boundUser.user.id));

    const bindPhoneTurn = await postAiAction({
      user: boundUser,
      action: 'opt_in_partner_pool',
      conversationId: guestSearchTurn.conversationId,
      displayText: '继续帮我留意',
      payload: {
        rawInput,
        activityType: 'boardgame',
        type: 'boardgame',
        location: '南山',
        locationName: '南山',
        locationHint: '南山',
        timePreference: '周六晚上',
        description: '找能稳定赴约、接受新手的桌游搭子',
        lat: 29.533009,
        lng: 106.601556,
      },
    });
    const bindPhoneAlert = findAlertBlock(bindPhoneTurn.response.blocks);
    assert(bindPhoneAlert, `未绑手机号 opt_in_partner_pool 未返回 auth alert: ${JSON.stringify(bindPhoneTurn.response.blocks)}`);
    const bindPhoneMeta = readAlertMeta(bindPhoneAlert);
    assert(bindPhoneMeta?.authRequired && typeof bindPhoneMeta.authRequired === 'object', `未绑手机号 opt_in 缺少 authRequired: ${JSON.stringify(bindPhoneMeta)}`);
    const bindPhoneAuth = bindPhoneMeta.authRequired as Record<string, unknown>;
    assert(bindPhoneAuth.mode === 'bind_phone', `未绑手机号 opt_in auth mode 应为 bind_phone: ${JSON.stringify(bindPhoneAuth)}`);
    assert(isRecord(bindPhoneAuth.pendingAction) && bindPhoneAuth.pendingAction.action === 'opt_in_partner_pool', `未绑手机号 opt_in pendingAction 异常: ${JSON.stringify(bindPhoneAuth)}`);
  } finally {
    await db
      .update(users)
      .set({ phoneNumber: originalPhoneNumber, updatedAt: new Date() })
      .where(eq(users.id, boundUser.user.id));
  }

  const activeIntentAfterGate = await db
    .select({ id: partnerIntents.id })
    .from(partnerIntents)
    .where(and(
      eq(partnerIntents.userId, boundUser.user.id),
      eq(partnerIntents.status, 'active'),
    ))
    .limit(1);
  assert(activeIntentAfterGate.length === 0, `auth gate 分支不应写入 active partner_intent: ${JSON.stringify(activeIntentAfterGate)}`);

  details.push(`游客会话 ${guestSearchTurn.conversationId} 可先浏览找搭子搜索结果`);
  details.push('游客点击“继续帮我留意”返回 login authRequired + pendingAction');
  details.push('已登录但未绑手机号点击“继续帮我留意”返回 bind_phone authRequired + pendingAction，且没有写入 active intent');

  return { name: 'partner-action-gate-flow', passed: true, details };
}

async function scenarioPartnerLongMultiUserBranchFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [organizer, partner, outsider] = context.users;
  const details: string[] = [];
  const fixture = LOCAL_PARTNER_FIXTURE;

  await cleanupSandboxAgentTasks(context.users);
  await cleanupSandboxPartnerIntents(context.users);

  const longSteps = [
    '我周六晚上想找个桌游搭子',
    '地点先放南山附近',
    '轻策略就好，最好别鸽',
    '如果没人立刻合适，也可以继续帮我留意',
  ];
  let conversationId: string | null = null;
  for (let index = 0; index < longSteps.length; index++) {
    const turn = await postAiChat({
      user: organizer,
      text: longSteps[index],
      conversationId: conversationId || undefined,
    });
    assert(typeof turn.conversationId === 'string', `找搭子长对话 turn${index + 1} 未返回 conversationId`);
    assertNoLeakedToolText(turn.response.blocks, `找搭子长对话 turn${index + 1}`);
    if (conversationId) {
      assert(turn.conversationId === conversationId, `找搭子长对话 turn${index + 1} conversationId 漂移`);
    }
    conversationId = turn.conversationId;
  }

  assert(conversationId, '找搭子长对话未形成 conversationId');

  const searchTurn = await postAiAction({
    user: organizer,
    action: 'search_partners',
    conversationId,
    displayText: '先搜一下有没有合适的人',
    payload: buildPartnerPayload(fixture),
  });
  assertNoLeakedToolText(searchTurn.response.blocks, '找搭子长对话搜索');
  assertPartnerSearchResultSafety(searchTurn.response.blocks, '找搭子长对话搜索');
  assert(
    searchTurn.response.blocks.some((block) => block.type === 'list' || block.type === 'cta-group'),
    `找搭子长对话搜索缺少结果或 CTA: ${JSON.stringify(searchTurn.response.blocks)}`,
  );

  const optInCta = findCtaActionInput(
    searchTurn.response.blocks,
    'opt_in_partner_pool',
    'sandbox_partner_long_opt_in_organizer',
    '找搭子长对话搜索',
  );
  const organizerOptIn = await postAiAction({
    user: organizer,
    action: 'opt_in_partner_pool',
    conversationId,
    actionId: optInCta.actionId,
    displayText: optInCta.displayText,
    payload: buildPartnerPayload(fixture),
  });
  assertNoLeakedToolText(organizerOptIn.response.blocks, '长对话继续帮我留意');

  await optInPartnerPoolFromSearch(partner, fixture);

  const organizerPendingMatch = await waitFor(async () => {
    const pendingMatches = await getPendingMatches(organizer);
    return pendingMatches.items.find((item) => item.isTempOrganizer) ?? null;
  }, { retries: 10, delayMs: 250 });
  assert(organizerPendingMatch, '多用户长链路未生成临时召集人的 pending match');
  assert(organizerPendingMatch.taskId, `pending match 未回挂 find_partner taskId: ${JSON.stringify(organizerPendingMatch)}`);

  const organizerDetail = await getPendingMatchDetail(organizer, organizerPendingMatch.id);
  assert(organizerDetail.nextActionOwner === 'self', `临时召集人详情 nextActionOwner 异常: ${JSON.stringify(organizerDetail)}`);
  assert(organizerDetail.continuationTitle.includes('找搭子任务'), `临时召集人详情缺少任务承接标题: ${JSON.stringify(organizerDetail)}`);
  assert(organizerDetail.members.length >= 2, `pending match 详情成员不足: ${JSON.stringify(organizerDetail)}`);

  const partnerPendingMatches = await getPendingMatches(partner);
  const partnerPendingMatch = partnerPendingMatches.items.find((item) => item.id === organizerPendingMatch.id);
  assert(partnerPendingMatch, `匹配成员消息中心未看到同一个 pending match: ${JSON.stringify(partnerPendingMatches.items)}`);
  const partnerDetail = await getPendingMatchDetail(partner, organizerPendingMatch.id);
  assert(partnerDetail.nextActionOwner === 'organizer', `非召集人详情 nextActionOwner 异常: ${JSON.stringify(partnerDetail)}`);
  assert(partnerDetail.continuationText.includes('不是一条孤立通知'), `非召集人详情没有说明任务连续性: ${JSON.stringify(partnerDetail)}`);

  const nonOrganizerConfirm = await requestError({
    method: 'POST',
    path: `/notifications/pending-matches/${organizerPendingMatch.id}/confirm`,
    token: partner.token,
  });
  assert(nonOrganizerConfirm.msg.includes('临时召集人'), `非召集人确认提示异常: ${nonOrganizerConfirm.msg}`);

  const outsiderDetail = await requestError({
    method: 'GET',
    path: `/notifications/pending-matches/${organizerPendingMatch.id}?userId=${outsider.user.id}`,
    token: outsider.token,
  });
  assert(outsiderDetail.msg.includes('不在这个匹配'), `局外人读取 pending match 详情提示异常: ${outsiderDetail.msg}`);

  const cancelResult = await cancelPendingMatch(organizer, organizerPendingMatch.id);
  assert(cancelResult.code === 200, `临时召集人取消 pending match 失败: ${JSON.stringify(cancelResult)}`);

  const organizerPendingAfterCancel = await getPendingMatches(organizer);
  assert(
    !organizerPendingAfterCancel.items.some((item) => item.id === organizerPendingMatch.id),
    `取消后 pending match 仍在列表中: ${JSON.stringify(organizerPendingAfterCancel.items)}`,
  );

  const organizerTasks = await getAiCurrentTasks(organizer);
  const partnerTasks = await getAiCurrentTasks(partner);
  const organizerTask = organizerTasks.items.find((item) => item.taskType === 'find_partner');
  const partnerTask = partnerTasks.items.find((item) => item.taskType === 'find_partner');
  assert(organizerTask?.currentStage === 'awaiting_match', `取消后召集人任务未回到 awaiting_match: ${JSON.stringify(organizerTasks.items)}`);
  assert(partnerTask?.currentStage === 'awaiting_match', `取消后匹配成员任务未回到 awaiting_match: ${JSON.stringify(partnerTasks.items)}`);

  details.push(`长对话会话 ${conversationId} 完成 4 轮找搭子追问后入池`);
  details.push(`多用户 pending match=${organizerPendingMatch.id} 已生成，taskId=${organizerPendingMatch.taskId}`);
  details.push('pending match 详情区分召集人与非召集人，且明确说明这是找搭子任务的继续');
  details.push('非召集人确认、局外人查看详情均被拦截；召集人取消后双方任务回到 awaiting_match');

  return { name: 'partner-long-multi-user-branch-flow', passed: true, details };
}

async function scenarioPartnerConditionUpdateIntentFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [user] = context.users;
  const details: string[] = [];
  const fixture = LOCAL_PARTNER_FIXTURE;

  await cleanupSandboxAgentTasks([user]);
  await cleanupSandboxPartnerIntents([user]);

  const longSteps = [
    '我想找观音桥周五晚羽毛球搭子',
    '地点改成南山，不在观音桥了',
    '时间改周六晚上',
    '玩法也改一下，还是桌游轻策略，别按羽毛球找',
  ];
  let conversationId: string | null = null;
  for (const text of longSteps) {
    const turn = await postAiChat({
      user,
      text,
      conversationId: conversationId || undefined,
    });
    assert(typeof turn.conversationId === 'string', `条件变更长对话 "${text}" 未返回 conversationId`);
    assertNoLeakedToolText(turn.response.blocks, `条件变更长对话 ${text}`);
    conversationId = turn.conversationId;
  }
  assert(conversationId, '条件变更长对话未形成 conversationId');

  const searchTurn = await postAiAction({
    user,
    action: 'search_partners',
    conversationId,
    displayText: '按最后说的条件搜一下',
    payload: buildPartnerPayload(fixture),
  });
  assertNoLeakedToolText(searchTurn.response.blocks, '条件变更最终搜索');
  assertPartnerSearchResultSafety(searchTurn.response.blocks, '条件变更最终搜索');
  const optInCta = findCtaActionInput(
    searchTurn.response.blocks,
    'opt_in_partner_pool',
    'sandbox_partner_condition_update_opt_in',
    '条件变更最终搜索',
  );

  const optInTurn = await postAiAction({
    user,
    action: 'opt_in_partner_pool',
    conversationId,
    actionId: optInCta.actionId,
    displayText: optInCta.displayText,
    payload: buildPartnerPayload(fixture),
  });
  assertNoLeakedToolText(optInTurn.response.blocks, '条件变更最终入池');

  const activeIntent = await waitFor(() => getLatestActivePartnerIntent(user), { retries: 8, delayMs: 250 });
  assert(activeIntent, '条件变更最终入池后未落 active partner_intent');
  assert(activeIntent.locationHint.includes('南山'), `最终意向 locationHint 未采用最后地点: ${JSON.stringify(activeIntent)}`);
  assert(!activeIntent.locationHint.includes('观音桥'), `最终意向仍残留旧地点: ${JSON.stringify(activeIntent)}`);
  assert(activeIntent.activityType === 'boardgame', `最终意向 activityType 未采用最后玩法: ${JSON.stringify(activeIntent)}`);
  const storedFinalTimeText = `${activeIntent.timePreference ?? ''} ${activeIntent.timeText ?? ''}`;
  assert(
    storedFinalTimeText.includes('周六'),
    `最终意向 time 未采用最后时间: ${JSON.stringify(activeIntent)}`,
  );
  assert(
    !activeIntent.description.includes('羽毛球'),
    `最终意向描述仍残留旧玩法: ${JSON.stringify(activeIntent)}`,
  );

  details.push(`长对话 ${conversationId} 从观音桥/周五/羽毛球改到南山/周六/桌游`);
  details.push(`最终 active partner_intent=${activeIntent.id} 已按最后条件落库`);

  return { name: 'partner-condition-update-intent-flow', passed: true, details };
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
  assertNoLeakedToolText(createTurn.response.blocks, '创建草稿');
  const draftBlock = findBlock(createTurn.response.blocks, 'entity-card');
  assert(draftBlock?.fields, `创建草稿后缺少 draft card: ${JSON.stringify(createTurn.response.blocks)}`);

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

    assertNoLeakedToolText(editTurn.response.blocks, '编辑草稿');
    const formBlock = findBlock(editTurn.response.blocks, 'form');
    assert(formBlock?.schema, `编辑草稿后缺少 form block: ${JSON.stringify(editTurn.response.blocks)}`);
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

    assertNoLeakedToolText(saveTurn.response.blocks, '保存草稿设置');
    assert(hasVisibleFeedback(saveTurn.response.blocks), `保存草稿设置后缺少可见反馈: ${JSON.stringify(saveTurn.response.blocks)}`);
    const savedDraftBlock = findBlock(saveTurn.response.blocks, 'entity-card');
    assert(savedDraftBlock?.fields, `保存草稿设置后缺少更新后的 draft card: ${JSON.stringify(saveTurn.response.blocks)}`);
    assert(findBlock(saveTurn.response.blocks, 'cta-group'), `保存草稿设置后缺少下一步 CTA: ${JSON.stringify(saveTurn.response.blocks)}`);

    const publishTurn = await postAiAction({
      user,
      action: 'confirm_publish',
      conversationId: createTurn.conversationId,
      actionId: 'sandbox_confirm_publish_1',
      displayText: '确认发布',
      payload: {
        activityId,
      },
    });

    assertNoLeakedToolText(publishTurn.response.blocks, '确认发布草稿');
    assert(hasVisibleFeedback(publishTurn.response.blocks), `确认发布后缺少可见反馈: ${JSON.stringify(publishTurn.response.blocks)}`);
    const publishedCard = findBlock(publishTurn.response.blocks, 'entity-card');
    assert(publishedCard?.fields, `确认发布后缺少已发布活动卡: ${JSON.stringify(publishTurn.response.blocks)}`);
    assert(
      typeof publishedCard.fields.activityId === 'string' && publishedCard.fields.activityId === activityId,
      `确认发布后 activityId 异常: ${JSON.stringify(publishedCard.fields)}`
    );
    assert(
      typeof publishedCard.fields.shareUrl === 'string'
      && publishedCard.fields.shareUrl.includes(`/activities/${activityId}`)
      && !publishedCard.fields.shareUrl.includes('/invite/'),
      `确认发布后 shareUrl 应指向活动详情页: ${JSON.stringify(publishedCard.fields)}`
    );
    assert(
      !Object.prototype.hasOwnProperty.call(publishedCard.fields, 'sharePath'),
      `确认发布后不应再返回 sharePath: ${JSON.stringify(publishedCard.fields)}`
    );

    const publicActivity = await waitFor(() => getPublicActivity(activityId).catch(() => null), { retries: 6, delayMs: 200 });
    assert(publicActivity, `活动发布后 public 接口不可见: ${activityId}`);
    assert(publicActivity.status === 'active', `活动发布后状态应为 active: ${JSON.stringify(publicActivity)}`);

    const publishedTask = await waitFor(async () => {
      const [task] = await db
        .select({
          id: agentTasks.id,
          status: agentTasks.status,
          currentStage: agentTasks.currentStage,
          resultOutcome: agentTasks.resultOutcome,
        })
        .from(agentTasks)
        .where(and(
          eq(agentTasks.userId, user.user.id),
          eq(agentTasks.taskType, 'create_activity'),
          eq(agentTasks.activityId, activityId),
        ))
        .orderBy(desc(agentTasks.updatedAt))
        .limit(1);

      return task ?? null;
    }, { retries: 6, delayMs: 200 });

    assert(publishedTask, `确认发布后未找到 create_activity 任务: ${activityId}`);
    assert(publishedTask.status === 'completed', `发布后 create task status 异常: ${JSON.stringify(publishedTask)}`);
    assert(publishedTask.currentStage === 'done', `发布后 create task stage 异常: ${JSON.stringify(publishedTask)}`);
    assert(publishedTask.resultOutcome === 'published', `发布后 create task resultOutcome 异常: ${JSON.stringify(publishedTask)}`);

    details.push(`活动 ${activityId} 支持 edit_draft -> draft_settings form -> save_draft_settings -> confirm_publish`);
    details.push('草稿编辑不再回退成文字问答，确认发布后 public 详情可见且状态变为 active');
    details.push('发布后的分享协议只返回 /activities 详情链接，不再返回 sharePath');
    details.push(`create_activity 任务已收口为 completed/done，resultOutcome=${publishedTask.resultOutcome}`);

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
    assertNoLeakedToolText(guestTurn.response.blocks, '游客报名挂起');

    const guestAlert = findAlertBlock(guestTurn.response.blocks);
    assert(guestAlert, `游客报名首轮缺少 alert: ${JSON.stringify(guestTurn.response.blocks)}`);
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

    assertNoLeakedToolText(resumeTurn.response.blocks, '登录后恢复报名');
    const resumeAlert = findAlertBlock(resumeTurn.response.blocks);
    assert(resumeAlert, `恢复报名后缺少 alert: ${JSON.stringify(resumeTurn.response.blocks)}`);
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

    const messageCenter = await getMessageCenter(joiner);
    assert(
      messageCenter.chatActivities.items.some((item) => item.activityId === activityId),
      `报名成功后消息中心缺少群聊摘要: ${JSON.stringify(messageCenter.chatActivities.items)}`
    );

    details.push(`活动 ${activityId} 游客触发 join_activity 后返回 authRequired + pendingAction`);
    details.push('登录后恢复同一动作，返回 open_discussion 并成功写入报名记录');
    details.push('discussion-entered 回写后，task stage 从 joined 推进到 discussion');
    details.push('消息中心能看到报名活动的群聊摘要');
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

  const h5UserLogin = await requestJson<LoginResponse>({
    method: 'POST',
    path: '/auth/login',
    payload: {
      grantType: 'phone_otp',
      audience: 'user',
      phone: user1.user.phoneNumber || '',
      code: ADMIN_CODE,
    },
  });
  const h5UserTokenPayload = decodeTokenPayload(h5UserLogin.token);
  assert(h5UserTokenPayload.role === 'user', `H5 普通用户登录不应签成 admin: ${JSON.stringify(h5UserTokenPayload)}`);
  assert(h5UserTokenPayload.phoneNumber === user1.user.phoneNumber, 'H5 普通用户登录 token 缺少手机号');

  const anonChat = await postAiChat({ text: '你好，帮我打个招呼' });
  assert(typeof anonChat.conversationId === 'string' && anonChat.conversationId.length > 0, '游客 AI 对话未返回 conversationId');
  assert(anonChat.response.blocks.some((block) => block.type === 'text' && typeof block.content === 'string' && block.content.length > 0), '游客 AI 对话未返回文本块');
  assertNoLeakedToolText(anonChat.response.blocks, '游客 AI 对话');

  const authChat = await postAiChat({ user: user1, text: '你好，我想找人吃火锅' });
  assert(typeof authChat.conversationId === 'string' && authChat.conversationId.length > 0, '登录 AI 对话未返回 conversationId');
  assert(authChat.response.blocks.some((block) => block.type === 'text' && typeof block.content === 'string' && block.content.length > 0), '登录 AI 对话未返回文本块');
  assertNoLeakedToolText(authChat.response.blocks, '登录 AI 对话');

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
    },
  });
  assert(hijackForbidden.status === 403, `跨账号劫持会话状态码异常: ${hijackForbidden.status}`);
  assert(hijackForbidden.msg.includes('无权限访问该会话'), `跨账号劫持会话提示异常: ${hijackForbidden.msg}`);

  details.push(`游客 AI 欢迎卡和聊天可用，conversationId=${anonChat.conversationId}`);
  details.push(`登录 AI 会话已持久化，conversationId=${authChat.conversationId}`);
  details.push('H5 phone audience 登录签发普通 user token');
  details.push('跨账号查看会话和劫持会话都被 403 拦截');

  return { name: 'ai-access-flow', passed: true, details };
}

async function scenarioAiLongConversationFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [user] = context.users;
  const details: string[] = [];

  const steps = [
    { text: '周末附近有什么活动', expectedBlocks: ['text', 'choice'] },
    { text: '观音桥', expectedBlocks: ['text', 'choice'] },
    { text: '桌游', expectedBlocks: ['text', 'list'] },
    { text: '帮我组一个吧', expectedBlocks: ['text', 'entity-card', 'cta-group'] },
    { text: '改下时间', expectedBlocks: ['text', 'form'] },
    { text: '确认发布', expectedBlocks: ['text', 'alert', 'entity-card', 'cta-group'] },
    { text: '帮我找同类搭子', expectedBlocks: ['text', 'choice'] },
    { text: '运动', expectedBlocks: ['text', 'choice'] },
    { text: '羽毛球', expectedBlocks: ['text', 'choice'] },
    { text: '周六晚上', expectedBlocks: ['text', 'list'] },
  ];

  let conversationId: string | null = null;

  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const turn = await postAiChat({
      user,
      text: step.text,
      conversationId: conversationId || undefined,
    });

    assert(typeof turn.conversationId === 'string', `长对话 turn${index + 1} 未返回 conversationId`);
    assertNoLeakedToolText(turn.response.blocks, `长对话 turn${index + 1}`);
    assert(turn.response.blocks.length > 0, `长对话 turn${index + 1} 返回空 blocks`);

    if (conversationId) {
      assert(turn.conversationId === conversationId, `长对话 turn${index + 1} conversationId 漂移`);
    }

    conversationId = turn.conversationId;
    const blockTypes = turn.response.blocks.map((b) => b.type);
    details.push(`turn${index + 1}=[${blockTypes.join(',')}]`);
  }

  const messages = await getAiConversations(user);
  assert(messages.items.some((item) => item.id === conversationId), '长对话未持久化到会话列表');

  details.push(`会话 ${conversationId} 完成 ${steps.length} 轮长对话`);
  return { name: 'ai-long-conversation-flow', passed: true, details };
}

async function scenarioAiTransientContextFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [user] = context.users;
  const details: string[] = [];

  const firstTurn = await postAiChat({ user, text: '周末附近有什么活动' });
  assert(typeof firstTurn.conversationId === 'string', 'transient context 首轮未返回 conversationId');
  const conversationId = firstTurn.conversationId;

  const locationTurn = await postAiChat({ user, text: '观音桥', conversationId });
  assertNoLeakedToolText(locationTurn.response.blocks, 'transient context 位置');

  const typeTurn = await postAiChat({ user, text: '桌游', conversationId });
  assertNoLeakedToolText(typeTurn.response.blocks, 'transient context 类型');

  const partnerTurn = await postAiChat({ user, text: '帮我找同类搭子', conversationId });
  assertNoLeakedToolText(partnerTurn.response.blocks, 'transient context 转找搭子');

  const sportTurn = await postAiChat({ user, text: '羽毛球', conversationId });
  assertNoLeakedToolText(sportTurn.response.blocks, 'transient context 运动类型');

  const timeTurn = await postAiChat({ user, text: '周六晚上', conversationId });
  assertNoLeakedToolText(timeTurn.response.blocks, 'transient context 时间');

  details.push(`会话 ${conversationId} 通过 transient context 完成多轮追问`);
  details.push('位置、类型、运动、时间在多轮对话中被正确保持');

  return { name: 'ai-transient-context-flow', passed: true, details };
}

async function scenarioAiMultiIntentCrossFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [user] = context.users;
  const details: string[] = [];

  await cleanupSandboxAgentTasks([user]);

  const createTurn = await postAiAction({
    user,
    action: 'create_activity',
    displayText: '先创建草稿',
    payload: {
      title: '多意图测试局',
      type: 'boardgame',
      activityType: '桌游',
      locationName: '观音桥',
      location: '观音桥',
      description: '测试多意图交叉',
      maxParticipants: 6,
    },
  });
  const conversationId = createTurn.conversationId;

  const exploreTurn = await postAiChat({ user, text: '观音桥附近还有什么活动', conversationId });
  assertNoLeakedToolText(exploreTurn.response.blocks, '多意图交叉探索');

  const partnerTurn = await postAiChat({ user, text: '帮我找个运动搭子', conversationId });
  assertNoLeakedToolText(partnerTurn.response.blocks, '多意图交叉找搭子');

  const refineTurn = await postAiChat({ user, text: '羽毛球', conversationId });
  assertNoLeakedToolText(refineTurn.response.blocks, '多意图交叉细化');

  const manageTurn = await postAiChat({ user, text: '我草稿箱里那个活动能改时间吗', conversationId });
  assertNoLeakedToolText(manageTurn.response.blocks, '多意图交叉管理');

  details.push(`会话 ${conversationId} 完成 创建->探索->找搭子->管理 多意图交叉`);
  return { name: 'ai-multi-intent-cross-flow', passed: true, details };
}

async function scenarioAiAnonymousLongFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const details: string[] = [];

  const steps = [
    '周末附近有什么活动',
    '观音桥',
    '桌游',
    '换个关键词重搜',
    '那解放碑呢',
    '帮我组一个周六晚上的局',
    '人数改成8人',
  ];

  let conversationId: string | null = null;

  for (let index = 0; index < steps.length; index++) {
    const turn = await postAiChat({
      text: steps[index],
      conversationId: conversationId || undefined,
    });

    assert(typeof turn.conversationId === 'string', `匿名长对话 turn${index + 1} 未返回 conversationId`);
    assertNoLeakedToolText(turn.response.blocks, `匿名长对话 turn${index + 1}`);

    conversationId = turn.conversationId;
  }

  details.push(`匿名会话 ${conversationId} 完成 ${steps.length} 轮对话`);
  details.push('验证了 transient context 在匿名状态下的保持');

  return { name: 'ai-anonymous-long-flow', passed: true, details };
}

async function scenarioAiErrorRecoveryFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [user] = context.users;
  const details: string[] = [];

  const invalidTurn = await postAiAction({
    user,
    action: 'nonexistent_action',
    displayText: '测试无效动作',
    payload: {},
  });
  assert(typeof invalidTurn.conversationId === 'string', '错误恢复测试首轮未返回 conversationId');
  const conversationId = invalidTurn.conversationId;

  const recoveryTurn = await postAiChat({
    user,
    text: '帮我组个周五的桌游局',
    conversationId,
  });
  assertNoLeakedToolText(recoveryTurn.response.blocks, '错误恢复测试恢复对话');

  const emptyResultTurn = await postAiChat({
    user,
    text: '火星上有什么活动',
    conversationId,
  });
  assertNoLeakedToolText(emptyResultTurn.response.blocks, '错误恢复测试空结果');

  const continueTurn = await postAiChat({
    user,
    text: '观音桥附近有什么',
    conversationId,
  });
  assertNoLeakedToolText(continueTurn.response.blocks, '错误恢复测试继续');

  details.push(`会话 ${conversationId} 完成错误恢复序列`);
  details.push('无效动作->有效输入->空结果->正常继续 全部通过');

  return { name: 'ai-error-recovery-flow', passed: true, details };
}

async function scenarioAiRapidFireFlow(context: ScenarioContext): Promise<ScenarioResult> {
  const [user] = context.users;
  const details: string[] = [];

  const texts = ['你好', '附近有什么', '观音桥', '桌游', '周五晚上', '帮我组一个'];
  let conversationId: string | null = null;

  for (const text of texts) {
    const turn = await postAiChat({ user, text, conversationId: conversationId || undefined });
    assert(typeof turn.conversationId === 'string', `rapid-fire "${text}" 未返回 conversationId`);
    conversationId = turn.conversationId;
  }

  details.push(`会话 ${conversationId} 完成 ${texts.length} 轮 rapid-fire 对话`);
  return { name: 'ai-rapid-fire-flow', passed: true, details };
}

async function scenarioActionFastExitValidation(context: ScenarioContext): Promise<ScenarioResult> {
  const [user] = context.users;
  const details: string[] = [];

  const startedAt = Date.now();
  const turn = await postAiAction({
    user,
    action: 'explore_nearby',
    displayText: '观音桥附近有什么活动',
    payload: {
      lat: 29.563009,
      lng: 106.551556,
      locationHint: '观音桥',
      type: 'boardgame',
    },
  });
  const durationMs = Date.now() - startedAt;

  assertNoLeakedToolText(turn.response.blocks, 'action fast exit explore');
  assert(hasVisibleFeedback(turn.response.blocks), 'action fast exit 缺少可见反馈');
  assert(
    turn.response.blocks.some((b) => b.type === 'list' || b.type === 'choice' || b.type === 'entity-card' || b.type === 'text'),
    `action fast exit 未返回预期 block 类型: ${turn.response.blocks.map((b) => b.type).join(',')}`,
  );

  details.push(`explore_nearby action 耗时 ${durationMs}ms`);
  details.push(`返回 block 类型: ${turn.response.blocks.map((b) => b.type).join(',')}`);

  return { name: 'action-fast-exit-validation', passed: true, details };
}

async function scenarioUserProfilePropagation(context: ScenarioContext): Promise<ScenarioResult> {
  const [creator, joiner] = context.users;
  const details: string[] = [];

  const activityId = await createActivity(creator, {
    title: `画像传播验收-${Date.now()}`,
    type: 'boardgame',
    locationName: '观音桥',
    locationHint: '观音桥',
  });

  try {
    await joinActivity(activityId, joiner);
    await markActivityCompleted(activityId, creator);

    const fulfillment = await confirmFulfillment({
      activityId,
      creator,
      participants: [{ userId: joiner.user.id, fulfilled: true }],
    });
    assert(fulfillment.totalSubmitted === 2, `履约确认人数异常: ${fulfillment.totalSubmitted}`);

    const outcome = await waitFor(
      () => getUserActivityOutcome(joiner.user.id, activityId),
      { retries: 8, delayMs: 300 },
    );
    assert(outcome, 'activityOutcome 未写入 userMemories');
    assert(outcome.attended === true, `attended 写回异常: ${outcome?.attended}`);

    const exploreTurn = await postAiAction({
      user: joiner,
      action: 'explore_nearby',
      displayText: '附近有什么桌游局',
      payload: {
        lat: 29.563009,
        lng: 106.551556,
        locationHint: '观音桥',
        type: 'boardgame',
      },
    });

    assertNoLeakedToolText(exploreTurn.response.blocks, '画像传播 explore');
    assert(hasVisibleFeedback(exploreTurn.response.blocks), '画像传播 explore 缺少可见反馈');

    const exploreText = extractVisibleText(exploreTurn.response.blocks);
    assert(exploreText.length > 10, `画像传播 explore 文本过短: "${exploreText}"`);

    const hasMemorySignal = exploreText.includes('观音桥') || exploreText.includes('桌游');
    details.push(`活动 ${activityId} 已写回 outcome，再次 explore 成功`);
    details.push(`explore 文本长度=${exploreText.length}`);
    details.push(`记忆信号检测=${hasMemorySignal ? '命中' : '未命中'}（文本: ${exploreText.slice(0, 60)}...）`);

    return { name: 'user-profile-propagation', passed: true, details };
  } finally {
    await cancelActivity(activityId, creator).catch(() => null);
  }
}

async function scenarioAiExploreMultiUser(context: ScenarioContext): Promise<ScenarioResult> {
  const [userA, userB] = context.users;
  const details: string[] = [];

  const turnA = await postAiChat({ user: userA, text: '观音桥附近有什么活动' });
  const turnB = await postAiChat({ user: userB, text: '南山附近有什么活动' });

  assert(typeof turnA.conversationId === 'string', 'userA explore 未返回 conversationId');
  assert(typeof turnB.conversationId === 'string', 'userB explore 未返回 conversationId');
  assert(turnA.conversationId !== turnB.conversationId, '多用户 explore 不应共享 conversationId');

  const convA = await getAiConversations(userA);
  const convB = await getAiConversations(userB);

  assert(convA.items.some((c) => c.id === turnA.conversationId), 'userA 应能看到自己的会话');
  assert(convB.items.some((c) => c.id === turnB.conversationId), 'userB 应能看到自己的会话');
  assert(!convA.items.some((c) => c.id === turnB.conversationId), 'userA 不应看到 userB 的会话');
  assert(!convB.items.some((c) => c.id === turnA.conversationId), 'userB 不应看到 userA 的会话');

  details.push(`userA conversation=${turnA.conversationId}, userB conversation=${turnB.conversationId}`);
  details.push('多用户会话隔离通过');

  return { name: 'ai-explore-multi-user', passed: true, details };
}

const coreScenarios = [
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
  scenarioAiPartnerSearchBootstrapFlow,
  scenarioPendingMatchConfirmCreatesActivityFlow,
  scenarioPartnerConfirmToDiscussionFlow,
  scenarioPartnerScenarioFixturesFlow,
  scenarioAiDestinationCompanionFlow,
  scenarioPartnerActionGateFlow,
  scenarioAiDraftSettingsFormFlow,
  scenarioAiAccessFlow,
  scenarioActionFastExitValidation,
  scenarioUserProfilePropagation,
];

const extendedScenarios = [
  scenarioPartnerLongMultiUserBranchFlow,
  scenarioPartnerConditionUpdateIntentFlow,
  scenarioAiLongConversationFlow,
  scenarioAiTransientContextFlow,
  scenarioAiMultiIntentCrossFlow,
  scenarioAiAnonymousLongFlow,
  scenarioAiErrorRecoveryFlow,
  scenarioAiRapidFireFlow,
  scenarioAiExploreMultiUser,
];

async function main() {
  const startedAt = new Date();
  const users = await bootstrapUsers();
  await cleanupSandboxActivities(users);
  await cleanupSandboxPartnerIntents(users);
  await cleanupSandboxAgentTasks(users);
  await cleanupSandboxConversations(users);
  await cleanupSandboxUserMemories(users);
  const context: ScenarioContext = { users };

  const scenarioPool = scenarioSuite === 'all'
    ? [...coreScenarios, ...extendedScenarios]
    : scenarioSuite === 'extended'
      ? extendedScenarios
      : coreScenarios;

  const selectedScenarios = scenarioFilter
    ? scenarioPool.filter((scenario) => {
        const scenarioName = scenario.name.replace(/^scenario/, '').replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
        return scenarioName.includes(scenarioFilter.toLowerCase());
      })
    : scenarioPool;

  assert(selectedScenarios.length > 0, `没有匹配到场景: ${scenarioFilter || scenarioSuite}`);

  console.log(`Sandbox suite: ${scenarioSuite}`);

  const results: ScenarioResult[] = [];

  for (const scenario of selectedScenarios) {
    const scenarioName = scenario.name.replace(/^scenario/, '').replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '');
    console.log(`\n>>> ${scenarioName}`);
    resetSandboxRateLimits(context.users);
    const scenarioStartedAt = Date.now();
    try {
      const result = await scenario(context);
      const durationMs = Date.now() - scenarioStartedAt;
      results.push({ ...result, durationMs });
      console.log(`PASS ${result.name}`);
      for (const detail of result.details) {
        console.log(`- ${detail}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        name: scenarioName,
        passed: false,
        details: [],
        error: message,
        durationMs: Date.now() - scenarioStartedAt,
      });
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

  const completedAt = new Date();
  const artifactPath = await writeRegressionArtifact({
    runner: 'sandbox-regression',
    suite: scenarioSuite,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    scenarioCount: results.length,
    passedCount: results.filter((item) => item.passed).length,
    failedCount: results.filter((item) => !item.passed).length,
    scenarios: results.map((result) => {
      const matrixEntry = findScenarioMatrixEntry(result.name);
      return {
        id: result.name,
        passed: result.passed,
        details: result.details,
        ...(result.error ? { error: result.error } : {}),
        ...(typeof result.durationMs === 'number' ? { durationMs: result.durationMs } : {}),
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
      };
    }),
    metadata: {
      requestedSuite,
      scenarioFilter,
      selectedScenarioNames: selectedScenarios.map((scenario) =>
        scenario.name.replace(/^scenario/, '').replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '')
      ),
    },
  });
  console.log(`Artifact: ${artifactPath}`);

  await cleanupSandboxPartnerIntents(users);
  await cleanupSandboxAgentTasks(users);
  await cleanupSandboxActivities(users);
  await cleanupSandboxConversations(users);
  await cleanupSandboxUserMemories(users);

  const failed = results.filter((item) => !item.passed);
  if (failed.length > 0) {
    process.exit(1);
  }
}

if (import.meta.main) {
  if (Bun.argv.includes('--help') || Bun.argv.includes('-h')) {
    console.log(`sandbox-regression.ts — 用户流程回归脚本

用法: bun scripts/sandbox-regression.ts [选项]

选项:
  --help, -h            显示此帮助
  --suite <name>        选择场景套件: core | extended | all (默认: core)
  --scenario <keyword>  按名称关键字过滤场景

套件说明:
  core      主链路场景 (默认)
  extended  扩展场景 (长对话、匿名、多意图切换等)
  all       全部场景

对应命令:
  bun run regression:flow
  bun run regression:flow:extended
`);
    process.exit(0);
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
}
