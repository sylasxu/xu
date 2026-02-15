/**
 * User Profile Processor (v4.9)
 * 
 * 负责注入用户画像到系统提示词：
 * - 从数据库加载用户的 EnhancedUserProfile（workingMemory）
 * - 使用 buildProfilePrompt 构建结构化画像 Prompt
 * - 将用户画像注入到 systemPrompt
 * - 将画像元数据写入 context.metadata.userProfile
 * 
 * 用户画像包含：
 * - 活动偏好（类型、时间、地点）
 * - 历史行为（创建、参与、取消）
 * - 社交偏好（群体大小、互动风格）
 */

import type { ProcessorContext, ProcessorResult } from './types';
import { getEnhancedUserProfile, buildProfilePrompt } from '../memory/working';

/**
 * User Profile Processor
 * 
 * 注入用户画像到系统提示词，输出写入 context.metadata.userProfile
 */
export async function userProfileProcessor(context: ProcessorContext): Promise<ProcessorResult> {
  const startTime = Date.now();
  
  try {
    const { userId } = context;
    
    // 如果没有 userId，跳过
    if (!userId) {
      const updatedContext: ProcessorContext = {
        ...context,
        metadata: {
          ...context.metadata,
          userProfile: {
            hasProfile: false,
            preferencesCount: 0,
          },
        },
      };

      return {
        success: true,
        context: updatedContext,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-user-id' },
      };
    }
    
    // 从数据库加载增强用户画像
    const profile = await getEnhancedUserProfile(userId);
    
    if (!profile || profile.preferences.length === 0) {
      const updatedContext: ProcessorContext = {
        ...context,
        metadata: {
          ...context.metadata,
          userProfile: {
            hasProfile: false,
            preferencesCount: 0,
          },
        },
      };

      return {
        success: true,
        context: updatedContext,
        executionTime: Date.now() - startTime,
        data: { skipped: true, reason: 'no-profile' },
      };
    }
    
    // 构建画像 Prompt
    const profilePrompt = buildProfilePrompt(profile);
    
    // 提取 top 偏好（按置信度排序，取前 5 个）
    const topPreferences = profile.preferences
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5)
      .map(p => `${p.sentiment === 'dislike' ? '不' : ''}${p.value}`);

    // 注入用户画像到系统提示词
    const updatedSystemPrompt = profilePrompt
      ? `${context.systemPrompt}\n\n## 用户画像\n${profilePrompt}\n\n请根据用户画像提供个性化的建议和响应。`
      : context.systemPrompt;
    
    const updatedContext: ProcessorContext = {
      ...context,
      systemPrompt: updatedSystemPrompt,
      userProfile: profilePrompt || undefined,
      metadata: {
        ...context.metadata,
        userProfile: {
          hasProfile: true,
          preferencesCount: profile.preferences.length,
          topPreferences,
        },
      },
    };
    
    return {
      success: true,
      context: updatedContext,
      executionTime: Date.now() - startTime,
      data: {
        hasProfile: true,
        preferencesCount: profile.preferences.length,
        topPreferences,
        injected: !!profilePrompt,
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
userProfileProcessor.processorName = 'user-profile-processor';
