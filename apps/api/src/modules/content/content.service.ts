// Content Service - 内容运营领域业务逻辑

import {
  and,
  contentNotes,
  db,
  desc,
  eq,
  ilike,
  isNotNull,
  or,
  sql,
  type ContentNote,
  type ContentType,
  type SQL,
} from '@juchang/db'
import { generateObject, jsonSchema, NoObjectGeneratedError } from 'ai'
import { t } from 'elysia'
import { toJsonSchema } from '@juchang/utils'
import type {
  ContentAnalyticsResponse,
  ContentLibraryQuery,
  ContentLibraryResponse,
  ContentNoteResponse,
  PerformanceUpdateRequest,
  TopicSuggestionResponse,
} from './content.model'
import { resolveChatModelSelection } from '../ai/models/router'
import type { ContentPlatform } from './content-platform'
import {
  normalizeGeneratedContentNote,
  normalizeSuggestedTopics,
  type GeneratedContentDraft,
} from './content-note-normalizer'
import { createLogger } from '../ai/observability/logger'
import { normalizeAiProviderErrorMessage } from '../ai/models/provider-error'

const logger = createLogger('content.service')

const NoteOutputSchema = t.Object({
  title: t.String({ description: '适合目标平台的自然标题，8-18 字，像传单号题眼一样直接，不强求 emoji' }),
  body: t.String({ description: '正文 90-160 字，先直接说需求/人群/状态，不讲故事，不写成长文模板' }),
  hashtags: t.Array(t.String(), { description: '2-4 个话题标签，优先同城/场景/人群标签，不要堆热门词' }),
  coverText: t.String({
    description:
      '首图文案，6-12 个字，适合压在首图上或作为首图主题短句，要像组织号封面文案，不要夸张营销',
  }),
  coverImageHint: t.String({
    description:
      '首图配图提示词，按固定多行格式输出：主体 / 场景 / 构图 / 光线 / 氛围 / 避免项，可直接粘贴到平台文字配图输入框',
  }),
})

type NoteOutput = typeof NoteOutputSchema.static

const TopicSuggestionOutputSchema = t.Object({
  items: t.Array(t.String({
    description:
      '可直接填入主题输入框的一整句主题，尽量带时间/地点/活动/感受中的 1-2 个元素，不要写成单个关键词',
  }), {
    minItems: 3,
    maxItems: 3,
  }),
})

type TopicSuggestionOutput = typeof TopicSuggestionOutputSchema.static

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  activity_recruit: '组局招募',
  buddy_story: '需求共鸣',
  local_guide: '本地攻略',
  product_seed: '组织入口',
}

const CONTENT_PLATFORM_LABELS: Record<ContentPlatform, string> = {
  xiaohongshu: '小红书',
  douyin: '抖音',
  wechat: '微信',
}

const PLATFORM_PROMPT_RULES: Record<ContentPlatform, string> = {
  xiaohongshu: `平台规则（小红书）：
- 重点是“真实生活感 + 直接表达 + 一点点真实细节”
- 标题自然，不要硬钩子，不要故作炸裂
- 正文像真实用户发笔记，优先生活体验和当下感受，不要像营销文案
- 更像正常人直接发状态，不要写成散文、微小说、电影旁白
- 但这次更偏“传单式内容”，重点是让对的人一眼看懂：这是什么局、适合谁、为什么值得来、这里正在组织
- 正文第一句优先直接说状态、需求、判断或当下困扰，不要先铺环境和镜头
- 不要按“本来...后来...最后...”的完整时间线讲故事，也不要写成偶像剧式相遇片段
- 不要为了显得高级去补文艺镜头，比如旧书、窗景、冷泡茶、晚风、灯影这类无关细节
- 如果内容涉及早期产品或新方式，先写真实需求场景，再自然带出“最近在试的方式”或“最近发现的入口”，不要一开头就讲产品
- 首图文案要像真实博主会放在封面上的短句，短一点，有情绪但不喊口号
- 标签控制在 2-4 个，尽量自然
- 首图配图提示词要适合“小红书文字配图”的首图生成，优先生活化实拍感，不要海报感
- 首图画面要像真实博主会发的图，不要品牌 KV，不要大字报，不要过度设计`,
  douyin: `平台规则（抖音）：
- 更强调节奏感、画面感和一句话重点，开头要快进入场景
- 正文适合做口播或短视频文案，句子更短，更口语
- 首图文案可以更直接一点，但不要廉价爆款标题
- 不要写成完整长笔记，控制信息密度，利于直接配画面
- 标签控制在 2-4 个，不要堆砌
- 首图配图提示词更适合做图文首图或视频封面，要有清楚主体和第一眼重点
- 画面可以更有情绪和冲击力，但不要廉价爆款感`,
  wechat: `平台规则（微信）：
- 更适合熟人社交传播，语气可以更自然、更克制
- 重点是信息清楚、表达真诚，不要刻意制造平台感
- 首图文案简短自然，像一条正常分享的题眼，不要营销感
- 可以稍微完整一点，但仍然不要写成长文和模板腔
- 不要站外引流，也不要写成群发公告
- 首图配图提示词适合头图或封面，画面干净自然，不要过度网感
- 避免夸张滤镜、过强网红感和刻意摆拍`,
}

