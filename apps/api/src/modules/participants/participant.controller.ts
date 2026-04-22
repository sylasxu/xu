// Participant Controller - 参与者辅助接口 (MVP 简化版)
// 主要逻辑已移到 activities 模块
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAuth, type ErrorResponse } from '../../setup';
import {
  participantModel,
  ParticipantInfoSchema,
  type FeedbackMetaResponse,
} from './participant.model';
import {
  getActivityParticipants,
  confirmActivityFulfillment,
  markActivityRebookFollowUp,
  recordActivitySelfFeedback,
} from './participant.service';
import { getConfigValue } from '../ai/config/config.service';

const DEFAULT_FEEDBACK_META: FeedbackMetaResponse = {
  title: '活动体验如何？',
  positiveLabel: '挺好的',
  negativeLabel: '有问题',
  problemSectionTitle: '遇到什么问题？',
  nextStepLabel: '下一步：选择反馈对象',
  targetSectionTitle: '选择反馈对象',
  descriptionSectionTitle: '补充说明（选填）',
  descriptionPlaceholder: '请描述具体情况...',
  backLabel: '返回',
  submitLabel: '提交反馈',
  problems: [
    { value: 'late', label: '迟到', icon: 'time' },
    { value: 'no_show', label: '放鸽子', icon: 'close-circle' },
    { value: 'bad_attitude', label: '态度不好', icon: 'dissatisfaction' },
    { value: 'not_as_described', label: '与描述不符', icon: 'error-circle' },
    { value: 'other', label: '其他问题', icon: 'ellipsis' },
  ],
  toast: {
    missingProblem: '请选择问题类型',
    missingTarget: '请选择反馈对象',
    success: '反馈已提交',
    failed: '提交失败',
  },
};

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeFeedbackMeta(raw: unknown): FeedbackMetaResponse {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_FEEDBACK_META;
  }

  const value = raw as Record<string, unknown>;
  const problemsSource = typeof value.problems === 'object' && value.problems !== null
    ? value.problems as Record<string, unknown>
    : {};
  const toastSource = typeof value.toast === 'object' && value.toast !== null
    ? value.toast as Record<string, unknown>
    : {};

  return {
    title: readString(value.title) ?? DEFAULT_FEEDBACK_META.title,
    positiveLabel: readString(value.positiveLabel) ?? DEFAULT_FEEDBACK_META.positiveLabel,
    negativeLabel: readString(value.negativeLabel) ?? DEFAULT_FEEDBACK_META.negativeLabel,
    problemSectionTitle: readString(value.problemSectionTitle) ?? DEFAULT_FEEDBACK_META.problemSectionTitle,
    nextStepLabel: readString(value.nextStepLabel) ?? DEFAULT_FEEDBACK_META.nextStepLabel,
    targetSectionTitle: readString(value.targetSectionTitle) ?? DEFAULT_FEEDBACK_META.targetSectionTitle,
    descriptionSectionTitle: readString(value.descriptionSectionTitle) ?? DEFAULT_FEEDBACK_META.descriptionSectionTitle,
    descriptionPlaceholder: readString(value.descriptionPlaceholder) ?? DEFAULT_FEEDBACK_META.descriptionPlaceholder,
    backLabel: readString(value.backLabel) ?? DEFAULT_FEEDBACK_META.backLabel,
    submitLabel: readString(value.submitLabel) ?? DEFAULT_FEEDBACK_META.submitLabel,
    problems: DEFAULT_FEEDBACK_META.problems.map((problem) => {
      const item = typeof problemsSource[problem.value] === 'object' && problemsSource[problem.value] !== null
        ? problemsSource[problem.value] as Record<string, unknown>
        : {};

      return {
        value: problem.value,
        label: readString(item.label) ?? problem.label,
        icon: readString(item.icon) ?? problem.icon,
      };
    }),
    toast: {
      missingProblem: readString(toastSource.missingProblem) ?? DEFAULT_FEEDBACK_META.toast.missingProblem,
      missingTarget: readString(toastSource.missingTarget) ?? DEFAULT_FEEDBACK_META.toast.missingTarget,
      success: readString(toastSource.success) ?? DEFAULT_FEEDBACK_META.toast.success,
      failed: readString(toastSource.failed) ?? DEFAULT_FEEDBACK_META.toast.failed,
    },
  };
}

