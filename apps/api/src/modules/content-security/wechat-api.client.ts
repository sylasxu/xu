/**
 * WeChat API Client - 微信 API 底层通信
 * 
 * 负责：
 * - Access Token 获取与缓存
 * - 内容安全接口调用 (msg_sec_check)
 * 
 * @module content-security
 */

// ==========================================
// Types
// ==========================================

interface AccessTokenResponse {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
}

interface MsgSecCheckRequest {
  content: string;
  version: 2;
  scene: 1 | 2 | 3 | 4; // 1-资料 2-评论 3-论坛 4-社交日志
  openid: string;
}

interface MsgSecCheckResponse {
  errcode: number;
  errmsg: string;
  result?: {
    suggest: 'pass' | 'review' | 'risky';
    label: number; // 100-正常 10001-广告 20001-色情 ...
  };
  detail?: Array<{
    strategy: string;
    errcode: number;
    suggest: string;
    label: number;
    keyword?: string;
  }>;
  trace_id?: string;
}

export interface ContentCheckResult {
  pass: boolean;
  suggest: 'pass' | 'review' | 'risky';
  label?: number;
  keyword?: string;
  traceId?: string;
}

// ==========================================
// Token Cache
// ==========================================

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;
let hasWarnedMissingCredentials = false;

function isMockModeEnabled(): boolean {
  const flag = process.env.WECHAT_MSG_SEC_CHECK_MOCK ?? process.env.WECHAT_CONTENT_SECURITY_MOCK;
  if (!flag) return false;
  return ['1', 'true', 'yes', 'on'].includes(flag.toLowerCase());
}

/**
 * 获取微信 Access Token（带缓存）
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  
  // 如果 Token 还有 5 分钟以上有效期，直接返回
  if (cachedToken && tokenExpiresAt > now + 5 * 60 * 1000) {
    return cachedToken;
  }
  
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;
  
  if (!appId || !appSecret) {
    throw new Error('微信配置缺失: WECHAT_APP_ID 或 WECHAT_APP_SECRET 未设置');
  }
  
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
  
  try {
    const response = await fetch(url);
    const data: AccessTokenResponse = await response.json();
    
    if (data.errcode) {
      throw new Error(`微信 Token 获取失败: ${data.errmsg} (${data.errcode})`);
    }
    
    if (!data.access_token) {
      throw new Error('微信 Token 响应格式异常');
    }
    
    // 缓存 Token
    cachedToken = data.access_token;
    tokenExpiresAt = now + (data.expires_in || 7200) * 1000;
    
    return cachedToken;
  } catch (error) {
    console.error('[WeChatAPI] Token 获取失败:', error);
    throw error;
  }
}

/**
 * 调用微信内容安全接口 (msg_sec_check)
 * 
 * 文档: https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/sec-center/sec-check/msgSecCheck.html
 * 
 * @param content 待检测文本
 * @param openid 用户 openid（用于行为分析）
 * @param scene 场景值：1-资料 2-评论 3-论坛 4-社交日志
 */
export async function msgSecCheck(
  content: string,
  openid: string,
  scene: 1 | 2 | 3 | 4 = 4
): Promise<ContentCheckResult> {
  // 仅在显式开启时才走 Mock，避免默认假数据掩盖真实问题。
  if (isMockModeEnabled()) {
    console.warn('[WeChatAPI] WECHAT_MSG_SEC_CHECK_MOCK 已启用，内容审核按通过处理');
    return {
      pass: true,
      suggest: 'pass',
      label: 100,
    };
  }

  const hasWechatCredentials = Boolean(process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET);
  if (!hasWechatCredentials) {
    if (!hasWarnedMissingCredentials) {
      console.warn('[WeChatAPI] 缺少 WECHAT_APP_ID / WECHAT_APP_SECRET，内容审核接口降级为放行');
      hasWarnedMissingCredentials = true;
    }
    return {
      pass: true,
      suggest: 'pass',
    };
  }
  
  try {
    const token = await getAccessToken();
    const url = `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${token}`;
    
    const body: MsgSecCheckRequest = {
      content,
      version: 2,
      scene,
      openid,
    };
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    
    const data: MsgSecCheckResponse = await response.json();
    
    // 处理 Token 过期（40001），自动重试一次
    if (data.errcode === 40001 || data.errcode === 42001) {
      console.warn('[WeChatAPI] Token 过期，刷新后重试');
      cachedToken = null;
      tokenExpiresAt = 0;
      return msgSecCheck(content, openid, scene);
    }
    
    if (data.errcode !== 0) {
      console.error('[WeChatAPI] msg_sec_check 失败:', data);
      // API 错误时默认放行（避免影响用户体验），但记录日志
      return {
        pass: true,
        suggest: 'pass',
        traceId: data.trace_id,
      };
    }
    
    const suggest = data.result?.suggest || 'pass';
    const label = data.result?.label;
    const keyword = data.detail?.find(d => d.keyword)?.keyword;
    
    return {
      pass: suggest === 'pass',
      suggest,
      label,
      keyword,
      traceId: data.trace_id,
    };
  } catch (error) {
    console.error('[WeChatAPI] msg_sec_check 异常:', error);
    // 网络错误时默认放行
    return {
      pass: true,
      suggest: 'pass',
    };
  }
}

/**
 * 清除 Token 缓存（用于测试或强制刷新）
 */
export function clearTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}