const CONTENT_TYPE_PROMPT_RULES: Record<ContentType, string> = {
  activity_recruit: `内容类型规则（活动招募）：
- 写成“我最近想组一个什么局/刚约了个什么局”的真人口吻
- 重点放在具体活动场景、时间感、参与氛围，以及“什么样的人会想来”
- 这类内容优先按“传单/招募卡片”去写，不要写成体验故事
- 要让读者快速看懂：这是什么局、适合什么人、为什么现在值得加入
- 可以自然带出“最近我在认真攒这种局”或“最近在帮人接这种搭子”，让人感觉这里真有人在推动这件事
- 更像在找同频的人一起玩，不像在发正式招募通知
- 可以轻轻带出“如果你也是这种状态/这种人，可能会想来”，但不要命令式号召
- 不要写成正式招募公告，不要像发布活动页文案`,
  buddy_story: `内容类型规则（搭子故事）：
- 这类内容现在按“需求共鸣内容”理解，不是讲一个完整故事
- 核心是把一个普通但真实的社交状态直接说出来，让同类人一眼觉得“这说的不就是我”
- 要让人觉得“这就是我平时会遇到的场景”，比如临时想吃火锅、周末想出门、想找人打球、下班后想随便坐坐
- 开头优先直接写当下状态、需求或犹豫，不要先铺环境和氛围
- 推荐结构是：先说现在卡在哪里 / 想要什么 -> 补一个真实场景或瞬间 -> 点到“这里有人在组织/有人懂这种需求”
- 中间只保留 1 个真实细节就够，不要设计对白，不要连续描写人物动作，不要写成小说
- 不要写“刚好遇见谁、聊着聊着发现、原来...”这类带转折的故事套路
- 结尾停在一个朴素感受上就行，不要鸡汤，不要强行升华
- 不要写成虚假的温情故事，不要写成“认识了特别特别好的朋友”这种过满表达
- 不要把重点放在产品功能上，重点放在人与场景
- 这类内容的目标是让同样有社交需求的人产生代入感：如果是我，我也想试试`,
  local_guide: `内容类型规则（本地攻略）：
- 重点是重庆本地体验、真实路线、踩点感受、适合谁去
- 多给具体信息，少写空泛夸赞
- 不要写成旅游平台攻略，也不要堆景点百科`,
  product_seed: `内容类型规则（产品种草）：
- 不要把产品写成“功能介绍”“产品发布”“内测招募说明”或“版本更新”
- 不要罗列 feature，不要写成工具清单，不要像老板让写的宣传稿
- 必须从一个真实社交卡点切入，比如“周末总想出门但约不到人”“微信群里喊人半天没人回”“谁组我就去但一直没入口”
- 这类内容更适合写成“需求传单”或“组织入口提示”，让有同类困扰的人立刻知道这里有人在组织
- 要让读者快速读懂：你遇到了什么卡点、这里提供了什么更顺手的组织方式、什么样的人会需要它
- 重点写“这个东西为什么对现在的我有用”，而不是“它有多先进、多智能”
- 更像真实需求识别和入口提示，比如“最近在试”“最近发现”“这种情况终于有人在认真组织”
- 可以带一点“最近我在认真帮人接搭子/攒局”的人味，让人感到不是冷冰冰的工具，而是真有人在帮忙把人约起来
- 产品露出要轻，只点到“有这么个方式/入口”就够，不要上来就讲品牌和能力
- 目标是筛出真正有类似需求的人，而不是追求所有人都感兴趣
- 可以让人感受到：这个东西降低了约人门槛，帮人更自然地找到同频搭子
- 不要站外引流，不要直接拉群，不要让用户加联系方式，不要诱导私信`,
}

const REAL_POST_STYLE_EXAMPLES = `以下是更接近真实小红书“找搭子/组局帖”的表达方向，只学语气和结构，不要照抄：

示例 1（周五下班饭搭子）：
标题：周五下班想找饭搭子
正文：坐标重庆，周五下班老是卡在没人约这一步。最近想攒个轻松饭局，吃点火锅或者家常菜都行，不用太会聊天，能接得上话就可以。AA、别太有负担，合得来再约下一次。

示例 2（周末轻运动小局）：
标题：周末有人打羽毛球吗
正文：这周末想动一动，不想一个人去球馆。想找两三个也想打羽毛球的人一起约个轻松局，水平一般也没事，主要是别太卷。打完各回各家，舒服一点最好。

示例 3（谁组我就去）：
标题：谁组我就去的人看过来
正文：我就是那种平时想出门，但很少主动喊人的人。最近也在认真帮这种“谁组我就去”的人接局，饭搭子、散步搭子、周末小活动都可以。不是硬社交，重点是有人能把第一步接住。`

