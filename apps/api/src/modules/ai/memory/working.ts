/**
 * Working Memory - 用户工作记忆
 * 
 * 存储用户画像（偏好、常去地点等）
 * 支持两种格式：
 * 1. Markdown 格式（旧版，便于 LLM 理解）
 * 2. JSON 格式（新版，支持置信度和时效性）
 */

import { db, users, eq } from '@juchang/db';
import type { UserProfile } from './types';
import type { PreferenceExtraction, PreferenceCategory, PreferenceSentiment } from './extractor';
import { calculatePreferenceScore } from './temporal-decay';

// ============ 类型定义 ============

/**
 * 增强的偏好项（支持置信度、时效性和提及次数）
 */
export interface EnhancedPreference {
  category: PreferenceCategory;
  value: string;
  sentiment: PreferenceSentiment;
  confidence: number;
  updatedAt: Date;
  /** 提及次数，初始值 1 */
  mentionCount: number;
}

/**
 * 增强的用户画像
 */
export interface EnhancedUserProfile {
  version: 2;
  preferences: EnhancedPreference[];
  frequentLocations: string[];
  lastUpdated: Date;
}

/**
 * 存储格式（JSON 字符串）
 */
interface StoredEnhancedProfile {
  version: 2;
  preferences: Array<{
    category: PreferenceCategory;
    value: string;
    sentiment: PreferenceSentiment;
    confidence: number;
    updatedAt: string;
    /** 提及次数，初始值 1 */
    mentionCount?: number;
  }>;
  frequentLocations: string[];
  lastUpdated: string;
}

/**
 * 空的用户画像（旧版）
 */
export const EMPTY_PROFILE: UserProfile = {
  preferences: [],
  dislikes: [],
  frequentLocations: [],
  behaviorPatterns: [],
};

/**
 * 空的增强用户画像
 */
export const EMPTY_ENHANCED_PROFILE: EnhancedUserProfile = {
  version: 2,
  preferences: [],
  frequentLocations: [],
  lastUpdated: new Date(),
};

/**
 * 从 Markdown 解析用户画像
 * 
 * 格式示例：
 * ```markdown
 * ## 喜好
 * - 喜欢火锅
 * - 偏好周末活动
 * 
 * ## 不喜欢
 * - 不吃辣
 * 
 * ## 常去地点
 * - 观音桥
 * - 解放碑
 * 
 * ## 行为模式
 * - 经常组局
 * - 喜欢小规模（4人以下）
 * ```
 */
export function parseUserProfile(markdown: string | null): UserProfile {
  if (!markdown) return EMPTY_PROFILE;

  const profile: UserProfile = {
    preferences: [],
    dislikes: [],
    frequentLocations: [],
    behaviorPatterns: [],
  };

  const sections: Record<string, keyof UserProfile> = {
    '喜好': 'preferences',
    '不喜欢': 'dislikes',
    '常去地点': 'frequentLocations',
    '行为模式': 'behaviorPatterns',
  };

  let currentSection: keyof UserProfile | null = null;

  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();

    // 检查是否是标题行
    if (trimmed.startsWith('## ')) {
      const title = trimmed.slice(3).trim();
      currentSection = sections[title] || null;
      continue;
    }

    // 检查是否是列表项
    if (trimmed.startsWith('- ') && currentSection) {
      const item = trimmed.slice(2).trim();
      if (item) {
        profile[currentSection].push(item);
      }
    }
  }

  return profile;
}

/**
 * 将用户画像序列化为 Markdown
 */
