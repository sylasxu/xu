#!/usr/bin/env bun

if (Bun.argv.includes('--help') || Bun.argv.includes('-h')) {
  console.log(`ten-user-world.ts — 10 用户交叉世界回归脚本

用法: bun scripts/ten-user-world.ts [选项]

选项:
  --help, -h    显示此帮助

说明:
  模拟 10 个用户在同一个产品世界中交叉活动：
  - 多活动创建、大规模报名与满员竞争
  - 讨论区并发、活动完成与履约确认
  - 找搭子匹配密度、消息中心聚合验证
  - 通知风暴、并发报名竞态

对应命令:
  bun run regression:ten-user
`);
  process.exit(0);
}

import {
  assert,
  sleep,
  waitFor,
  bootstrapUsers,
  createActivity,
  joinActivity,
  cancelActivity,
  markActivityCompleted,
  getPublicActivity,
  getActivityParticipants,
  getChatMessages,
  sendChatMessage,
  getNotifications,
  getUnreadCount,
  getMessageCenter,
  getPendingMatches,
  confirmPendingMatch,
  getAiCurrentTasks,
  confirmFulfillment,
  cleanupSandboxActivities,
  cleanupSandboxPartnerIntents,
  cleanupSandboxAgentTasks,
  cleanupSandboxConversations,
  cleanupSandboxUserMemories,
  resetSandboxRateLimits,
  hasVisibleFeedback,
  assertNoLeakedToolText,
  extractVisibleText,
  postAiAction,
  postAiChat,
  buildPartnerPayload,
  findCtaActionInput,
  buildCreatePayload,
  ADMIN_PHONE,
  ADMIN_CODE,
} from './regression-sandbox-utils';
import type {
  BootstrappedUser,
  ScenarioResult,
} from './regression-sandbox-utils';
import { writeRegressionArtifact } from './regression-artifact';
import { findScenarioMatrixEntry } from './regression-scenario-matrix';

const USER_COUNT = 10;

interface WorldPhaseResult {
  phase: string;
  passed: boolean;
  details: string[];
  error?: string;
  durationMs?: number;
}

async function bootstrapTenUsers(): Promise<BootstrappedUser[]> {
  return bootstrapUsers(USER_COUNT);
}

async function optInPartnerPoolFromSearch(user: BootstrappedUser, fixture: {
  rawInput: string;
  activityType: string;
  locationName: string;
  locationHint: string;
  lat: number;
  lng: number;
  description?: string;
  timePreference?: string;
}) {
  const firstTurn = await postAiAction({
    user,
    action: 'find_partner',
    displayText: fixture.rawInput,
    payload: buildPartnerPayload({
      ...fixture,
      id: `fixture_${user.user.id.slice(0, 6)}`,
      scenarioType: 'local_partner',
      locationKeywords: [fixture.locationHint],
      timeKeywords: [fixture.timePreference || ''],
      timePreference: fixture.timePreference || '',
    } as Parameters<typeof buildPartnerPayload>[0]),
  });

  assert(typeof firstTurn.conversationId === 'string' && firstTurn.conversationId.length > 0, '找搭子首轮未返回 conversationId');
  assertNoLeakedToolText(firstTurn.response.blocks, '找搭子首轮');

  const searchTurn = await postAiAction({
    user,
    action: 'search_partners',
    conversationId: firstTurn.conversationId,
    displayText: '先看看有没有合适的人',
    payload: buildPartnerPayload({
      ...fixture,
      id: `fixture_${user.user.id.slice(0, 6)}`,
      scenarioType: 'local_partner',
      locationKeywords: [fixture.locationHint],
      timeKeywords: [fixture.timePreference || ''],
      timePreference: fixture.timePreference || '',
    } as Parameters<typeof buildPartnerPayload>[0]),
  });

  assertNoLeakedToolText(searchTurn.response.blocks, '找搭子搜索结果');
  assert(hasVisibleFeedback(searchTurn.response.blocks), `找搭子搜索后缺少可见反馈: ${JSON.stringify(searchTurn.response.blocks)}`);

  const optInCta = findCtaActionInput(
    searchTurn.response.blocks,
    'opt_in_partner_pool',
    `ten_user_opt_in_${user.user.id.slice(0, 6)}`,
    '找搭子搜索结果',
  );

  const optInTurn = await postAiAction({
    user,
    action: 'opt_in_partner_pool',
    conversationId: firstTurn.conversationId,
    actionId: optInCta.actionId,
    displayText: optInCta.displayText,
    payload: buildPartnerPayload({
      ...fixture,
      id: `fixture_${user.user.id.slice(0, 6)}`,
      scenarioType: 'local_partner',
      locationKeywords: [fixture.locationHint],
      timeKeywords: [fixture.timePreference || ''],
      timePreference: fixture.timePreference || '',
    } as Parameters<typeof buildPartnerPayload>[0]),
  });

  assertNoLeakedToolText(optInTurn.response.blocks, '继续帮我留意');
  assert(hasVisibleFeedback(optInTurn.response.blocks), `继续帮我留意后缺少反馈: ${JSON.stringify(optInTurn.response.blocks)}`);

  return { conversationId: firstTurn.conversationId, optInTurn };
}

