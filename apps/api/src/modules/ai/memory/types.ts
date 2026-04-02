/**
 * Memory Module Types - 记忆系统类型定义
 * 
 * 基于 @juchang/db 的 conversations 和 conversationMessages 表
 */

import type { Conversation, Message } from '@juchang/db';

/**
 * ConversationThread（会话）- 对应 conversations 表
 * 直接复用 DB 类型
 */
export type ConversationThread = Conversation;

/**
 * ConversationThreadMessage（消息）- 对应 conversation_messages 表
 * 直接复用 DB 类型
 */
export type ConversationThreadMessage = Message;

/**
 * RecalledMessage（语义召回的历史消息片段）
 */
export interface RecalledMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 用户画像（WorkingMemory 解析结果）
 * 存储为 Markdown 格式，解析为结构化数据
 */
export interface UserProfile {
  /** 喜好：喜欢火锅、偏好周末活动 */
  preferences: string[];
  /** 不喜欢：不吃辣、不喜欢太早 */
  dislikes: string[];
  /** 常去地点：朝阳区、望京 */
  frequentLocations: string[];
  /** 用户明确说过的身份线索 */
  identityFacts: string[];
  /** 用户明确提过的重要人物/关系线索 */
  socialContextFacts: string[];
  /** 行为模式：经常组局、喜欢小规模 */
  behaviorPatterns: string[];
}

/**
 * v4.5 用户兴趣向量
 * 用于 MaxSim 个性化推荐策略
 * 存储最近满意活动的向量（非平均值）
 */
export interface InterestVector {
  /** 关联的活动 ID */
  activityId: string;
  /** 1536 维向量 (Qwen text-embedding-v4) */
  embedding: number[];
  /** 参与时间 */
  participatedAt: Date;
  /** 用户反馈 */
  feedback?: 'positive' | 'neutral' | 'negative';
}

/**
 * 真实活动结果记忆
 * 记录用户在活动后的真实履约结果，用于后续再约和推荐
 */
export interface ActivityOutcome {
  /** 关联活动 ID */
  activityId: string;
  /** 活动标题 */
  activityTitle: string;
  /** 活动类型 */
  activityType: string;
  /** 地点 */
  locationName: string;
  /** 是否真实到场；未知时为 null */
  attended: boolean | null;
  /** 是否已触发再约 */
  rebookTriggered: boolean;
  /** 履约/复盘摘要 */
  reviewSummary?: string | null;
  /** 活动发生时间 */
  happenedAt: Date;
  /** 最后更新时间 */
  updatedAt: Date;
}

/**
 * v4.5 增强版用户画像
 * 包含兴趣向量用于语义搜索个性化
 */
export interface EnhancedUserProfile extends UserProfile {
  /** 版本号 */
  version: 2;
  /** 最后更新时间 */
  lastUpdated: Date;
  /** 最近真实活动结果 */
  activityOutcomes?: ActivityOutcome[];
  /** 
   * 用户兴趣向量 (MaxSim 策略)
   * 最多存储 3 个最近满意活动的向量
   * 搜索时取与查询向量最大相似度的那个
   */
  interestVectors?: InterestVector[];
}

/**
 * 保存消息的参数
 */
export interface SaveMessageParams {
  conversationId: string;
  userId: Message['userId'];
  role: Message['role'];
  messageType: Message['messageType'];
  content: Message['content'];
  activityId?: Message['activityId'];
  taskId?: Message['taskId'];
}

/**
 * 会话窗口配置
 */
export interface SessionWindowConfig {
  /** 会话窗口时长（毫秒），默认 24 小时 */
  windowMs: number;
}

export const DEFAULT_SESSION_WINDOW: SessionWindowConfig = {
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
};
