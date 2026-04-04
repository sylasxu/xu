/**
 * Quality Metrics - 对话质量指标记录
 * 
 * 记录每次 AI 对话的质量指标到数据库，用于：
 * - 对话质量监控（意图识别率、Tool 成功率）
 * - 转化率追踪（对话 → 活动创建/报名）
 * - 历史趋势分析
 * 
 * v4.6 新增
 */

import { db, aiConversationMetrics } from '@juchang/db';
import { createLogger } from './logger';
import { getConfigValue } from '../config/config.service';

const logger = createLogger('quality-metrics');

/**
 * 对话指标数据
 */
export interface ConversationMetricsData {
  conversationId?: string;
  userId?: string;
  
  // 意图识别
  intent?: string;
  intentConfidence?: number;
  intentRecognized?: boolean;
  
  // Tool 调用
  toolsCalled?: string[];
  toolsSucceeded?: number;
  toolsFailed?: number;
  
  // Token 用量
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  
  // 性能
  latencyMs?: number;
  
  // 输出
  outputLength?: number;
  
  // 转化追踪
  activityCreated?: boolean;
  activityJoined?: boolean;
  activityId?: string;
  
  // 元数据
  source?: 'web' | 'miniprogram' | 'admin';
}

/**
 * 计算对话质量评分（四维加权）
 *
 * 公式：intent * w1 + tool * w2 + latency * w3 + length * w4
 *
 * - 意图识别置信度（默认权重 0.3）
 * - Tool 调用成功率（默认权重 0.3）
 * - 延迟合理性（默认权重 0.2）：< 3s 满分，3-10s 线性衰减，> 10s 为 0
 * - 输出长度合理性（默认权重 0.2）：10-2000 字符满分，< 10 为 0.3，> 2000 为 0.7
 */
export async function calculateQualityScore(data: ConversationMetricsData): Promise<number> {
  const weights = await getConfigValue('quality.score_weights', {
    intent: 0.3,
    tool: 0.3,
    latency: 0.2,
    length: 0.2,
  });

  // 意图置信度
  const intentScore = data.intentConfidence ?? 0.5;

  // Tool 成功率
  const toolsCalled = data.toolsCalled?.length ?? 0;
  const toolsSucceeded = data.toolsSucceeded ?? 0;
  const toolScore = toolsCalled > 0 ? toolsSucceeded / toolsCalled : 1;

  // 延迟合理性：< 3s 满分，3-10s 线性衰减，> 10s 为 0
  const latency = data.latencyMs ?? 3000;
  const latencyScore = latency <= 3000 ? 1 : latency >= 10000 ? 0 : (10000 - latency) / 7000;

  // 输出长度合理性：10-2000 字符满分，< 10 为 0.3，> 2000 为 0.7
  const len = data.outputLength ?? 0;
  const lengthScore = len >= 10 && len <= 2000 ? 1 : len < 10 ? 0.3 : 0.7;

  const score =
    weights.intent * intentScore +
    weights.tool * toolScore +
    weights.latency * latencyScore +
    weights.length * lengthScore;

  return Math.round(score * 100) / 100;
}

/**
 * 记录对话质量指标到数据库
 */
export async function recordConversationMetrics(data: ConversationMetricsData): Promise<void> {
  try {
    const qualityScore = await calculateQualityScore(data);
    
    await db.insert(aiConversationMetrics).values({
      conversationId: data.conversationId || null,
      userId: data.userId || null,
      intent: data.intent || null,
      intentConfidence: data.intentConfidence || null,
      intentRecognized: data.intentRecognized ?? true,
      toolsCalled: data.toolsCalled || [],
      toolsSucceeded: data.toolsSucceeded || 0,
      toolsFailed: data.toolsFailed || 0,
      qualityScore,
      inputTokens: data.inputTokens || 0,
      outputTokens: data.outputTokens || 0,
      totalTokens: data.totalTokens || 0,
      latencyMs: data.latencyMs || null,
      activityCreated: data.activityCreated || false,
      activityJoined: data.activityJoined || false,
      activityId: data.activityId || null,
      source: data.source || 'miniprogram',
    });
    
    // 低质量对话记录到异常日志
    if (qualityScore < 0.6) {
      logger.warn('Low quality conversation detected', {
        qualityScore,
        intent: data.intent,
        toolsCalled: data.toolsCalled,
        toolsSucceeded: data.toolsSucceeded,
        toolsFailed: data.toolsFailed,
        userId: data.userId,
      });
    }
    
    logger.debug('Conversation metrics recorded', {
      qualityScore,
      intent: data.intent,
      toolsCalled: data.toolsCalled?.length || 0,
    });
  } catch (error) {
    logger.error('Failed to record conversation metrics', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 从 Tool 调用结果中提取转化信息
 */
export function extractConversionInfo(toolCalls: Array<{ toolName: string; result?: unknown }>): {
  activityCreated: boolean;
  activityJoined: boolean;
  activityId?: string;
} {
  let activityCreated = false;
  let activityJoined = false;
  let activityId: string | undefined;
  
  for (const tc of toolCalls) {
    const result = tc.result as Record<string, unknown> | undefined;
    
    if (result?.activityId) {
      activityId = result.activityId as string;
      
      // 根据 Tool 名称判断是创建还是报名
      if (tc.toolName === 'createActivity' || tc.toolName === 'create_activity') {
        activityCreated = true;
      } else if (tc.toolName === 'joinActivity' || tc.toolName === 'join_activity') {
        activityJoined = true;
      }
    }
  }
  
  return { activityCreated, activityJoined, activityId };
}
