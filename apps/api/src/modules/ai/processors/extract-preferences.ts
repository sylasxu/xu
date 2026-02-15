/**
 * Extract Preferences Processor (v4.8)
 * 
 * 负责从对话中提取用户偏好：
 * - 分析用户消息和 AI 响应
 * - 提取活动偏好（类型、时间、地点、群体大小）
 * - 更新用户的 workingMemory
 * 
 * 提取规则（简化版）：
 * - 活动类型：检测关键词（火锅、电影、运动、桌游等）
 * - 时间偏好：检测时间表达（周末、晚上、下午等）
 * - 地点偏好：检测地点名称（解放碑、观音桥等）
 * - 群体大小：检测人数表达（2-3人、小团体等）
 * 
 * 注意：这是一个后处理 Processor，在 AI 响应生成后执行
 */

import type { ProcessorContext, ProcessorResult } from './types';
import { db, users, eq } from '@juchang/db';
import { hasPreferenceSignal } from '../memory/preference-signal';

// 活动类型关键词映射
const ACTIVITY_TYPE_KEYWORDS: Record<string, string[]> = {
  food: ['火锅', '烧烤', '串串', '吃饭', '美食', '餐厅'],
  entertainment: ['电影', '唱歌', 'KTV', '剧本杀', '密室', '娱乐'],
  sports: ['运动', '篮球', '足球', '羽毛球', '健身', '跑步', '爬山'],
  boardgame: ['桌游', '狼人杀', '三国杀', '卡牌', '棋牌'],
};

// 时间偏好关键词
const TIME_KEYWORDS = [
  '周末', '周六', '周日', '工作日',
  '早上', '上午', '中午', '下午', '晚上', '深夜',
  '今天', '明天', '后天',
];

/**
 * 从文本中提取偏好信息
 */
function extractPreferencesFromText(text: string): {
  activityTypes: string[];
  timePreferences: string[];
  locations: string[];
} {
  const activityTypes: string[] = [];
  const timePreferences: string[] = [];
  const locations: string[] = [];
  
  // 提取活动类型
  for (const [type, keywords] of Object.entries(ACTIVITY_TYPE_KEYWORDS)) {
    if (keywords.some(keyword => text.includes(keyword))) {
      activityTypes.push(type);
    }
  }
  
  // 提取时间偏好
  for (const keyword of TIME_KEYWORDS) {
    if (text.includes(keyword)) {
      timePreferences.push(keyword);
    }
  }
  
  // 提取地点（简化版，实际应使用 NER）
  const locationPatterns = [
    /在(.{2,10})/g,
    /去(.{2,10})/g,
    /(.{2,10})附近/g,
  ];
  
  for (const pattern of locationPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[1]) {
        locations.push(match[1]);
      }
    }
  }
  
  return { activityTypes, timePreferences, locations };
}

/**
 * Extract Preferences Processor
 * 
 * 从对话中提取用户偏好
 */
export async function extractPreferencesProcessor(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();
  
  try {
    const { userId, messages } = context;
    
    // 如果没有 userId，跳过
    if (!userId) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-user-id' },
      };
    }
    
    // 偏好信号前置检查：仅当检测到偏好信号时才触发提取
    const recentMsgs = messages.slice(-5).map(m => ({
      role: String((m as unknown as Record<string, unknown>).role ?? 'user'),
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
    
    if (!hasPreferenceSignal(recentMsgs)) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-preference-signal' },
      };
    }
    
    // 提取最近几条消息的偏好
    const recentMessages = messages.slice(-5);
    const combinedText = recentMessages
      .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      .join(' ');
    
    const preferences = extractPreferencesFromText(combinedText);
    
    // 如果没有提取到任何偏好，跳过
    if (
      preferences.activityTypes.length === 0 &&
      preferences.timePreferences.length === 0 &&
      preferences.locations.length === 0
    ) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-preferences' },
      };
    }
    
    // 加载现有的 workingMemory
    const [user] = await db
      .select({ workingMemory: users.workingMemory })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    
    const existingMemory = user?.workingMemory || '';
    
    // 构建新的偏好描述
    const newPreferences: string[] = [];
    
    if (preferences.activityTypes.length > 0) {
      newPreferences.push(`喜欢的活动类型：${preferences.activityTypes.join('、')}`);
    }
    
    if (preferences.timePreferences.length > 0) {
      newPreferences.push(`时间偏好：${preferences.timePreferences.join('、')}`);
    }
    
    if (preferences.locations.length > 0) {
      newPreferences.push(`常去地点：${preferences.locations.join('、')}`);
    }
    
    // 合并到 workingMemory（简化版，实际应去重和智能合并）
    const updatedMemory = existingMemory
      ? `${existingMemory}\n\n${newPreferences.join('\n')}`
      : newPreferences.join('\n');
    
    // 更新数据库
    await db
      .update(users)
      .set({ workingMemory: updatedMemory })
      .where(eq(users.id, userId));
    
    return {
      success: true,
      context,
      executionTime: Date.now() - startTime,
      data: {
        extracted: preferences,
        memoryLength: updatedMemory.length,
      },
    };
    
  } catch (error) {
    // 提取偏好失败不应阻止整个流程，只记录错误
    return {
      success: true,
      context,
      executionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : '未知错误',
      data: { skipped: true, reason: 'error' },
    };
  }
}

// Processor 元数据
extractPreferencesProcessor.processorName = 'extract-preferences-processor';
