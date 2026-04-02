/**
 * Feature_Combination 规则引擎 - P1 层意图分类
 *
 * 基于多维特征组合（关键词 + 句式结构 + 上下文信号）进行意图分类，
 * 返回差异化置信度，避免单一关键词的贪婪匹配问题。
 *
 * 置信度公式：min(baseConfidence + hitCount × signalBoost, maxConfidence)
 */

import type { IntentType, ClassifyResult } from './types';
import { getConfigValue } from '../config/config.service';

// ============================================================
// 接口定义
// ============================================================

/** 特征信号 */
export interface FeatureSignal {
  /** 关键词匹配（任一命中即算） */
  keywords: string[];
  /** 句式结构模式 */
  syntaxPattern?: RegExp;
  /** 上下文信号（如最近意图） */
  contextSignal?: (history: Array<{ role: string; content: string }>) => boolean;
}

/** 特征组合规则 */
export interface FeatureCombinationRule {
  /** 目标意图 */
  intent: IntentType;
  /** 特征信号列表 */
  signals: FeatureSignal[];
  /** 基础置信度（至少命中 1 个信号时的起始值） */
  baseConfidence: number;
  /** 每命中一个额外信号增加的置信度 */
  signalBoost: number;
  /** 最大置信度上限 */
  maxConfidence: number;
}

// ============================================================
// 默认规则集
// ============================================================

/** 活动类型词（火锅、桌游、运动等） */
const ACTIVITY_TYPE_WORDS = [
  '火锅', '桌游', '运动', '打球', '羽毛球', '篮球', '足球', '乒乓',
  '吃饭', '聚餐', '烧烤', '唱歌', 'KTV', 'ktv', '电影', '爬山',
  '徒步', '骑行', '游泳', '健身', '瑜伽', '跑步', '钓鱼',
  '密室', '剧本杀', '狼人杀', '麻将', '扑克', '台球',
  '露营', '野餐', '逛街', '旅游', '滑雪', '滑冰',
  '喝酒', '喝咖啡', '下午茶', '宵夜',
];


/**
 * 默认特征组合规则集
 *
 * 设计原则：
 * - 高特异性组合（关键词 + 活动类型）给高置信度
 * - 单一通用词（"想"、"约"）给低置信度，交由 P2 确认
 * - 流程控制类意图（confirm/deny/cancel）使用句式模式匹配
 */
