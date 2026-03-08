// Participant Controller - 参与者辅助接口 (MVP 简化版)
// 主要逻辑已移到 activities 模块
import { Elysia, t } from 'elysia';
import { basePlugins, verifyAuth } from '../../setup';
import { participantModel, ParticipantInfoSchema, type ErrorResponse } from './participant.model';
import {
  getActivityParticipants,
  confirmActivityFulfillment,
  markActivityRebookFollowUp,
} from './participant.service';

export const participantController = new Elysia({ prefix: '/participants' })
  .use(basePlugins)
  .use(participantModel)

  // 获取活动参与者列表
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
        500: 'participant.error',
      },
    }
  )

  // 发起人提交履约确认
  .post(
    '/confirm-fulfillment',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return {
          code: 401,
          msg: '未授权',
        } satisfies ErrorResponse;
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
        400: 'participant.error',
        401: 'participant.error',
        403: 'participant.error',
        404: 'participant.error',
        500: 'participant.error',
      },
    }
  )

  .post(
    '/rebook-follow-up',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return {
          code: 401,
          msg: '未授权',
        } satisfies ErrorResponse;
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
        400: 'participant.error',
        401: 'participant.error',
        403: 'participant.error',
        404: 'participant.error',
        500: 'participant.error',
      },
    }
  );
