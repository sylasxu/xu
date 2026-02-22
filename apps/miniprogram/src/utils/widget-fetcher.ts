/**
 * Widget Data Fetcher — Widget 引用模式数据获取工具
 *
 * 根据 WidgetDataSource 映射到对应的 Orval SDK API 调用。
 * 禁止使用 wx.request，所有请求通过 Orval SDK 发起。
 */

import { getActivitiesNearby, getActivitiesById } from '../api/endpoints/activities/activities';

export type FetchState = 'idle' | 'loading' | 'success' | 'error';

export interface FetchResult<T = unknown> {
  state: FetchState;
  data: T | null;
  error: string | null;
}

/** 数据源 → API 调用映射（按需扩展） */
const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  nearby_activities: async (params) => {
    const res = await getActivitiesNearby(params as any);
    if (res.status === 200) return res.data;
    throw new Error('获取附近活动失败');
  },
  activity_detail: async (params) => {
    const res = await getActivitiesById(params.id as string);
    if (res.status === 200) return res.data;
    throw new Error('获取活动详情失败');
  },
};

/**
 * 根据数据源和参数获取 Widget 数据
 */
export async function fetchWidgetData(
  source: string,
  params: Record<string, unknown>,
): Promise<FetchResult> {
  const handler = handlers[source];
  if (!handler) {
    return { state: 'error', data: null, error: `未知数据源: ${source}` };
  }
  try {
    const data = await handler(params);
    return { state: 'success', data, error: null };
  } catch (err) {
    return {
      state: 'error',
      data: null,
      error: err instanceof Error ? err.message : '数据加载失败',
    };
  }
}
