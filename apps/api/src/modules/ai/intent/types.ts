/**
 * Intent Types - 意图识别类型定义
 */

/**
 * 意图类型
 */
export type IntentType =
  | 'create'    // 创建活动
  | 'explore'   // 探索附近
  | 'manage'    // 管理活动
  | 'partner'   // 找搭子
  | 'chitchat'  // 闲聊
  | 'idle'      // 空闲/暂停
  | 'modify'    // 修改/纠正
  | 'confirm'   // 确认
  | 'deny'      // 拒绝/否定
  | 'cancel'    // 取消/终止
  | 'share'     // 分享/邀请
  | 'join'      // 报名/参加
  | 'show_activity' // 展示活动/历史
  | 'unknown';  // 未知

/**
 * 分类方法
 * - regex: 旧版正则匹配（兼容）
 * - llm: 旧版 LLM 分类（兼容）
 * - p0: P0 层全局关键词匹配
 * - p1: P1 层 Feature_Combination 规则引擎
 * - p2: P2 层 LLM Few-shot 分类
 */
export type ClassifyMethod = 'regex' | 'llm' | 'p0' | 'p1' | 'p2';

/**
 * 分类结果
 */
export interface ClassifyResult {
  /** 识别的意图 */
  intent: IntentType;
  /** 置信度 0-1 */
  confidence: number;
  /** 分类方法 */
  method: ClassifyMethod;
  /** 匹配的正则模式（regex 方法时） */
  matchedPattern?: string;
  /** P1 层命中的特征信号列表 */
  p1Features?: string[];
}

/**
 * 分类上下文
 */
export interface ClassifyContext {
  /** 是否有草稿上下文 */
  hasDraftContext: boolean;
  /** 对话历史 */
  conversationHistory?: Array<{ role: string; content: string }>;
  /** 用户 ID（用于 metrics 记录） */
  userId?: string;
}
