import * as dotenv from 'dotenv';
import { sql } from 'drizzle-orm';

dotenv.config({ path: '../../.env' });

import { aiConfigs } from './schema';
import { systemTemplateConfigSeed } from './ai-config-seeds/system-template';

const welcomeCopyConfig = {
  fallbackNickname: '朋友',
  subGreeting: '今天想约什么局？',
  stateSubGreetings: {
    hasDraft: '你有一个草稿还没发出去，要不要现在继续？',
    pendingActivities: '你有 {count} 个待参加活动，先看看接下来怎么安排？',
    lowPreference: '告诉我你偏爱什么，我会更懂你。',
    nearbyExplore: '附近有新局，想直接看看吗？',
  },
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
  chatShell: {
    composerHint: '也可以直接说地方、时间、类型或你想找的人',
    pendingActionTitle: '待恢复动作',
    pendingActionDefaultMessage: '这一步已经挂起，登录后会继续替你办完。',
    pendingActionLoginHint: '完成登录后回到这里，我会自动继续。',
    pendingActionBindPhoneHint: '完成绑定手机号后回到这里，我会自动继续。',
    pendingActionResumeLabel: '我已完成，继续',
    runtimeStatus: {
      networkOfflineText: '网络连接已断开',
      networkRetryText: '重试',
      networkRestoredToast: '网络已恢复',
      widgetErrorMessage: '出了点问题',
      widgetErrorRetryText: '重试',
    },
  },
  sidebar: {
    title: 'xu',
    messageCenterLabel: '消息中心',
    currentTasksTitle: '现在最需要继续的事',
    currentTasksEmpty: '当前没有需要继续推进的事，新的进展会先出现在这里。',
    historyTitle: '历史会话',
    searchPlaceholder: '搜索历史会话',
    emptySearchResult: '没有找到匹配的历史会话。',
    emptyHistory: '还没有历史会话，发起第一条消息后这里就会出现。',
  },
};

const messageCenterUiConfig = {
  title: '消息中心',
  description: '待确认搭子、活动后跟进、群聊摘要都在这里处理。',
  visitorTitle: '这里会接住后续进展',
  visitorDescription: '待确认搭子、活动后跟进和群聊未读，都会整理到这里。',
  summaryTitle: '未读总数',
  actionInboxSectionTitle: '等你处理',
  actionInboxDescription: '先把最需要你接一下的事摆在上面，点开就能继续原来的那条链路。',
  actionInboxEmpty: '当前没有必须立刻处理的事，新的进展会先出现在这里。',
  pendingMatchesTitle: '待确认搭子',
  pendingMatchesEmpty: '当前没有待确认匹配，新的搭子撮合到了会先出现在这里。',
  requestAuthHint: '请先登录后再查看消息中心',
  loadFailedText: '消息中心加载失败',
  markReadSuccess: '已标记为已读',
  markReadFailed: '标记已读失败',
  pendingDetailAuthHint: '请先登录后再查看匹配详情',
  pendingDetailLoadFailed: '详情加载失败',
  actionFailed: '操作失败，请稍后再试',
  followUpFailed: '发起失败，请稍后再试',
  refreshLabel: '刷新消息中心',
  systemSectionTitle: '系统跟进',
  systemEmpty: '暂无系统通知，活动进度有变化会第一时间出现在这里。',
  feedbackPositiveLabel: '挺顺利',
  feedbackNeutralLabel: '一般',
  feedbackNegativeLabel: '没成局',
  reviewActionLabel: '去复盘',
  rebookActionLabel: '去再约',
  kickoffActionLabel: '让 AI 帮我写开场白',
  markReadActionLabel: '标记已读',
  chatSummarySectionTitle: '活动群聊摘要',
  chatSummaryDescription: '这里汇总活动群聊的最近动态，点进详情可以继续讨论和跟进。',
  chatSummaryEmpty: '暂无活动群聊记录，参与活动后这里会同步显示最近动态。',
  chatSummaryFallbackMessage: '还没人说话，发句开场吧',
  chatSummaryOpenActionLabel: '进入讨论区',
};

const authGateUiConfig = {
  loginTitle: '登录后继续',
  bindPhoneTitle: '用手机号继续',
  loginDescription: '先确认身份，后续进展和讨论记录会接着保留。',
  bindPhoneDescription: '这一步需要确认可联系的手机号，完成后会继续刚才的动作。',
  invalidPhoneText: '请输入 11 位手机号',
  missingCodeText: '请输入验证码',
  loginFailedText: '登录失败，请稍后再试',
  phonePlaceholder: '手机号',
  codePlaceholder: '验证码',
  submitLabel: '继续',
  submittingLabel: '正在继续',
  privacyHint: '当前使用手机号验证码登录承接动作，完成后会继续刚才的动作。',
};

const reportUiConfig = {
  titleByType: {
    activity: '举报活动',
    message: '举报消息',
    user: '举报用户',
  },
  sectionTitles: {
    reason: '请选择举报原因',
    description: '补充说明（可选）',
  },
  descriptionPlaceholder: '请描述具体问题...',
  submitLabel: '提交举报',
  reasons: {
    inappropriate: '违规内容',
    fake: '虚假信息',
    harassment: '骚扰行为',
    other: '其他',
  },
  toast: {
    missingReason: '请选择举报原因',
    invalidTarget: '举报目标无效',
    invalidType: '举报类型无效',
    success: '举报已提交',
    failed: '举报失败',
    networkError: '网络错误，请重试',
  },
};

const feedbackUiConfig = {
  title: '活动体验如何？',
  positiveLabel: '挺好的',
  negativeLabel: '有问题',
  problemSectionTitle: '遇到什么问题？',
  nextStepLabel: '下一步：选择反馈对象',
  targetSectionTitle: '选择反馈对象',
  descriptionSectionTitle: '补充说明（选填）',
  descriptionPlaceholder: '请描述具体情况...',
  backLabel: '返回',
  submitLabel: '提交反馈',
  problems: {
    late: { label: '迟到', icon: 'time' },
    no_show: { label: '放鸽子', icon: 'close-circle' },
    bad_attitude: { label: '态度不好', icon: 'dissatisfaction' },
    not_as_described: { label: '与描述不符', icon: 'error-circle' },
    other: { label: '其他问题', icon: 'ellipsis' },
  },
  toast: {
    missingProblem: '请选择问题类型',
    missingTarget: '请选择反馈对象',
    success: '反馈已提交',
    failed: '提交失败',
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
    description: 'Welcome UI 下发配置（快捷入口、底部按钮）',
  },
  {
    configKey: 'ui.message_center',
    configValue: messageCenterUiConfig,
    category: 'ui',
    description: '消息中心壳层文案配置',
  },
  {
    configKey: 'ui.auth_gate',
    configValue: authGateUiConfig,
    category: 'ui',
    description: '认证动作闸门文案配置',
  },
  {
    configKey: 'ui.report',
    configValue: reportUiConfig,
    category: 'ui',
    description: '举报弹层文案与原因标签配置',
  },
  {
    configKey: 'ui.feedback',
    configValue: feedbackUiConfig,
    category: 'ui',
    description: '活动反馈弹层文案与问题类型配置',
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