export function serializeUserProfile(profile: UserProfile): string {
  const sections: string[] = [];

  if (profile.preferences.length > 0) {
    sections.push('## 喜好');
    sections.push(...profile.preferences.map(p => `- ${p}`));
    sections.push('');
  }

  if (profile.dislikes.length > 0) {
    sections.push('## 不喜欢');
    sections.push(...profile.dislikes.map(d => `- ${d}`));
    sections.push('');
  }

  if (profile.frequentLocations.length > 0) {
    sections.push('## 常去地点');
    sections.push(...profile.frequentLocations.map(l => `- ${l}`));
    sections.push('');
  }

  if (profile.behaviorPatterns.length > 0) {
    sections.push('## 行为模式');
    sections.push(...profile.behaviorPatterns.map(b => `- ${b}`));
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * 注入工作记忆到 System Prompt
 * 
 * @param prompt - 原始 System Prompt
 * @param memory - 用户工作记忆（Markdown 格式）
 * @returns 注入后的 Prompt
 */
export function injectWorkingMemory(prompt: string, memory: string | null): string {
  if (!memory) return prompt;

  return `${prompt}

<working_memory>
${memory}
</working_memory>`;
}

/**
 * 合并用户画像（新数据覆盖旧数据中的重复项）
 */
export function mergeUserProfile(
  existing: UserProfile,
  updates: Partial<UserProfile>
): UserProfile {
  return {
    preferences: mergeArrayUnique(existing.preferences, updates.preferences || []),
    dislikes: mergeArrayUnique(existing.dislikes, updates.dislikes || []),
    frequentLocations: mergeArrayUnique(existing.frequentLocations, updates.frequentLocations || []),
    behaviorPatterns: mergeArrayUnique(existing.behaviorPatterns, updates.behaviorPatterns || []),
  };
}

/**
 * 合并数组并去重
 */
function mergeArrayUnique(existing: string[], updates: string[]): string[] {
  const set = new Set([...existing, ...updates]);
  return Array.from(set);
}

/**
 * 从对话历史中提取用户偏好（简化版）
 * 
 * TODO: 后续可以用 LLM 来提取更精准的偏好
 */
export function extractPreferencesFromHistory(
  messages: Array<{ role: string; content: string }>
): Partial<UserProfile> {
  const preferences: string[] = [];
  const frequentLocations: string[] = [];

  // 简单的关键词提取
  const locationKeywords = ['观音桥', '解放碑', '南坪', '沙坪坝', '江北', '杨家坪', '大坪', '北碚'];
  const preferenceKeywords = ['喜欢', '爱吃', '想吃', '想玩', '想打'];

  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    const content = msg.content;

    // 提取地点
    for (const loc of locationKeywords) {
      if (content.includes(loc) && !frequentLocations.includes(loc)) {
        frequentLocations.push(loc);
      }
    }

    // 提取偏好（简化版）
    for (const keyword of preferenceKeywords) {
      const idx = content.indexOf(keyword);
      if (idx !== -1) {
        // 提取关键词后的内容（最多 10 个字）
        const after = content.slice(idx, idx + 15);
        if (after && !preferences.includes(after)) {
          preferences.push(after);
        }
      }
    }
  }

  return {
    preferences: preferences.slice(0, 5), // 最多 5 个
    frequentLocations: frequentLocations.slice(0, 3), // 最多 3 个
  };
}

// ============ 数据库操作 ============

/**
 * 获取用户工作记忆
 */
export async function getWorkingMemory(userId: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { workingMemory: true },
  });
  return user?.workingMemory ?? null;
}

/**
 * 更新用户工作记忆
 */
