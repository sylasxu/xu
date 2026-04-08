/**
 * Widget Protocol — 聚场 Gen UI 协议层
 *
 * 定义 Widget 系统的数据获取和交互能力。
 * 所有 Widget 类型共享此协议，具体 Widget 按需使用。
 *
 * 三个正交维度：
 * - payload（必选）：Widget 数据，自包含模式下为完整数据，引用模式下为预览数据
 * - fetchConfig（可选）：数据源声明，存在时前端自主拉取完整数据
 * - interaction（可选）：交互能力声明，前端据此渲染交互元素
 */

import { t } from 'elysia';

// ── 数据源 ──

export type WidgetDataSource =
  | 'nearby_activities'
  | 'activity_detail'
  | 'my_activities'
  | 'activity_participants';

export interface WidgetFetchConfig {
  /** 数据源标识，映射到具体 API 端点 */
  source: WidgetDataSource;
  /** 传递给 API 的查询参数 */
  params: Record<string, unknown>;
}

// ── 交互能力 ──

export type WidgetActionType =
  | 'join'
  | 'cancel'
  | 'share'
  | 'detail'
  | 'publish'
  | 'confirm_match'
  | 'select'
  | 'skip';

export interface WidgetAction {
  type: WidgetActionType;
  label: string;
  params: Record<string, unknown>;
}

export interface WidgetInteraction {
  /** 是否支持水平滑动浏览 */
  swipeable?: boolean;
  /** 是否支持半屏详情弹出 */
  halfScreenDetail?: boolean;
  /** 卡内操作按钮 */
  actions?: WidgetAction[];
}

// ── TypeBox Schema（辅助类型，无对应 DB 表，允许手动定义） ──

export const WidgetFetchConfigSchema = t.Object({
  source: t.Union([
    t.Literal('nearby_activities'),
    t.Literal('activity_detail'),
    t.Literal('my_activities'),
    t.Literal('activity_participants'),
  ]),
  params: t.Record(t.String(), t.Unknown()),
});

export const WidgetActionSchema = t.Object({
  type: t.Union([
    t.Literal('join'),
    t.Literal('cancel'),
    t.Literal('share'),
    t.Literal('detail'),
    t.Literal('publish'),
    t.Literal('confirm_match'),
    t.Literal('select'),
    t.Literal('skip'),
  ]),
  label: t.String(),
  params: t.Record(t.String(), t.Unknown()),
});

export const WidgetInteractionSchema = t.Object({
  swipeable: t.Optional(t.Boolean()),
  halfScreenDetail: t.Optional(t.Boolean()),
  actions: t.Optional(t.Array(WidgetActionSchema)),
});
