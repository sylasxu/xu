// Report Controller - 举报管理接口
import { Elysia } from 'elysia';
import { basePlugins, verifyAuth, verifyAdmin, type ErrorResponse } from '../../setup';
import {
  reportModel,
  REPORT_REASONS,
  type ReportMetaResponse,
} from './report.model';
import {
  createReport,
  getReports,
  getReportById,
  updateReport,
} from './report.service';
import { getConfigValue } from '../ai/config/config.service';

const DEFAULT_REPORT_META: ReportMetaResponse = {
  titleByType: {
    activity: '举报活动',
    message: '举报消息',
    user: '举报用户',
  },
  sectionTitles: {
    reason: '请选择举报原因',
    description: '补充说明（可选）',
  },
  descriptionPlaceholder: '请描述具体问题...',
  submitLabel: '提交举报',
  reasons: [
    { value: 'inappropriate', label: '违规内容' },
    { value: 'fake', label: '虚假信息' },
    { value: 'harassment', label: '骚扰行为' },
    { value: 'other', label: '其他' },
  ],
  toast: {
    missingReason: '请选择举报原因',
    invalidTarget: '举报目标无效',
    invalidType: '举报类型无效',
    success: '举报已提交',
    failed: '举报失败',
    networkError: '网络错误，请重试',
  },
};

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeReportMeta(raw: unknown): ReportMetaResponse {
  if (!raw || typeof raw !== 'object') {
    return DEFAULT_REPORT_META;
  }

  const value = raw as Record<string, unknown>;
  const titleByType = typeof value.titleByType === 'object' && value.titleByType !== null
    ? value.titleByType as Record<string, unknown>
    : {};
  const sectionTitles = typeof value.sectionTitles === 'object' && value.sectionTitles !== null
    ? value.sectionTitles as Record<string, unknown>
    : {};
  const reasons = typeof value.reasons === 'object' && value.reasons !== null
    ? value.reasons as Record<string, unknown>
    : {};
  const toast = typeof value.toast === 'object' && value.toast !== null
    ? value.toast as Record<string, unknown>
    : {};

  return {
    titleByType: {
      activity: readString(titleByType.activity) ?? DEFAULT_REPORT_META.titleByType.activity,
      message: readString(titleByType.message) ?? DEFAULT_REPORT_META.titleByType.message,
      user: readString(titleByType.user) ?? DEFAULT_REPORT_META.titleByType.user,
    },
    sectionTitles: {
      reason: readString(sectionTitles.reason) ?? DEFAULT_REPORT_META.sectionTitles.reason,
      description: readString(sectionTitles.description) ?? DEFAULT_REPORT_META.sectionTitles.description,
    },
    descriptionPlaceholder: readString(value.descriptionPlaceholder) ?? DEFAULT_REPORT_META.descriptionPlaceholder,
    submitLabel: readString(value.submitLabel) ?? DEFAULT_REPORT_META.submitLabel,
    reasons: REPORT_REASONS.map((reason) => ({
      value: reason,
      label: readString(reasons[reason]) ?? DEFAULT_REPORT_META.reasons.find((item) => item.value === reason)?.label ?? reason,
    })),
    toast: {
      missingReason: readString(toast.missingReason) ?? DEFAULT_REPORT_META.toast.missingReason,
      invalidTarget: readString(toast.invalidTarget) ?? DEFAULT_REPORT_META.toast.invalidTarget,
      invalidType: readString(toast.invalidType) ?? DEFAULT_REPORT_META.toast.invalidType,
      success: readString(toast.success) ?? DEFAULT_REPORT_META.toast.success,
      failed: readString(toast.failed) ?? DEFAULT_REPORT_META.toast.failed,
      networkError: readString(toast.networkError) ?? DEFAULT_REPORT_META.toast.networkError,
    },
  };
}

