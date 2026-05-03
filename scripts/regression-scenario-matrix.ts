export type RegressionLayer = 'flow' | 'protocol' | 'memory' | 'manual';
export type RegressionSuite = 'core' | 'extended';
export type RegressionDomain =
  | 'join_activity'
  | 'create_activity'
  | 'find_partner'
  | 'resume_task'
  | 'discussion'
  | 'message_center'
  | 'post_activity'
  | 'guardrails'
  | 'identity_memory'
  | 'protocol_contract';
export type BranchLength = 'short' | 'long';
export type UserMindset =
  | 'trial_browse'
  | 'trust_building'
  | 'auth_interrupted'
  | 'post_join_empty'
  | 'lazy_create'
  | 'condition_refine'
  | 'privacy_cautious'
  | 'async_waiting'
  | 'role_unclear'
  | 'multi_task_return'
  | 'post_activity_reflect'
  | 'error_recovery'
  | 'protocol_confidence';
export type TrustRisk =
  | 'early_login_wall'
  | 'dead_air'
  | 'task_loss'
  | 'privacy_exposure'
  | 'state_confusion'
  | 'role_confusion'
  | 'notification_disconnect'
  | 'memory_pollution'
  | 'protocol_break';
export type DropOffPoint =
  | 'entry'
  | 'activity_detail'
  | 'auth_gate'
  | 'discussion'
  | 'message_center'
  | 'pending_match'
  | 'notification_landing'
  | 'post_activity'
  | 'long_conversation'
  | 'protocol';
export type LongFlowId =
  | 'LF-1'
  | 'LF-2'
  | 'LF-3'
  | 'LF-4'
  | 'LF-5'
  | 'LF-6'
  | 'LF-7'
  | 'LF-8';

export const longFlowCatalog: Array<{ id: LongFlowId; title: string; userJourney: string }> = [
  {
    id: 'LF-1',
    title: '游客找局到报名后讨论',
    userJourney: '游客浏览/详情 -> 写入动作 auth gate -> 登录恢复 -> 报名成功 -> 进入讨论区',
  },
  {
    id: 'LF-2',
    title: '松散表达到确认发局',
    userJourney: '口语表达需求 -> AI 追问补齐 -> 草稿设置 -> 确认发布 -> 后续承接',
  },
  {
    id: 'LF-3',
    title: '活动结束到真实反馈',
    userJourney: '活动完成 -> fulfillment 确认 -> 反馈/复约 -> 真实结果写入长期记忆',
  },
  {
    id: 'LF-4',
    title: '长对话找搭子到确认成局',
    userJourney: '含糊找搭子 -> 即时搜索 -> 登录入池 -> 异步匹配 -> 确认成局 -> 讨论区',
  },
  {
    id: 'LF-5',
    title: '隐私谨慎到可信记忆',
    userJourney: '临时表达/身份信息 -> 不污染画像 -> 只把真实社交结果沉淀为 Memory',
  },
  {
    id: 'LF-6',
    title: '通知回流到任务现场',
    userJourney: '离开产品 -> 通知/消息中心/分享入口回流 -> 回到对应活动、匹配或待办',
  },
  {
    id: 'LF-7',
    title: '多任务返回时的优先级承接',
    userJourney: '多个任务并行 -> 首页判断最该接住的事 -> 消息中心保留其他任务',
  },
  {
    id: 'LF-8',
    title: '小范围多用户全场景自测',
    userJourney: '多类用户共同跑完创建、报名、讨论、找搭子、活动后续的核心分支',
  },
];

export interface ScenarioMatrixEntry {
  id: string;
  runner: string;
  layer: RegressionLayer;
  suite: RegressionSuite;
  domain: RegressionDomain;
  branchLength: BranchLength;
  userGoal: string;
  prdSections: string[];
  primarySurface: 'h5' | 'miniprogram' | 'shared' | 'api';
  scenarioType: 'happy_path' | 'branch' | 'recovery' | 'guardrail' | 'contract';
  userMindsets?: UserMindset[];
  trustRisks?: TrustRisk[];
  dropOffPoints?: DropOffPoint[];
  expectedFeeling?: string;
  longFlowIds?: LongFlowId[];
  notes?: string;
}

