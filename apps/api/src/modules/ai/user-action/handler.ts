/**
 * User Action Handler - 处理结构化用户操作
 * 
 * 跳过 LLM 意图识别，直接路由到对应 Service 执行
 */

import type { UserAction, UserActionType, ActionResult } from './types';
import { createLogger } from '../observability/logger';

// 复用现有 Service 函数
import { joinActivity, quitActivity, getActivityById } from '../../activities/activity.service';
import { search } from '../rag';
import { confirmMatch, cancelMatch } from '../tools/helpers/match';
import { buildCreateDraftParamsFromActionPayload, createActivityDraftRecord, publishActivityRecord } from '../tools/activity-tools';

const logger = createLogger('user-action');

/**
 * Action 到 Tool 的映射表
 */
const ACTION_HANDLERS: Record<UserActionType, {
  handler: (payload: Record<string, unknown>, userId: string | null) => Promise<ActionResult>;
  requiresAuth: boolean;
  description: string;
}> = {
  // 活动相关
  join_activity: {
    handler: handleJoinActivity,
    requiresAuth: true,
    description: '报名活动',
  },
  view_activity: {
    handler: handleViewActivity,
    requiresAuth: false,
    description: '查看活动详情',
  },
  cancel_join: {
    handler: handleCancelJoin,
    requiresAuth: true,
    description: '取消报名',
  },
  share_activity: {
    handler: handleShareActivity,
    requiresAuth: false,
    description: '分享活动',
  },
  
  // 创建相关
  create_activity: {
    handler: handleCreateActivity,
    requiresAuth: true,
    description: '创建活动',
  },
  edit_draft: {
    handler: handleEditDraft,
    requiresAuth: true,
    description: '编辑草稿',
  },
  publish_draft: {
    handler: handlePublishDraft,
    requiresAuth: true,
    description: '发布草稿',
  },
  confirm_publish: {
    handler: handlePublishDraft,
    requiresAuth: true,
    description: '确认发布',
  },
  
  // 探索相关
  explore_nearby: {
    handler: handleExploreNearby,
    requiresAuth: false,
    description: '探索附近',
  },
  expand_map: {
    handler: handleExpandMap,
    requiresAuth: false,
    description: '展开地图',
  },
  filter_activities: {
    handler: handleFilterActivities,
    requiresAuth: false,
    description: '筛选活动',
  },
  
  // 找搭子相关
  find_partner: {
    handler: handleFindPartner,
    requiresAuth: true,
    description: '找搭子',
  },
  confirm_match: {
    handler: handleConfirmMatch,
    requiresAuth: true,
    description: '确认匹配',
  },
  cancel_match: {
    handler: handleCancelMatch,
    requiresAuth: true,
    description: '取消匹配',
  },
  select_preference: {
    handler: handleSelectPreference,
    requiresAuth: false,
    description: '选择偏好',
  },
  skip_preference: {
    handler: handleSkipPreference,
    requiresAuth: false,
    description: '跳过偏好',
  },
  
  // 通用
  retry: {
    handler: handleRetry,
    requiresAuth: false,
    description: '重试',
  },
  cancel: {
    handler: handleCancel,
    requiresAuth: false,
    description: '取消',
  },
  quick_prompt: {
    handler: handleQuickPrompt,
    requiresAuth: false,
    description: '快捷提示词',
  },
};

/**
 * 处理 UserAction
 * 
 * @returns ActionResult，如果 fallbackToLLM=true 则需要回退到 LLM 处理
 */
export async function handleUserAction(
  action: UserAction,
  userId: string | null,
  location?: { lat: number; lng: number }
): Promise<ActionResult> {
  const startTime = Date.now();
  const { action: actionType, payload, source } = action;
  
  logger.info('Processing user action', { 
    actionType, 
    source, 
    userId: userId || 'anon',
    hasLocation: !!location,
  });
  
  // 查找处理器
  const handlerConfig = ACTION_HANDLERS[actionType];
  if (!handlerConfig) {
    logger.warn('Unknown action type', { actionType });
    return {
      success: false,
      fallbackToLLM: true,
      fallbackText: action.originalText || `执行 ${actionType}`,
    };
  }
  
  // 检查认证
  if (handlerConfig.requiresAuth && !userId) {
    logger.warn('Action requires auth', { actionType });
    return {
      success: false,
      error: '请先登录',
      data: { requiresAuth: true },
    };
  }
  
  try {
    // 注入位置信息到 payload
    const enrichedPayload = location 
      ? { ...payload, _location: location }
      : payload;
    
    const result = await handlerConfig.handler(enrichedPayload, userId);
    
    const duration = Date.now() - startTime;
    logger.info('User action completed', { 
      actionType, 
      success: result.success,
      duration,
      fallbackToLLM: result.fallbackToLLM,
    });
    
    return result;
  } catch (error: any) {
    logger.error('User action failed', { 
      actionType, 
      error: error.message,
    });
    
    return {
      success: false,
      error: error.message || '操作失败',
      fallbackToLLM: true,
      fallbackText: action.originalText,
    };
  }
}

