import { db, users, eq } from '@xu/db';
import { clearTokenCache, getAccessToken } from '../content-security';

type ServiceNotificationScene =
  | 'post_activity'
  | 'activity_reminder'
  | 'discussion_reply'
  | 'match_reassigned'
  | 'partner_connect_request'
  | 'partner_group_up_request';
type MiniProgramState = 'developer' | 'trial' | 'formal';
type NotificationLang = 'zh_CN' | 'en_US' | 'zh_HK' | 'zh_TW';

interface SceneConfig {
  templateIdEnvKeys: readonly string[];
  pageEnvKeys: readonly string[];
  defaultPage: string;
}

interface SendServiceNotificationByUserIdParams {
  userId: string;
  scene: ServiceNotificationScene;
  data: Record<string, string>;
  pagePath?: string;
}

interface SubscribeMessageRequest {
  touser: string;
  template_id: string;
  page: string;
  miniprogram_state?: MiniProgramState;
  lang?: NotificationLang;
  data: Record<string, { value: string }>;
}

interface SubscribeMessageResponse {
  errcode: number;
  errmsg: string;
  msgid?: string;
}

export interface ServiceNotificationResult {
  success: boolean;
  scene: ServiceNotificationScene;
  userId: string;
  templateId?: string;
  messageId?: string;
  skipped?: boolean;
  mocked?: boolean;
  error?: string;
}

const TOKEN_EXPIRED_CODES = new Set([40001, 42001]);

const SCENE_CONFIGS: Record<ServiceNotificationScene, SceneConfig> = {
  post_activity: {
    templateIdEnvKeys: ['WECHAT_NOTIFY_TEMPLATE_ID_POST_ACTIVITY', 'WECHAT_TEMPLATE_ID_POST_ACTIVITY'],
    pageEnvKeys: ['WECHAT_NOTIFY_PAGE_POST_ACTIVITY'],
    defaultPage: 'pages/message/index',
  },
  activity_reminder: {
    templateIdEnvKeys: ['WECHAT_NOTIFY_TEMPLATE_ID_ACTIVITY_REMINDER', 'WECHAT_TEMPLATE_ID_ACTIVITY_REMINDER'],
    pageEnvKeys: ['WECHAT_NOTIFY_PAGE_ACTIVITY_REMINDER'],
    defaultPage: 'pages/message/index',
  },
  discussion_reply: {
    templateIdEnvKeys: [
      'WECHAT_NOTIFY_TEMPLATE_ID_DISCUSSION_REPLY',
      'WECHAT_TEMPLATE_ID_DISCUSSION_REPLY',
      'WECHAT_NOTIFY_TEMPLATE_ID_ACTIVITY_REMINDER',
      'WECHAT_TEMPLATE_ID_ACTIVITY_REMINDER',
    ],
    pageEnvKeys: [
      'WECHAT_NOTIFY_PAGE_DISCUSSION_REPLY',
      'WECHAT_NOTIFY_PAGE_ACTIVITY_REMINDER',
    ],
    defaultPage: 'pages/message/index',
  },
  match_reassigned: {
    templateIdEnvKeys: ['WECHAT_NOTIFY_TEMPLATE_ID_MATCH_REASSIGNED', 'WECHAT_TEMPLATE_ID_MATCH_REASSIGNED'],
    pageEnvKeys: ['WECHAT_NOTIFY_PAGE_MATCH_REASSIGNED'],
    defaultPage: 'pages/message/index',
  },
  partner_connect_request: {
    templateIdEnvKeys: [
      'WECHAT_NOTIFY_TEMPLATE_ID_PARTNER_CONNECT_REQUEST',
      'WECHAT_TEMPLATE_ID_PARTNER_CONNECT_REQUEST',
      'WECHAT_NOTIFY_TEMPLATE_ID_MATCH_REASSIGNED',
      'WECHAT_TEMPLATE_ID_MATCH_REASSIGNED',
    ],
    pageEnvKeys: [
      'WECHAT_NOTIFY_PAGE_PARTNER_CONNECT_REQUEST',
      'WECHAT_NOTIFY_PAGE_MATCH_REASSIGNED',
    ],
    defaultPage: 'pages/message/index',
  },
  partner_group_up_request: {
    templateIdEnvKeys: [
      'WECHAT_NOTIFY_TEMPLATE_ID_PARTNER_GROUP_UP_REQUEST',
      'WECHAT_TEMPLATE_ID_PARTNER_GROUP_UP_REQUEST',
      'WECHAT_NOTIFY_TEMPLATE_ID_MATCH_REASSIGNED',
      'WECHAT_TEMPLATE_ID_MATCH_REASSIGNED',
    ],
    pageEnvKeys: [
      'WECHAT_NOTIFY_PAGE_PARTNER_GROUP_UP_REQUEST',
      'WECHAT_NOTIFY_PAGE_MATCH_REASSIGNED',
    ],
    defaultPage: 'pages/message/index',
  },
};

