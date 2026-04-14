/**
 * Working Memory - 用户工作记忆
 * 
 * 存储用户画像（偏好、常去地点等）
 * 支持两种格式：
 * 1. Markdown 格式（旧版，便于 LLM 理解）
 * 2. JSON 格式（新版，支持置信度和时效性）
 */

import { db, userMemories, eq, desc, sql } from '@xu/db';
import type { ActivityOutcome, InterestVector, UserProfile } from './types';
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
  identityFacts: string[];
  socialContextFacts: string[];
  lastUpdated: Date;
  activityOutcomes?: ActivityOutcome[];
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
  identityFacts?: string[];
  socialContextFacts?: string[];
  lastUpdated: string;
  activityOutcomes?: Array<{
    activityId: string;
    activityTitle: string;
    activityType: string;
    locationName: string;
    attended: boolean | null;
    rebookTriggered: boolean;
    reviewSummary?: string | null;
    happenedAt: string;
    updatedAt: string;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readRequiredText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readOptionalText(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return typeof value === 'string' ? value : undefined;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readDateString(value: unknown): string | null {
  const text = readRequiredText(value);
  if (!text) {
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : text;
}

function readPreferenceCategory(value: unknown): PreferenceCategory | null {
  switch (value) {
    case 'activity_type':
    case 'time':
    case 'location':
    case 'food':
    case 'social':
      return value;
    default:
      return null;
  }
}

function readPreferenceSentiment(value: unknown): PreferenceSentiment | null {
  switch (value) {
    case 'like':
    case 'dislike':
      return value;
    default:
      return null;
  }
}

function readStoredLocations(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function readStoredFacts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 8);
}

function readStoredEnhancedPreference(
  value: unknown,
): StoredEnhancedProfile['preferences'][number] | null {
  if (!isRecord(value)) {
    return null;
  }

  const category = readPreferenceCategory(value.category);
  const storedValue = readRequiredText(value.value);
  const sentiment = readPreferenceSentiment(value.sentiment);
  const confidence = readFiniteNumber(value.confidence);
  const updatedAt = readDateString(value.updatedAt);

  if (!category || !storedValue || !sentiment || confidence === null || !updatedAt) {
    return null;
  }

  const mentionCount = readFiniteNumber(value.mentionCount);

  return {
    category,
    value: storedValue,
    sentiment,
    confidence,
    updatedAt,
    ...(mentionCount !== null ? { mentionCount } : {}),
  };
}

function readStoredActivityOutcome(
  value: unknown,
): NonNullable<StoredEnhancedProfile['activityOutcomes']>[number] | null {
  if (!isRecord(value)) {
    return null;
  }

  const activityId = readRequiredText(value.activityId);
  const activityTitle = readRequiredText(value.activityTitle);
  const activityType = readRequiredText(value.activityType);
  const locationName = readRequiredText(value.locationName);
  const happenedAt = readDateString(value.happenedAt);
  const updatedAt = readDateString(value.updatedAt);
  const attended = value.attended;
  const rebookTriggered = value.rebookTriggered;
  const reviewSummary = readOptionalText(value.reviewSummary);

  if (
    !activityId ||
    !activityTitle ||
    !activityType ||
    !locationName ||
    !happenedAt ||
    !updatedAt ||
    !(
      attended === null ||
      typeof attended === 'boolean'
    ) ||
    typeof rebookTriggered !== 'boolean'
  ) {
    return null;
  }

  return {
    activityId,
    activityTitle,
    activityType,
    locationName,
    attended,
    rebookTriggered,
    happenedAt,
    updatedAt,
    ...(reviewSummary !== undefined ? { reviewSummary } : {}),
  };
}

function readStoredEnhancedProfile(value: unknown): StoredEnhancedProfile | null {
  if (!isRecord(value) || value.version !== 2) {
    return null;
  }

  const lastUpdated = readDateString(value.lastUpdated);
  if (!lastUpdated) {
    return null;
  }

  const preferences = Array.isArray(value.preferences)
    ? value.preferences
        .map((item) => readStoredEnhancedPreference(item))
        .filter((item): item is StoredEnhancedProfile['preferences'][number] => item !== null)
    : [];

  const activityOutcomes = Array.isArray(value.activityOutcomes)
    ? value.activityOutcomes
        .map((item) => readStoredActivityOutcome(item))
        .filter((item): item is NonNullable<StoredEnhancedProfile['activityOutcomes']>[number] => item !== null)
    : undefined;

  return {
    version: 2,
    preferences,
    frequentLocations: readStoredLocations(value.frequentLocations),
    identityFacts: readStoredFacts(value.identityFacts),
    socialContextFacts: readStoredFacts(value.socialContextFacts),
    lastUpdated,
    ...(activityOutcomes ? { activityOutcomes } : {}),
  };
}

function parseStoredEnhancedProfileJson(content: string): StoredEnhancedProfile | null {
  try {
    return readStoredEnhancedProfile(JSON.parse(content));
  } catch {
    return null;
  }
}

/**
 * 空的用户画像（旧版）
 */
export const EMPTY_PROFILE: UserProfile = {
  preferences: [],
  dislikes: [],
  frequentLocations: [],
  identityFacts: [],
  socialContextFacts: [],
  behaviorPatterns: [],
};

/**
 * 空的增强用户画像
 */
export const EMPTY_ENHANCED_PROFILE: EnhancedUserProfile = {
  version: 2,
  preferences: [],
  frequentLocations: [],
  identityFacts: [],
  socialContextFacts: [],
  lastUpdated: new Date(),
  activityOutcomes: [],
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
    identityFacts: [],
    socialContextFacts: [],
    behaviorPatterns: [],
  };

  const sections: Record<string, keyof UserProfile> = {
    '喜好': 'preferences',
    '不喜欢': 'dislikes',
    '常去地点': 'frequentLocations',
    '身份线索': 'identityFacts',
    '关系线索': 'socialContextFacts',
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

  if (profile.identityFacts.length > 0) {
    sections.push('## 身份线索');
    sections.push(...profile.identityFacts.map((fact) => `- ${fact}`));
    sections.push('');
  }

  if (profile.socialContextFacts.length > 0) {
    sections.push('## 关系线索');
    sections.push(...profile.socialContextFacts.map((fact) => `- ${fact}`));
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
export function injectMemoryContext(prompt: string, memory: string | null): string {
  if (!memory) return prompt;

  return `${prompt}

<memory_context>
${memory}
</memory_context>`;
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
    identityFacts: mergeArrayUnique(existing.identityFacts, updates.identityFacts || []),
    socialContextFacts: mergeArrayUnique(existing.socialContextFacts, updates.socialContextFacts || []),
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

type ActiveUserMemoryRow = {
  id: string;
  memoryType: typeof userMemories.$inferSelect.memoryType;
  content: string;
  embedding: number[] | null;
  metadata: Record<string, unknown> | null;
  importance: number;
  createdAt: Date;
  updatedAt: Date;
};

async function listActiveUserMemories(userId: string): Promise<ActiveUserMemoryRow[]> {
  return db
    .select({
      id: userMemories.id,
      memoryType: userMemories.memoryType,
      content: userMemories.content,
      embedding: userMemories.embedding,
      metadata: userMemories.metadata,
      importance: userMemories.importance,
      createdAt: userMemories.createdAt,
      updatedAt: userMemories.updatedAt,
    })
    .from(userMemories)
    .where(
      sql`${userMemories.userId} = ${userId}
        AND (${userMemories.expiresAt} IS NULL OR ${userMemories.expiresAt} > NOW())`
    )
    .orderBy(desc(userMemories.updatedAt), desc(userMemories.createdAt));
}

function readMemoryMetadata(record: ActiveUserMemoryRow): Record<string, unknown> {
  return isRecord(record.metadata) ? record.metadata : {};
}

function readMetadataText(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readMetadataBoolean(metadata: Record<string, unknown>, key: string): boolean | null {
  const value = metadata[key];
  return typeof value === 'boolean' ? value : null;
}

function readMetadataDate(metadata: Record<string, unknown>, key: string): Date | null {
  const text = readMetadataText(metadata, key);
  if (!text) {
    return null;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readMetadataNumber(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function inferPreferenceCategory(record: ActiveUserMemoryRow, metadata: Record<string, unknown>): PreferenceCategory {
  const explicit = readPreferenceCategory(metadata.category);
  if (explicit) {
    return explicit;
  }

  const content = record.content.trim();
  if (content.startsWith('常去地点：')) {
    return 'location';
  }

  return 'activity_type';
}

function normalizeEnhancedPreference(record: ActiveUserMemoryRow): EnhancedPreference | null {
  if (record.memoryType !== 'preference') {
    return null;
  }

  const metadata = readMemoryMetadata(record);
  const sentiment = readPreferenceSentiment(metadata.sentiment) ?? 'like';
  const confidence = readMetadataNumber(metadata, 'confidence') ?? 0.5;
  const mentionCount = readMetadataNumber(metadata, 'mentionCount') ?? 1;
  const updatedAt = readMetadataDate(metadata, 'updatedAt') ?? record.updatedAt ?? record.createdAt;

  return {
    category: inferPreferenceCategory(record, metadata),
    value: record.content.trim(),
    sentiment,
    confidence,
    updatedAt,
    mentionCount,
  };
}

function normalizeActivityOutcome(record: ActiveUserMemoryRow): ActivityOutcome | null {
  if (record.memoryType !== 'activity_outcome') {
    return null;
  }

  const metadata = readMemoryMetadata(record);
  const activityId = readMetadataText(metadata, 'activityId');
  const activityTitle = readMetadataText(metadata, 'activityTitle');
  const activityType = readMetadataText(metadata, 'activityType');
  const locationName = readMetadataText(metadata, 'locationName');
  const happenedAt = readMetadataDate(metadata, 'happenedAt');
  const updatedAt = readMetadataDate(metadata, 'updatedAt') ?? record.updatedAt;

  if (!activityId || !activityTitle || !activityType || !locationName || !happenedAt) {
    return null;
  }

  return {
    activityId,
    activityTitle,
    activityType,
    locationName,
    attended: readMetadataBoolean(metadata, 'attended'),
    rebookTriggered: readMetadataBoolean(metadata, 'rebookTriggered') ?? false,
    reviewSummary: readMetadataText(metadata, 'reviewSummary'),
    happenedAt,
    updatedAt,
  };
}

function normalizeInterestVector(record: ActiveUserMemoryRow): InterestVector | null {
  if (record.memoryType !== 'activity_outcome' || !Array.isArray(record.embedding) || record.embedding.length === 0) {
    return null;
  }

  const metadata = readMemoryMetadata(record);
  const activityId = readMetadataText(metadata, 'activityId');
  const participatedAt = readMetadataDate(metadata, 'participatedAt')
    ?? readMetadataDate(metadata, 'happenedAt')
    ?? record.updatedAt;

  if (!activityId) {
    return null;
  }

  const feedback = readMetadataText(metadata, 'feedback');

  return {
    activityId,
    embedding: record.embedding,
    participatedAt,
    ...(feedback === 'positive' || feedback === 'neutral' || feedback === 'negative'
      ? { feedback }
      : {}),
  };
}

function deriveUserProfile(memories: ActiveUserMemoryRow[]): UserProfile {
  const preferences = memories
    .filter((record) => record.memoryType === 'preference')
    .map((record) => record.content.trim())
    .filter(Boolean)
    .slice(0, 10);

  const frequentLocations = memories
    .filter((record) => record.memoryType === 'social_context' && record.content.startsWith('常去地点：'))
    .map((record) => record.content.replace(/^常去地点：/, '').trim())
    .filter(Boolean)
    .slice(0, 5);

  const identityFacts = memories
    .filter((record) => record.memoryType === 'profile_fact')
    .map((record) => record.content.trim())
    .filter(Boolean)
    .slice(0, 6);

  const socialContextFacts = memories
    .filter((record) => record.memoryType === 'social_context' && !record.content.startsWith('常去地点：'))
    .map((record) => record.content.trim())
    .filter(Boolean)
    .slice(0, 6);

  return {
    preferences,
    dislikes: [],
    frequentLocations,
    identityFacts,
    socialContextFacts,
    behaviorPatterns: [],
  };
}

/**
 * 获取用户画像（解析后的结构）
 */
export async function getUserProfile(userId: string): Promise<UserProfile> {
  const memories = await listActiveUserMemories(userId);
  return deriveUserProfile(memories);
}


// ============ 增强版用户画像操作 ============

/**
 * 检测存储格式是否为增强版（JSON）
 * @internal Used by parseEnhancedProfile
 */
export function isEnhancedFormat(content: string | null): boolean {
  return typeof content === 'string' && parseStoredEnhancedProfileJson(content) !== null;
}

/**
 * 解析增强版用户画像
 */
export function parseEnhancedProfile(content: string | null): EnhancedUserProfile {
  if (!content) return { ...EMPTY_ENHANCED_PROFILE, lastUpdated: new Date() };

  const stored = parseStoredEnhancedProfileJson(content);
  if (!stored) {
    return convertToEnhancedProfile(parseUserProfile(content));
  }

  return {
    version: 2,
    preferences: stored.preferences.map((preference) => ({
      ...preference,
      updatedAt: new Date(preference.updatedAt),
      mentionCount: preference.mentionCount ?? 1,
    })),
    frequentLocations: stored.frequentLocations,
    identityFacts: stored.identityFacts || [],
    socialContextFacts: stored.socialContextFacts || [],
    lastUpdated: new Date(stored.lastUpdated),
    activityOutcomes: (stored.activityOutcomes || []).map((outcome) => ({
      ...outcome,
      happenedAt: new Date(outcome.happenedAt),
      updatedAt: new Date(outcome.updatedAt),
    })),
  };
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
    identityFacts: profile.identityFacts,
    socialContextFacts: profile.socialContextFacts,
    lastUpdated: profile.lastUpdated.toISOString(),
    activityOutcomes: profile.activityOutcomes?.map((outcome) => ({
      ...outcome,
      happenedAt: outcome.happenedAt.toISOString(),
      updatedAt: outcome.updatedAt.toISOString(),
    })),
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
    identityFacts: oldProfile.identityFacts,
    socialContextFacts: oldProfile.socialContextFacts,
    lastUpdated: now,
    activityOutcomes: [],
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
  const identityFacts = profile.identityFacts.slice(0, 3);
  const socialContextFacts = profile.socialContextFacts.slice(0, 3);
  const recentOutcomes = (profile.activityOutcomes || [])
    .slice()
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, 3);

  if (
    profile.preferences.length === 0 &&
    profile.frequentLocations.length === 0 &&
    identityFacts.length === 0 &&
    socialContextFacts.length === 0 &&
    recentOutcomes.length === 0
  ) {
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

  if (identityFacts.length > 0) {
    lines.push('## 用户身份线索');
    for (const fact of identityFacts) {
      lines.push(`- ${fact}`);
    }
    lines.push('');
  }
  
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

  if (socialContextFacts.length > 0) {
    lines.push('## 用户提过的重要关系线索');
    for (const fact of socialContextFacts) {
      lines.push(`- ${fact}`);
    }
    lines.push('');
  }

  if (recentOutcomes.length > 0) {
    lines.push('## 最近真实社交结果');
    for (const outcome of recentOutcomes) {
      const attendedText = outcome.attended === true ? '真实到场' : outcome.attended === false ? '未到场' : '到场待确认';
      const rebookText = outcome.rebookTriggered ? '已主动再约' : '暂未再约';
      const summaryText = outcome.reviewSummary?.trim() ? `，${outcome.reviewSummary.trim()}` : '';
      lines.push(`- ${outcome.activityTitle}（${outcome.activityType} · ${outcome.locationName}）：${attendedText}，${rebookText}${summaryText}`);
    }
    lines.push('');
  }
  
  lines.push('</user_profile>');
  lines.push('');
  lines.push('请根据用户画像个性化你的回复：');
  lines.push('- 如果用户有饮食禁忌（如不吃辣），推荐餐厅时要特别提醒');
  lines.push('- 如果用户有常去地点，优先推荐该区域的活动');
  lines.push('- 根据用户喜好推荐相关类型的活动');
  lines.push('- 遇到复盘、再约或活动推荐时，优先参考最近真实社交结果，而不是只看聊天表述');
  lines.push('- 如果用户问“你记得我吗”或“我是谁”，基于上方用户画像自然回应；有画像就简要复述，没有就坦诚说明并邀请用户分享偏好');
  
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
  const memories = await listActiveUserMemories(userId);
  const preferences = memories
    .map((record) => normalizeEnhancedPreference(record))
    .filter((item): item is EnhancedPreference => item !== null)
    .slice(0, 30);
  const frequentLocations = memories
    .filter((record) => record.memoryType === 'social_context' && record.content.startsWith('常去地点：'))
    .map((record) => record.content.replace(/^常去地点：/, '').trim())
    .filter(Boolean)
    .slice(0, 5);
  const identityFacts = memories
    .filter((record) => record.memoryType === 'profile_fact')
    .map((record) => record.content.trim())
    .filter(Boolean)
    .slice(0, 6);
  const socialContextFacts = memories
    .filter((record) => record.memoryType === 'social_context' && !record.content.startsWith('常去地点：'))
    .map((record) => record.content.trim())
    .filter(Boolean)
    .slice(0, 6);
  const activityOutcomes = memories
    .map((record) => normalizeActivityOutcome(record))
    .filter((item): item is ActivityOutcome => item !== null);
  const lastUpdated = memories.length > 0
    ? memories.reduce((latest, record) => record.updatedAt > latest ? record.updatedAt : latest, memories[0].updatedAt)
    : new Date();

  return {
    version: 2,
    preferences,
    frequentLocations,
    identityFacts,
    socialContextFacts,
    lastUpdated,
    activityOutcomes,
  };
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
  const now = new Date();

  await Promise.all(
    cleaned.preferences.slice(0, 30).map(async (preference) => {
      const [existing] = await db
        .select({ id: userMemories.id, metadata: userMemories.metadata, importance: userMemories.importance })
        .from(userMemories)
        .where(
          sql`${userMemories.userId} = ${userId}
            AND ${userMemories.memoryType} = 'preference'
            AND ${userMemories.content} = ${preference.value}`
        )
        .limit(1);

      const metadata = {
        ...(isRecord(existing?.metadata) ? existing.metadata : {}),
        category: preference.category,
        sentiment: preference.sentiment,
        confidence: preference.confidence,
        mentionCount: preference.mentionCount,
        updatedAt: preference.updatedAt.toISOString(),
      };

      if (existing) {
        await db
          .update(userMemories)
          .set({
            metadata,
            importance: Math.max(existing.importance ?? 0, 2),
            updatedAt: now,
          })
          .where(eq(userMemories.id, existing.id));
        return;
      }

      await db.insert(userMemories).values({
        userId,
        memoryType: 'preference',
        content: preference.value,
        metadata,
        importance: 2,
        updatedAt: now,
      });
    }),
  );
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

  await saveEnhancedUserProfile(userId, {
    version: 2,
    preferences: mergeEnhancedPreferences(existing.preferences, newPrefs),
    frequentLocations: mergeArrayUnique(existing.frequentLocations, extraction.frequentLocations).slice(0, 5),
    identityFacts: mergeArrayUnique(existing.identityFacts, extraction.identityFacts).slice(0, 6),
    socialContextFacts: mergeArrayUnique(existing.socialContextFacts, extraction.socialContextFacts).slice(0, 6),
    lastUpdated: new Date(),
    activityOutcomes: existing.activityOutcomes || [],
  });
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

import type { EnhancedUserProfile as EnhancedUserProfileWithVectors } from './types';

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
  const [existing] = await db
    .select({
      id: userMemories.id,
      content: userMemories.content,
      metadata: userMemories.metadata,
    })
    .from(userMemories)
    .where(
      sql`${userMemories.userId} = ${userId}
        AND ${userMemories.memoryType} = 'activity_outcome'
        AND ${userMemories.metadata}->>'activityId' = ${vector.activityId}`
    )
    .limit(1);

  const nextMetadata = {
    ...(isRecord(existing?.metadata) ? existing.metadata : {}),
    activityId: vector.activityId,
    feedback: vector.feedback ?? null,
    participatedAt: vector.participatedAt.toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    await db
      .update(userMemories)
      .set({
        embedding: vector.embedding,
        metadata: nextMetadata,
        updatedAt: new Date(),
      })
      .where(eq(userMemories.id, existing.id));
    return;
  }

  await db.insert(userMemories).values({
    userId,
    memoryType: 'activity_outcome',
    content: `活动结果：${vector.activityId}`,
    embedding: vector.embedding,
    metadata: nextMetadata,
    importance: 2,
  });
}

/**
 * 获取用户兴趣向量
 * 
 * @param userId - 用户 ID
 * @returns 兴趣向量数组（最多 3 个）
 */
export async function getInterestVectors(userId: string): Promise<InterestVector[]> {
  const memories = await listActiveUserMemories(userId);
  return memories
    .map((record) => normalizeInterestVector(record))
    .filter((item): item is InterestVector => item !== null)
    .slice(0, MAX_INTEREST_VECTORS);
}

/**
 * 清除用户兴趣向量
 * 
 * @param userId - 用户 ID
 */
export async function clearInterestVectors(userId: string): Promise<void> {
  await db
    .update(userMemories)
    .set({
      embedding: null,
      updatedAt: new Date(),
    })
    .where(
      sql`${userMemories.userId} = ${userId}
        AND ${userMemories.memoryType} = 'activity_outcome'`
    );
}

export interface ActivityOutcomeMemoryInput {
  activityId: string;
  activityTitle: string;
  activityType: string;
  locationName: string;
  attended: boolean | null;
  rebookTriggered?: boolean;
  reviewSummary?: string | null;
  happenedAt: Date;
  updatedAt?: Date;
}

function mergeActivityOutcome(
  existing: ActivityOutcome | undefined,
  input: ActivityOutcomeMemoryInput,
): ActivityOutcome {
  return {
    activityId: input.activityId,
    activityTitle: input.activityTitle || existing?.activityTitle || '',
    activityType: input.activityType || existing?.activityType || 'other',
    locationName: input.locationName || existing?.locationName || '',
    attended: input.attended ?? existing?.attended ?? null,
    rebookTriggered: input.rebookTriggered ?? existing?.rebookTriggered ?? false,
    reviewSummary: input.reviewSummary ?? existing?.reviewSummary ?? null,
    happenedAt: input.happenedAt || existing?.happenedAt || new Date(),
    updatedAt: input.updatedAt || new Date(),
  };
}

function sortActivityOutcomes(outcomes: ActivityOutcome[]): ActivityOutcome[] {
  return outcomes
    .slice()
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    .slice(0, 10);
}

export async function upsertActivityOutcomeMemory(
  userId: string,
  input: ActivityOutcomeMemoryInput,
): Promise<void> {
  const [existing] = await db
    .select({
      id: userMemories.id,
      content: userMemories.content,
      metadata: userMemories.metadata,
      embedding: userMemories.embedding,
    })
    .from(userMemories)
    .where(
      sql`${userMemories.userId} = ${userId}
        AND ${userMemories.memoryType} = 'activity_outcome'
        AND ${userMemories.metadata}->>'activityId' = ${input.activityId}`
    )
    .limit(1);

  const existingOutcome = existing
    ? normalizeActivityOutcome({
        id: existing.id,
        memoryType: 'activity_outcome',
        content: existing.content,
        embedding: existing.embedding,
        metadata: isRecord(existing.metadata) ? existing.metadata : {},
        importance: 0,
        createdAt: input.updatedAt ?? new Date(),
        updatedAt: input.updatedAt ?? new Date(),
      })
    : undefined;
  const merged = mergeActivityOutcome(existingOutcome ?? undefined, input);
  const nextMetadata = {
    ...(isRecord(existing?.metadata) ? existing.metadata : {}),
    activityId: merged.activityId,
    activityTitle: merged.activityTitle,
    activityType: merged.activityType,
    locationName: merged.locationName,
    attended: merged.attended,
    rebookTriggered: merged.rebookTriggered,
    reviewSummary: merged.reviewSummary ?? null,
    happenedAt: merged.happenedAt.toISOString(),
    updatedAt: merged.updatedAt.toISOString(),
  };
  const nextContent = merged.reviewSummary?.trim()
    ? merged.reviewSummary.trim()
    : `活动结果：${merged.activityTitle}（${merged.locationName}）`;

  if (existing) {
    await db
      .update(userMemories)
      .set({
        content: nextContent,
        metadata: nextMetadata,
        updatedAt: merged.updatedAt,
      })
      .where(eq(userMemories.id, existing.id));
    return;
  }

  await db.insert(userMemories).values({
    userId,
    memoryType: 'activity_outcome',
    content: nextContent,
    metadata: nextMetadata,
    importance: 3,
    updatedAt: merged.updatedAt,
  });
}

export async function markActivityOutcomeRebookTriggered(
  userId: string,
  input: Omit<ActivityOutcomeMemoryInput, 'rebookTriggered' | 'attended'> & {
    attended?: boolean | null;
    reviewSummary?: string | null;
  },
): Promise<void> {
  const profile = await getEnhancedUserProfileWithVectors(userId);
  const existing = (profile.activityOutcomes || []).find((item) => item.activityId === input.activityId);

  await upsertActivityOutcomeMemory(userId, {
    activityId: input.activityId,
    activityTitle: input.activityTitle,
    activityType: input.activityType,
    locationName: input.locationName,
    attended: input.attended ?? existing?.attended ?? null,
    rebookTriggered: true,
    reviewSummary: input.reviewSummary ?? existing?.reviewSummary ?? null,
    happenedAt: input.happenedAt,
    updatedAt: new Date(),
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
  identityFacts?: string[];
  socialContextFacts?: string[];
  lastUpdated: string;
  interestVectors?: Array<{
    activityId: string;
    embedding: number[];
    participatedAt: string;
    feedback?: 'positive' | 'neutral' | 'negative';
  }>;
  activityOutcomes?: Array<{
    activityId: string;
    activityTitle: string;
    activityType: string;
    locationName: string;
    attended: boolean | null;
    rebookTriggered: boolean;
    reviewSummary?: string | null;
    happenedAt: string;
    updatedAt: string;
  }>;
}

function readStoredEmbedding(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const numbers: number[] = [];
  for (const item of value) {
    const number = readFiniteNumber(item);
    if (number === null) {
      return null;
    }
    numbers.push(number);
  }

  return numbers;
}

function readStoredInterestVector(
  value: unknown,
): NonNullable<StoredEnhancedProfileWithVectors['interestVectors']>[number] | null {
  if (!isRecord(value)) {
    return null;
  }

  const activityId = readRequiredText(value.activityId);
  const embedding = readStoredEmbedding(value.embedding);
  const participatedAt = readDateString(value.participatedAt);

  if (!activityId || !embedding || !participatedAt) {
    return null;
  }

  const feedback = value.feedback;
  const normalizedFeedback =
    feedback === 'positive' || feedback === 'neutral' || feedback === 'negative'
      ? feedback
      : undefined;

  return {
    activityId,
    embedding,
    participatedAt,
    ...(normalizedFeedback ? { feedback: normalizedFeedback } : {}),
  };
}

function readStoredEnhancedProfileWithVectors(
  value: unknown,
): StoredEnhancedProfileWithVectors | null {
  const baseProfile = readStoredEnhancedProfile(value);
  if (!baseProfile || !isRecord(value)) {
    return null;
  }

  const interestVectors = Array.isArray(value.interestVectors)
    ? value.interestVectors
        .map((item) => readStoredInterestVector(item))
        .filter((item): item is NonNullable<StoredEnhancedProfileWithVectors['interestVectors']>[number] => item !== null)
    : undefined;

  return {
    ...baseProfile,
    ...(interestVectors ? { interestVectors } : {}),
  };
}

function parseStoredEnhancedProfileWithVectorsJson(
  content: string,
): StoredEnhancedProfileWithVectors | null {
  try {
    return readStoredEnhancedProfileWithVectors(JSON.parse(content));
  } catch {
    return null;
  }
}

function createStoredDefaultPreference(
  value: string,
): StoredEnhancedProfileWithVectors['preferences'][number] {
  return {
    category: 'activity_type',
    value,
    sentiment: 'like',
    confidence: 0.5,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 获取带兴趣向量的增强版用户画像
 */
export async function getEnhancedUserProfileWithVectors(
  userId: string
): Promise<EnhancedUserProfileWithVectors> {
  const profile = await getEnhancedUserProfile(userId);
  const memories = await listActiveUserMemories(userId);
  const interestVectors = memories
    .map((record) => normalizeInterestVector(record))
    .filter((item): item is InterestVector => item !== null)
    .slice(0, MAX_INTEREST_VECTORS);

  return {
    preferences: profile.preferences.map((preference) => preference.value),
    dislikes: profile.preferences
      .filter((preference) => preference.sentiment === 'dislike')
      .map((preference) => preference.value),
    frequentLocations: profile.frequentLocations,
    identityFacts: profile.identityFacts,
    socialContextFacts: profile.socialContextFacts,
    behaviorPatterns: [],
    version: 2,
    lastUpdated: profile.lastUpdated,
    interestVectors,
    activityOutcomes: profile.activityOutcomes || [],
  };
}

/**
 * 保存带兴趣向量的增强版用户画像
 */
export async function saveEnhancedUserProfileWithVectors(
  userId: string,
  profile: EnhancedUserProfileWithVectors
): Promise<void> {
  await Promise.all(
    (profile.interestVectors || []).slice(0, MAX_INTEREST_VECTORS).map((vector) => addInterestVector(userId, vector)),
  );

  await Promise.all(
    (profile.activityOutcomes || []).slice(0, 10).map((outcome) => upsertActivityOutcomeMemory(userId, {
      activityId: outcome.activityId,
      activityTitle: outcome.activityTitle,
      activityType: outcome.activityType,
      locationName: outcome.locationName,
      attended: outcome.attended,
      rebookTriggered: outcome.rebookTriggered,
      reviewSummary: outcome.reviewSummary ?? null,
      happenedAt: outcome.happenedAt,
      updatedAt: outcome.updatedAt,
    })),
  );
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
      identityFacts: [],
      socialContextFacts: [],
      behaviorPatterns: [],
      version: 2,
      lastUpdated: new Date(),
      interestVectors: [],
      activityOutcomes: [],
    };
  }

  const stored = parseStoredEnhancedProfileWithVectorsJson(content);
  if (!stored) {
    const oldProfile = parseUserProfile(content);
    return {
      ...oldProfile,
      version: 2,
      lastUpdated: new Date(),
      interestVectors: [],
      activityOutcomes: [],
    };
  }

  return {
    preferences: stored.preferences.map((preference) => preference.value),
    dislikes: stored.preferences
      .filter((preference) => preference.sentiment === 'dislike')
      .map((preference) => preference.value),
    frequentLocations: stored.frequentLocations,
    identityFacts: stored.identityFacts || [],
    socialContextFacts: stored.socialContextFacts || [],
    behaviorPatterns: [],
    version: 2,
    lastUpdated: new Date(stored.lastUpdated),
    interestVectors: (stored.interestVectors || []).map((vector) => ({
      ...vector,
      participatedAt: new Date(vector.participatedAt),
    })),
    activityOutcomes: (stored.activityOutcomes || []).map((outcome) => ({
      ...outcome,
      happenedAt: new Date(outcome.happenedAt),
      updatedAt: new Date(outcome.updatedAt),
    })),
  };
}

/**
 * 序列化带兴趣向量的增强版用户画像
 */
function serializeEnhancedProfileWithVectors(profile: EnhancedUserProfileWithVectors): string {
  const stored: StoredEnhancedProfileWithVectors = {
    version: 2,
    preferences: profile.preferences.map((preference) => createStoredDefaultPreference(preference)),
    frequentLocations: profile.frequentLocations,
    identityFacts: profile.identityFacts,
    socialContextFacts: profile.socialContextFacts,
    lastUpdated: profile.lastUpdated.toISOString(),
    interestVectors: profile.interestVectors?.map(v => ({
      activityId: v.activityId,
      embedding: v.embedding,
      participatedAt: v.participatedAt.toISOString(),
      feedback: v.feedback,
    })),
    activityOutcomes: profile.activityOutcomes?.map((outcome) => ({
      ...outcome,
      happenedAt: outcome.happenedAt.toISOString(),
      updatedAt: outcome.updatedAt.toISOString(),
    })),
  };
  return JSON.stringify(stored);
}
