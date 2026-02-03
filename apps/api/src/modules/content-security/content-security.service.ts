/**
 * Content Security Service - 统一内容安全审核服务
 * 
 * 作为系统内所有内容审核的唯一入口，封装多级审核策略：
 * - Level 1: 本地正则（快速拦截高风险）
 * - Level 2: 微信 msg_sec_check（权威外部接口）
 * 
 * @module content-security
 */

import { db, aiSecurityEvents } from '@juchang/db';
import { msgSecCheck } from './wechat-api.client';

// ==========================================
// Types
// ==========================================

export interface ValidationContext {
    userId?: string;
    openid?: string;
    scene?: 'activity' | 'message' | 'profile';
    source?: 'miniprogram' | 'admin';
}

export interface ValidationResult {
    pass: boolean;
    level: 'regex' | 'wechat' | 'none';
    reason?: string;
    keyword?: string;
    traceId?: string;
}

// ==========================================
// Local Regex Rules (Level 1)
// ==========================================

/**
 * 高风险敏感词（直接拦截）
 */
const HIGH_RISK_WORDS = [
    // 政治敏感
    '习近平', '共产党', '六四', '天安门', '法轮功',
    // 暴力相关
    '杀人', '自杀', '炸弹', '枪支',
    // 色情相关
    '色情', '裸体', '性交',
    // 诈骗相关
    '刷单', '兼职赚钱', '高额回报',
];

/**
 * 联系方式模式（可疑，但不直接拦截）
 */
const CONTACT_PATTERNS = [
    /1[3-9]\d{9}/,           // 手机号
    /微信|wx|weixin/i,       // 微信
    /QQ|扣扣/i,              // QQ
    /加我|私聊|联系我/,       // 引导私聊
];

// 使用 void 来消除未使用警告
void CONTACT_PATTERNS;

/**
 * 广告/诈骗模式
 */
const SUSPICIOUS_PATTERNS = [
    /免费|赚钱|兼职|日结/,
    /高薪|月入|躺赚/,
    /代理|招商|加盟/,
];

// ==========================================
// Core Validation Logic
// ==========================================

/**
 * Level 1: 本地正则检测
 */
function checkByRegex(content: string): { blocked: boolean; keyword?: string; reason?: string } {
    // 高风险词直接拦截
    for (const word of HIGH_RISK_WORDS) {
        if (content.includes(word)) {
            return {
                blocked: true,
                keyword: word,
                reason: '包含敏感词',
            };
        }
    }

    // 可疑模式：记录但不拦截（让微信接口决定）
    for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(content)) {
            return {
                blocked: false,
                keyword: content.match(pattern)?.[0],
                reason: '疑似广告',
            };
        }
    }

    return { blocked: false };
}

/**
 * 统一内容验证入口
 * 
 * 多级策略：
 * 1. 本地正则检测（快速拦截高风险）
 * 2. 微信内容安全接口（权威判定）
 * 
 * @param content 待检测内容
 * @param context 上下文信息
 */
export async function validateContent(
    content: string,
    context: ValidationContext = {}
): Promise<ValidationResult> {
    const { userId, openid, scene = 'activity' } = context;

    // 空内容直接通过
    if (!content || content.trim().length === 0) {
        return { pass: true, level: 'none' };
    }

    // Level 1: 本地正则
    const regexResult = checkByRegex(content);
    if (regexResult.blocked) {
        // 记录安全事件
        await recordSecurityEvent({
            userId,
            eventType: 'content_blocked',
            triggerWord: regexResult.keyword,
            inputText: content.slice(0, 200),
            severity: 'high',
            metadata: {
                level: 'regex',
                scene,
                reason: regexResult.reason,
            },
        });

        return {
            pass: false,
            level: 'regex',
            reason: regexResult.reason,
            keyword: regexResult.keyword,
        };
    }

    // Level 2: 微信内容安全（需要 openid）
    if (openid) {
        const sceneMap = {
            activity: 4 as const,  // 社交日志
            message: 2 as const,   // 评论
            profile: 1 as const,   // 资料
        };

        const wechatResult = await msgSecCheck(content, openid, sceneMap[scene]);

        if (!wechatResult.pass) {
            // 记录安全事件
            await recordSecurityEvent({
                userId,
                eventType: 'content_blocked',
                triggerWord: wechatResult.keyword,
                inputText: content.slice(0, 200),
                severity: wechatResult.suggest === 'risky' ? 'high' : 'medium',
                metadata: {
                    level: 'wechat',
                    scene,
                    label: wechatResult.label,
                    traceId: wechatResult.traceId,
                },
            });

            return {
                pass: false,
                level: 'wechat',
                reason: getWechatLabelDescription(wechatResult.label),
                keyword: wechatResult.keyword,
                traceId: wechatResult.traceId,
            };
        }
    }

    return { pass: true, level: 'none' };
}

/**
 * 批量验证多个字段
 */
export async function validateFields(
    fields: Record<string, string | undefined | null>,
    context: ValidationContext = {}
): Promise<ValidationResult> {
    for (const [_fieldName, value] of Object.entries(fields)) {
        if (value) {
            const result = await validateContent(value, context);
            if (!result.pass) {
                return result;
            }
        }
    }
    return { pass: true, level: 'none' };
}

// ==========================================
// Helpers
// ==========================================

/**
 * 微信 label 转可读描述
 */
function getWechatLabelDescription(label?: number): string {
    const labelMap: Record<number, string> = {
        100: '正常',
        10001: '广告',
        20001: '色情',
        20002: '性感',
        20003: '低俗',
        21000: '其他',
        30001: '暴恐',
        30002: '违法犯罪',
        40001: '辱骂',
        50001: '政治敏感',
    };
    return label ? (labelMap[label] || '违规内容') : '违规内容';
}

/**
 * 记录安全事件到数据库
 */
async function recordSecurityEvent(event: {
    userId?: string;
    eventType: string;
    triggerWord?: string;
    inputText?: string;
    severity?: string;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    try {
        await db.insert(aiSecurityEvents).values({
            userId: event.userId || null,
            eventType: event.eventType,
            triggerWord: event.triggerWord || null,
            inputText: event.inputText || null,
            severity: event.severity || 'medium',
            metadata: event.metadata || null,
        });
    } catch (error) {
        console.error('[ContentSecurity] 记录安全事件失败:', error);
        // 不抛出错误，避免影响主流程
    }
}