function readFirstEnvValue(keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function normalizeTemplateData(data: Record<string, string>): Record<string, { value: string }> {
  const payload: Record<string, { value: string }> = {};
  for (const [field, value] of Object.entries(data)) {
    const key = field.trim();
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!key || !normalized) continue;
    payload[key] = { value: normalized };
  }
  return payload;
}

function resolveMiniProgramState(): MiniProgramState | undefined {
  const state = process.env.WECHAT_NOTIFY_MINIPROGRAM_STATE?.trim();
  if (state === 'developer' || state === 'trial' || state === 'formal') {
    return state;
  }
  return undefined;
}

function resolveNotificationLang(): NotificationLang | undefined {
  const lang = process.env.WECHAT_NOTIFY_LANG?.trim();
  if (lang === 'zh_CN' || lang === 'en_US' || lang === 'zh_HK' || lang === 'zh_TW') {
    return lang;
  }
  return undefined;
}

function shouldUseMockMode(): boolean {
  const flag = process.env.WECHAT_NOTIFY_MOCK;
  if (!flag) return false;
  return ['1', 'true', 'yes', 'on'].includes(flag.toLowerCase());
}

async function callSubscribeApi(body: SubscribeMessageRequest): Promise<SubscribeMessageResponse> {
  const token = await getAccessToken();
  const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json() as Promise<SubscribeMessageResponse>;
}

async function callSubscribeApiWithTokenRetry(body: SubscribeMessageRequest): Promise<SubscribeMessageResponse> {
  const first = await callSubscribeApi(body);
  if (!TOKEN_EXPIRED_CODES.has(first.errcode)) {
    return first;
  }

  clearTokenCache();
  return callSubscribeApi(body);
}

export async function sendServiceNotificationByUserId(
  params: SendServiceNotificationByUserIdParams,
): Promise<ServiceNotificationResult> {
  const { userId, scene, data, pagePath } = params;
  const sceneConfig = SCENE_CONFIGS[scene];
  const templateId = readFirstEnvValue(sceneConfig.templateIdEnvKeys);

  if (!templateId) {
    return {
      success: false,
      scene,
      userId,
      skipped: true,
      error: `未配置模板 ID: ${sceneConfig.templateIdEnvKeys[0]}`,
    };
  }

  const [targetUser] = await db
    .select({ wxOpenId: users.wxOpenId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!targetUser?.wxOpenId) {
    return {
      success: false,
      scene,
      userId,
      skipped: true,
      templateId,
      error: '用户缺少 wxOpenId，无法发送微信服务通知',
    };
  }

  const hasWechatCredentials = Boolean(process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET);
  const payloadData = normalizeTemplateData(data);
  const resolvedPage = pagePath?.trim() || readFirstEnvValue(sceneConfig.pageEnvKeys) || sceneConfig.defaultPage;

  if (Object.keys(payloadData).length === 0) {
    return {
      success: false,
      scene,
      userId,
      skipped: true,
      templateId,
      error: '模板数据为空，跳过发送',
    };
  }

  if (shouldUseMockMode()) {
    console.info('[WeChatNotification] mock send', {
      userId,
      scene,
      templateId,
      page: resolvedPage,
      data: payloadData,
    });

    return {
      success: true,
      mocked: true,
      scene,
      userId,
      templateId,
    };
  }

  if (!hasWechatCredentials) {
    return {
      success: false,
      scene,
      userId,
      skipped: true,
      templateId,
      error: '缺少 WECHAT_APP_ID / WECHAT_APP_SECRET，无法发送微信服务通知',
    };
  }

  const body: SubscribeMessageRequest = {
    touser: targetUser.wxOpenId,
    template_id: templateId,
    page: resolvedPage,
    miniprogram_state: resolveMiniProgramState(),
    lang: resolveNotificationLang(),
    data: payloadData,
  };

  try {
    const response = await callSubscribeApiWithTokenRetry(body);

    if (response.errcode === 0) {
      return {
        success: true,
        scene,
        userId,
        templateId,
        messageId: response.msgid,
      };
    }

    return {
      success: false,
      scene,
      userId,
      templateId,
      error: `微信接口错误: ${response.errmsg} (${response.errcode})`,
    };
  } catch (error) {
    return {
      success: false,
      scene,
      userId,
      templateId,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type { ServiceNotificationScene };