async function runTenUserWorld(): Promise<WorldPhaseResult[]> {
  const results: WorldPhaseResult[] = [];

  // ==================== Phase 1: 世界初始化 ====================
  const phase1StartedAt = Date.now();
  try {
    const users = await bootstrapTenUsers();
    await cleanupSandboxActivities(users);
    await cleanupSandboxPartnerIntents(users);
    await cleanupSandboxAgentTasks(users);
    await cleanupSandboxConversations(users);
    await cleanupSandboxUserMemories(users);
    resetSandboxRateLimits(users);

    results.push({
      phase: 'world-bootstrap',
      passed: true,
      details: [`${USER_COUNT} 个用户已初始化，沙盒数据已清理`],
      durationMs: Date.now() - phase1StartedAt,
    });

    const [u1, u2, u3, u4, u5, u6, u7, u8, u9, u10] = users;

    // ==================== Phase 2: 多活动创建 ====================
    const phase2StartedAt = Date.now();
    try {
      const boardgameId = await createActivity(u1, {
        title: `十人世界桌游局-${Date.now()}`,
        type: 'boardgame',
        locationName: '观音桥',
        locationHint: '观音桥',
        maxParticipants: 6,
      });
      const hotpotId = await createActivity(u2, {
        title: `十人世界火锅局-${Date.now()}`,
        type: 'food',
        locationName: '解放碑',
        locationHint: '解放碑',
        maxParticipants: 4,
      });
      const badmintonId = await createActivity(u3, {
        title: `十人世界羽毛球局-${Date.now()}`,
        type: 'sports',
        locationName: '南山',
        locationHint: '南山',
        maxParticipants: 5,
      });

      results.push({
        phase: 'multi-activity-creation',
        passed: true,
        details: [
          `桌游局 ${boardgameId} 创建成功（max 6）`,
          `火锅局 ${hotpotId} 创建成功（max 4）`,
          `羽毛球局 ${badmintonId} 创建成功（max 5）`,
        ],
        durationMs: Date.now() - phase2StartedAt,
      });

      // ==================== Phase 3: 大规模报名与满员竞争 ====================
      const phase3StartedAt = Date.now();
      try {
        // 桌游局（max 6， creator U1 自动加入占 1 席）：U4-U8（5人）报名 → 应全部成功
        const boardgameJoins = await Promise.all([
          joinActivity(boardgameId, u4),
          joinActivity(boardgameId, u5),
          joinActivity(boardgameId, u6),
          joinActivity(boardgameId, u7),
          joinActivity(boardgameId, u8),
        ]);
        for (let i = 0; i < boardgameJoins.length; i++) {
          assert(boardgameJoins[i].joinResult === 'joined', `桌游局 U${i + 4} 报名失败: ${JSON.stringify(boardgameJoins[i])}`);
        }

        // U9、U10 报名桌游局 → 应被满员拦截（进入候补）
        const u9Boardgame = await joinActivity(boardgameId, u9);
        const u10Boardgame = await joinActivity(boardgameId, u10);
        assert(
          u9Boardgame.joinResult === 'waitlisted' || u9Boardgame.joinResult === 'closed',
          `桌游局满员后 U9 应被拦截: ${JSON.stringify(u9Boardgame)}`,
        );
        assert(
          u10Boardgame.joinResult === 'waitlisted' || u10Boardgame.joinResult === 'closed',
          `桌游局满员后 U10 应被拦截: ${JSON.stringify(u10Boardgame)}`,
        );

        const publicBoardgame = await getPublicActivity(boardgameId);
        assert(publicBoardgame.currentParticipants === 6, `桌游局人数异常: ${publicBoardgame.currentParticipants}`);

        // 火锅局（max 4，creator U2 自动加入占 1 席）：U4-U6（3人）报名 → 应全部成功
        const hotpotJoins = await Promise.all([
          joinActivity(hotpotId, u4),
          joinActivity(hotpotId, u5),
          joinActivity(hotpotId, u6),
        ]);
        for (let i = 0; i < hotpotJoins.length; i++) {
          assert(hotpotJoins[i].joinResult === 'joined', `火锅局 U${i + 4} 报名失败: ${JSON.stringify(hotpotJoins[i])}`);
        }

        // U7 报名火锅局 → 应被满员拦截（进入候补）
        const u7Hotpot = await joinActivity(hotpotId, u7);
        assert(
          u7Hotpot.joinResult === 'waitlisted' || u7Hotpot.joinResult === 'closed',
          `火锅局满员后 U7 应被拦截: ${JSON.stringify(u7Hotpot)}`,
        );

        // 羽毛球局（max 5，creator U3 自动加入占 1 席）：U5-U8（4人）报名 → 交叉报名验证
        const badmintonJoins = await Promise.all([
          joinActivity(badmintonId, u5),
          joinActivity(badmintonId, u6),
          joinActivity(badmintonId, u7),
          joinActivity(badmintonId, u8),
        ]);
        for (let i = 0; i < badmintonJoins.length; i++) {
          assert(badmintonJoins[i].joinResult === 'joined', `羽毛球局 U${i + 5} 报名失败: ${JSON.stringify(badmintonJoins[i])}`);
        }

        // U5 同时参加桌游+羽毛球，验证状态独立
        const u5Activities = await getMessageCenter(u5);
        const u5ChatIds = u5Activities.chatActivities.items.map((a) => a.activityId);
        assert(u5ChatIds.includes(boardgameId), 'U5 消息中心应包含桌游局');
        assert(u5ChatIds.includes(badmintonId), 'U5 消息中心应包含羽毛球局');

        results.push({
          phase: 'mass-join-competition',
          passed: true,
          details: [
            `桌游局 6/6 满员（含创建者），U9/U10 被拦截（结果=${u9Boardgame.joinResult}/${u10Boardgame.joinResult}）`,
            `火锅局 4/4 满员（含创建者），U7 被拦截（结果=${u7Hotpot.joinResult}）`,
            `羽毛球局 5/5 满员（含创建者）`,
            `U5 交叉报名验证通过（桌游+羽毛球）`,
          ],
          durationMs: Date.now() - phase3StartedAt,
        });

        // ==================== Phase 4: 讨论区并发 ====================
        const phase4StartedAt = Date.now();
        try {
          await sendChatMessage(boardgameId, u1, '大家好，今晚桌游局准时开始！');
          await sendChatMessage(boardgameId, u4, '收到，我带零食。');
          await sendChatMessage(boardgameId, u5, '我教规则，大家别迟到。');
          await sendChatMessage(boardgameId, u6, 'OK，观音桥见。');

          await sendChatMessage(hotpotId, u2, '火锅局定金已付，大家按时到。');
          await sendChatMessage(hotpotId, u4, '好的，解放碑集合。');
          await sendChatMessage(hotpotId, u5, '我负责点鸳鸯锅。');
          await sendChatMessage(hotpotId, u6, '我带饮料。');

          const boardgameMessages = await getChatMessages(boardgameId, u4);
          const hotpotMessages = await getChatMessages(hotpotId, u4);

          assert(boardgameMessages.messages.length >= 8, `桌游局消息数过少: ${boardgameMessages.messages.length}`);
          assert(hotpotMessages.messages.length >= 7, `火锅局消息数过少: ${hotpotMessages.messages.length}`);

          // 验证消息按活动隔离
          assert(
            boardgameMessages.messages.some((m) => m.content.includes('桌游')),
            '桌游局讨论区应包含桌游相关消息',
          );
          assert(
            hotpotMessages.messages.some((m) => m.content.includes('火锅')),
            '火锅局讨论区应包含火锅相关消息',
          );

          results.push({
            phase: 'concurrent-discussion',
            passed: true,
            details: [
              `桌游局消息数=${boardgameMessages.messages.length}`,
              `火锅局消息数=${hotpotMessages.messages.length}`,
              '消息按活动隔离验证通过',
            ],
            durationMs: Date.now() - phase4StartedAt,
          });

          // ==================== Phase 5: 活动完成与真实结果写回 ====================
          const phase5StartedAt = Date.now();
          try {
            const completed = await markActivityCompleted(boardgameId, u1);
            assert(completed.success === true, `桌游局完成状态更新失败`);

            const participants = await getActivityParticipants(boardgameId);
            const joinedParticipants = participants.filter((p) => p.status === 'joined');
            assert(joinedParticipants.length === 6, `桌游局 joined 参与者数量异常: ${joinedParticipants.length}`);

            const fulfillment = await confirmFulfillment({
              activityId: boardgameId,
              creator: u1,
              participants: joinedParticipants.map((p) => ({
                userId: p.userId,
                fulfilled: true,
              })),
            });
            assert(fulfillment.noShowCount === 0, `履约确认缺席人数异常: ${fulfillment.noShowCount}`);
            assert(fulfillment.totalSubmitted === 6, `履约确认提交人数异常: ${fulfillment.totalSubmitted}`);

            results.push({
              phase: 'activity-completion-outcomes',
              passed: true,
              details: [
                `桌游局已完成，6 人全部 attended=true`,
                `confirm-fulfillment 提交=${fulfillment.totalSubmitted}，缺席=${fulfillment.noShowCount}`,
              ],
              durationMs: Date.now() - phase5StartedAt,
            });

            // ==================== Phase 6: 找搭子匹配密度 ====================
            const phase6StartedAt = Date.now();
            try {
              await cleanupSandboxAgentTasks([u8, u9, u10]);
              await cleanupSandboxPartnerIntents([u8, u9, u10]);

              await optInPartnerPoolFromSearch(u8, {
                rawInput: '观音桥桌游搭子',
                activityType: 'boardgame',
                locationName: '观音桥',
                locationHint: '观音桥',
                lat: 29.563009,
                lng: 106.551556,
                description: '找观音桥桌游搭子',
                timePreference: '周末',
              });
              await optInPartnerPoolFromSearch(u9, {
                rawInput: '观音桥桌游搭子',
                activityType: 'boardgame',
                locationName: '观音桥',
                locationHint: '观音桥',
                lat: 29.563009,
                lng: 106.551556,
                description: '找观音桥桌游搭子',
                timePreference: '周末',
              });
              await optInPartnerPoolFromSearch(u10, {
                rawInput: '南山羽毛球搭子',
                activityType: 'sports',
                sportType: 'badminton',
                locationName: '南山',
                locationHint: '南山',
                lat: 29.533009,
                lng: 106.601556,
                description: '找南山羽毛球搭子',
                timePreference: '周末',
              });

              // U8+U9 应生成待确认匹配（观音桥桌游）
              const u8Pending = await waitFor(async () => {
                const matches = await getPendingMatches(u8);
                return matches.items.find((m) => m.activityType === 'boardgame' && m.locationHint.includes('观音桥')) ?? null;
              }, { retries: 10, delayMs: 250 });
              assert(u8Pending, 'U8 和 U9 应生成观音桥桌游待确认匹配');
              assert(u8Pending.isTempOrganizer, 'U8 应是最早创建意向的 temp organizer');

              // U10 单人入池，不应有匹配
              const u10Pending = await getPendingMatches(u10);
              assert(
                !u10Pending.items.some((m) => m.activityType === 'sports' && m.locationHint.includes('南山')),
                'U10 单人入池不应生成南山羽毛球匹配',
              );

              // U8 确认匹配
              const confirmResult = await confirmPendingMatch(u8, u8Pending.id);
              assert(confirmResult.code === 200, `确认待确认匹配失败: ${JSON.stringify(confirmResult)}`);
              assert(typeof confirmResult.activityId === 'string', `确认匹配未返回 activityId`);

              // 验证 U8 和 U9 的 find_partner 任务收口
              const u8Tasks = await getAiCurrentTasks(u8);
              const u9Tasks = await getAiCurrentTasks(u9);
              assert(
                !u8Tasks.items.some((t) => t.taskType === 'find_partner'),
                'U8 确认匹配后 find_partner 任务应收口',
              );
              assert(
                !u9Tasks.items.some((t) => t.taskType === 'find_partner'),
                'U9 匹配成局后 find_partner 任务应收口',
              );

              results.push({
                phase: 'partner-matching-density',
                passed: true,
                details: [
                  `U8+U9 观音桥桌游生成待确认匹配 ${u8Pending.id}`,
                  `U10 南山羽毛球单人入池，无匹配`,
                  `U8 确认匹配后创建活动 ${confirmResult.activityId}`,
                  '双方 find_partner 任务已收口',
                ],
                durationMs: Date.now() - phase6StartedAt,
              });

              // ==================== Phase 7: 消息中心聚合验证 ====================
              const phase7StartedAt = Date.now();
              try {
                const u4Center = await getMessageCenter(u4);
                const u5Center = await getMessageCenter(u5);
                const u10Center = await getMessageCenter(u10);

                const u4ChatIds = u4Center.chatActivities.items.map((a) => a.activityId);
                const u5ChatIds = u5Center.chatActivities.items.map((a) => a.activityId);

                assert(u4ChatIds.includes(boardgameId), 'U4 消息中心应包含桌游局');
                assert(u4ChatIds.includes(hotpotId), 'U4 消息中心应包含火锅局');
                assert(!u4ChatIds.includes(badmintonId), 'U4 消息中心不应包含羽毛球局');

                assert(u5ChatIds.includes(boardgameId), 'U5 消息中心应包含桌游局');
                assert(u5ChatIds.includes(badmintonId), 'U5 消息中心应包含羽毛球局');
                assert(u5ChatIds.includes(hotpotId), 'U5 消息中心应包含火锅局');

                // U10 被桌游局拒绝、羽毛球局未匹配，但找搭子入池了
                // 消息中心不直接展示 find_partner 任务，pendingMatches 只在有匹配时才有
                assert(u10Center.chatActivities.items.length === 0, 'U10 未成功加入任何活动，chatActivities 应为空');
                const u10Tasks = await getAiCurrentTasks(u10);
                assert(
                  u10Tasks.items.some((t: any) => t.taskType === 'find_partner'),
                  'U10 找搭子入池后应有 active find_partner 任务',
                );

                results.push({
                  phase: 'message-center-aggregation',
                  passed: true,
                  details: [
                    `U4 chatActivities=${u4Center.chatActivities.items.length}（桌游+火锅）`,
                    `U5 chatActivities=${u5Center.chatActivities.items.length}（桌游+羽毛球+火锅）`,
                    `U10 chatActivities=0, find_partner 任务 active`,
                  ],
                  durationMs: Date.now() - phase7StartedAt,
                });

                // ==================== Phase 8: 通知风暴 ====================
                const phase8StartedAt = Date.now();
                try {
                  await cancelActivity(hotpotId, u2);

                  // 火锅局 joined 参与者 U4-U6 应收到取消通知（U7 是候补，不通知）
                  for (const user of [u4, u5, u6]) {
                    const notifications = await getNotifications(user);
                    const cancelNotif = notifications.items.find(
                      (n) => n.activityId === hotpotId && n.type === 'cancelled',
                    );
                    assert(cancelNotif, `${user.user.nickname || '用户'} 应收到火锅局取消通知`);
                  }

                  // U2（创建者）不应有未读取消通知
                  const u2Unread = await getUnreadCount(u2);
                  // U2 可能因 U4-U7 报名而有未读 join 通知，但不应因 cancel 而新增
                  // 这里只验证 U4 的未读数增加了
                  const u4Unread = await getUnreadCount(u4);
                  assert(u4Unread.count >= 1, 'U4 收到取消通知后未读数应大于等于 1');

                  results.push({
                    phase: 'notification-storm',
                    passed: true,
                    details: [
                      '火锅局取消，U4-U6 均收到 cancelled 通知（joined 参与者）',
                      `U4 未读数=${u4Unread.count}`,
                    ],
                    durationMs: Date.now() - phase8StartedAt,
                  });

                  // ==================== Phase 9: 并发报名竞态 ====================
                  const phase9StartedAt = Date.now();
                  try {
                    const raceActivityId = await createActivity(u3, {
                      title: `竞态测试局-${Date.now()}`,
                      type: 'food',
                      maxParticipants: 3,
                    });

                    // U4, U5 同时报名（Promise.all 模拟并发）
                    const [raceA, raceB] = await Promise.all([
                      joinActivity(raceActivityId, u4),
                      joinActivity(raceActivityId, u5),
                    ]);

                    assert(
                      raceA.joinResult === 'joined' && raceB.joinResult === 'joined',
                      `竞态报名应两人均成功: A=${raceA.joinResult}, B=${raceB.joinResult}`,
                    );

                    const publicRace = await getPublicActivity(raceActivityId);
                    assert(publicRace.currentParticipants === 3, `竞态局人数异常: ${publicRace.currentParticipants}`);

                    // U6 再报名 → 应被满员拦截（ creator U3 已占 1 席）
                    const raceC = await joinActivity(raceActivityId, u6);
                    assert(
                      raceC.joinResult === 'waitlisted' || raceC.joinResult === 'closed',
                      `竞态局满员后 U6 应被拦截: ${raceC.joinResult}`,
                    );

                    await cancelActivity(raceActivityId, u3);

                    results.push({
                      phase: 'concurrent-join-race',
                      passed: true,
                      details: [
                        `竞态局 U4+U5 同时报名均成功`,
                        `竞态局 U6 满员后被拦截（结果=${raceC.joinResult}）`,
                        `最终人数=${publicRace.currentParticipants}/3`,
                      ],
                      durationMs: Date.now() - phase9StartedAt,
                    });
                  } catch (error) {
                    results.push({
                      phase: 'concurrent-join-race',
                      passed: false,
                      details: [],
                      error: error instanceof Error ? error.message : String(error),
                      durationMs: Date.now() - phase9StartedAt,
                    });
                  }
                } catch (error) {
                  results.push({
                    phase: 'notification-storm',
                    passed: false,
                    details: [],
                    error: error instanceof Error ? error.message : String(error),
                    durationMs: Date.now() - phase8StartedAt,
                  });
                }
              } catch (error) {
                results.push({
                  phase: 'message-center-aggregation',
                  passed: false,
                  details: [],
                  error: error instanceof Error ? error.message : String(error),
                  durationMs: Date.now() - phase7StartedAt,
                });
              }
            } catch (error) {
              results.push({
                phase: 'partner-matching-density',
                passed: false,
                details: [],
                error: error instanceof Error ? error.message : String(error),
                durationMs: Date.now() - phase6StartedAt,
              });
            }
          } catch (error) {
            results.push({
              phase: 'activity-completion-outcomes',
              passed: false,
              details: [],
              error: error instanceof Error ? error.message : String(error),
              durationMs: Date.now() - phase5StartedAt,
            });
          }
        } catch (error) {
          results.push({
            phase: 'concurrent-discussion',
            passed: false,
            details: [],
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - phase4StartedAt,
          });
        }
      } catch (error) {
        results.push({
          phase: 'mass-join-competition',
          passed: false,
          details: [],
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - phase3StartedAt,
        });
      }
    } catch (error) {
      results.push({
        phase: 'multi-activity-creation',
        passed: false,
        details: [],
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - phase2StartedAt,
      });
    }

    // 收尾清理
    await cleanupSandboxPartnerIntents(users);
    await cleanupSandboxAgentTasks(users);
    await cleanupSandboxActivities(users);
    await cleanupSandboxConversations(users);
    await cleanupSandboxUserMemories(users);
  } catch (error) {
    results.push({
      phase: 'world-bootstrap',
      passed: false,
      details: [],
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - phase1StartedAt,
    });
  }

  return results;
}

