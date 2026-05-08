import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleStructuredAction } from '../user-action';
import { resolveFollowupActions } from '../shared/action-outcomes';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Structured Action Contracts', () => {
  it('keeps local execution failures on a deterministic local error path', async () => {
    const activityService = await import('../../activities/activity.service');
    vi.spyOn(activityService, 'joinActivity').mockRejectedValueOnce(new Error('报名入口暂时不可用'));

    const result = await handleStructuredAction(
      {
        action: 'join_activity',
        payload: {
          activityId: 'act_join_1',
        },
        source: 'structured_action_contract_test',
        originalText: '我想参加',
      },
      'user_join_1'
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('报名入口暂时不可用');
  });

  it('embeds partner search global actions with explicit reusable params', async () => {
    const partnerTools = await import('../tools/partner-tools');
    vi.spyOn(partnerTools, 'searchPartnerCandidates').mockResolvedValueOnce({
      success: true,
      items: [
        {
          intentId: 'intent_partner_1',
          userId: 'user_partner_1',
          nickname: '羽毛球搭子A',
          avatarUrl: null,
          typeName: '羽毛球搭子',
          scenarioType: 'local_partner',
          scenarioLabel: '本地搭子',
          locationHint: '观音桥',
          timePreference: '周六晚上',
          summary: '想找周六晚上一起打球的人',
          matchReason: '时间和地点都很接近',
          matchHighlights: ['时间接近', '地点接近'],
          compatibilitySummary: '本地搭子 · 区域在 观音桥 · 时间偏向 周六晚上',
          privacyHint: '确认前不会展示联系方式',
          score: 92,
          tags: ['周末', '羽毛球'],
        },
      ],
      total: 1,
      searchSummary: {
        total: 1,
        locationHint: '观音桥',
        timeHint: '周六晚上',
        scenarioType: 'local_partner',
        scenarioLabel: '本地搭子',
        stageLabel: '先搜一下',
        privacyHint: '候选结果只展示摘要，确认前不暴露联系方式',
      },
      nextAction: {
        type: 'opt_in_partner_pool',
        label: '继续帮我留意',
      },
      secondaryAction: {
        type: 'search_partners',
        label: '再看看其他人',
      },
    });

    const result = await handleStructuredAction(
      {
        action: 'search_partners',
        payload: {
          activityType: 'sports',
          sportType: 'badminton',
          locationName: '观音桥',
          locationHint: '观音桥',
          lat: 29.58567,
          lng: 106.52988,
          rawInput: '想找个周六晚上在观音桥打羽毛球的搭子',
          timePreference: 'weekend_evening',
        },
        source: 'structured_action_contract_test',
        originalText: '继续帮我找羽毛球搭子',
      },
      null
    );

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      partnerSearchResults: {
        searchSummary: {
          count: 1,
          locationHint: '观音桥',
          scenarioLabel: '本地搭子',
          stageLabel: '先搜一下',
          privacyHint: '候选结果只展示摘要，确认前不暴露联系方式',
        },
        items: [
          expect.objectContaining({
            scenarioLabel: '本地搭子',
            matchHighlights: ['时间接近', '地点接近'],
            compatibilitySummary: '本地搭子 · 区域在 观音桥 · 时间偏向 周六晚上',
            privacyHint: '确认前不会展示联系方式',
          }),
        ],
        primaryAction: {
          label: '继续帮我留意',
          action: 'opt_in_partner_pool',
          params: expect.objectContaining({
            activityType: 'sports',
            location: '观音桥',
            sportType: 'badminton',
          }),
        },
        secondaryAction: {
          label: '再看看其他人',
          action: 'search_partners',
          params: expect.objectContaining({
            activityType: 'sports',
            location: '观音桥',
            sportType: 'badminton',
          }),
        },
      },
    });
  });

  it('keeps confirm_publish next action minimal with activityId only', () => {
    const followups = resolveFollowupActions({
      actionType: 'save_draft_settings',
      data: {
        activityId: 'act_draft_1',
        draft: {
          title: '周五桌游局',
          type: 'boardgame',
          startAt: '2026-04-10T20:00:00.000Z',
          locationName: '观音桥',
          locationHint: '观音桥附近',
          maxParticipants: 6,
          currentParticipants: 1,
          location: [106.52988, 29.58567],
        },
      },
    });

    const confirmPublish = followups.find((item) => item.action === 'confirm_publish');

    expect(confirmPublish).toMatchObject({
      action: 'confirm_publish',
      params: {
        activityId: 'act_draft_1',
      },
    });
    expect(Object.keys(confirmPublish?.params || {})).toEqual(['activityId']);
  });
});