const scenarioMatrixEntries: ScenarioMatrixEntry[] = [
  {
    id: 'basic-discussion-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'discussion',
    branchLength: 'short',
    userGoal: '报名成功后进入讨论区并看到真实协作消息',
    prdSections: ['6.2 join_activity', '8.3 活动讨论区'],
    primarySurface: 'shared',
    scenarioType: 'happy_path',
    userMindsets: ['post_join_empty'],
    trustRisks: ['dead_air'],
    dropOffPoints: ['discussion'],
    expectedFeeling: '报名不是结束，后面马上有人和事接住',
  },
  {
    id: 'capacity-limit',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'join_activity',
    branchLength: 'short',
    userGoal: '活动满员时得到正确限制反馈',
    prdSections: ['6.2 join_activity', '8.2 活动详情'],
    primarySurface: 'shared',
    scenarioType: 'branch',
    userMindsets: ['trust_building'],
    trustRisks: ['state_confusion'],
    dropOffPoints: ['activity_detail'],
    expectedFeeling: '满员原因说清楚，不让我误以为系统坏了',
  },
  {
    id: 'duplicate-and-rejoin',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'join_activity',
    branchLength: 'short',
    userGoal: '退出后还能重新报名，不出现状态错乱',
    prdSections: ['6.2 join_activity'],
    primarySurface: 'shared',
    scenarioType: 'recovery',
    userMindsets: ['trust_building'],
    trustRisks: ['state_confusion', 'task_loss'],
    dropOffPoints: ['activity_detail'],
    expectedFeeling: '改主意后还能正常回来，不被旧状态卡住',
  },
  {
    id: 'permission-guards',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'guardrails',
    branchLength: 'short',
    userGoal: '游客 / 未绑手机在关键动作上被正确拦截',
    prdSections: ['认证闸门', 'Visitor-First + Action-Gated Auth'],
    primarySurface: 'shared',
    scenarioType: 'guardrail',
    userMindsets: ['trial_browse', 'auth_interrupted'],
    trustRisks: ['early_login_wall', 'task_loss'],
    dropOffPoints: ['auth_gate'],
    expectedFeeling: '可以先看懂，真要写入时再登录，而且不丢刚才的动作',
  },
  {
    id: 'cancel-visibility',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'join_activity',
    branchLength: 'short',
    userGoal: '活动取消后公开面与参与状态保持一致',
    prdSections: ['8.2 活动详情'],
    primarySurface: 'shared',
    scenarioType: 'branch',
    userMindsets: ['trust_building'],
    trustRisks: ['state_confusion', 'notification_disconnect'],
    dropOffPoints: ['activity_detail', 'message_center'],
    expectedFeeling: '活动变化被明确告知，不靠自己猜',
    longFlowIds: ['LF-6'],
  },
  {
    id: 'notifications-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'message_center',
    branchLength: 'short',
    userGoal: '消息中心能承接群聊和系统进展',
    prdSections: ['8.4 消息中心'],
    primarySurface: 'shared',
    scenarioType: 'happy_path',
    userMindsets: ['async_waiting', 'multi_task_return'],
    trustRisks: ['notification_disconnect', 'task_loss'],
    dropOffPoints: ['message_center'],
    expectedFeeling: '离开后再回来，消息中心知道我该接哪件事',
    longFlowIds: ['LF-6', 'LF-7'],
  },
  {
    id: 'post-activity-follow-up-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'post_activity',
    branchLength: 'short',
    userGoal: '活动结束后能直接写回真实反馈并继续下一步',
    prdSections: ['6.2 活动后续上', '8.4 消息中心'],
    primarySurface: 'shared',
    scenarioType: 'happy_path',
    userMindsets: ['post_activity_reflect'],
    trustRisks: ['memory_pollution', 'task_loss'],
    dropOffPoints: ['post_activity'],
    expectedFeeling: '反馈不是问卷，而是帮我把真实结果变成下一步',
    longFlowIds: ['LF-3'],
  },
  {
    id: 'ai-explore-without-location-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'join_activity',
    branchLength: 'short',
    userGoal: '没有定位时仍能被 AI 正确追问并继续找局',
    prdSections: ['状态首页', '找局主链'],
    primarySurface: 'shared',
    scenarioType: 'branch',
    userMindsets: ['trial_browse'],
    trustRisks: ['dead_air', 'state_confusion'],
    dropOffPoints: ['entry'],
    expectedFeeling: '信息不够时被自然追问，而不是看到空结果',
  },
  {
    id: 'ai-location-followup-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'join_activity',
    branchLength: 'short',
    userGoal: '定位补全后能继续推荐附近活动',
    prdSections: ['状态首页', '找局主链'],
    primarySurface: 'shared',
    scenarioType: 'recovery',
    userMindsets: ['trial_browse', 'condition_refine'],
    trustRisks: ['state_confusion', 'task_loss'],
    dropOffPoints: ['long_conversation'],
    expectedFeeling: '补充条件后它还记得我刚才想找什么',
  },
  {
    id: 'ai-join-auth-resume-discussion-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'resume_task',
    branchLength: 'short',
    userGoal: '报名动作被 auth gate 挂起后，登录能恢复并进入讨论区',
    prdSections: ['6.2 join_activity', '8.3 活动讨论区'],
    primarySurface: 'shared',
    scenarioType: 'recovery',
    userMindsets: ['trial_browse', 'auth_interrupted', 'post_join_empty'],
    trustRisks: ['early_login_wall', 'task_loss', 'dead_air'],
    dropOffPoints: ['auth_gate', 'discussion'],
    expectedFeeling: '登录后还是刚才那件事，报名后知道去哪协作',
    longFlowIds: ['LF-1'],
  },
  {
    id: 'ai-partner-search-bootstrap-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'find_partner',
    branchLength: 'short',
    userGoal: '找搭子先返回即时搜索结果，再决定是否继续留意',
    prdSections: ['即时搜索 + 明确下一步 + 可选异步意向池'],
    primarySurface: 'shared',
    scenarioType: 'happy_path',
    userMindsets: ['privacy_cautious', 'async_waiting'],
    trustRisks: ['privacy_exposure', 'dead_air'],
    dropOffPoints: ['entry', 'pending_match'],
    expectedFeeling: '先看到可信结果，再决定要不要把需求放进池子',
    longFlowIds: ['LF-4'],
  },
  {
    id: 'pending-match-confirm-creates-activity-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'find_partner',
    branchLength: 'short',
    userGoal: '匹配确认后能顺滑进入成局链路',
    prdSections: ['找搭子主链', '8.4 消息中心'],
    primarySurface: 'shared',
    scenarioType: 'happy_path',
    userMindsets: ['async_waiting', 'role_unclear'],
    trustRisks: ['role_confusion', 'task_loss'],
    dropOffPoints: ['pending_match', 'message_center'],
    expectedFeeling: '等到匹配后知道为什么是我确认，也知道确认后去哪里',
    longFlowIds: ['LF-4'],
  },
  {
    id: 'partner-confirm-to-discussion-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'find_partner',
    branchLength: 'short',
    userGoal: '找搭子匹配确认后，双方能进入讨论区且任务收口',
    prdSections: ['找搭子主链', '8.3 活动讨论区', '8.4 消息中心'],
    primarySurface: 'shared',
    scenarioType: 'happy_path',
    userMindsets: ['async_waiting', 'post_join_empty', 'role_unclear'],
    trustRisks: ['role_confusion', 'dead_air', 'task_loss'],
    dropOffPoints: ['pending_match', 'discussion'],
    expectedFeeling: '匹配不是一个通知，确认后马上进入可协作的局',
    longFlowIds: ['LF-4'],
  },
  {
    id: 'partner-scenario-fixtures-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'find_partner',
    branchLength: 'short',
    userGoal: '本地找搭子、异地同行、补位三类意向都能正确落库',
    prdSections: ['找搭子主链'],
    primarySurface: 'shared',
    scenarioType: 'branch',
    userMindsets: ['condition_refine'],
    trustRisks: ['state_confusion'],
    dropOffPoints: ['long_conversation'],
    expectedFeeling: '不同说法都被归到正确场景，不需要按系统词汇表达',
    longFlowIds: ['LF-4'],
  },
  {
    id: 'ai-destination-companion-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'find_partner',
    branchLength: 'short',
    userGoal: '带目的地约伴时，AI 能理解并给出可执行下一步',
    prdSections: ['找搭子主链'],
    primarySurface: 'shared',
    scenarioType: 'happy_path',
    userMindsets: ['condition_refine'],
    trustRisks: ['state_confusion', 'dead_air'],
    dropOffPoints: ['long_conversation'],
    expectedFeeling: '目的地和时间被理解成可以推进的找搭子任务',
    longFlowIds: ['LF-4'],
  },
  {
    id: 'partner-action-gate-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'find_partner',
    branchLength: 'short',
    userGoal: '游客可先搜索搭子，但入池动作必须被登录 / 绑手机号闸门接住',
    prdSections: ['Visitor-First + Action-Gated Auth', '找搭子主链'],
    primarySurface: 'shared',
    scenarioType: 'guardrail',
    userMindsets: ['trial_browse', 'auth_interrupted', 'privacy_cautious'],
    trustRisks: ['early_login_wall', 'privacy_exposure', 'task_loss'],
    dropOffPoints: ['auth_gate', 'pending_match'],
    expectedFeeling: '先试探不暴露，决定留意时登录也不会丢条件',
    longFlowIds: ['LF-4'],
  },
  {
    id: 'ai-draft-settings-form-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'create_activity',
    branchLength: 'short',
    userGoal: '发局草稿设置表单能完整补齐并确认发布',
    prdSections: ['create_activity 主链'],
    primarySurface: 'shared',
    scenarioType: 'happy_path',
    userMindsets: ['lazy_create', 'condition_refine'],
    trustRisks: ['task_loss', 'state_confusion'],
    dropOffPoints: ['long_conversation'],
    expectedFeeling: '我说得松散也能变成可确认、可发布的草稿',
    longFlowIds: ['LF-2'],
  },
  {
    id: 'ai-access-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'resume_task',
    branchLength: 'short',
    userGoal: '首页 welcome / chat 基础承接与访问权限正确',
    prdSections: ['状态首页', 'Visitor-First'],
    primarySurface: 'shared',
    scenarioType: 'guardrail',
    userMindsets: ['trial_browse'],
    trustRisks: ['early_login_wall'],
    dropOffPoints: ['entry'],
    expectedFeeling: '首页先接住我当前想做什么，而不是一上来要登录',
  },
  {
    id: 'partner-long-multi-user-branch-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'extended',
    domain: 'find_partner',
    branchLength: 'long',
    userGoal: '多用户长对话找搭子能入池、生成待确认匹配、拦截越权，并在取消后继续等待',
    prdSections: ['找搭子主链', '8.4 消息中心', '任务运行时'],
    primarySurface: 'shared',
    scenarioType: 'branch',
    userMindsets: ['condition_refine', 'async_waiting', 'role_unclear', 'privacy_cautious'],
    trustRisks: ['role_confusion', 'privacy_exposure', 'task_loss'],
    dropOffPoints: ['pending_match', 'message_center'],
    expectedFeeling: '长时间找搭子时，等待、确认、取消都清楚且不越权',
    longFlowIds: ['LF-4'],
  },
  {
    id: 'partner-condition-update-intent-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'extended',
    domain: 'find_partner',
    branchLength: 'long',
    userGoal: '长对话里多次改地点、时间和类型后，最终入池只采用最后条件',
    prdSections: ['找搭子主链', '任务运行时'],
    primarySurface: 'shared',
    scenarioType: 'branch',
    userMindsets: ['condition_refine', 'privacy_cautious'],
    trustRisks: ['state_confusion', 'privacy_exposure'],
    dropOffPoints: ['long_conversation', 'pending_match'],
    expectedFeeling: '我改口以后，系统按最后说法办事',
    longFlowIds: ['LF-4'],
  },
  {
    id: 'ai-long-conversation-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'extended',
    domain: 'create_activity',
    branchLength: 'long',
    userGoal: '长对话里持续完成发局链路',
    prdSections: ['create_activity 主链'],
    primarySurface: 'shared',
    scenarioType: 'happy_path',
    userMindsets: ['lazy_create', 'condition_refine'],
    trustRisks: ['task_loss', 'state_confusion'],
    dropOffPoints: ['long_conversation'],
    expectedFeeling: '多轮补充不会让我重来，最后能确认发布',
    longFlowIds: ['LF-2'],
  },
  {
    id: 'ai-transient-context-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'extended',
    domain: 'resume_task',
    branchLength: 'long',
    userGoal: '短暂上下文切换后仍能接住当前任务',
    prdSections: ['状态首页', '任务运行时'],
    primarySurface: 'shared',
    scenarioType: 'recovery',
    userMindsets: ['multi_task_return'],
    trustRisks: ['task_loss', 'state_confusion'],
    dropOffPoints: ['entry', 'long_conversation'],
    expectedFeeling: '我插一句别的再回来，系统仍知道主线在哪',
    longFlowIds: ['LF-7'],
  },
  {
    id: 'ai-multi-intent-cross-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'extended',
    domain: 'resume_task',
    branchLength: 'long',
    userGoal: '跨意图切换时不丢主任务',
    prdSections: ['状态首页', '任务运行时'],
    primarySurface: 'shared',
    scenarioType: 'branch',
    userMindsets: ['multi_task_return'],
    trustRisks: ['task_loss', 'state_confusion'],
    dropOffPoints: ['entry', 'message_center'],
    expectedFeeling: '同时想做几件事时，最高优先级被接住，其他任务不丢',
    longFlowIds: ['LF-7'],
  },
  {
    id: 'ai-anonymous-long-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'extended',
    domain: 'guardrails',
    branchLength: 'long',
    userGoal: '游客长链对话不误入需要登录的写入链路',
    prdSections: ['Visitor-First + Action-Gated Auth'],
    primarySurface: 'shared',
    scenarioType: 'guardrail',
    userMindsets: ['trial_browse', 'auth_interrupted'],
    trustRisks: ['early_login_wall', 'task_loss'],
    dropOffPoints: ['auth_gate', 'long_conversation'],
    expectedFeeling: '游客能聊清楚需求，但写入动作才触发登录',
    longFlowIds: ['LF-1', 'LF-4'],
  },
  {
    id: 'ai-error-recovery-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'extended',
    domain: 'resume_task',
    branchLength: 'long',
    userGoal: '错误恢复后还能继续推进当前链路',
    prdSections: ['任务运行时'],
    primarySurface: 'shared',
    scenarioType: 'recovery',
    userMindsets: ['error_recovery', 'multi_task_return'],
    trustRisks: ['task_loss', 'state_confusion'],
    dropOffPoints: ['long_conversation'],
    expectedFeeling: '出错后不用重讲一遍，继续刚才的事',
    longFlowIds: ['LF-7'],
  },
  {
    id: 'ai-rapid-fire-flow',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'extended',
    domain: 'protocol_contract',
    branchLength: 'long',
    userGoal: '快速连发时对话状态和流式协议不乱',
    prdSections: ['/ai/chat 统一协议'],
    primarySurface: 'shared',
    scenarioType: 'contract',
    userMindsets: ['protocol_confidence'],
    trustRisks: ['protocol_break', 'task_loss'],
    dropOffPoints: ['protocol'],
    expectedFeeling: '快速表达也不会把任务和回复顺序打乱',
  },
  {
    id: 'action-fast-exit-validation',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'join_activity',
    branchLength: 'short',
    userGoal: '结构化 Action 执行成功后走 fast exit，不触发完整 LLM 推理',
    prdSections: ['/ai/chat 统一协议', 'Action fast exit'],
    primarySurface: 'shared',
    scenarioType: 'happy_path',
    userMindsets: ['protocol_confidence'],
    trustRisks: ['protocol_break', 'task_loss'],
    dropOffPoints: ['protocol'],
    expectedFeeling: '明确动作被快速响应，不用等长篇大论',
  },
  {
    id: 'user-profile-propagation',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'core',
    domain: 'identity_memory',
    branchLength: 'short',
    userGoal: '活动真实结果写回后，后续 Action 能复用画像上下文',
    prdSections: ['Memory', '真实结果驱动 Memory', 'Action fast exit'],
    primarySurface: 'shared',
    scenarioType: 'happy_path',
    userMindsets: ['trust_building'],
    trustRisks: ['memory_pollution', 'task_loss'],
    dropOffPoints: ['long_conversation'],
    expectedFeeling: '它记得我做过什么，推荐和搜索都有上下文',
    longFlowIds: ['LF-3'],
  },
  {
    id: 'ai-explore-multi-user',
    runner: 'sandbox-regression',
    layer: 'flow',
    suite: 'extended',
    domain: 'join_activity',
    branchLength: 'short',
    userGoal: '多用户同时探索时各自拿到独立会话且互不干扰',
    prdSections: ['/ai/chat 统一协议'],
    primarySurface: 'shared',
    scenarioType: 'happy_path',
    userMindsets: ['trial_browse'],
    trustRisks: ['privacy_exposure', 'state_confusion'],
    dropOffPoints: ['entry'],
    expectedFeeling: '我和别人同时问，结果不会串',
  },
  {
    id: 'ten-user-world',
    runner: 'ten-user-world',
    layer: 'flow',
    suite: 'extended',
    domain: 'discussion',
    branchLength: 'long',
    userGoal: '10个用户在同一个世界中交叉创建、报名、讨论、匹配、完成活动',
    prdSections: ['create_activity 主链', '6.2 join_activity', '找搭子主链', '8.3 活动讨论区', '8.4 消息中心'],
    primarySurface: 'shared',
    scenarioType: 'happy_path',
    userMindsets: ['trust_building', 'async_waiting', 'multi_task_return'],
    trustRisks: ['state_confusion', 'notification_disconnect', 'task_loss'],
    dropOffPoints: ['discussion', 'message_center', 'pending_match'],
    expectedFeeling: '多人同时活动，我的状态和通知不会乱',
    longFlowIds: ['LF-8'],
  },
  {
    id: 'stream-full-pipeline',
    runner: 'chat-regression',
    layer: 'protocol',
    suite: 'core',
    domain: 'protocol_contract',
    branchLength: 'short',
    userGoal: 'SSE 顺序、GenUI block 结构、trace 节点都正确',
    prdSections: ['/ai/chat 统一协议'],
    primarySurface: 'api',
    scenarioType: 'contract',
    userMindsets: ['protocol_confidence'],
    trustRisks: ['protocol_break'],
    dropOffPoints: ['protocol'],
    expectedFeeling: '多端收到同一套稳定协议，前端不用猜',
  },
  {
    id: 'stream-guardrail',
    runner: 'chat-regression',
    layer: 'protocol',
    suite: 'core',
    domain: 'guardrails',
    branchLength: 'short',
    userGoal: '违规请求在流式协议下稳定拦截',
    prdSections: ['Guardrails', '/ai/chat 统一协议'],
    primarySurface: 'api',
    scenarioType: 'guardrail',
    userMindsets: ['protocol_confidence'],
    trustRisks: ['protocol_break'],
    dropOffPoints: ['protocol'],
    expectedFeeling: '被拦截时协议形态也稳定，不破坏客户端',
  },
  {
    id: 'identity-memory',
    runner: 'identity-memory-regression',
    layer: 'memory',
    suite: 'core',
    domain: 'identity_memory',
    branchLength: 'short',
    userGoal: '身份疑问句不会被错误解析为身份信息写入记忆',
    prdSections: ['Memory', '真实结果驱动 Memory', 'LF-5 隐私谨慎到可信记忆'],
    primarySurface: 'api',
    scenarioType: 'guardrail',
    userMindsets: ['privacy_cautious', 'protocol_confidence'],
    trustRisks: ['memory_pollution', 'protocol_break'],
    dropOffPoints: ['long_conversation'],
    expectedFeeling: '问"你知道我是谁吗"时得到自然回复，不会触发旧硬编码短路',
    longFlowIds: ['LF-5'],
  },
];