const DEFAULT_SYSTEM_PROMPT = `你是一个很会写中文社交内容的本地生活创作者，同时也是一个擅长做“传单式内容起号”的内容运营。你熟悉重庆同城社交、搭子、探店和周末活动内容，也理解小红书、抖音、微信三种不同的平台语境。
你知道这类平台用户更吃“真实经历、具体细节、可代入的生活感”，不吃“硬广、假热闹、模板化钩子、平台外引流”。

默认读者：
- 关注重庆本地生活、同城社交、周末去处的年轻用户
- 更愿意看真实瞬间、具体体验、真诚表达，不喜欢被“教育”或被“带节奏”
- 也会被“这说的不就是我吗”“原来这里已经有人在组织了”这种强需求识别内容打动

写作风格：
- 像本人刚发的一条真实笔记，不像运营写给老板看的投放文案
- 先把事说清楚，再补一个真实场景或细节；不要为了氛围感硬写镜头
- 只保留必要的 1-2 个细节，少写空泛感悟，也不要堆动作描写
- 语气自然、克制、接地气，允许留白，不必处处都很“满”
- 正常用户发内容通常是直接开口，不会写成小散文、小小说、日记体
- 这次生成优先考虑“传单式表达”：像一张能快速筛选同频人群的内容卡片，而不是一篇故事或心得
- 更接近小红书里真实“求搭/组局”帖的写法：直接写时间、地点、想约什么、希望什么样的人来，必要时补一句边界感

${REAL_POST_STYLE_EXAMPLES}

当前阶段：
- 当前不是成熟产品投放，而是早期种子用户招募
- 文案目标不是卖功能，也不是追求泛流量，而是先筛出真正对“重庆同城找搭子、周末约局、轻社交”有真实需求的人
- 请优先输出“能打中真实生活卡点、让人产生代入感、愿意继续了解”的内容
- 少讲产品本身，多讲“这件事为什么对当下的人有用”
- 让对的人快速意识到：这里有人在认真帮我找搭子、接局、降低约人门槛，不用再一个人瞎刷或在群里硬喊
- 绝对不要写成正式招募帖、产品公告、版本更新说明或硬广

绝对禁止：
- 站外引流：不要写“加群”“私信我”“扣1”“评论区带你”“vx/微信/二维码/拉群/主页联系”等
- 夸张营销腔：不要写“闭眼冲”“错过血亏”“全网爆火”“天花板”“家人们”“姐妹们”
- 模板化互动结尾：不要硬塞“评论区聊聊”“想看的扣1”
- 生硬广告感、平台公告感、假装很真实的自嗨口吻`

const DEFAULT_CONTENT_PROMPT = `请为以下主题生成一篇社交内容稿：

主题：{topic}
发布平台：{platform}
内容方向：{contentType}

要求：
1. 标题：8-18 字，先自然再吸引人，不强求 emoji，不要标题党
2. 正文：90-160 字，最多 2-3 小段；更像真实发布，不要写成长篇模板
3. 正文第一句必须直接进入状态、需求、判断或困扰，不要用环境描写开头
4. 正文只需要 1 个具体场景或细节，比如时间、地点、动作、一个瞬间；够真实就行，不要贪多
5. 正文优先顺序是：真实卡点或需求 -> 具体生活场景 -> 轻微带出做法/新方式；不要一上来就讲产品
6. 默认把正文写成“能吸引想找搭子的人”的内容，直接讲清楚：现在是什么状态、想约什么、这里能怎么帮他更自然地接到搭子
7. 可以有一点招募感和组织感，但不要写成硬广，不要写成站外引流，不要直接索要联系方式
8. 不要站外引流，不要引导加群、私信、主页联系，也不要让用户“扣1”
9. 话题标签：2-4 个，贴近内容，不要堆热门词
10. 首图文案：输出 6-12 个字，适合压在首图上，不要和标题完全重复，不要口号感，不要营销腔，但要有“这里有人在组局/在组织”的感觉
11. 首图配图提示词：必须按下面固定格式输出，方便直接复制给平台“文字配图/AI 配图”使用：
主体：...
场景：...
构图：...
光线：...
氛围：...
避免项：...
12. 每一行尽量短，不要解释，不要写“帮我生成”，不要超过 6 行
13. 不要使用“先说结论/开头 hook/结尾互动引导”这种标准内容模板
14. 默认优先用“直接表达”的写法，不要写成散文、微小说、日记体长叙述
15. 不要写完整故事，不要铺陈气氛，不要设计人物出场，不要连续写动作链
16. 如果内容方向是“需求共鸣”或“组局招募”，重点写真实生活感和同城氛围，不要写成招募公告
17. 允许口语化，但不要油腻，不要鸡汤，不要强行升华
18. 如果内容方向是“需求共鸣”或“组织入口”，优先写真实社交卡点和具体生活场景，少讲产品，多讲需求为什么成立
19. 如果内容方向是“组局招募”或“组织入口”，目标是筛出同频的人，不是追求所有人都想点进来
20. 多用“谁适合来、什么状态的人会需要、这里正在组织什么”这类信息，不要沉迷写氛围
21. 正文不要出现“这版”“这条内容”“这种内容”“目标用户”“让人看懂”“更适合”“值得继续看”这类幕后说明口吻
22. 正文要像用户本人真的会发出去的话，不要像运营在分析这条内容的投放思路
23. 小红书正文优先参考这种真实发帖结构：时间/地点/状态 + 想约什么 + 希望来的人 + 轻松边界（比如不尬聊、AA、合适再约）
24. 可以写“坐标重庆”“周五下班”“周末”“想找个饭搭子/酒搭子/散步搭子/羽毛球搭子”这种直接说法，不要绕弯子
25. 可以自然带出“最近我在认真帮人攒局/接搭子/按兴趣约人”这种服务感，但要像真人发帖，不要像广告承诺`