export const reportController = new Elysia({ prefix: '/reports' })
  .use(basePlugins)
  .use(reportModel)

  .get(
    '/meta',
    async () => {
      const raw = await getConfigValue<unknown>('ui.report', DEFAULT_REPORT_META);
      return normalizeReportMeta(raw);
    },
    {
      detail: {
        tags: ['Reports'],
        summary: '获取举报 UI 元数据',
        description: '返回举报弹层所需的标题、原因标签、输入框提示与 toast 文案。',
      },
      response: {
        200: 'report.metaResponse',
      },
    }
  )

  // POST /reports - 提交举报（需要登录）
  .post(
    '/',
    async ({ body, set, jwt, headers }) => {
      const user = await verifyAuth(jwt, headers);
      if (!user) {
        set.status = 401;
        return { code: 401, msg: '未授权' } satisfies ErrorResponse;
      }

      try {
        const result = await createReport(body, user.id);
        return { success: true as const, msg: '举报已提交，我们会尽快处理', id: result.id };
      } catch (error) {
        set.status = 500;
        const message = error instanceof Error ? error.message : '举报提交失败';
        return { code: 500, msg: message } satisfies ErrorResponse;
      }
    },
    {
      detail: {
        tags: ['Internal'],
        summary: '提交举报',
        description: '用户提交举报（活动/消息/用户），需要登录',
      },
      body: 'report.createRequest',
      response: {
        200: 'report.createSuccess',
        401: 'common.error',
        500: 'common.error',
      },
    }
  )

  // GET /reports - 获取举报列表（管理员）
  .get(
    '/',
    async ({ query, set, jwt, headers }) => {
      const admin = await verifyAdmin(jwt, headers);
      if (!admin) {
        set.status = 403;
        return { code: 403, msg: '无管理员权限' } satisfies ErrorResponse;
      }

      const result = await getReports(query);
      return result;
    },
    {
      detail: {
        tags: ['Internal'],
        summary: '获取举报列表',
        description: '获取举报列表，支持按状态和类型筛选（需要管理员权限）',
      },
      query: 'report.listQuery',
      response: {
        200: 'report.listResponse',
        401: 'common.error',
        403: 'common.error',
      },
    }
  )

  // GET /reports/:id - 获取举报详情（管理员）
  .get(
    '/:id',
    async ({ params, set, jwt, headers }) => {
      const admin = await verifyAdmin(jwt, headers);
      if (!admin) {
        set.status = 403;
        return { code: 403, msg: '无管理员权限' } satisfies ErrorResponse;
      }

      const report = await getReportById(params.id);
      if (!report) {
        set.status = 404;
        return { code: 404, msg: '举报不存在' } satisfies ErrorResponse;
      }
      return report;
    },
    {
      detail: {
        tags: ['Internal'],
        summary: '获取举报详情',
        description: '根据 ID 获取举报详细信息（需要管理员权限）',
      },
      params: 'report.idParams',
      response: {
        200: 'report.response',
        401: 'common.error',
        403: 'common.error',
        404: 'common.error',
      },
    }
  )

  // PATCH /reports/:id - 更新举报状态（管理员）
  .patch(
    '/:id',
    async ({ params, body, set, jwt, headers }) => {
      const admin = await verifyAdmin(jwt, headers);
      if (!admin) {
        set.status = 403;
        return { code: 403, msg: '无管理员权限' } satisfies ErrorResponse;
      }

      const updated = await updateReport(params.id, body, admin.id);
      if (!updated) {
        set.status = 404;
        return { code: 404, msg: '举报不存在' } satisfies ErrorResponse;
      }
      return updated;
    },
    {
      detail: {
        tags: ['Internal'],
        summary: '更新举报状态',
        description: '更新举报处理状态和备注（需要管理员权限）',
      },
      params: 'report.idParams',
      body: 'report.updateRequest',
      response: {
        200: 'report.response',
        401: 'common.error',
        403: 'common.error',
        404: 'common.error',
      },
    }
  );