export function listScenarioMatrix(): ScenarioMatrixEntry[] {
  return [...scenarioMatrixEntries];
}

export function findScenarioMatrixEntry(id: string): ScenarioMatrixEntry | null {
  return scenarioMatrixEntries.find((entry) => entry.id === id) ?? null;
}

function addValues<T extends string>(target: Map<T, number>, values: T[] | undefined): void {
  for (const value of values ?? []) {
    target.set(value, (target.get(value) ?? 0) + 1);
  }
}

export function summarizeScenarioMatrix(entries: ScenarioMatrixEntry[]) {
  const byLayer = new Map<RegressionLayer, number>();
  const byDomain = new Map<RegressionDomain, number>();
  const byUserMindset = new Map<UserMindset, number>();
  const byTrustRisk = new Map<TrustRisk, number>();
  const byDropOffPoint = new Map<DropOffPoint, number>();
  const byLongFlow = new Map<LongFlowId, number>();

  for (const item of longFlowCatalog) {
    byLongFlow.set(item.id, 0);
  }

  for (const entry of entries) {
    byLayer.set(entry.layer, (byLayer.get(entry.layer) ?? 0) + 1);
    byDomain.set(entry.domain, (byDomain.get(entry.domain) ?? 0) + 1);
    addValues(byUserMindset, entry.userMindsets);
    addValues(byTrustRisk, entry.trustRisks);
    addValues(byDropOffPoint, entry.dropOffPoints);
    addValues(byLongFlow, entry.longFlowIds);
  }

  return {
    total: entries.length,
    byLayer: Object.fromEntries(byLayer),
    byDomain: Object.fromEntries(byDomain),
    byUserMindset: Object.fromEntries(byUserMindset),
    byTrustRisk: Object.fromEntries(byTrustRisk),
    byDropOffPoint: Object.fromEntries(byDropOffPoint),
    byLongFlow: Object.fromEntries(byLongFlow),
  };
}