const TOPIC_SUGGESTION_PROMPT = `你不是来写正文的，你是聚场内容运营的“主题起手助手”。

当前阶段不是成熟产品投放，而是早期种子用户招募。
你的目标不是追求泛流量，而是先筛出真正对“重庆同城找搭子、周末约局、轻社交”有真实需求的人。

请根据给定的平台和内容方向，生成 3 条“可直接点击填入”的主题建议。

生成目标：
1. 先写真实社交卡点，再写具体场景，最后轻微带出“这里能帮人更容易找到搭子”这层信息
2. 每条都要像用户真的会输入的一句主题，不要只给单个关键词
3. 每条尽量带上时间、地点、活动、情绪、人物关系中的 1-2 个元素
4. 要贴近聚场的真实场景：重庆、同城、周末活动、约饭、火锅、羽毛球、桌游、散步、喝茶聊天、找搭子、组局、谁组我就去
5. 不要写成功能介绍、产品公告、内测招募、版本更新说明
6. 每条尽量控制在 14-28 个字，最长不要超过 32 个字
7. 如果用户已经输入了一个方向，不要把那句话原样重复返回，要给更像“可直接开写”的变体
8. 不要和“标题”一样短，要让人一眼就知道这条内容大概会写什么
9. 主题句本身也要偏直接表达，不要写成文艺题眼、散文句子或故事开头
10. 不能站外引流，不能出现“加群/私信/扣1/主页联系/vx/微信/二维码”
11. 不要输出解释，不要编号，不要重复表达，只返回 3 条主题建议
12. 主题建议也尽量像真实帖子起手句，比如“坐标重庆...”“周五下班...”“最近想找...”这种说法，不要像运营命题
13. 允许少量出现“最近我在认真攒...”“最近在帮人接...”这种真人组织口吻，但不要变成广告口播

3 条建议请尽量优先覆盖这 3 个切入角度：
- 一个真实卡点
- 一个具体约局或见面场景
- 一个情绪或需求出发点
- 一个“这里已经有人在组织”的入口感

平台与内容方向理解：
- 小红书更偏生活感和具体场景
- 抖音更偏直接和有画面感
- 微信更偏自然分享
- 活动招募更像真人在发组局传单
- 搭子故事更像需求共鸣，不像真实故事连载
- 本地攻略更像本地体验建议
- 产品种草更像“最近发现一个更顺手的入口”，不是广告`

const FLYER_REWRITE_PROMPT = `你会把一版初稿，改成适合“传单号 / 组织号”发布的最终成品。

这不是故事文，不是心得体会，也不是品牌广告。
你的目标是让目标用户在几秒内看懂：
1. 这说的是我现在的需求或状态
2. 这里有人在认真帮他找搭子、接局、降低约人门槛
3. 我值得继续了解这条内容

改写要求：
1. 保留原主题与主要信息，不要脱离方向
2. 标题更像招募卡片或入口卡片的题眼，直接、清楚、能筛人
3. 正文第一句必须直接说人群、需求、状态、困扰中的一个
4. 正文优先回答：我现在卡在哪 -> 我想约什么/想帮什么人找到搭子 -> 这里怎么更自然地接到人
5. 最多保留 1 个真实细节，不要形成完整故事线
6. 删除散文感、微小说感、对白、环境铺垫、偶像剧情节
7. 不要写站外引流，不要索要联系方式，不要让用户加群或私信
8. 保持自然，不要写成生硬广告，也不要写成平台公告
9. 正文绝对不要出现“这版”“这条内容”“更适合”“目标用户”“让人看懂”“值得继续看”这类幕后说明口吻
10. 正文要像小红书用户本人在发，不像系统在总结这条文案适合谁
11. 输出必须完整包含：title、body、hashtags、coverText、coverImageHint
12. 优先改成这种真实帖子结构：我现在是什么状态 / 我想约什么 / 我最近怎么在帮人接搭子 / 边界感是什么
13. 小红书风格里允许出现“坐标”“周五下班”“周末”“有无”“想找个”“最近在认真攒”这种直接词
14. 最终结果要更像能直接发出去的成品，不要解释过程`

function readErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return typeof error === 'string' ? error : ''
}

function buildContentLogPreview(text: string, maxLength = 320): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}...`
}

export function normalizeContentAiErrorMessage(message: string): string {
  const normalized = message.trim()
  const lowerCased = normalized.toLowerCase()

  if (!normalized) {
    return 'AI 这会儿有点忙，内容还没生成出来，稍后再试一次吧～'
  }

  if (
    lowerCased.includes('no object generated')
    || lowerCased.includes('could not parse the response')
    || lowerCased.includes('response did not match schema')
  ) {
    return 'AI 这次回包格式不太对，内容还没整理出来，稍后再试一次吧～'
  }

  return normalizeAiProviderErrorMessage(normalized)
}

function readEmbeddedJsonText(text: string): string | null {
  const trimmed = text.trim()

  if (!trimmed) {
    return null
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed
  }

  const fencedJsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fencedJsonMatch?.[1]) {
    const fencedText = fencedJsonMatch[1].trim()
    if (fencedText.startsWith('{') && fencedText.endsWith('}')) {
      return fencedText
    }
  }

  const firstBraceIndex = trimmed.indexOf('{')
  const lastBraceIndex = trimmed.lastIndexOf('}')
  if (firstBraceIndex >= 0 && lastBraceIndex > firstBraceIndex) {
    return trimmed.slice(firstBraceIndex, lastBraceIndex + 1)
  }

  return null
}

function readStructuredContentLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*•]\s*/, '').replace(/^[0-9]+[.、)\]]\s*/, '').trim())
    .filter(Boolean)
}

function readNoteSection(text: string, labels: string[]): string | null {
  const noteFieldPattern = '(?:标题|title|正文|body|标签|hashtags?|首图文案|covertext|封面文案|首图配图提示词|coverimagehint|封面图片描述)'
  const sectionPattern = labels.join('|')
  const regex = new RegExp(
    `(?:^|\\n)\\s*(?:${sectionPattern})\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${noteFieldPattern})\\s*[:：]|$)`,
    'i',
  )
  const match = text.match(regex)

  return match?.[1]?.trim() || null
}

export function repairTopicSuggestionGenerationText(params: { text: string }): string | null {
  const embeddedJsonText = readEmbeddedJsonText(params.text)
  if (embeddedJsonText) {
    logger.info('主题建议回包包含可修复 JSON 片段', {
      rawPreview: buildContentLogPreview(params.text),
      repairedPreview: buildContentLogPreview(embeddedJsonText),
    })
    return embeddedJsonText
  }

  const items = readStructuredContentLines(params.text)
    .filter((line) => !/^(输出|说明|解释|主题建议|建议如下|下面是)/.test(line))
    .map((line) => line.replace(/^["“”'']|["“”'']$/g, '').trim())
    .filter(Boolean)

  if (items.length === 0) {
    logger.warn('主题建议回包无法修复为结构化 JSON', {
      rawPreview: buildContentLogPreview(params.text),
    })
    return null
  }

  const repairedText = JSON.stringify({
    items: items.slice(0, 3),
  })

  logger.info('主题建议回包已按行修复为结构化 JSON', {
    rawPreview: buildContentLogPreview(params.text),
    repairedPreview: buildContentLogPreview(repairedText),
  })

  return repairedText
}

function parseHashtagLine(value: string | null): string[] {
  if (!value) {
    return []
  }

  return value
    .split(/[\s,，、]+/)
    .map((part) => part.replace(/^#/, '').trim())
    .filter(Boolean)
}

export function repairGeneratedNoteText(params: { text: string }): string | null {
  const embeddedJsonText = readEmbeddedJsonText(params.text)
  if (embeddedJsonText) {
    logger.info('内容生成回包包含可修复 JSON 片段', {
      rawPreview: buildContentLogPreview(params.text),
      repairedPreview: buildContentLogPreview(embeddedJsonText),
    })
    return embeddedJsonText
  }

  const title = readNoteSection(params.text, ['标题', 'title'])
  const body = readNoteSection(params.text, ['正文', 'body'])
  const hashtags = parseHashtagLine(readNoteSection(params.text, ['标签', 'hashtags?']))
  const coverText = readNoteSection(params.text, ['首图文案', 'covertext', '封面文案'])
  const coverImageHint = readNoteSection(params.text, ['首图配图提示词', 'coverimagehint', '封面图片描述'])

  if (!title && !body) {
    logger.warn('内容生成回包无法修复为结构化 JSON', {
      rawPreview: buildContentLogPreview(params.text),
    })
    return null
  }

  const repairedText = JSON.stringify({
    title: title ?? '',
    body: body ?? '',
    hashtags,
    coverText: coverText ?? '',
    coverImageHint: coverImageHint ?? '',
  })

  logger.info('内容生成回包已按字段修复为结构化 JSON', {
    rawPreview: buildContentLogPreview(params.text),
    repairedPreview: buildContentLogPreview(repairedText),
  })

  return repairedText
}

function shouldRetryWithFallbackModel(error: unknown): boolean {
  const errorText = readErrorText(error).toLowerCase()

  return [
    'allocationquota',
    'free tier',
    'quota',
    'rate limit',
    '429',
    'dashscope_api_key is not set',
    'fetch failed',
  ].some((keyword) => errorText.includes(keyword))
}

function coerceNoteOutput(value: NoteOutput): NoteOutput {
  return {
    title: typeof value.title === 'string' ? value.title : '',
    body: typeof value.body === 'string' ? value.body : '',
    hashtags: Array.isArray(value.hashtags)
      ? value.hashtags.filter((item): item is string => typeof item === 'string')
      : [],
    coverText: typeof value.coverText === 'string' ? value.coverText : '',
    coverImageHint: typeof value.coverImageHint === 'string' ? value.coverImageHint : '',
  }
}

function coerceTopicSuggestionOutput(value: TopicSuggestionOutput): TopicSuggestionOutput {
  return {
    items: Array.isArray(value.items)
      ? value.items.filter((item): item is string => typeof item === 'string')
      : [],
  }
}

async function generateNoteObject(
  prompt: string,
  modelIntent: 'chat' | 'reasoning' | 'agent',
): Promise<NoteOutput> {
  const routeKey = modelIntent === 'agent' ? 'agent' : 'content_generation'
  const { modelId, model } = await resolveChatModelSelection({ routeKey })

  try {
    const result = await generateObject({
      model,
      schema: jsonSchema<NoteOutput>(toJsonSchema(NoteOutputSchema)),
      schemaName: 'content_note',
      schemaDescription: '聚场 Admin 内容生成结果，必须返回 title、body、hashtags、coverText、coverImageHint 的 JSON 对象',
      prompt: `${prompt}\n\n输出格式要求：只返回一个 JSON 对象，不要 Markdown 代码块，不要额外解释，不要编号。`,
      experimental_repairText: async ({ text }) => repairGeneratedNoteText({ text }),
    })

    return coerceNoteOutput(result.object)
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      logger.warn('内容生成结构化解析失败', {
        modelIntent,
        modelId,
        finishReason: error.finishReason,
        rawPreview: buildContentLogPreview(error.text ?? ''),
        error: readErrorText(error),
        cause: readErrorText(error.cause),
      })
    }

    throw error
  }
}

async function generateTopicSuggestionObject(
  prompt: string,
  modelIntent: 'chat' | 'reasoning' | 'agent',
): Promise<TopicSuggestionOutput> {
  const routeKey = modelIntent === 'agent' ? 'agent' : 'content_topic_suggestions'
  const { modelId, model } = await resolveChatModelSelection({ routeKey })

  try {
    const result = await generateObject({
      model,
      schema: jsonSchema<TopicSuggestionOutput>(toJsonSchema(TopicSuggestionOutputSchema)),
      schemaName: 'content_topic_suggestions',
      schemaDescription: '聚场 Admin 内容主题建议结果，必须返回 items 数组的 JSON 对象',
      prompt: `${prompt}\n\n输出格式要求：只返回一个 JSON 对象，格式为 {"items":["建议1","建议2","建议3"]}，不要 Markdown 代码块，不要额外解释。`,
      experimental_repairText: async ({ text }) => repairTopicSuggestionGenerationText({ text }),
    })

    return coerceTopicSuggestionOutput(result.object)
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      logger.warn('主题建议结构化解析失败', {
        modelIntent,
        modelId,
        finishReason: error.finishReason,
        rawPreview: buildContentLogPreview(error.text ?? ''),
        error: readErrorText(error),
        cause: readErrorText(error.cause),
      })
    }

    throw error
  }
}

async function rewriteDraftAsFlyerNote(params: {
  draft: GeneratedContentDraft
  topic: string
  platform: ContentPlatform
  contentType: ContentType
  modelIntent: 'chat' | 'reasoning' | 'agent'
}): Promise<GeneratedContentDraft> {
  const rewritePrompt = `${DEFAULT_SYSTEM_PROMPT}

