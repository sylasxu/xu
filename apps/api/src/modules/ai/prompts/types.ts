/**
 * Prompts Module Types - 提示词模块类型定义
 */

/**
 * Prompt 上下文接口
 */
export interface PromptContext {
  /** 当前时间 */
  currentTime: Date;
  /** 用户位置 */
  userLocation?: {
    lat: number;
    lng: number;
    name?: string;
  };
  /** 用户昵称 */
  userNickname?: string;
  /** 草稿上下文 */
  draftContext?: {
    activityId: string;
    currentDraft: ActivityDraftForPrompt;
  };
  /** 用户工作记忆（Markdown 格式的用户画像） */
  workingMemory?: string | null;
}

/**
 * 活动草稿（用于 Prompt 上下文）
 */
export interface ActivityDraftForPrompt {
  title: string;
  type: string;
  locationName: string;
  locationHint: string;
  startAt: string;
  maxParticipants: number;
}

/**
 * Prompt 模板接口
 */
export interface PromptTemplate {
  /** 模板名称 */
  name: string;
  /** 版本号 */
  version: string;
  /** 描述 */
  description: string;
  /** 构建函数 */
  build: (context: PromptContext, contextXml?: string) => string;
}

/**
 * Prompt 信息（Admin 用）
 */
export interface PromptInfo {
  version: string;
  lastModified: string;
  description: string;
  features: string[];
  promptTechniques: readonly string[];
}
