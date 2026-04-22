// Participant Model - TypeBox schemas (MVP 简化版)
// 主要逻辑已移到 activities 模块，此模块仅保留辅助功能
import { ErrorResponseSchema, type ErrorResponse } from "../../common/common.model";
import { Elysia, t, type Static } from 'elysia';

/**
 * Participant Model Plugin (MVP 简化版)
 * 
 * MVP 中参与者管理已整合到 activities 模块：
 * - POST /activities/:id/join - 报名
 * - POST /activities/:id/quit - 退出
 * 
 * 此模块仅保留获取参与者列表的辅助接口
 */

// 参与者信息
export const ParticipantInfoSchema = t.Object({
  id: t.String(),
  userId: t.String(),
  status: t.String(),
  joinedAt: t.Union([t.String(), t.Null()]),
  user: t.Union([
    t.Object({
      id: t.String(),
      nickname: t.Union([t.String(), t.Null()]),
      avatarUrl: t.Union([t.String(), t.Null()]),
    }),
    t.Null(),
  ]),
});

// 履约确认条目
const FulfillmentParticipantSchema = t.Object({
  userId: t.String({ format: 'uuid', description: '参与者用户 ID' }),
  fulfilled: t.Boolean({ description: '是否到场' }),
});

// 发起人提交履约确认请求
const ConfirmFulfillmentRequest = t.Object({
  activityId: t.String({ format: 'uuid', description: '活动 ID' }),
  participants: t.Array(FulfillmentParticipantSchema, {
    minItems: 1,
    description: '参与者履约确认结果',
  }),
});

// 履约确认响应
const ConfirmFulfillmentResponse = t.Object({
  activityId: t.String(),
  attendedCount: t.Number({ description: '到场人数（不含发起人）' }),
  noShowCount: t.Number({ description: '未到场人数' }),
  totalSubmitted: t.Number({ description: '提交确认的参与者总数' }),
  msg: t.String(),
});

const RebookFollowUpRequest = t.Object({
  activityId: t.String({ format: 'uuid', description: '活动 ID' }),
});

const ActivitySelfFeedbackRequest = t.Object({
  activityId: t.String({ format: 'uuid', description: '活动 ID' }),
  feedback: t.Union([
    t.Literal('positive'),
    t.Literal('neutral'),
    t.Literal('failed'),
  ], { description: '活动后自反馈结果' }),
  reviewSummary: t.Optional(t.String({ minLength: 1, maxLength: 500, description: '可选复盘摘要' })),
});

const ActionResponse = t.Object({
  code: t.Number(),
  msg: t.String(),
});

const FeedbackProblemOption = t.Object({
  value: t.Union([
    t.Literal('late'),
    t.Literal('no_show'),
    t.Literal('bad_attitude'),
    t.Literal('not_as_described'),
    t.Literal('other'),
  ]),
  label: t.String(),
  icon: t.String(),
});

const FeedbackMetaResponse = t.Object({
  title: t.String(),
  positiveLabel: t.String(),
  negativeLabel: t.String(),
  problemSectionTitle: t.String(),
  nextStepLabel: t.String(),
  targetSectionTitle: t.String(),
  descriptionSectionTitle: t.String(),
  descriptionPlaceholder: t.String(),
  backLabel: t.String(),
  submitLabel: t.String(),
  problems: t.Array(FeedbackProblemOption),
  toast: t.Object({
    missingProblem: t.String(),
    missingTarget: t.String(),
    success: t.String(),
    failed: t.String(),
  }),
});

// 路径参数
const IdParams = t.Object({
  id: t.String({ format: 'uuid', description: '活动ID' }),
});


// 注册到 Elysia
export const participantModel = new Elysia({ name: 'participantModel' })
  .model({
    'participant.info': ParticipantInfoSchema,
    'participant.fulfillmentParticipant': FulfillmentParticipantSchema,
    'participant.confirmFulfillmentRequest': ConfirmFulfillmentRequest,
    'participant.confirmFulfillmentResponse': ConfirmFulfillmentResponse,
    'participant.rebookFollowUpRequest': RebookFollowUpRequest,
    'participant.activitySelfFeedbackRequest': ActivitySelfFeedbackRequest,
    'participant.actionResponse': ActionResponse,
    'participant.feedbackProblemOption': FeedbackProblemOption,
    'participant.feedbackMetaResponse': FeedbackMetaResponse,
    'participant.idParams': IdParams,
    'common.error': ErrorResponseSchema,
  });

// 导出 TS 类型
export type ParticipantInfo = Static<typeof ParticipantInfoSchema>;
export type FulfillmentParticipant = Static<typeof FulfillmentParticipantSchema>;
export type ConfirmFulfillmentRequest = Static<typeof ConfirmFulfillmentRequest>;
export type ConfirmFulfillmentResponse = Static<typeof ConfirmFulfillmentResponse>;
export type RebookFollowUpRequest = Static<typeof RebookFollowUpRequest>;
export type ActivitySelfFeedbackRequest = Static<typeof ActivitySelfFeedbackRequest>;
export type ActionResponse = Static<typeof ActionResponse>;
export type FeedbackProblemOption = Static<typeof FeedbackProblemOption>;
export type FeedbackMetaResponse = Static<typeof FeedbackMetaResponse>;
export type IdParams = Static<typeof IdParams>;