${FLYER_REWRITE_PROMPT}

发布平台：${CONTENT_PLATFORM_LABELS[params.platform]}
内容方向：${CONTENT_TYPE_LABELS[params.contentType]}

${PLATFORM_PROMPT_RULES[params.platform]}

${CONTENT_TYPE_PROMPT_RULES[params.contentType]}

原始主题：${params.topic}

当前初稿：
标题：${params.draft.title}
正文：${params.draft.body}
标签：${params.draft.hashtags.join('、')}
首图文案：${params.draft.coverText}
首图配图提示词：
${params.draft.coverImageHint}`

  const rewrittenNote = await generateNoteObject(rewritePrompt, params.modelIntent)

  return rewrittenNote
}

/**
 * 查询高表现内容，用于生成时参考历史表现
 */
export async function getTopPerformingNotes(limit = 5): Promise<ContentNote[]> {
  const engagementScoreExpr = sql<number>`
    coalesce(${contentNotes.views}, 0)
    + coalesce(${contentNotes.likes}, 0) * 2
    + coalesce(${contentNotes.collects}, 0) * 3
    + coalesce(${contentNotes.comments}, 0) * 2
  `

  return db
    .select()
    .from(contentNotes)
    .where(isNotNull(contentNotes.views))
    .orderBy(desc(engagementScoreExpr))
    .limit(limit)
}

export async function generateNotes(params: {
  topic: string
  platform: ContentPlatform
  contentType: ContentType
  count: number
  trendKeywords?: string[]
}): Promise<ContentNoteResponse[]> {
  const { topic, platform, contentType, count, trendKeywords } = params
  const batchId = crypto.randomUUID()
  const platformLabel = CONTENT_PLATFORM_LABELS[platform]
  const contentTypeLabel = CONTENT_TYPE_LABELS[contentType]

  const topNotes = await getTopPerformingNotes(5)
  let referenceSection = ''
  if (topNotes.length >= 3) {
    const references = topNotes
      .map(
        (note, index) =>
          `${index + 1}. 标题：${note.title}（浏览 ${note.views}，点赞 ${note.likes}，收藏 ${note.collects}）`
      )
      .join('\n')

    referenceSection = `\n\n以下是历史高表现内容，请参考它们的标题风格和表达方式：\n${references}\n请学习这些成功内容的特点，但不要直接复制。`
  }

  let trendSection = ''
  if (trendKeywords && trendKeywords.length > 0) {
    trendSection = `\n\n当前热门关键词：${trendKeywords.join('、')}，请适当融入内容中。`
  }

  const generatedTitles: string[] = []
  const results: ContentNoteResponse[] = []
  let modelIntent: 'chat' | 'reasoning' | 'agent' = 'chat'

  for (let index = 0; index < count; index += 1) {
    let contentPrompt = DEFAULT_CONTENT_PROMPT
      .replace('{topic}', topic)
      .replace('{platform}', platformLabel)
      .replace('{contentType}', contentTypeLabel)

    contentPrompt += referenceSection
    contentPrompt += trendSection
    contentPrompt += `\n\n${PLATFORM_PROMPT_RULES[platform]}`
    contentPrompt += `\n\n${CONTENT_TYPE_PROMPT_RULES[contentType]}`

    if (generatedTitles.length > 0) {
      contentPrompt += `\n\n注意：以下标题已被使用，请确保你的标题与它们完全不同：\n${generatedTitles
        .map((title) => `- ${title}`)
        .join('\n')}`
    }

    const prompt = `${DEFAULT_SYSTEM_PROMPT}\n\n${contentPrompt}`

    let generatedNote: NoteOutput
    try {
      generatedNote = await generateNoteObject(prompt, modelIntent)
    } catch (error) {
      if (modelIntent === 'agent' || !shouldRetryWithFallbackModel(error)) {
        throw error
      }

      modelIntent = 'agent'
      console.warn('[Content] 当前内容生成模型受限，已切到 agent 映射继续生成', error)
      generatedNote = await generateNoteObject(prompt, modelIntent)
    }

    let finalNote: GeneratedContentDraft = generatedNote

    try {
      finalNote = await rewriteDraftAsFlyerNote({
        draft: generatedNote,
        topic,
        platform,
        contentType,
        modelIntent,
      })
    } catch (error) {
      console.warn('[Content] 传单式二次改写失败，已回退到首稿清洗', error)
    }

    finalNote = normalizeGeneratedContentNote({
      topic,
      platform,
      contentType,
      note: finalNote,
    })

    generatedTitles.push(finalNote.title)

    const [inserted] = await db
      .insert(contentNotes)
      .values({
        topic,
        platform,
        contentType,
        batchId,
        title: finalNote.title,
        body: finalNote.body,
        hashtags: finalNote.hashtags,
        coverText: finalNote.coverText,
        coverImageHint: finalNote.coverImageHint,
      })
      .returning()

    results.push(formatContentNote(inserted))
  }

  return results
}

export async function generateTopicSuggestions(params: {
  platform: ContentPlatform
  contentType: ContentType
  seed?: string
}): Promise<TopicSuggestionResponse> {
  const { platform, contentType, seed } = params
  const platformLabel = CONTENT_PLATFORM_LABELS[platform]
  const contentTypeLabel = CONTENT_TYPE_LABELS[contentType]
  const topNotes = await getTopPerformingNotes(3)

  let referenceSection = ''
  if (topNotes.length > 0) {
    referenceSection = `\n\n历史高表现内容参考（只学方向，不要照抄）：\n${topNotes
      .map((note, index) => `${index + 1}. ${note.title}`)
      .join('\n')}`
  }

  const seedSection = seed?.trim()
    ? `\n\n用户已经有一个模糊方向：${seed.trim()}。\n请围绕这个方向给更像“可直接写内容”的主题建议。`
    : ''

  const prompt = `${DEFAULT_SYSTEM_PROMPT}\n\n${TOPIC_SUGGESTION_PROMPT}