export const participantController = new Elysia({ prefix: '/participants' })
  .use(basePlugins)
  .use(participantModel)

  // ==========================================
  // 公开接口（无需认证）
  // ==========================================
  // 获取活动参与者列表
  .get(
    '/feedback-meta',
    async () => {
      const raw = await getConfigValue<unknown>('ui.feedback', DEFAULT_FEEDBACK_META);
      return normalizeFeedbackMeta(raw);
    },
    {
      detail: {
        tags: ['Participants'],
        summary: '获取活动反馈 UI 元数据',
        description: '返回活动结束后反馈弹层所需的标题、问题类型、按钮文案与 toast 文案。',
      },
      response: {
        200: 'participant.feedbackMetaResponse',
      },
    }
  )

  .get(
    '/activity/:id',
    async ({ params, set }) => {
      try {
        const participantsList = await getActivityParticipants(params.id);
        return participantsList;
      } catch (error: any) {
        set.status = 500;
        return {
          code: 500,
          msg: error.message || '获取参与者列表失败',
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Participants'],
        summary: '获取活动参与者列表',
        description: '获取指定活动的参与者列表',
      },
      params: 'participant.idParams',
      response: {
        200: t.Array(ParticipantInfoSchema),
        500: 'common.error',
      },
    }
  )

  // ==========================================
  // 需要登录的接口
  // ==========================================
  // 发起人提交履约确认
  .post(
    '/confirm-fulfillment',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        return await confirmActivityFulfillment(user.id, body);
      } catch (error: any) {
        const message = error?.message || '履约确认失败';
        if (message === '活动不存在') {
          set.status = 404;
        } else if (message === '只有活动发起人可以确认履约') {
          set.status = 403;
        } else if (
          message === '请先将活动标记为已完成后再确认履约'
          || message === '当前活动暂无可确认的参与者'
          || message === '提交中包含非已报名参与者'
          || message === '提交中存在重复参与者'
          || message === '请完成所有已报名参与者的履约确认后再提交'
        ) {
          set.status = 400;
        } else {
          set.status = 500;
        }

        return {
          code: set.status,
          msg: message,
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Participants'],
        summary: '提交活动履约确认',
        description: '仅活动发起人可提交参与者到场情况。提交后将写入履约结果并生成系统消息。',
      },
      body: 'participant.confirmFulfillmentRequest',
      response: {
        200: 'participant.confirmFulfillmentResponse',
        400: 'common.error',
        401: 'common.error',
        403: 'common.error',
        404: 'common.error',
        500: 'common.error',
      },
    }
  )

  // 记录活动后的再约意愿
  .post(
    '/self-feedback',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        return await recordActivitySelfFeedback({
          userId: user.id,
          activityId: body.activityId,
          feedback: body.feedback,
          reviewSummary: typeof body.reviewSummary === 'string' ? body.reviewSummary : undefined,
        });
      } catch (error: any) {
        const message = error?.message || '记录活动反馈失败';
        if (message === '活动不存在') {
          set.status = 404;
        } else if (
          message === '只有活动发起人或参与成员可以记录这次反馈'
          || message === '活动还没开始，结束后再来记录反馈吧'
        ) {
          set.status = 403;
        } else {
          set.status = 500;
        }

        return {
          code: set.status,
          msg: message,
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Participants'],
        summary: '记录活动后的真实反馈',
        description: '活动结束后由发起人或参与成员记录这次活动的真实反馈结果，用于后续推荐和再约判断。',
      },
      body: 'participant.activitySelfFeedbackRequest',
      response: {
        200: 'participant.actionResponse',
        401: 'common.error',
        403: 'common.error',
        404: 'common.error',
        500: 'common.error',
      },
    }
  )

  .post(
    '/rebook-follow-up',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        return await markActivityRebookFollowUp(user.id, body.activityId);
      } catch (error: any) {
        const message = error?.message || '记录再约意愿失败';
        if (message === '活动不存在') {
          set.status = 404;
        } else if (message === '只有活动发起人或参与成员可以标记再约') {
          set.status = 403;
        } else if (message === '只有已结束的活动才能标记再约') {
          set.status = 400;
        } else {
          set.status = 500;
        }

        return {
          code: set.status,
          msg: message,
        } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Participants'],
        summary: '记录活动后的再约意愿',
        description: '活动结束后记录用户是否主动发起再约，用于 AI memory 的真实结果写回。',
      },
      body: 'participant.rebookFollowUpRequest',
      response: {
        200: 'participant.actionResponse',
        400: 'common.error',
        401: 'common.error',
        403: 'common.error',
        404: 'common.error',
        500: 'common.error',
      },
    }
  );
