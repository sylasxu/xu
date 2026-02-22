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
  center: { lat: number; lng: number; name: string };
  results: ExploreResultItem[];
  title: string;
  semanticQuery?: string;
}

/**
 * 将 ScoredActivity 转换为 ExploreResultItem
 */
function toExploreResultItem(scored: ScoredActivity): ExploreResultItem {
  const { activity, score, distance, matchReason } = scored;
  
  // 从 PostGIS point 提取经纬度
  const location = activity.location as unknown as { x: number; y: number } | null;
  
  return {
    id: activity.id,
    title: activity.title,
    type: activity.type,
    lat: location?.y ?? 0,
    lng: location?.x ?? 0,
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

/**
 * exploreNearby Tool 工厂
 */
export const exploreNearbyTool = createToolFactory<ExploreNearbyParams, ExploreData>({
  name: 'exploreNearby',
  description: '探索附近活动。支持语义搜索，返回匹配度最高的活动列表。',
  parameters: exploreNearbySchema,
  
  execute: async ({ center, semanticQuery, type, radius = 5 }, context) => {
    try {
      // 构建搜索查询
      // 如果没有 semanticQuery，使用地点名称作为默认查询
      const query = semanticQuery || `${center.name}附近的活动`;
      
      // 调用 RAG 语义搜索（传递 userId 用于 MaxSim 个性化）
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
        includeMatchReason: !!semanticQuery, // 有语义查询时才生成理由
        userId: context.userId, // v4.5: 传递 userId 用于 MaxSim 个性化
      });
      
      // 转换结果格式
      const results = scoredResults.map(toExploreResultItem);
      
      const title = results.length > 0 
        ? `为你找到${center.name}附近的 ${results.length} 个活动`
        : `${center.name}附近暂时没有活动`;

      if (results.length > REFERENCE_MODE_THRESHOLD) {
        // ── 引用模式：结果多时返回 fetchConfig，前端自主拉取 ──
        return {
          success: true as const,
          explore: {
            center,
            results: [],
            title,
            semanticQuery: semanticQuery || undefined,
          },
          fetchConfig: {
            source: 'nearby_activities',
            params: {
              lat: center.lat,
              lng: center.lng,
              radius: radius * 1000,
              ...(type ? { type } : {}),
            },
          } satisfies WidgetFetchConfig,
          preview: {
            total: results.length,
            firstItem: {
              id: results[0].id,
              title: results[0].title,
              type: results[0].type,
              locationName: results[0].locationName,
              distance: results[0].distance,
            },
          },
          interaction: {
            swipeable: true,
            halfScreenDetail: true,
            actions: [
              { type: 'join', label: '报名', params: {} },
              { type: 'share', label: '分享', params: {} },
            ],
          } satisfies WidgetInteraction,
        };
      }

      // ── 自包含模式：结果少时直接返回完整数据 ──
      return {
        success: true as const,
        explore: {
          center,
          results,
          title,
          semanticQuery: semanticQuery || undefined,
        },
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
