/**
 * Widget Data Fetcher — Widget 引用模式数据获取工具
 *
 * 根据 WidgetDataSource 映射到对应的 Orval SDK API 调用。
 * 禁止使用 wx.request，所有请求通过 Orval SDK 发起。
 */

import { getActivitiesNearby, getActivitiesById } from '../api/endpoints/activities/activities';
import type {
  ActivityDetailResponse,
  ActivityNearbyResponse,
  GetActivitiesNearbyParams,
} from '../api/model';

export type FetchState = 'idle' | 'loading' | 'success' | 'error';
export type WidgetDataSource = 'nearby_activities' | 'activity_detail';

export interface FetchResult<T = unknown> {
  state: FetchState;
  data: T | null;
  error: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNearbyType(value: unknown): GetActivitiesNearbyParams['type'] | undefined {
  switch (value) {
    case 'food':
    case 'entertainment':
    case 'sports':
    case 'boardgame':
    case 'other':
      return value;
    default:
      return undefined;
  }
}

function readNearbyParams(params: Record<string, unknown>): GetActivitiesNearbyParams | null {
  const lat = readNumber(params.lat);
  const lng = readNumber(params.lng);

  if (lat === null || lng === null) {
    return null;
  }

  const nearbyParams: GetActivitiesNearbyParams = { lat, lng };
  const keyword = readString(params.keyword);
  const type = readNearbyType(params.type);
  const radius = readNumber(params.radius);
  const limit = readNumber(params.limit);

  if (keyword) {
    nearbyParams.keyword = keyword;
  }
  if (type) {
    nearbyParams.type = type;
  }
  if (radius !== null) {
    nearbyParams.radius = radius;
  }
  if (limit !== null) {
    nearbyParams.limit = limit;
  }

  return nearbyParams;
}

function readActivityId(params: Record<string, unknown>): string | null {
  return readString(params.id);
}

async function fetchNearbyActivities(
  params: Record<string, unknown>,
): Promise<ActivityNearbyResponse['data']> {
  const requestParams = readNearbyParams(params);
  if (!requestParams) {
    throw new Error('附近活动参数无效');
  }

  const response = await getActivitiesNearby(requestParams);
  if (response.status === 200) {
    return response.data.data;
  }

  throw new Error('获取附近活动失败');
}

async function fetchActivityDetail(params: Record<string, unknown>): Promise<ActivityDetailResponse> {
  const activityId = readActivityId(params);
  if (!activityId) {
    throw new Error('活动 ID 无效');
  }

  const response = await getActivitiesById(activityId);
  if (response.status === 200) {
    return response.data;
  }

  throw new Error('获取活动详情失败');
}

/**
 * 根据数据源和参数获取 Widget 数据
 */
export async function fetchWidgetData(
  source: 'nearby_activities',
  params: Record<string, unknown>,
): Promise<FetchResult<ActivityNearbyResponse['data']>>;
export async function fetchWidgetData(
  source: 'activity_detail',
  params: Record<string, unknown>,
): Promise<FetchResult<ActivityDetailResponse>>;
export async function fetchWidgetData(
  source: WidgetDataSource,
  params: Record<string, unknown>,
): Promise<FetchResult<ActivityNearbyResponse['data'] | ActivityDetailResponse>>;
export async function fetchWidgetData(
  source: string,
  params: Record<string, unknown>,
): Promise<FetchResult> {
  try {
    if (!isRecord(params)) {
      return { state: 'error', data: null, error: '数据源参数无效' };
    }

    switch (source) {
      case 'nearby_activities': {
        const data = await fetchNearbyActivities(params);
        return { state: 'success', data, error: null };
      }
      case 'activity_detail': {
        const data = await fetchActivityDetail(params);
        return { state: 'success', data, error: null };
      }
      default:
        return { state: 'error', data: null, error: `未知数据源: ${source}` };
    }
  } catch (err) {
    return {
      state: 'error',
      data: null,
      error: err instanceof Error ? err.message : '数据加载失败',
    };
  }
}