// ============================================================================
// Action Handlers
// ============================================================================

function resolveActionLocation(payload: Record<string, unknown>): { lat: number; lng: number } | null {
  const embedded = payload._location;
  if (embedded && typeof embedded === 'object') {
    const record = embedded as Record<string, unknown>;
    const lat = typeof record.lat === 'number' ? record.lat : null;
    const lng = typeof record.lng === 'number' ? record.lng : null;
    if (lat !== null && lng !== null) {
      return { lat, lng };
    }
  }

  const center = payload.center;
  if (center && typeof center === 'object') {
    const record = center as Record<string, unknown>;
    const lat = typeof record.lat === 'number' ? record.lat : null;
    const lng = typeof record.lng === 'number' ? record.lng : null;
    if (lat !== null && lng !== null) {
      return { lat, lng };
    }
  }

  const lat = typeof payload.lat === 'number' ? payload.lat : null;
  const lng = typeof payload.lng === 'number' ? payload.lng : null;
  if (lat !== null && lng !== null) {
    return { lat, lng };
  }

  return null;
}

async function handleJoinActivity(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<ActionResult> {
  const activityId = payload.activityId as string;
  if (!activityId) {
    return { success: false, error: '缺少活动 ID' };
  }
  
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }
  
  try {
    // 调用现有的 activity.service 函数
    await joinActivity(activityId, userId);
    
    // 获取活动标题用于返回消息
    const activity = await getActivityById(activityId);
    
    return {
      success: true,
      data: {
        activityId,
        activityTitle: activity?.title,
        message: `报名成功！「${activity?.title || '活动'}」等你来～`,
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function handleViewActivity(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<ActionResult> {
  const activityId = payload.activityId as string;
  if (!activityId) {
    return { success: false, error: '缺少活动 ID' };
  }
  
  // 查看详情由前端处理跳转，这里只返回成功
  return {
    success: true,
    data: { 
      action: 'navigate',
      url: `/subpackages/activity/detail/index?id=${activityId}`,
    },
  };
}

async function handleCancelJoin(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<ActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }
  
  const activityId = payload.activityId as string;
  if (!activityId) {
    return { success: false, error: '缺少活动 ID' };
  }
  
  try {
    // 调用现有的 activity.service 函数
    await quitActivity(activityId, userId);
    
    return {
      success: true,
      data: {
        activityId,
        message: '已取消报名',
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function handleShareActivity(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<ActionResult> {
  const activityId = payload.activityId as string;
  if (!activityId) {
    return { success: false, error: '缺少活动 ID' };
  }
  
  // 分享由前端处理，这里返回分享数据
  return {
    success: true,
    data: {
      action: 'share',
      activityId,
      title: payload.title as string,
    },
  };
}

async function handleCreateActivity(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<ActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }

  const draftParams = buildCreateDraftParamsFromActionPayload(payload);
  const createResult = await createActivityDraftRecord(userId, draftParams);

  if (!createResult.success) {
    return {
      success: false,
      error: createResult.error,
    };
  }

  return {
    success: true,
    data: {
      activityId: createResult.activityId,
      draft: createResult.draft,
      locationName: createResult.draft.locationName,
      type: createResult.draft.type,
      message: createResult.message,
    },
  };
}

async function handleEditDraft(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<ActionResult> {
  const activityId = payload.activityId as string;
  const field = payload.field as string;
  
  // 编辑草稿需要 LLM 理解修改意图
  return {
    success: false,
    fallbackToLLM: true,
    fallbackText: field 
      ? `修改活动的${field}` 
      : `编辑活动 ${activityId}`,
  };
}

async function handlePublishDraft(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<ActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }
  
  const activityId = payload.activityId as string;
  if (!activityId) {
    return { success: false, error: '缺少活动 ID' };
  }

  const publishResult = await publishActivityRecord(userId, activityId);
  if (!publishResult.success) {
    return {
      success: false,
      error: publishResult.error,
    };
  }
  
  return {
    success: true,
    data: publishResult,
  };
}

async function handleExploreNearby(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<ActionResult> {
  const location = resolveActionLocation(payload);

  if (!location) {
    return { 
      success: false, 
      fallbackToLLM: true,
      fallbackText: '探索附近的活动',
    };
  }

  try {
    const locationName = (payload.locationName as string) || '附近';
    const radius = (payload.radiusKm as number) || 5;
    const type = payload.type as string | undefined;
    const semanticQuery = typeof payload.semanticQuery === 'string' && payload.semanticQuery.trim()
      ? payload.semanticQuery.trim()
      : `${locationName}附近的活动`;

    const scoredResults = await search({
      semanticQuery,
      filters: {
        location: {
          lat: location.lat,
          lng: location.lng,
          radiusInKm: radius,
        },
        type: type ?? undefined,
      },
      limit: 10,
      includeMatchReason: false,
      userId: userId ?? undefined,
    });

    const results = scoredResults.map(scored => {
      const { activity, score, distance } = scored;
      const loc = activity.location as unknown as { x: number; y: number } | null;

      return {
        id: activity.id,
        title: activity.title,
        type: activity.type,
        lat: loc?.y ?? 0,
        lng: loc?.x ?? 0,
        locationName: activity.locationName,
        distance: distance ? Math.round(distance) : 0,
        startAt: new Date(activity.startAt).toISOString(),
        currentParticipants: activity.currentParticipants,
        maxParticipants: activity.maxParticipants,
        score,
      };
    });

    const title = results.length > 0
      ? `为你找到${locationName}附近的 ${results.length} 个活动`
      : `${locationName}附近暂时没有合适的活动`;

    const message = results.length > 0
      ? `先给你看看${locationName}附近的局，顺眼的话点一个就能继续。`
      : `${locationName}附近暂时没有合适的局，我再给你几个下一步。`;

    return {
      success: true,
      data: {
        locationName,
        ...(type ? { type } : {}),
        message,
        explore: {
          center: { lat: location.lat, lng: location.lng, name: locationName },
          results,
          title,
          semanticQuery,
        },
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function handleExpandMap(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<ActionResult> {
  // 展开地图由前端处理
  return {
    success: true,
    data: {
      action: 'navigate',
      url: '/subpackages/activity/explore/index',
      params: payload,
    },
  };
}

async function handleFilterActivities(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<ActionResult> {
  // 筛选需要 LLM 理解筛选条件
  return {
    success: false,
    fallbackToLLM: true,
    fallbackText: `筛选${payload.type || ''}活动`,
  };
}

async function handleFindPartner(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<ActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }
  
  // 找搭子需要进入多轮对话流程
  return {
    success: false,
    fallbackToLLM: true,
    fallbackText: payload.type 
      ? `找${payload.type}搭子`
      : '找搭子',
  };
}

async function handleConfirmMatch(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<ActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }

  const matchId = payload.matchId as string;
  if (!matchId) {
    return { success: false, error: '缺少匹配 ID' };
  }

  const result = await confirmMatch(matchId, userId);
  if (!result.success) {
    return { success: false, error: result.error || '确认失败，请稍后再试' };
  }

  return {
    success: true,
    data: {
      matchId,
      activityId: result.activityId,
      message: '确认成功，已帮你把局组好，快去群聊里招呼大家～',
    },
  };
}

async function handleCancelMatch(
  payload: Record<string, unknown>,
  userId: string | null
): Promise<ActionResult> {
  if (!userId) {
    return { success: false, error: '请先登录', data: { requiresAuth: true } };
  }

  const matchId = payload.matchId as string;
  if (!matchId) {
    return { success: false, error: '缺少匹配 ID' };
  }

  const result = await cancelMatch(matchId, userId);
  if (!result.success) {
    return { success: false, error: result.error || '取消失败，请稍后再试' };
  }

  return {
    success: true,
    data: {
      matchId,
      message: '已取消这次匹配，你可以继续找更合适的搭子',
    },
  };
}

async function handleSelectPreference(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<ActionResult> {
  const selectedValue = (
    (typeof payload.selectedValue === 'string' && payload.selectedValue.trim())
      ? payload.selectedValue
      : (typeof payload.value === 'string' && payload.value.trim())
        ? payload.value
        : ''
  ) as string;
  const selectedLabel = (
    (typeof payload.selectedLabel === 'string' && payload.selectedLabel.trim())
      ? payload.selectedLabel
      : (typeof payload.label === 'string' && payload.label.trim())
        ? payload.label
        : ''
  ) as string;
  
  // 选择偏好后，用选中的标签作为用户输入继续对话
  return {
    success: false,
    fallbackToLLM: true,
    fallbackText: selectedLabel || selectedValue || '继续',
  };
}

async function handleSkipPreference(
  _payload: Record<string, unknown>,
  _userId: string | null
): Promise<ActionResult> {
  // 跳过偏好，用默认文本继续
  return {
    success: false,
    fallbackToLLM: true,
    fallbackText: '随便，你推荐吧',
  };
}

async function handleRetry(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<ActionResult> {
  const originalText = payload.originalText as string;
  
  return {
    success: false,
    fallbackToLLM: true,
    fallbackText: originalText || '重试',
  };
}

async function handleCancel(
  _payload: Record<string, unknown>,
  _userId: string | null
): Promise<ActionResult> {
  return {
    success: true,
    data: { action: 'cancelled' },
  };
}

async function handleQuickPrompt(
  payload: Record<string, unknown>,
  _userId: string | null
): Promise<ActionResult> {
  const prompt = payload.prompt as string;
  
  if (!prompt) {
    return { success: false, error: '缺少提示词' };
  }
  
  // 快捷提示词直接作为用户输入
  return {
    success: false,
    fallbackToLLM: true,
    fallbackText: prompt,
  };
}