export const DEFAULT_FEATURE_RULES: FeatureCombinationRule[] = [
  // ---- 流程控制类（高优先级） ----
  {
    intent: 'confirm',
    signals: [
      { keywords: ['对', '是的', '没问题', '可以', '行', '好的', '确认', '就这样', '就是这个', 'ok', 'yes'] },
      { keywords: [], syntaxPattern: /^(对|是|好|嗯|行|没问题|可以|ok|yes)$/i },
    ],
    baseConfidence: 0.7,
    signalBoost: 0.15,
    maxConfidence: 0.95,
  },
  {
    intent: 'deny',
    signals: [
      { keywords: ['不是', '不行', '不好', '不对', '不要', '换一个', '不太行'] },
      { keywords: [], syntaxPattern: /^(不|不是|不行|no|不好|不对|不要)$/i },
    ],
    baseConfidence: 0.7,
    signalBoost: 0.15,
    maxConfidence: 0.95,
  },
  {
    intent: 'cancel',
    signals: [
      { keywords: ['算了', '不找了', '取消', '不用了', '改天', '下次再说', '先这样'] },
      { keywords: [], syntaxPattern: /算了|不找了|取消|不用了/ },
    ],
    baseConfidence: 0.7,
    signalBoost: 0.15,
    maxConfidence: 0.95,
  },
  {
    intent: 'modify',
    signals: [
      { keywords: ['改成', '换成', '不是.*是', '错了', '改一下'] },
      { keywords: [], syntaxPattern: /(人数|时间|地点|地方).*(改|换)/ },
      { keywords: [], syntaxPattern: /改成|换成|换个/ },
    ],
    baseConfidence: 0.6,
    signalBoost: 0.15,
    maxConfidence: 0.95,
  },

  // ---- 社交动作类 ----
  {
    intent: 'share',
    signals: [
      { keywords: ['分享', '发给', '邀请', '生成海报', '海报'] },
      { keywords: [], syntaxPattern: /分享|发给|邀请|海报/ },
    ],
    baseConfidence: 0.75,
    signalBoost: 0.1,
    maxConfidence: 0.95,
  },
  {
    intent: 'join',
    signals: [
      { keywords: ['我也去', '算我一个', '报名', '上车', '加我', '带我一个', '参加'] },
      { keywords: [], syntaxPattern: /我也去|算我一个|报名|上车/ },
    ],
    baseConfidence: 0.75,
    signalBoost: 0.1,
    maxConfidence: 0.95,
  },
  {
    intent: 'show_activity',
    signals: [
      { keywords: ['我的活动', '我发布的', '历史活动', '发过哪些', '看看活动'] },
      { keywords: [], syntaxPattern: /我的活动|我发布的|历史活动/ },
    ],
    baseConfidence: 0.75,
    signalBoost: 0.1,
    maxConfidence: 0.95,
  },

  // ---- 闲聊 ----
  {
    intent: 'chitchat',
    signals: [
      { keywords: ['你是谁', '你叫什么', '讲个笑话', '今天天气', '你好厉害', '你真棒'] },
      { keywords: ['无聊', '聊聊天', '陪我聊', '说说话'] },
      { keywords: [], syntaxPattern: /哈哈|嘿嘿|呵呵/ },
    ],
    baseConfidence: 0.6,
    signalBoost: 0.15,
    maxConfidence: 0.95,
  },

  // ---- 空闲/告别 ----
  {
    intent: 'idle',
    signals: [
      { keywords: ['谢谢', '拜拜', '再见', '88', 'byebye'] },
      { keywords: [], syntaxPattern: /好的.*谢|谢谢.*不|拜拜|再见|88|byebye/i },
    ],
    baseConfidence: 0.7,
    signalBoost: 0.1,
    maxConfidence: 0.95,
  },

  // ---- 管理活动 ----
  {
    intent: 'manage',
    signals: [
      { keywords: ['取消活动', '不办了', '管理活动'] },
      { keywords: [], syntaxPattern: /取消活动|不办了/ },
    ],
    baseConfidence: 0.7,
    signalBoost: 0.15,
    maxConfidence: 0.95,
  },

  // ---- 找搭子 ----
  {
    intent: 'partner',
    signals: [
      { keywords: ['找搭子', '求搭子', '谁组我就去', '懒得组局', '等人约'] },
      { keywords: ['我的意向', '我的搭子意向', '确认匹配', '确认发布'] },
      { keywords: [], syntaxPattern: /找搭子|求搭子|找[^，。！？\s]{0,12}搭子|谁组我就去|等人约/ },
    ],
    baseConfidence: 0.65,
    signalBoost: 0.15,
    maxConfidence: 0.95,
  },

  // ---- 创建活动（需要复合信号才给高置信度） ----
  {
    intent: 'create',
    signals: [
      // 信号 1：明确的组局动词
      { keywords: ['帮我组', '帮我创建', '自己组', '我来组', '我要组', '我想组', '发布活动', '创建活动'] },
      // 信号 2：组局动词 + 活动类型（句式模式）
      { keywords: [], syntaxPattern: /(帮我|我想|我要|我来|自己).*(组|创建|发布)/ },
      // 信号 3：包含活动类型词（作为辅助信号提升置信度）
      {
        keywords: [],
        contextSignal: (_history) => false, // 占位，实际通过 syntaxPattern 检测
        syntaxPattern: new RegExp(ACTIVITY_TYPE_WORDS.slice(0, 20).map(escapeRegExp).join('|')),
      },
    ],
    baseConfidence: 0.55,
    signalBoost: 0.2,
    maxConfidence: 0.95,
  },

  // ---- 探索附近（通用词需要复合信号） ----
  {
    intent: 'explore',
    signals: [
      // 信号 1：明确的探索词
      { keywords: ['想找', '找人', '附近', '推荐', '有什么活动', '看看附近'] },
      // 信号 2："想/约" + 活动类型词（复合信号）
      { keywords: [], syntaxPattern: /(想|约).*(打|吃|玩|去|来)/ },
      // 信号 3：包含活动类型词
      {
        keywords: [],
        syntaxPattern: new RegExp(ACTIVITY_TYPE_WORDS.slice(0, 20).map(escapeRegExp).join('|')),
      },
      // 信号 4：上下文中最近有 explore 意图（连续性）
      {
        keywords: [],
        contextSignal: (history) => {
          // 检查最近 2 条 assistant 消息是否包含探索相关内容
          const recentAssistant = history
            .filter((m) => m.role === 'assistant')
            .slice(-2);
          return recentAssistant.some((m) =>
            /附近|推荐|活动|找到/.test(m.content),
          );
        },
      },
    ],
    baseConfidence: 0.45,
    signalBoost: 0.15,
    maxConfidence: 0.9,
  },
];


