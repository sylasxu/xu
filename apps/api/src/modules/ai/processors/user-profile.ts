/**
 * User Profile Processor (v4.8)
 * 
 * 负责注入用户画像到系统提示词：
 * - 从数据库加载用户的 workingMemory
 * - 将用户画像注入到 systemPrompt
 * 
 * 用户画像包含：
 * - 活动偏好（类型、时间、地点）
 * - 历史行为（创建、参与、取消）
 * - 社交偏好（群体大小、互动风格）
 */

import type { ProcessorContext, ProcessorResult } from './types';
import { db, users, eq } from '@juchang/db';

/**
 * User Profile Processor
 * 
 * 注入用户画像到系统提示词
 */
export async function userProfile(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();
  
  try {
    const { userId } = context;
    
    // 如果没有 userId，跳过
    if (!userId) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-user-id' },
      };
    }
    
    // 从数据库加载用户画像
    const [user] = await db
      .select({ workingMemory: users.workingMemory })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    
    if (!user || !user.workingMemory) {
      return {
        success: true,
        context,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-profile' },
      };
    }
    
    // 注入用户画像到系统提示词
    const updatedSystemPrompt = `${context.systemPrompt}

## 用户画像
${user.workingMemory}

请根据用户画像提供个性化的建议和响应。`;
    
    const updatedContext: ProcessorContext = {
      ...context,
      systemPrompt: updatedSystemPrompt,
      userProfile: user.workingMemory,
    };
    
    return {
      success: true,
      context: updatedContext,
      executionTime: Date.now() - startTime,
      data: {
        profileLength: user.workingMemory.length,
        injected: true,
      },
    };
    
  } catch (error) {
    return {
      success: false,
      context,
      executionTime: Date.now() - startTime,
      error: error instanceof Error ? error.message : '未知错误',
    };
  }
}

// Processor 元数据
userProfile.processorName = 'user-profile';