发布平台：${platformLabel}
内容方向：${contentTypeLabel}

${PLATFORM_PROMPT_RULES[platform]}

${CONTENT_TYPE_PROMPT_RULES[contentType]}${seedSection}${referenceSection}`

  let modelIntent: 'chat' | 'reasoning' | 'agent' = 'chat'

  try {
    const result = await generateTopicSuggestionObject(prompt, modelIntent)
    return {
      items: normalizeSuggestedTopics({
        platform,
        contentType,
        items: result.items,
      }),
    }
  } catch (error) {
    if (!shouldRetryWithFallbackModel(error)) {
      throw error
    }

    modelIntent = 'agent'
    console.warn('[Content] 主题建议生成切到 agent 映射继续处理', error)
    const result = await generateTopicSuggestionObject(prompt, modelIntent)
    return {
      items: normalizeSuggestedTopics({
        platform,
        contentType,
        items: result.items,
      }),
    }
  }
}

export async function getLibrary(params: ContentLibraryQuery): Promise<ContentLibraryResponse> {
  const { page = 1, limit = 20, platform, contentType, keyword } = params
  const offset = (page - 1) * limit
  const conditions: SQL<unknown>[] = []

  if (platform) {
    conditions.push(eq(contentNotes.platform, platform))
  }

  if (contentType) {
    conditions.push(eq(contentNotes.contentType, contentType))
  }

  if (keyword) {
    conditions.push(
      or(
        ilike(contentNotes.topic, `%${keyword}%`),
        ilike(contentNotes.body, `%${keyword}%`),
      )!
    )
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [data, totalResult] = await Promise.all([
    db
      .select()
      .from(contentNotes)
      .where(where)
      .orderBy(desc(contentNotes.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(contentNotes)
      .where(where),
  ])

  return {
    items: data.map(formatContentNote),
    total: totalResult[0]?.count ?? 0,
    page,
    limit,
  }
}

export async function getNoteById(id: string): Promise<ContentNoteResponse | null> {
  const [row] = await db
    .select()
    .from(contentNotes)
    .where(eq(contentNotes.id, id))
    .limit(1)

  return row ? formatContentNote(row) : null
}

export async function deleteNote(id: string): Promise<boolean> {
  const result = await db
    .delete(contentNotes)
    .where(eq(contentNotes.id, id))
    .returning({ id: contentNotes.id })

  return result.length > 0
}

export async function updatePerformance(
  id: string,
  data: PerformanceUpdateRequest,
): Promise<ContentNoteResponse> {
  const [updated] = await db
    .update(contentNotes)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(contentNotes.id, id))
    .returning()

  if (!updated) {
    throw new Error('笔记不存在')
  }

  return formatContentNote(updated)
}

export async function getAnalytics(): Promise<ContentAnalyticsResponse> {
  const engagementScoreExpr = sql<number>`
    coalesce(${contentNotes.views}, 0)
    + coalesce(${contentNotes.likes}, 0) * 2
    + coalesce(${contentNotes.collects}, 0) * 3
    + coalesce(${contentNotes.comments}, 0) * 2
  `

  const byType = await db
    .select({
      contentType: contentNotes.contentType,
      avgViews: sql<number>`coalesce(avg(${contentNotes.views}), 0)::float`,
      avgLikes: sql<number>`coalesce(avg(${contentNotes.likes}), 0)::float`,
      avgCollects: sql<number>`coalesce(avg(${contentNotes.collects}), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(contentNotes)
    .where(isNotNull(contentNotes.views))
    .groupBy(contentNotes.contentType)

  const [totalResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contentNotes)

  const [perfResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contentNotes)
    .where(isNotNull(contentNotes.views))

  const totalNotes = totalResult?.count ?? 0
  const totalWithPerformance = perfResult?.count ?? 0

  const topNotes = totalWithPerformance >= 5
    ? await db
        .select()
        .from(contentNotes)
        .where(isNotNull(contentNotes.views))
        .orderBy(desc(engagementScoreExpr))
        .limit(10)
    : []

  return {
    byType: byType.map((item) => ({
      contentType: item.contentType,
      avgViews: item.avgViews,
      avgLikes: item.avgLikes,
      avgCollects: item.avgCollects,
      count: item.count,
    })),
    topNotes: topNotes.map(formatContentNote),
    totalNotes,
    totalWithPerformance,
  }
}

export function formatContentNote(note: ContentNote): ContentNoteResponse {
  return {
    id: note.id,
    topic: note.topic,
    platform: note.platform,
    contentType: note.contentType,
    title: note.title,
    body: note.body,
    hashtags: note.hashtags,
    coverText: note.coverText,
    coverImageHint: note.coverImageHint,
    views: note.views,
    likes: note.likes,
    collects: note.collects,
    comments: note.comments,
    newFollowers: note.newFollowers,
    batchId: note.batchId,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  }
}