async function main() {
  const startedAt = new Date();
  const results = await runTenUserWorld();
  const completedAt = new Date();

  console.log('\n=== Ten User World Summary ===');
  let totalPassed = 0;
  for (const result of results) {
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`- ${status} ${result.phase} (${result.durationMs}ms)`);
    if (result.error) {
      console.log(`  ${result.error}`);
    }
    for (const detail of result.details) {
      console.log(`  - ${detail}`);
    }
    if (result.passed) totalPassed++;
  }

  const artifactPath = await writeRegressionArtifact({
    runner: 'ten-user-world',
    suite: 'extended',
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    scenarioCount: results.length + 1,
    passedCount: totalPassed === results.length ? totalPassed + 1 : totalPassed,
    failedCount: results.length - totalPassed + (totalPassed === results.length ? 0 : 1),
    scenarios: [
      {
        id: 'ten-user-world',
        passed: totalPassed === results.length,
        details: [
          `${USER_COUNT} 个用户完成 ${results.length} 个交叉世界 phase`,
          ...results.map((result) => `${result.phase}: ${result.passed ? 'passed' : 'failed'}`),
        ],
        durationMs: completedAt.getTime() - startedAt.getTime(),
        matrix: findScenarioMatrixEntry('ten-user-world') ?? null,
      },
      ...results.map((r) => ({
        id: r.phase,
        passed: r.passed,
        details: r.details,
        ...(r.error ? { error: r.error } : {}),
        ...(typeof r.durationMs === 'number' ? { durationMs: r.durationMs } : {}),
      })),
    ],
    metadata: {
      phases: results.map((result) => result.phase),
    },
  });
  console.log(`\nArtifact: ${artifactPath}`);

  if (totalPassed < results.length) {
    process.exit(1);
  }

  process.exit(0);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`ten-user-world failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
