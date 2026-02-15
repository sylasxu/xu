/**
 * Memory Module - 记忆系统模块
 * 
 * 导出会话存储和工作记忆相关函数（移除语义记忆）
 */

// Types
export type {
  ConversationThread,
  ConversationThreadMessage,
  RecalledMessage,
  UserProfile,
  SaveMessageParams,
  SessionWindowConfig,
} from './types';

export { DEFAULT_SESSION_WINDOW } from './types';

// Store - 会话存储
export {
  getOrCreateThread,
  getThread,
  getMessages,
  saveMessage,
  getUserThreads,
  deleteThread,
  clearUserThreads,
  getMessagesByActivityId,
} from './store';

// Working Memory - 用户工作记忆（旧版）
export {
  EMPTY_PROFILE,
  parseUserProfile,
  serializeUserProfile,
  injectWorkingMemory,
  mergeUserProfile,
  extractPreferencesFromHistory,
  // Database operations
  getWorkingMemory,
  updateWorkingMemory,
  getUserProfile,
  updateUserProfile,
  clearWorkingMemory,
} from './working';

// Working Memory - 增强版用户画像
export type {
  EnhancedPreference,
  EnhancedUserProfile,
} from './working';

export {
  EMPTY_ENHANCED_PROFILE,
  parseEnhancedProfile,
  serializeEnhancedProfile,
  convertToEnhancedProfile,
  mergeEnhancedPreferences,
  extractionToEnhancedPreferences,
  buildProfilePrompt,
  getEnhancedUserProfile,
  saveEnhancedUserProfile,
  updateEnhancedUserProfile,
  injectEnhancedWorkingMemory,
  // v4.5 兴趣向量 (MaxSim)
  addInterestVector,
  getInterestVectors,
  clearInterestVectors,
  calculateMaxSim,
  getEnhancedUserProfileWithVectors,
  saveEnhancedUserProfileWithVectors,
} from './working';

// Types - v4.5 兴趣向量
export type { InterestVector } from './types';

// Extractor - LLM 偏好提取
export type {
  PreferenceCategory,
  PreferenceSentiment,
  ExtractedPreference,
  PreferenceExtraction,
} from './extractor';

export {
  extractPreferencesWithLLM,
  extractPreferencesSimple,
  extractPreferencesFromConversation,
} from './extractor';

// Semantic Search - 语义召回
export {
  semanticRecall
} from './semantic';
