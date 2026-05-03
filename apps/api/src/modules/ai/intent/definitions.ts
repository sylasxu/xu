/**
 * Intent Definitions - 意图定义和正则模式
 *
 * 模式以可序列化的字符串形式存储，支持通过 ai_configs 表外置配置。
 * 消费侧通过 new RegExp(pattern, flags) 编译后使用。
 */

import type { IntentType } from './types';

/**
 * 模式定义（可序列化）
 */
export interface PatternDefinition {
  pattern: string;
  flags?: string;
}

/**
 * 意图正则模式定义
 *
 * 按优先级排序，匹配到即返回
 */
export const intentPatterns: Record<IntentType, PatternDefinition[]> = {
  // 流程控制类（高优先级）
  cancel: [
    { pattern: '改天|下次|先这样|不用了|算了|不找了|取消' },
  ],
  confirm: [
    { pattern: '^(对|是|好|没问题|可以|行|ok|yes|嗯)', flags: 'i' },
    { pattern: '就是这个|确认' },
  ],
  deny: [
    { pattern: '^(不|不是|不行|no|不好|不对)', flags: 'i' },
    { pattern: '换一个|不太行' },
  ],
  modify: [
    { pattern: '改|换|不是.*是|错了' },
    { pattern: '人数.*改|时间.*改|地点.*改' },
  ],

  // 社交动作类
  share: [
    { pattern: '分享|发给|邀请' },
    { pattern: '生成海报|海报' },
  ],
  join: [
    { pattern: '我也去|算我一个|报名|上车|加我' },
    { pattern: '带我一个' },
  ],

  // 信息查询
  show_activity: [
    { pattern: '我的活动|我发布的|以参与的' },
    { pattern: '历史活动|发过哪些' },
    { pattern: '看看活动' },
  ],

  // 闲聊意图（与组局无关的话题）
  chitchat: [
    { pattern: '你是谁|你叫什么|讲个笑话|今天天气' },
    { pattern: '你知道我是谁吗|你记得我吗|你了解我吗|你对我有印象吗|我是谁' },
    { pattern: '你好厉害|你真棒|哈哈|嘿嘿|呵呵' },
    { pattern: '无聊|聊聊天|陪我聊|说说话' },
  ],

  // 原有意图保持
  idle: [
    { pattern: '好的.*谢|谢谢.*不|拜拜|再见|88|byebye', flags: 'i' },
  ],

  manage: [
    { pattern: '我的活动|我发布的|我参与的' },
    { pattern: '取消活动|不办了' },
  ],

  partner: [
    { pattern: '找搭子|求搭子|找[^，。！？\\s]{0,12}搭子|谁组我就去|懒得组局|等人约' },
    { pattern: '我的意向|我的搭子意向' },
    { pattern: '确认匹配|确认发布' },
  ],

  create: [
    { pattern: '帮我组|帮我创建|自己组|我来组|我要组|我想组' },
  ],

  explore: [
    { pattern: '想找|找人|一起|有什么|附近|推荐|看看' },
    { pattern: '想.*打|想.*吃|想.*玩' },
    { pattern: '想|约' }, // 兜底
  ],

  unknown: [],
};

/**
 * 意图优先级顺序
 *
 * 按此顺序检查，先匹配到的优先
 */
export const intentPriority: IntentType[] = [
  'cancel',
  'confirm',
  'deny',
  'modify',
  'share',
  'join',
  'show_activity',
  'idle',
  'chitchat',
  'manage',
  'partner',
  'create',
  'explore',
  'unknown',
];

/**
 * 草稿上下文下的修改意图模式
 */
export const draftModifyPatterns: PatternDefinition[] = [
  { pattern: '改|换|加|减|调' },
  { pattern: '发布|没问题|就这样|确认' },
];

/**
 * 意图显示名称
 */
export const intentDisplayNames: Record<IntentType, string> = {
  create: '创建活动',
  explore: '探索附近',
  manage: '管理活动',
  partner: '找搭子',
  chitchat: '闲聊',
  idle: '暂停',
  modify: '修改指令',
  confirm: '确认',
  deny: '拒绝',
  cancel: '取消',
  share: '分享',
  join: '报名',
  show_activity: '查看活动',
  unknown: '未知',
};

/**
 * 闲聊模板回复
 */
export const chitchatResponses: string[] = [
  '哈哈，我只会帮你组局约人，闲聊就不太行了～想约点什么？',
  '聊天我不太擅长，但组局我很在行！想找人一起玩点什么？',
  '我是组局小助手，帮你约人才是我的强项～有什么想玩的吗？',
  '这个我不太懂，但如果你想约人吃饭、打球、桌游，随时找我！',
];

/**
 * 获取随机闲聊回复
 */
export function getRandomChitchatResponse(): string {
  return chitchatResponses[Math.floor(Math.random() * chitchatResponses.length)];
}
