/**
 * 智能欢迎卡片服务
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 * v4.4 重构: 增加快捷入口
 *
 * 调用 /ai/welcome API 获取个性化欢迎卡片数据
 */

import { getAiWelcome } from '../api/endpoints/ai/ai';
import type {
  AiWelcomeResponse,
  AiWelcomeResponsePendingActivitiesItem,
  AiWelcomeResponseQuickPromptsItem,
  AiWelcomeResponseSectionsItem,
  AiWelcomeResponseSectionsItemItemsItem,
  GetAiWelcomeParams,
} from '../api/model';

export type QuickItem = AiWelcomeResponseSectionsItemItemsItem;
export type QuickItemType = QuickItem['type'];
export type WelcomeSection = AiWelcomeResponseSectionsItem;
export type WelcomePendingActivity = AiWelcomeResponsePendingActivitiesItem;
export type QuickPrompt = AiWelcomeResponseQuickPromptsItem;
export type WelcomeResponse = AiWelcomeResponse;
export type WelcomeQuery = GetAiWelcomeParams;

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
  return response.data;
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