// ============================================================
// 工具函数
// ============================================================

/** 转义正则特殊字符 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 检测单个信号是否命中
 *
 * 匹配逻辑：
 * - keywords 中任一关键词出现在 input 中即命中
 * - syntaxPattern 匹配 input 即命中
 * - contextSignal 返回 true 即命中
 * - 以上任一条件满足即视为该信号命中
 */
function matchSignal(
  signal: FeatureSignal,
  input: string,
  conversationHistory: Array<{ role: string; content: string }>,
): boolean {
  // 关键词匹配
  if (signal.keywords.length > 0) {
    const keywordHit = signal.keywords.some((kw) => input.includes(kw));
    if (keywordHit) return true;
  }

  // 句式结构匹配
  if (signal.syntaxPattern && signal.syntaxPattern.test(input)) {
    return true;
  }

  // 上下文信号匹配
  if (signal.contextSignal && signal.contextSignal(conversationHistory)) {
    return true;
  }

  return false;
}

// ============================================================
// 核心分类函数
// ============================================================

/**
 * 基于特征组合的意图分类（纯函数）
 *
 * 遍历所有规则，计算每条规则的命中信号数和置信度，
 * 返回置信度最高的匹配结果。
 *
 * 置信度公式：min(baseConfidence + hitCount × signalBoost, maxConfidence)
 * - hitCount = 该规则中命中的信号数量
 * - 至少命中 1 个信号才计入候选
 *
 * @param input - 用户输入（已净化）
 * @param conversationHistory - 最近对话历史
 * @returns 分类结果，无匹配时返回 unknown
 */
export async function classifyByFeatureCombination(
  input: string,
  conversationHistory: Array<{ role: string; content: string }>,
): Promise<ClassifyResult> {
  const rules = await loadFeatureRules();

  let bestResult: ClassifyResult = {
    intent: 'unknown',
    confidence: 0,
    method: 'regex',
  };

  for (const rule of rules) {
    // 统计命中的信号数量
    let hitCount = 0;
    const hitFeatures: string[] = [];

    for (let i = 0; i < rule.signals.length; i++) {
      if (matchSignal(rule.signals[i], input, conversationHistory)) {
        hitCount++;
        hitFeatures.push(`signal_${i}`);
      }
    }

    // 至少命中 1 个信号才计入候选
    if (hitCount === 0) continue;

    // 置信度公式：min(baseConfidence + hitCount × signalBoost, maxConfidence)
    const confidence = Math.min(
      rule.baseConfidence + hitCount * rule.signalBoost,
      rule.maxConfidence,
    );

    // 取置信度最高的结果
    if (confidence > bestResult.confidence) {
      bestResult = {
        intent: rule.intent,
        confidence,
        method: 'regex',
        matchedPattern: hitFeatures.join(','),
        p1Features: hitFeatures,
      };
    }
  }

  // P1 对语义类意图只做特征提示，不直接判案，强制走到 P2 LLM
  const SEMANTIC_INTENTS = new Set<IntentType>(['chitchat', 'explore', 'create', 'partner', 'manage']);
  if (SEMANTIC_INTENTS.has(bestResult.intent) && bestResult.confidence >= 0.7) {
    bestResult.confidence = Math.min(bestResult.confidence, 0.65);
  }

  return bestResult;
}

// ============================================================
// 规则加载
// ============================================================

/**
 * 加载特征组合规则
 *
 * 优先从数据库配置加载（通过 AI 配置模块），降级到默认内置规则。
 * 支持通过 Admin 在线编辑规则集。
 *
 * @returns 生效的规则集
 */
export async function loadFeatureRules(): Promise<FeatureCombinationRule[]> {
  return getConfigValue<FeatureCombinationRule[]>('intent.feature_rules', DEFAULT_FEATURE_RULES);
}
