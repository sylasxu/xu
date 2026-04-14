import * as dotenv from 'dotenv';
import { sql } from 'drizzle-orm';

dotenv.config({ path: '../../.env' });

import { aiConfigs } from './schema';
import { systemTemplateConfigSeed } from './ai-config-seeds/system-template';

const welcomeCopyConfig = {
  fallbackNickname: '朋友',
  subGreeting: '今天想约什么局？',
  greetingTemplates: {
    lateNight: '夜深了，{nickname}～',
    morning: '早上好，{nickname}！',
    forenoon: '上午好，{nickname}！',
    noon: '中午好，{nickname}！',
    afternoon: '下午好，{nickname}！',
    evening: '晚上好，{nickname}！',
    night: '夜深了，{nickname}～',
  },
};

const welcomeUiConfig = {
  composerPlaceholder: '你想找什么活动？',
  sectionTitles: {
    suggestions: '快速组局',
    explore: '探索附近',
  },
  exploreTemplates: {
    label: '看看{locationName}有什么局',
    prompt: '看看{locationName}附近有什么活动',
  },
  suggestionItems: [
    { icon: '🍜', label: '约饭局', prompt: '帮我组一个吃饭的局' },
    { icon: '🎮', label: '打游戏', prompt: '想找人一起打游戏' },
    { icon: '🏃', label: '运动', prompt: '想找人一起运动' },
    { icon: '☕', label: '喝咖啡', prompt: '想约人喝咖啡聊天' },
  ],
  quickPrompts: [
    { icon: '🗓️', text: '周末附近有什么活动？', prompt: '周末附近有什么活动' },
    { icon: '🤝', text: '帮我找个运动搭子', prompt: '帮我找个运动搭子' },
    { icon: '🎉', text: '想组个周五晚的局', prompt: '想组个周五晚的局' },
  ],
  bottomQuickActions: ['快速组局', '找搭子', '附近活动', '我的草稿'],
  profileHints: {
    low: '多聊一点，我会更懂你的偏好',
    medium: '我正在记住你的习惯',
    high: '你的偏好已经比较清楚，可以直接让我来安排',
  },
};

const modelIntentMapConfig = {
  chat: 'moonshot/kimi-k2.5',
  reasoning: 'moonshot/kimi-k2.5',
  agent: 'moonshot/kimi-k2.5',
  vision: 'moonshot/kimi-k2.5',
};

const modelRouteMapConfig = {
  chat: 'moonshot/kimi-k2.5',
  reasoning: 'moonshot/kimi-k2.5',
  agent: 'moonshot/kimi-k2.5',
  vision: 'moonshot/kimi-k2.5',
  content_generation: 'moonshot/kimi-k2.5',
  content_topic_suggestions: 'moonshot/kimi-k2.5',
  embedding: 'qwen/text-embedding-v4',
  rerank: 'moonshot/kimi-k2.5',
};

const modelFallbackConfig = {
  primary: 'moonshot',
  fallback: 'moonshot',
  maxRetries: 2,
  retryDelay: 1000,
  enableFallback: false,
};

const aiConfigSeeds = [
  {
    configKey: 'prompts.system_template',
    configValue: systemTemplateConfigSeed,
    category: 'prompts',
    description: 'AI System Prompt 模板（运行时必需配置）',
  },
  {
    configKey: 'welcome.copy',
    configValue: welcomeCopyConfig,
    category: 'welcome',
    description: 'Welcome 欢迎语模板（按时段）与副标题',
  },
  {
    configKey: 'welcome.ui',
    configValue: welcomeUiConfig,
    category: 'welcome',
    description: 'Welcome UI 下发配置（快捷入口、底部按钮、画像提示文案）',
  },
  {
    configKey: 'model.intent_map',
    configValue: modelIntentMapConfig,
    category: 'model',
    description: 'AI 主链路意图到模型的映射配置（兼容旧路由，推荐使用 provider/model 形式）',
  },
  {
    configKey: 'model.route_map',
    configValue: modelRouteMapConfig,
    category: 'model',
    description: 'AI workload 到模型路由的映射配置（推荐，显式 provider/model）',
  },
  {
    configKey: 'model.fallback_config',
    configValue: modelFallbackConfig,
    category: 'model',
    description: 'Provider 级 fallback 配置（默认关闭，不自动切到其他提供商）',
  },
];

export async function seedAiConfigs() {
  const { db } = await import('./db');
  const now = new Date();
  for (const item of aiConfigSeeds) {
    await db
      .insert(aiConfigs)
      .values({
        configKey: item.configKey,
        configValue: item.configValue,
        category: item.category,
        description: item.description,
        version: 1,
        updatedAt: now,
        updatedBy: 'seed-ai-configs',
      })
      .onConflictDoUpdate({
        target: aiConfigs.configKey,
        set: {
          configValue: item.configValue,
          category: item.category,
          description: item.description,
          updatedAt: now,
          updatedBy: 'seed-ai-configs',
          version: sql`${aiConfigs.version} + 1`,
        },
      });
  }
}

if (require.main === module) {
  seedAiConfigs()
    .then(() => {
      console.log(`✅ AI 配置已写入数据库，共 ${aiConfigSeeds.length} 项`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ AI 配置写入失败:', error);
      process.exit(1);
    });
}
