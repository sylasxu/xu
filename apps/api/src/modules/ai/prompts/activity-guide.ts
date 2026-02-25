/**
 * 活动引导知识（替代 RAG）
 *
 * 小聚是"按图索骥"（结构化查询），不是"大海捞针"（语义检索）
 * 知识量小（几十条活动建议），Prompt 内置即可
 *
 * 从 xiaoju-v39.ts 提取的独立模块
 */

/**
 * 活动类型 → 建议映射
 */
export const ACTIVITY_GUIDE: Record<string, string> = {
  剧本杀: '建议6-8人，提前预约，先问大家喜欢推理/情感/恐怖',
  火锅: '人均80-120元，提前订位，问清忌口（辣度、牛羊肉）',
  羽毛球: '建议4-6人，提前订场地，带好球拍和水',
  KTV: '建议4-8人，提前订包间，问清是否有麦霸',
  桌游: '建议4-6人，新手建议从简单游戏开始（如阿瓦隆、狼人杀）',
  烧烤: '人均60-100元，夏天建议晚上去，注意防蚊',
  电影: '建议2-4人，提前选好片子和场次',
  爬山: '建议4-8人，带好水和零食，注意防晒',
  密室逃脱: '建议4-6人，提前预约，问清恐怖程度',
  轰趴: '建议8-15人，提前订场地，准备好游戏和零食',
};

/**
 * 获取活动引导建议
 * 支持精确匹配和模糊匹配
 */
export function getActivityGuide(activityType: string): string | null {
  // 精确匹配
  if (ACTIVITY_GUIDE[activityType]) {
    return ACTIVITY_GUIDE[activityType];
  }

  // 模糊匹配
  for (const [key, value] of Object.entries(ACTIVITY_GUIDE)) {
    if (activityType.includes(key) || key.includes(activityType)) {
      return value;
    }
  }

  return null;
}
