/**
 * exploreNearby Tool
 * 
 * 探索附近活动。当用户表达探索性意图时使用：
 * - "附近有什么好玩的"
 * - "推荐一下观音桥的活动"
 * - "有什么局可以参加"
 * - "想找人一起打羽毛球"
 * 
 * v4.5: 升级为 RAG 语义搜索
 * - 支持 semanticQuery 参数进行语义匹配
 * - 返回 matchReason 推荐理由
 * - 使用 createToolFactory 重构
 */

import { t } from 'elysia';
import type { Activity } from '@xu/db';
import { createToolFactory } from './create-tool';
import { search } from '../rag';
import type { ScoredActivity } from '../rag';
import type { WidgetFetchConfig, WidgetInteraction } from './widget-protocol';

/**
 * Tool Schema - 使用 TypeBox 语法
 */
const exploreNearbySchema = t.Object({
  center: t.Object({
    lat: t.Number({ description: '中心点纬度' }),
    lng: t.Number({ description: '中心点经度' }),
    name: t.String({ description: '地点名称，如"观音桥"' }),
  }, { description: '搜索中心点' }),
  semanticQuery: t.Optional(t.String({ 
    description: '语义搜索关键词，如"想找人一起打羽毛球"、"周末聚餐"。用于智能匹配活动',
  })),
  type: t.Optional(t.Union([
    t.Literal('food'),
    t.Literal('entertainment'),
    t.Literal('sports'),
    t.Literal('boardgame'),
    t.Literal('other'),
  ], { description: '活动类型筛选' })),
  radius: t.Optional(t.Number({ 
    default: 5, 
    description: '搜索半径（公里），默认 5',
  })),
});

/** 类型自动推导 */
type ExploreNearbyParams = typeof exploreNearbySchema.static;

/**
 * 探索结果项
 */
export interface ExploreResultItem {
  id: string;
  title: string;
  type: string;
  lat: number;
  lng: number;
  locationName: string;
  distance: number;
  startAt: string;
  currentParticipants: number;
  maxParticipants: number;
  score?: number;
  matchReason?: string;
}

/**
 * 探索结果
 */
export interface ExploreData {
  center?: { lat: number; lng: number; name: string };
  results: ExploreResultItem[];
  title: string;
  semanticQuery?: string;
  memoryHints?: string[];
}

export interface ExplorePreview {
  total: number;
  firstItem?: {
    id: string;
    title: string;
    type: string;
    locationName: string;
    distance: number;
  };
}