export async function updateWorkingMemory(
  userId: string,
  content: string
): Promise<void> {
  await db.update(users)
    .set({ 
      workingMemory: content,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

/**
 * 获取用户画像（解析后的结构）
 */
export async function getUserProfile(userId: string): Promise<UserProfile> {
  const memory = await getWorkingMemory(userId);
  return parseUserProfile(memory);
}

/**
 * 更新用户画像
 */
export async function updateUserProfile(
  userId: string,
  updates: Partial<UserProfile>
): Promise<void> {
  const existing = await getUserProfile(userId);
  const merged = mergeUserProfile(existing, updates);
  const markdown = serializeUserProfile(merged);
  await updateWorkingMemory(userId, markdown);
}

/**
 * 清空用户工作记忆
 */
export async function clearWorkingMemory(userId: string): Promise<void> {
  await db.update(users)
    .set({ 
      workingMemory: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}


// ============ 增强版用户画像操作 ============

/**
 * 检测存储格式是否为增强版（JSON）
 * @internal Used by parseEnhancedProfile
 */
export function isEnhancedFormat(content: string | null): boolean {
  if (!content) return false;
  try {
    const parsed = JSON.parse(content);
    return parsed.version === 2;
  } catch {
    return false;
  }
}

/**
 * 解析增强版用户画像
 */
export function parseEnhancedProfile(content: string | null): EnhancedUserProfile {
  if (!content) return { ...EMPTY_ENHANCED_PROFILE, lastUpdated: new Date() };

  try {
    const stored = JSON.parse(content) as StoredEnhancedProfile;
    if (stored.version !== 2) {
      // 旧版格式，转换为增强版
      return convertToEnhancedProfile(parseUserProfile(content));
    }
    return {
      version: 2,
      preferences: stored.preferences.map(p => ({
        ...p,
        updatedAt: new Date(p.updatedAt),
        mentionCount: p.mentionCount ?? 1,
      })),
      frequentLocations: stored.frequentLocations,
      lastUpdated: new Date(stored.lastUpdated),
    };
  } catch {
    // 解析失败，尝试作为 Markdown 解析
    return convertToEnhancedProfile(parseUserProfile(content));
  }
}

/**
 * 序列化增强版用户画像
 */
export function serializeEnhancedProfile(profile: EnhancedUserProfile): string {
  const stored: StoredEnhancedProfile = {
    version: 2,
    preferences: profile.preferences.map(p => ({
      ...p,
      updatedAt: p.updatedAt.toISOString(),
    })),
    frequentLocations: profile.frequentLocations,
    lastUpdated: profile.lastUpdated.toISOString(),
  };
  return JSON.stringify(stored);
}

/**
 * 将旧版用户画像转换为增强版
 */
export function convertToEnhancedProfile(oldProfile: UserProfile): EnhancedUserProfile {
  const now = new Date();
  const preferences: EnhancedPreference[] = [];

  // 转换喜好
  for (const pref of oldProfile.preferences) {
    preferences.push({
      category: 'activity_type',
      value: pref,
      sentiment: 'like',
      confidence: 0.5, // 旧数据置信度较低
      updatedAt: now,
      mentionCount: 1,
    });
  }

  // 转换不喜欢
  for (const dislike of oldProfile.dislikes) {
    preferences.push({
      category: 'food', // 假设不喜欢的多是食物
      value: dislike,
      sentiment: 'dislike',
      confidence: 0.5,
      updatedAt: now,
      mentionCount: 1,
    });
  }

  return {
    version: 2,
    preferences,
    frequentLocations: oldProfile.frequentLocations,
    lastUpdated: now,
  };
}

/**
 * 合并增强版偏好（支持矛盾偏好冲突处理和 mentionCount 累加）
 *
 * 合并策略：
 * 1. 通过 `category + value` 匹配已有偏好
 * 2. 同一偏好再次提及：mentionCount + 1，confidence + 0.1（上限 1.0）
 * 3. 矛盾偏好（sentiment 不同）：覆盖情感标签，旧偏好 confidence 降低 50%，新偏好 mentionCount 设为 1
 * 4. 全新偏好：直接添加，mentionCount 为 1
 */
export function mergeEnhancedPreferences(
  existing: EnhancedPreference[],
  newPrefs: EnhancedPreference[]
): EnhancedPreference[] {
  const merged = new Map<string, EnhancedPreference>();
  
  // 先添加现有偏好
  for (const pref of existing) {
    const key = `${pref.category}:${pref.value.toLowerCase()}`;
    merged.set(key, { ...pref });
  }
  
  // 处理新偏好
  for (const pref of newPrefs) {
    const key = `${pref.category}:${pref.value.toLowerCase()}`;
    const existingPref = merged.get(key);
    
    if (!existingPref) {
      // 全新偏好，直接添加
      merged.set(key, { ...pref, mentionCount: pref.mentionCount ?? 1, updatedAt: new Date() });
    } else if (existingPref.sentiment !== pref.sentiment) {
      // 矛盾偏好冲突处理：覆盖情感标签，旧偏好 confidence 降低 50%
      merged.set(key, {
        ...existingPref,
        sentiment: pref.sentiment,
        confidence: existingPref.confidence * 0.5,
        mentionCount: 1,
        updatedAt: new Date(),
      });
    } else {
      // 同一偏好再次提及：mentionCount + 1，confidence + 0.1（上限 1.0）
      merged.set(key, {
        ...existingPref,
        mentionCount: existingPref.mentionCount + 1,
        confidence: Math.min(existingPref.confidence + 0.1, 1.0),
        updatedAt: new Date(),
      });
    }
  }
  
  // 按更新时间排序，最近的在前
  return Array.from(merged.values())
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, 20); // 最多保留 20 个偏好
}

/**
 * 从 LLM 提取结果转换为增强偏好
 */
export function extractionToEnhancedPreferences(
  extraction: PreferenceExtraction
): EnhancedPreference[] {
  const now = new Date();
  return extraction.preferences.map(p => ({
    category: p.category,
    value: p.value,
    sentiment: p.sentiment,
    confidence: p.confidence,
    updatedAt: now,
    mentionCount: 1,
  }));
}

/**
 * 构建用户画像 Prompt 片段
 *
 * 按 confidence × temporalDecay 综合分数降序排列偏好，
 * 排除综合分数为 0（超过 90 天）的偏好。
 */
export function buildProfilePrompt(profile: EnhancedUserProfile): string {
  if (profile.preferences.length === 0 && profile.frequentLocations.length === 0) {
    return '';
  }

  const now = new Date();

  // 过滤掉综合分数为 0 的偏好（超过 90 天），按综合分数降序排列
  const scoredPrefs = profile.preferences
    .map(p => ({ pref: p, score: calculatePreferenceScore(p, now) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  const lines: string[] = ['<user_profile>'];
  lines.push('以下是用户的偏好信息，请在回复时参考：');
  lines.push('');
  
  // 喜好（取前 5 个）
  const likes = scoredPrefs
    .filter(({ pref }) => pref.sentiment === 'like')
    .slice(0, 5);
  
  if (likes.length > 0) {
    lines.push('## 用户喜好');
    for (const { pref } of likes) {
      const categoryLabel = getCategoryLabel(pref.category);
      lines.push(`- ${pref.value}（${categoryLabel}）`);
    }
    lines.push('');
  }
  
  // 不喜欢/禁忌（这些更重要，要特别注意）
  const dislikes = scoredPrefs
    .filter(({ pref }) => pref.sentiment === 'dislike')
    .slice(0, 5);
  
  if (dislikes.length > 0) {
    lines.push('## ⚠️ 用户禁忌（重要）');
    for (const { pref } of dislikes) {
      const categoryLabel = getCategoryLabel(pref.category);
      lines.push(`- ${pref.value}（${categoryLabel}）`);
    }
    lines.push('');
  }
  
  // 常去地点
  if (profile.frequentLocations.length > 0) {
    lines.push('## 常去地点');
    lines.push(`- ${profile.frequentLocations.slice(0, 3).join('、')}`);
    lines.push('');
  }
  
  lines.push('</user_profile>');
  lines.push('');
  lines.push('请根据用户画像个性化你的回复：');
  lines.push('- 如果用户有饮食禁忌（如不吃辣），推荐餐厅时要特别提醒');
  lines.push('- 如果用户有常去地点，优先推荐该区域的活动');
  lines.push('- 根据用户喜好推荐相关类型的活动');
  
  return lines.join('\n');
}

/**
 * 获取类别的中文标签
 */
function getCategoryLabel(category: PreferenceCategory): string {
  const labels: Record<PreferenceCategory, string> = {
    activity_type: '活动类型',
    time: '时间偏好',
    location: '地点偏好',
    food: '饮食偏好',
    social: '社交偏好',
  };
  return labels[category] || category;
}

// ============ 增强版数据库操作 ============

/**
 * 获取增强版用户画像
 */
export async function getEnhancedUserProfile(userId: string): Promise<EnhancedUserProfile> {
  const memory = await getWorkingMemory(userId);
  return parseEnhancedProfile(memory);
}

/**
 * 保存增强版用户画像（含偏好清理策略）
 *
 * 清理规则：偏好数量 > 30 时，移除 confidence < 0.2 且 updatedAt 超过 30 天的偏好
 */
export async function saveEnhancedUserProfile(
  userId: string,
  profile: EnhancedUserProfile
): Promise<void> {
  const cleaned = cleanupPreferences(profile);
  const content = serializeEnhancedProfile(cleaned);
  await updateWorkingMemory(userId, content);
}

/**
 * 偏好清理策略
 *
 * 当偏好数量超过 30 条时，移除低置信度且过期的偏好
 * 移除条件：confidence < 0.2 且 updatedAt 距今超过 30 天
 */
export function cleanupPreferences(profile: EnhancedUserProfile): EnhancedUserProfile {
  if (profile.preferences.length <= 30) return profile;

  const now = new Date();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const cleaned = profile.preferences.filter((p) => {
    const isLowConfidence = p.confidence < 0.2;
    const isOld = now.getTime() - p.updatedAt.getTime() > thirtyDaysMs;
    // 移除同时满足低置信度和过期的偏好
    return !(isLowConfidence && isOld);
  });

  return { ...profile, preferences: cleaned };
}

/**
 * 更新增强版用户画像（合并新偏好）
 */
export async function updateEnhancedUserProfile(
  userId: string,
  extraction: PreferenceExtraction
): Promise<void> {
  const existing = await getEnhancedUserProfile(userId);
  const newPrefs = extractionToEnhancedPreferences(extraction);
  
  const merged: EnhancedUserProfile = {
    version: 2,
    preferences: mergeEnhancedPreferences(existing.preferences, newPrefs),
    frequentLocations: mergeArrayUnique(existing.frequentLocations, extraction.frequentLocations).slice(0, 5),
    lastUpdated: new Date(),
  };
  
  await saveEnhancedUserProfile(userId, merged);
}

/**
 * 注入增强版用户画像到 System Prompt
 */
export function injectEnhancedWorkingMemory(prompt: string, profile: EnhancedUserProfile): string {
  const profilePrompt = buildProfilePrompt(profile);
  if (!profilePrompt) return prompt;
  
  return `${prompt}

${profilePrompt}`;
}


// ============ v4.5 兴趣向量操作 (MaxSim) ============

import type { InterestVector, EnhancedUserProfile as EnhancedUserProfileWithVectors } from './types';

/**
 * 最大兴趣向量数量
 */
const MAX_INTEREST_VECTORS = 3;

/**
 * 添加用户兴趣向量
 * 
 * 当用户参与活动并给出正面反馈时调用
 * 最多保留 3 个最近的向量（FIFO）
 * 
 * @param userId - 用户 ID
 * @param vector - 兴趣向量
 */
export async function addInterestVector(
  userId: string,
  vector: InterestVector
): Promise<void> {
  const profile = await getEnhancedUserProfileWithVectors(userId);
  
  // 获取现有向量，如果不存在则初始化为空数组
  const existingVectors = profile.interestVectors || [];
  
  // 检查是否已存在相同活动的向量
  const filteredVectors = existingVectors.filter(v => v.activityId !== vector.activityId);
  
  // 添加新向量到开头
  const newVectors = [vector, ...filteredVectors];
  
  // 限制最多 3 个向量（FIFO）
  const limitedVectors = newVectors.slice(0, MAX_INTEREST_VECTORS);
  
  // 保存更新后的画像
  await saveEnhancedUserProfileWithVectors(userId, {
    ...profile,
    interestVectors: limitedVectors,
    lastUpdated: new Date(),
  });
}

/**
 * 获取用户兴趣向量
 * 
 * @param userId - 用户 ID
 * @returns 兴趣向量数组（最多 3 个）
 */
export async function getInterestVectors(userId: string): Promise<InterestVector[]> {
  const profile = await getEnhancedUserProfileWithVectors(userId);
  return profile.interestVectors || [];
}

/**
 * 清除用户兴趣向量
 * 
 * @param userId - 用户 ID
 */
export async function clearInterestVectors(userId: string): Promise<void> {
  const profile = await getEnhancedUserProfileWithVectors(userId);
  await saveEnhancedUserProfileWithVectors(userId, {
    ...profile,
    interestVectors: [],
    lastUpdated: new Date(),
  });
}

/**
 * 计算 MaxSim 分数
 * 
 * MaxSim 策略：取用户所有兴趣向量与查询向量的最大相似度
 * 这比平均值更能捕捉用户的多样化兴趣
 * 
 * @param queryVector - 查询向量
 * @param interestVectors - 用户兴趣向量数组
 * @returns 最大相似度分数 (0-1)
 */
export function calculateMaxSim(
  queryVector: number[],
  interestVectors: InterestVector[]
): number {
  if (interestVectors.length === 0) return 0;
  
  let maxSim = 0;
  
  for (const iv of interestVectors) {
    const sim = cosineSimilarity(queryVector, iv.embedding);
    if (sim > maxSim) {
      maxSim = sim;
    }
  }
  
  return maxSim;
}

/**
 * 计算余弦相似度
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  
  return dotProduct / denominator;
}

// ============ 带兴趣向量的增强版画像操作 ============

/**
 * 存储格式（包含兴趣向量）
 */
interface StoredEnhancedProfileWithVectors {
  version: 2;
  preferences: Array<{
    category: PreferenceCategory;
    value: string;
    sentiment: PreferenceSentiment;
    confidence: number;
    updatedAt: string;
    /** 提及次数，初始值 1 */
    mentionCount?: number;
  }>;
  frequentLocations: string[];
  lastUpdated: string;
  interestVectors?: Array<{
    activityId: string;
    embedding: number[];
    participatedAt: string;
    feedback?: 'positive' | 'neutral' | 'negative';
  }>;
}

/**
 * 获取带兴趣向量的增强版用户画像
 */
export async function getEnhancedUserProfileWithVectors(
  userId: string
): Promise<EnhancedUserProfileWithVectors> {
  const memory = await getWorkingMemory(userId);
  return parseEnhancedProfileWithVectors(memory);
}

/**
 * 保存带兴趣向量的增强版用户画像
 */
export async function saveEnhancedUserProfileWithVectors(
  userId: string,
  profile: EnhancedUserProfileWithVectors
): Promise<void> {
  const content = serializeEnhancedProfileWithVectors(profile);
  await updateWorkingMemory(userId, content);
}

/**
 * 解析带兴趣向量的增强版用户画像
 */
function parseEnhancedProfileWithVectors(content: string | null): EnhancedUserProfileWithVectors {
  if (!content) {
    return {
      preferences: [],
      dislikes: [],
      frequentLocations: [],
      behaviorPatterns: [],
      version: 2,
      lastUpdated: new Date(),
      interestVectors: [],
    };
  }

  try {
    const stored = JSON.parse(content) as StoredEnhancedProfileWithVectors;
    if (stored.version !== 2) {
      // 旧版格式，转换为增强版
      const oldProfile = parseUserProfile(content);
      return {
        ...oldProfile,
        version: 2,
        lastUpdated: new Date(),
        interestVectors: [],
      };
    }
    
    return {
      preferences: stored.preferences.map(p => p.value),
      dislikes: stored.preferences.filter(p => p.sentiment === 'dislike').map(p => p.value),
      frequentLocations: stored.frequentLocations,
      behaviorPatterns: [],
      version: 2,
      lastUpdated: new Date(stored.lastUpdated),
      interestVectors: stored.interestVectors?.map(v => ({
        ...v,
        participatedAt: new Date(v.participatedAt),
      })) || [],
    };
  } catch {
    // 解析失败，尝试作为 Markdown 解析
    const oldProfile = parseUserProfile(content);
    return {
      ...oldProfile,
      version: 2,
      lastUpdated: new Date(),
      interestVectors: [],
    };
  }
}

/**
 * 序列化带兴趣向量的增强版用户画像
 */
function serializeEnhancedProfileWithVectors(profile: EnhancedUserProfileWithVectors): string {
  const stored: StoredEnhancedProfileWithVectors = {
    version: 2,
    preferences: profile.preferences.map(p => ({
      category: 'activity_type' as PreferenceCategory,
      value: p,
      sentiment: 'like' as PreferenceSentiment,
      confidence: 0.5,
      updatedAt: new Date().toISOString(),
    })),
    frequentLocations: profile.frequentLocations,
    lastUpdated: profile.lastUpdated.toISOString(),
    interestVectors: profile.interestVectors?.map(v => ({
      activityId: v.activityId,
      embedding: v.embedding,
      participatedAt: v.participatedAt.toISOString(),
      feedback: v.feedback,
    })),
  };
  return JSON.stringify(stored);
}
