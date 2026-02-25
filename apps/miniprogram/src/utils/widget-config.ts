/**
 * Widget 配置 — 小程序端集中映射
 *
 * 手动镜像 API 端 WIDGET_CATALOG 的 toolNames 配置
 * API 端 Catalog 为 Source of Truth，本文件为小程序端镜像
 *
 * 新增 Widget 类型时需同步更新此文件
 */

/** Tool→Widget 类型映射 */
export const TOOL_WIDGET_MAP: Record<string, string> = {
  createActivityDraft: 'widget_draft',
  getDraft: 'widget_draft',
  refineDraft: 'widget_draft',
  exploreNearby: 'widget_explore',
  getActivityDetail: 'widget_detail',
  publishActivity: 'widget_share',
  askPreference: 'widget_ask_preference',
}

/** 所有关联 Widget 的 Tool 名称 */
export const WIDGET_TOOL_NAMES: string[] = Object.keys(TOOL_WIDGET_MAP)
