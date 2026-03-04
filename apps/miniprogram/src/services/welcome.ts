/**
 * 智能欢迎卡片服务
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 * v4.4 重构: 增加社交档案和快捷入口
 *
 * 调用 /ai/welcome API 获取个性化欢迎卡片数据
 */

import { getAiWelcome } from '../api/endpoints/ai/ai';

// 快捷项类型
export type QuickItemType = 'draft' | 'suggestion' | 'explore';

// 快捷项
export interface QuickItem {
  type: QuickItemType;
  icon?: string;
  label: string;
  prompt: string;
  context?: Record<string, unknown>;
}

// 分组
export interface WelcomeSection {
  id: string;
  icon: string;
  title: string;
  items: QuickItem[];
}

// 社交档案 (v4.4 新增)
export interface SocialProfile {
  participationCount: number;
  activitiesCreatedCount: number;
  preferenceCompleteness: number;
}

// 快捷入口 (v4.4 新增)
export interface QuickPrompt {
  icon: string;
  text: string;
  prompt: string;
}

// Welcome API 响应 (v4.4 更新)
export interface WelcomeResponse {
  greeting: string;
  subGreeting?: string;
  sections: WelcomeSection[];
  socialProfile?: SocialProfile;
  quickPrompts: QuickPrompt[];
  ui?: {
    bottomQuickActions?: string[];
    profileHints?: {
      low?: string;
      medium?: string;
      high?: string;
    };
  };
}

// Welcome API 查询参数
export interface WelcomeQuery {
  lat?: number;
  lng?: number;
}

/**
 * 获取欢迎卡片数据
 * Requirements: 1.1, 1.4, 1.5
 * 
 * @param params 可选的位置参数
 * @returns 欢迎卡片数据
 */
export async function getWelcomeCard(params?: WelcomeQuery): Promise<WelcomeResponse> {
  const response = await getAiWelcome(params);
  if (response.status !== 200) {
    throw new Error('获取欢迎卡片失败');
  }
  return response.data as WelcomeResponse;
}

/**
 * 获取用户当前位置
 * @returns 位置信息或 null
 */
export function getUserLocation(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    wx.getLocation({
      type: 'gcj02',
      success: (res) => {
        resolve({
          lat: res.latitude,
          lng: res.longitude,
        });
      },
      fail: () => {
        // 位置获取失败，返回 null
        resolve(null);
      },
    });
  });
}

/**
 * 从 sections 中提取指定类型的 items
 */
export function getSectionItems(sections: WelcomeSection[], sectionId: string): QuickItem[] {
  const section = sections.find(s => s.id === sectionId);
  return section?.items || [];
}

/**
 * 从 sections 中提取草稿项（如果有）
 */
export function getDraftItem(sections: WelcomeSection[]): QuickItem | null {
  const draftSection = sections.find(s => s.id === 'draft');
  return draftSection?.items[0] || null;
}