export interface ExploreNearbyResultPayload {
  locationName: string;
  type?: string;
  message: string;
  explore: ExploreData;
  memoryHints?: string[];
  fetchConfig?: WidgetFetchConfig;
  preview?: ExplorePreview;
  interaction?: WidgetInteraction;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readPointCoordinate(
  location: Record<string, unknown>,
  key: 'x' | 'y',
): number | null {
  const coordinate = location[key];
  return typeof coordinate === 'number' ? coordinate : null;
}

function readActivityPoint(location: Activity['location'] | null): {
  lat: number;
  lng: number;
} | null {
  if (!isRecord(location)) {
    return null;
  }

  const lng = readPointCoordinate(location, 'x');
  const lat = readPointCoordinate(location, 'y');

  if (lng === null || lat === null) {
    return null;
  }

  return { lat, lng };
}

/**
 * 将 ScoredActivity 转换为 ExploreResultItem
 */
function toExploreResultItem(scored: ScoredActivity): ExploreResultItem {
  const { activity, score, distance, matchReason } = scored;
  const point = readActivityPoint(activity.location);
  
  return {
    id: activity.id,
    title: activity.title,
    type: activity.type,
    lat: point?.lat ?? 0,
    lng: point?.lng ?? 0,
    locationName: activity.locationName,
    distance: distance ? Math.round(distance) : 0,
    startAt: new Date(activity.startAt).toISOString(),
    currentParticipants: activity.currentParticipants,
    maxParticipants: activity.maxParticipants,
    score,
    matchReason,
  };
}

/**
 * 引用模式阈值：结果超过此数量时切换到引用模式
 */
const REFERENCE_MODE_THRESHOLD = 5;

export function buildExploreNearbyResult(params: {
  center?: { lat: number; lng: number; name: string };
  locationName: string;
  results: ExploreResultItem[];
  radiusKm: number;
  semanticQuery?: string;
  type?: string;
  memoryHints?: string[];
}): ExploreNearbyResultPayload {
  const { center, locationName, results, radiusKm, semanticQuery, type, memoryHints } = params;
  const sanitizedLocationName = locationName.trim();
  const locationLabel = (sanitizedLocationName === 'current' || sanitizedLocationName === '当前位置'
    ? '你附近'
    : sanitizedLocationName) || center?.name || '附近';
  const title = results.length > 0
    ? `为你找到${locationLabel}附近的 ${results.length} 个活动`
    : `${locationLabel}附近暂时没有活动`;
  const message = results.length > 0
    ? `先帮你找了一批${locationLabel}附近的活动，你可以先看看有没有想继续了解的；如果想换条件，也可以直接告诉我。`
    : `${locationLabel}附近这会儿还没刷到合适的活动。你也可以直接告诉我想换的地方、时间、类型或预算，我继续帮你找。`;

  if (results.length > REFERENCE_MODE_THRESHOLD && center) {
    return {
      locationName: locationLabel,
      ...(type ? { type } : {}),
      ...(memoryHints && memoryHints.length > 0 ? { memoryHints } : {}),
      message,
      explore: {
        center,
        results: [],
        title,
        ...(semanticQuery ? { semanticQuery } : {}),
        ...(memoryHints && memoryHints.length > 0 ? { memoryHints } : {}),
      },
      fetchConfig: {
        source: 'nearby_activities',
        params: {
          lat: center.lat,
          lng: center.lng,
          radius: radiusKm * 1000,
          ...(type ? { type } : {}),
        },
      },
      preview: {
        total: results.length,
        ...(results[0]
          ? {
              firstItem: {
                id: results[0].id,
                title: results[0].title,
                type: results[0].type,
                locationName: results[0].locationName,
                distance: results[0].distance,
              },
            }
          : {}),
      },
      interaction: {
        swipeable: true,
        halfScreenDetail: true,
        actions: [
          { type: 'join', label: '报名', params: {} },
          { type: 'share', label: '分享', params: {} },
        ],
      },
    };
  }

  return {
    locationName: locationLabel,
    ...(type ? { type } : {}),
    ...(memoryHints && memoryHints.length > 0 ? { memoryHints } : {}),
    message,
    explore: {
      ...(center ? { center } : {}),
      results,
      title,
      ...(semanticQuery ? { semanticQuery } : {}),
      ...(memoryHints && memoryHints.length > 0 ? { memoryHints } : {}),
    },
    ...(results.length > 1 ? {
      interaction: {
        swipeable: true,
        halfScreenDetail: true,
        actions: [
          { type: 'join', label: '报名', params: {} },
          { type: 'share', label: '分享', params: {} },
        ],
      },
    } : {}),
  };
}

/**
 * exploreNearby Tool 工厂
 */
export const exploreNearbyTool = createToolFactory<ExploreNearbyParams, ExploreData>({
  name: 'exploreNearby',
  description: '探索附近活动。搜索中心点(center)是必需参数，必须包含用户明确指定的位置（如"观音桥"）。如果用户没有提供具体位置信息，不要调用此工具，而是调用 askPreference 询问位置。',
  parameters: exploreNearbySchema,
  
  execute: async ({ center, semanticQuery, type, radius = 5 }, context) => {
    try {
      let results: ExploreResultItem[] = [];

      // v5.3: 优先消费语义召回结果，避免重复 RAG 搜索
      const recalled = context.recalledActivities;
      if (recalled && recalled.length > 0) {
        // 按类型过滤并按相似度排序
        const filtered = recalled
          .filter((r) => !type || r.type === type)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, 10);

        results = filtered.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          lat: 0,
          lng: 0,
          locationName: r.locationHint ?? center.name,
          distance: 0,
          startAt: new Date(r.startAt).toISOString(),
          currentParticipants: 0,
          maxParticipants: 0,
          similarity: r.similarity,
        }));
      }

      // 召回结果为空时 fallback 到独立搜索
      if (results.length === 0) {
        const query = semanticQuery || `${center.name}附近的活动`;
        const scoredResults = await search({
          semanticQuery: query,
          filters: {
            location: {
              lat: center.lat,
              lng: center.lng,
              radiusInKm: radius,
            },
            type: type ?? undefined,
          },
          limit: 10,
          includeMatchReason: !!semanticQuery,
          userId: context.userId,
        });
        results = scoredResults.map(toExploreResultItem);
      }

      return {
        success: true as const,
        ...buildExploreNearbyResult({
          center,
          locationName: center.name,
          results,
          radiusKm: radius,
          ...(semanticQuery ? { semanticQuery } : {}),
          ...(type ? { type } : {}),
        }),
      };
    } catch (error) {
      console.error('[exploreNearby] Error:', error);
      return {
        success: false as const,
        error: '搜索失败，请再试一次',
      };
    }
  },
});
