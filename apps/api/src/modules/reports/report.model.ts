// Report Model - TypeBox schemas for 内容审核
import { Elysia, t, type Static } from 'elysia';
import { ErrorResponseSchema, type ErrorResponse } from "../../common/common.model";

/**
 * Report Model Plugin
 * 举报模块 Schema 定义
 */

// ============ 枚举常量 ============

/** 举报类型枚举值 */
export const REPORT_TYPES = ['activity', 'message', 'user'] as const;
export type ReportType = typeof REPORT_TYPES[number];

/** 举报原因枚举值 */
export const REPORT_REASONS = ['inappropriate', 'fake', 'harassment', 'other'] as const;
export type ReportReason = typeof REPORT_REASONS[number];

/** 举报状态枚举值 */
export const REPORT_STATUSES = ['pending', 'resolved', 'ignored'] as const;
export type ReportStatus = typeof REPORT_STATUSES[number];

// ============ 类型守卫 ============

/** 类型守卫：检查是否为有效的举报类型 */
export function isReportType(value: string): value is ReportType {
  return REPORT_TYPES.includes(value as ReportType);
}

/** 类型守卫：检查是否为有效的举报原因 */
export function isReportReason(value: string): value is ReportReason {
  return REPORT_REASONS.includes(value as ReportReason);
}

/** 类型守卫：检查是否为有效的举报状态 */
export function isReportStatus(value: string): value is ReportStatus {
  return REPORT_STATUSES.includes(value as ReportStatus);
}

// ============ 请求 Schema ============

// 创建举报请求体
export const CreateReportRequestSchema = t.Object({
  type: t.Union([
    t.Literal('activity'),
    t.Literal('message'),
    t.Literal('user'),
  ], { description: '举报类型' }),
  reason: t.Union([
    t.Literal('inappropriate'),
    t.Literal('fake'),
    t.Literal('harassment'),
    t.Literal('other'),
  ], { description: '举报原因' }),
  description: t.Optional(t.String({ maxLength: 500, description: '举报说明（可选）' })),
  targetId: t.String({ format: 'uuid', description: '被举报的目标 ID' }),
});

// 举报列表查询参数（受保护查询）
export const ReportListQuerySchema = t.Object({
  page: t.Optional(t.Number({ minimum: 1, default: 1, description: '页码' })),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100, default: 20, description: '每页数量' })),
  status: t.Optional(t.Union([
    t.Literal('pending'),
    t.Literal('resolved'),
    t.Literal('ignored'),
  ], { description: '状态筛选' })),
  type: t.Optional(t.Union([
    t.Literal('activity'),
    t.Literal('message'),
    t.Literal('user'),
  ], { description: '类型筛选' })),
});

// 更新举报请求体（受保护处理）
export const UpdateReportRequestSchema = t.Object({
  status: t.Union([
    t.Literal('resolved'),
    t.Literal('ignored'),
  ], { description: '处理状态' }),
  adminNote: t.Optional(t.String({ maxLength: 1000, description: '处理备注' })),
});

// 路径参数
export const ReportIdParamsSchema = t.Object({
  id: t.String({ format: 'uuid', description: '举报 ID' }),
});

// ============ 响应 Schema ============

// 举报人信息
const ReporterInfoSchema = t.Object({
  id: t.String(),
  nickname: t.Union([t.String(), t.Null()]),
  avatarUrl: t.Union([t.String(), t.Null()]),
});

// 举报响应 (包含举报人信息)
export const ReportResponseSchema = t.Object({
  id: t.String(),
  type: t.String(),
  reason: t.String(),
  description: t.Union([t.String(), t.Null()]),
  targetId: t.String(),
  targetContent: t.String(),
  reporterId: t.String(),
  status: t.String(),
  adminNote: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
  resolvedAt: t.Union([t.String(), t.Null()]),
  resolvedBy: t.Union([t.String(), t.Null()]),
  reporter: t.Union([ReporterInfoSchema, t.Null()]),
});

// 举报列表响应
export const ReportListResponseSchema = t.Object({
  items: t.Array(ReportResponseSchema),
  total: t.Number({ description: '总数' }),
  page: t.Number({ description: '当前页码' }),
  limit: t.Number({ description: '每页数量' }),
});

// 成功响应
const SuccessResponseSchema = t.Object({
  code: t.Number(),
  msg: t.String(),
});

// 创建举报成功响应
const CreateReportSuccessSchema = t.Object({
  success: t.Literal(true),
  msg: t.String(),
  id: t.String({ description: '举报 ID' }),
});

// ============ 注册到 Elysia ============

export const reportModel = new Elysia({ name: 'reportModel' })
  .model({
    'report.createRequest': CreateReportRequestSchema,
    'report.listQuery': ReportListQuerySchema,
    'report.updateRequest': UpdateReportRequestSchema,
    'report.idParams': ReportIdParamsSchema,
    'report.response': ReportResponseSchema,
    'report.listResponse': ReportListResponseSchema,
    'report.error': ErrorResponseSchema,
    'common.error': ErrorResponseSchema,
    'report.success': SuccessResponseSchema,
    'report.createSuccess': CreateReportSuccessSchema,
  });

// ============ 导出 TS 类型 ============

export type CreateReportRequest = Static<typeof CreateReportRequestSchema>;
export type ReportListQuery = Static<typeof ReportListQuerySchema>;
export type UpdateReportRequest = Static<typeof UpdateReportRequestSchema>;
export type ReportIdParams = Static<typeof ReportIdParamsSchema>;
export type ReportResponse = Static<typeof ReportResponseSchema>;
export type ReportListResponse = Static<typeof ReportListResponseSchema>;
export type SuccessResponse = Static<typeof SuccessResponseSchema>;
