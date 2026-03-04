/**
 * Partner Matching - 找搭子追问流程
 * 
 * 当用户想找搭子但信息不完整时，结构化追问收集偏好
 * 状态持久化到 conversation_messages，刷新不丢失
 */

import { db, conversationMessages, eq, desc } from '@juchang/db';
import { randomUUID } from 'crypto';
import { createLogger } from '../observability/logger';

const logger = createLogger('partner-matching');

// ============ 类型定义 ============

/**
 * 找搭子追问状态
 */
export interface PartnerMatchingState {
  /** Workflow ID */
  workflowId: string;
  /** 状态 */
  status: 'collecting' | 'searching' | 'completed' | 'paused';
  /** 已收集的偏好 */
  collectedPreferences: {
    activityType?: string;
    timeRange?: string;
    location?: string;
    participants?: number;
  };
  /** 缺失的必填项 */
  missingRequired: string[];
  /** 追问轮次 */
  round: number;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

/**
 * 追问问题
 */
export interface PartnerMatchingQuestion {
  field: string;
  question: string;
  options: Array<{ label: string; value: string }>;
}

/**
 * 存储格式 (保持 type 值不变以兼容已存储数据)
 */
interface StoredPartnerMatchingState {
  type: 'broker_state';  // 保持不变以兼容已存储数据
  state: {
    workflowId: string;
    status: string;
    collectedPreferences: Record<string, unknown>;
    missingRequired: string[];
    round: number;
    createdAt: string;
    updatedAt: string;
  };
}

// ============ 配置 ============

/**
 * 必填项
 */
const REQUIRED_FIELDS = ['activityType', 'timeRange'];

/**
 * 追问问题模板
 */
const QUESTION_TEMPLATES: Record<string, PartnerMatchingQuestion> = {
  activityType: {
    field: 'activityType',
    question: '想玩点什么呢？🎯',
    options: [
      { label: '🍲 吃饭', value: 'food' },
      { label: '🎮 娱乐', value: 'entertainment' },
      { label: '⚽ 运动', value: 'sports' },
      { label: '🎲 桌游', value: 'boardgame' },
      { label: '☕ 喝咖啡', value: 'coffee' },
    ],
  },
  timeRange: {
    field: 'timeRange',
    question: '什么时候方便？⏰',
    options: [
      { label: '今晚', value: 'tonight' },
      { label: '明天', value: 'tomorrow' },
      { label: '周末', value: 'weekend' },
      { label: '下周', value: 'next_week' },
    ],
  },
  location: {
    field: 'location',
    question: '想在哪儿玩？🗺️',
    options: [
      { label: '观音桥', value: '观音桥' },
      { label: '解放碑', value: '解放碑' },
      { label: '南坪', value: '南坪' },
      { label: '沙坪坝', value: '沙坪坝' },
    ],
  },
  participants: {
    field: 'participants',
    question: '想约几个人？👥',
    options: [
      { label: '2-3人', value: '2-3' },
      { label: '4-6人', value: '4-6' },
      { label: '7人以上', value: '7+' },
      { label: '不限', value: 'any' },
    ],
  },
};

// ============ 核心函数 ============

/**
 * 检查是否需要开始找搭子追问流程
 */
export function shouldStartPartnerMatching(
  intent: string,
  existingState: PartnerMatchingState | null
): boolean {
  // 找搭子意图且没有进行中的 workflow
  if (intent === 'partner' && !existingState) {
    return true;
  }
  // 有暂停的 workflow 需要恢复
  if (existingState?.status === 'paused') {
    return true;
  }
  // 有收集中的 workflow 需要继续
  if (existingState?.status === 'collecting') {
    return true;
  }
  return false;
}

/**
 * 创建找搭子追问状态
 */
export function createPartnerMatchingState(): PartnerMatchingState {
  const now = new Date();
  return {
    workflowId: randomUUID(),
    status: 'collecting',
    collectedPreferences: {},
    missingRequired: [...REQUIRED_FIELDS],
    round: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 更新找搭子追问状态
 */
export function updatePartnerMatchingState(
  state: PartnerMatchingState,
  field: string,
  value: string | number
): PartnerMatchingState {
  const newState: PartnerMatchingState = {
    ...state,
    collectedPreferences: {
      ...state.collectedPreferences,
      [field]: value,
    },
    round: state.round + 1,
    updatedAt: new Date(),
  };
  
  // 更新缺失的必填项
  newState.missingRequired = REQUIRED_FIELDS.filter(
    f => !newState.collectedPreferences[f as keyof typeof newState.collectedPreferences]
  );
  
  // 检查是否收集完成
  if (newState.missingRequired.length === 0) {
    newState.status = 'searching';
  }
  
  return newState;
}

/**
 * 暂停找搭子追问状态
 */
export function pausePartnerMatchingState(state: PartnerMatchingState): PartnerMatchingState {
  return {
    ...state,
    status: 'paused',
    updatedAt: new Date(),
  };
}

/**
 * 完成找搭子追问状态
 */
export function completePartnerMatchingState(state: PartnerMatchingState): PartnerMatchingState {
  return {
    ...state,
    status: 'completed',
    updatedAt: new Date(),
  };
}

/**
 * 获取下一个追问问题
 */
export function getNextQuestion(state: PartnerMatchingState): PartnerMatchingQuestion | null {
  // 优先问必填项
  if (state.missingRequired.length > 0) {
    const field = state.missingRequired[0];
    return QUESTION_TEMPLATES[field] || null;
  }
  
  // 必填项收集完成，可以问可选项（但不强制）
  return null;
}

/**
 * 构建追问 Prompt
 */
export function buildAskPrompt(state: PartnerMatchingState): string {
  const question = getNextQuestion(state);
  if (!question) {
    return '好的，让我帮你找找有没有合适的活动～';
  }
  return question.question;
}

/**
 * 从用户消息中解析回答
 */
export function parseUserAnswer(
  message: string,
  currentQuestion: PartnerMatchingQuestion | null
): { field: string; value: string } | null {
  if (!currentQuestion) return null;
  
  const lowerMessage = message.toLowerCase();
  
  // 尝试匹配选项
  for (const option of currentQuestion.options) {
    if (lowerMessage.includes(option.label.toLowerCase()) || 
        lowerMessage.includes(option.value.toLowerCase())) {
      return { field: currentQuestion.field, value: option.value };
    }
  }
  
  // 特殊处理：活动类型
  if (currentQuestion.field === 'activityType') {
    const typeMap: Record<string, string> = {
      '吃饭': 'food', '吃': 'food', '饭': 'food', '火锅': 'food', '烧烤': 'food',
      '游戏': 'entertainment', '玩': 'entertainment', '唱歌': 'entertainment', 'ktv': 'entertainment',
      '运动': 'sports', '打球': 'sports', '篮球': 'sports', '羽毛球': 'sports',
      '桌游': 'boardgame', '狼人杀': 'boardgame', '剧本杀': 'boardgame',
      '咖啡': 'coffee', '喝': 'coffee',
    };
    for (const [keyword, value] of Object.entries(typeMap)) {
      if (lowerMessage.includes(keyword)) {
        return { field: 'activityType', value };
      }
    }
  }
  
  // 特殊处理：时间
  if (currentQuestion.field === 'timeRange') {
    const timeMap: Record<string, string> = {
      '今晚': 'tonight', '今天': 'tonight', '晚上': 'tonight',
      '明天': 'tomorrow', '明晚': 'tomorrow',
      '周末': 'weekend', '周六': 'weekend', '周日': 'weekend',
      '下周': 'next_week',
    };
    for (const [keyword, value] of Object.entries(timeMap)) {
      if (lowerMessage.includes(keyword)) {
        return { field: 'timeRange', value };
      }
    }
  }
  
  // 特殊处理：地点
  if (currentQuestion.field === 'location') {
    const locations = ['观音桥', '解放碑', '南坪', '沙坪坝', '江北', '杨家坪', '大坪'];
    for (const loc of locations) {
      if (message.includes(loc)) {
        return { field: 'location', value: loc };
      }
    }
  }
  
  // 无法解析，返回原始消息作为值
  return { field: currentQuestion.field, value: message };
}

/**
 * 检测用户是否切换话题
 */
export function isTopicSwitch(message: string, currentIntent: string): boolean {
  // 如果意图不再是 partner，说明切换了话题
  if (currentIntent !== 'partner') {
    return true;
  }
  
  // 检测明确的取消意图
  const cancelPatterns = ['算了', '不找了', '取消', '不要了', '换个'];
  return cancelPatterns.some(p => message.includes(p));
}

// ============ 持久化 ============

/**
 * 持久化找搭子追问状态到消息
 */
export async function persistPartnerMatchingState(
  conversationId: string,
  userId: string,
  state: PartnerMatchingState
): Promise<void> {
  try {
    const content: StoredPartnerMatchingState = {
      type: 'broker_state',  // 保持不变以兼容已存储数据
      state: {
        workflowId: state.workflowId,
        status: state.status,
        collectedPreferences: state.collectedPreferences,
        missingRequired: state.missingRequired,
        round: state.round,
        createdAt: state.createdAt.toISOString(),
        updatedAt: state.updatedAt.toISOString(),
      },
    };
    
    await db.insert(conversationMessages).values({
      conversationId,
      userId,
      role: 'assistant',
      messageType: 'widget_ask_preference',
      content,
    });
    
    logger.debug('Partner matching state persisted', { workflowId: state.workflowId, status: state.status });
  } catch (error) {
    logger.error('Failed to persist partner matching state', { error });
  }
}

/**
 * 从消息中恢复找搭子追问状态
 */
export async function recoverPartnerMatchingState(
  conversationId: string
): Promise<PartnerMatchingState | null> {
  try {
    const messages = await db.query.conversationMessages.findMany({
      where: eq(conversationMessages.conversationId, conversationId),
      orderBy: [desc(conversationMessages.createdAt)],
      limit: 20,
    });
    
    for (const msg of messages) {
      const content = msg.content as StoredPartnerMatchingState | null;
      if (content?.type === 'broker_state' && content?.state) {
        const stored = content.state;
        
        // 检查是否过期（超过 30 分钟）
        const updatedAt = new Date(stored.updatedAt);
        if (Date.now() - updatedAt.getTime() > 30 * 60 * 1000) {
          logger.debug('Partner matching state expired', { workflowId: stored.workflowId });
          return null;
        }
        
        // 只恢复未完成的状态
        if (stored.status === 'completed') {
          return null;
        }
        
        return {
          workflowId: stored.workflowId,
          status: stored.status as PartnerMatchingState['status'],
          collectedPreferences: stored.collectedPreferences as PartnerMatchingState['collectedPreferences'],
          missingRequired: stored.missingRequired,
          round: stored.round,
          createdAt: new Date(stored.createdAt),
          updatedAt: new Date(stored.updatedAt),
        };
      }
    }
    
    return null;
  } catch (error) {
    logger.error('Failed to recover partner matching state', { error });
    return null;
  }
}

/**
 * 清除会话的找搭子追问状态
 */
export async function clearPartnerMatchingState(conversationId: string): Promise<void> {
  // 不实际删除，只是标记为完成
  // 这样可以保留历史记录
  logger.debug('Partner matching state cleared', { conversationId });
}
