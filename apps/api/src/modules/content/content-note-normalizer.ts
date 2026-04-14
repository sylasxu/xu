import type { ContentType } from '@xu/db'
import type { ContentPlatform } from './content-platform'

export interface GeneratedContentDraft {
  title: string
  body: string
  hashtags: string[]
  coverText: string
  coverImageHint: string
}

export interface ContentPublishCheck {
  status: 'ready' | 'review' | 'rewrite'
  summary: string
  issues: string[]
}

export interface ContentTrafficScript {
  commentPrompt: string
  dmReply: string
  wechatHandoff: string
}

const OFFSITE_TERMS = [
  '加我',
  '加群',
  '进群',
  '拉群',
  '私信我',
  '私我',
  '扣1',
  '评论区带你',
  '主页联系',
  '二维码',
  'vx',
  '微信',
] as const

const STORY_LIKE_OPENINGS = [
  '本来',
  '后来',
  '那天',
  '今天本来',
  '原来',
  '刚好',
  '临时起意',
] as const

const STORY_LIKE_MARKERS = [
  '本来',
  '后来',
  '原来',
  '那天',
  '刚好',
  '临时起意',
  '聊着聊着',
  '我们',
  '她',
  '他',
] as const

const META_EXPLANATION_MARKERS = [
  '这版',
  '这条内容',
  '这种内容',
  '更适合',
  '让人看懂',
  '让用户',
  '目标用户',
  '值得继续看',
  '这说的是我',
  '这里已经有人在组织',
  '让真正需要的人知道',
  '重点不是',
] as const

const ORGANIZING_MARKERS = [
  '有人在组',
  '有人在组织',
  '这种局',
  '这个入口',
  '适合',
  '更适合',
  '想来',
  '同频',
] as const

const HYPE_MARKERS = [
  '闭眼冲',
  '冲就完了',
  '错过血亏',
  '全网爆火',
  '天花板',
  '家人们',
  '姐妹们',
  '评论区聊聊',
] as const

const DIRECT_OPENING_MARKERS = [
  '坐标',
  '周五',
  '周末',
  '下班',
  '最近',
  '我自己',
  '总是',
  '想',
  '有人',
  '有没有',
] as const

const FALLBACK_TAGS_BY_TYPE: Record<ContentType, string[]> = {
  activity_recruit: ['重庆同城', '组局招募', '找搭子'],
  buddy_story: ['重庆同城', '需求共鸣', '找搭子'],
  local_guide: ['重庆攻略', '周末去处', '本地推荐'],
  product_seed: ['重庆同城', '组织入口', '找搭子'],
}

const DEFAULT_TOPIC_SUGGESTIONS: Record<ContentType, string[]> = {
  activity_recruit: [
    '坐标重庆，周末总想出门但没人开局的人，可以来这种轻松小局',
    '周五下班想找饭搭子的人，我最近在认真攒这种不尬聊的局',
    '谁组我就去的人，最近可以看看这种有人帮你接搭子的方式',
  ],
  buddy_story: [
    '下班后想找人随便坐坐的人真的不少，我最近也在认真接这种搭子',
    '周末想出门又不想硬社交的人，可能会喜欢这种轻搭子节奏',
    '不是想认识很多人，只是偶尔想有个同频搭子，这种需求我最近经常碰到',
  ],
  local_guide: [
    '重庆适合两三个人慢慢坐的地方，我想整理一版直接能抄的',
    '周末在重庆不知道去哪的时候，这几个地方真的比较稳',
    '不想跑热门景点的人，可能更需要这种本地去处清单',
  ],
  product_seed: [
    '总想出门但每次都凑不到局的人，最近可以看看这种接搭子的入口',
    '微信群喊半天没人回的时候，我最近更想认真帮这种人把局攒起来',
    '谁组我就去的人，终于有个更容易被接住的地方',
  ],
}

type PartnerScene =
  | 'meal'
  | 'walk'
  | 'sports'
  | 'tabletop'
  | 'drink'
  | 'passive'
  | 'generic'

function inferPartnerScene(topic: string): PartnerScene {
  if (/(火锅|吃饭|饭搭子|烧烤|探店|约饭)/.test(topic)) {
    return 'meal'
  }

  if (/(散步|遛弯|走走|压马路|公园)/.test(topic)) {
    return 'walk'
  }

  if (/(羽毛球|跑步|骑行|爬山|徒步|打球|健身)/.test(topic)) {
    return 'sports'
  }

  if (/(桌游|剧本杀|麻将|德州|狼人杀)/.test(topic)) {
    return 'tabletop'
  }

  if (/(喝酒|酒搭子|喝一杯|小酌|精酿|咖啡|喝茶)/.test(topic)) {
    return 'drink'
  }

  if (/(谁组我就去|被动|没人约|没人开局|接搭子|接住)/.test(topic)) {
    return 'passive'
  }

  return 'generic'
}

function buildActivityRecruitBody(topic: string, scene: PartnerScene): string {
  switch (scene) {
    case 'meal':
      return `坐标重庆，周五下班老是卡在没人约饭这一步，所以最近我在认真攒和「${topic}」有关的饭搭子小局。想来的人不用太会聊天，能接得上话就行，AA、轻松吃，合得来再约下一次。`
    case 'walk':
      return `最近下班后总想出去走走，但一个人出门又容易作罢，所以我在认真攒和「${topic}」有关的散步小局。想来的人不用有压力，能聊就聊，安静走走也行，轻松一点最好。`
    case 'sports':
      return `这周末不太想一个人去运动，所以最近我在认真攒和「${topic}」有关的小局。想来的人水平一般也没关系，主要是别太卷，能约出来动一动、打完各回各家就挺好。`
    case 'tabletop':
      return `最近挺想约个轻松桌游局，所以我在认真攒和「${topic}」有关的小局。人不用太多，能凑起来就开，不用强社交，玩得舒服最重要。`
    case 'drink':
      return `最近下班后老想找个地方坐坐，所以我在认真攒和「${topic}」有关的小局。想来的人不用太会聊，不拼酒、不硬热场，能放松坐一会儿就行。`
    case 'passive':
      return `我自己就是那种谁组我就去的人，所以最近也在认真攒和「${topic}」有关的小局。比起到处喊人，我更想把第一步变轻一点，让想出门的人更容易被接住。`
    default:
      return `坐标重庆，最近老是卡在没人约这一步，所以我在认真攒和「${topic}」有关的小局。想来的人不用太会聊天，轻松一点就行，两三个人能成局就很好。`
  }
}

function buildProductSeedBody(topic: string, scene: PartnerScene): string {
  switch (scene) {
    case 'meal':
      return `最近总有人卡在“下班想找个饭搭子，但不知道找谁”这一步，所以我会一直留意和「${topic}」有关的入口。不是为了凑热闹，就是想让想吃饭、想有人一起坐坐的人，能更顺手地被接到。`
    case 'walk':
      return `最近总有人想下班后散散步，但临到头又没人能约，所以我会更留意和「${topic}」有关的入口。不是硬社交，就是想让这种轻一点的需求也能被接住。`
    case 'sports':
      return `很多人不是不想运动，是想打球、跑步的时候总差一个能一起去的人，所以我会一直看和「${topic}」有关的入口。重点不是拉很多人，而是让这种小需求也能顺手成局。`
    case 'passive':
      return `我发现“谁组我就去”的人其实很多，不是不想出门，是没人开局，也没有顺手入口。所以最近我会更留意和「${topic}」有关的方式，让想找搭子的人不用再自己到处喊。`
    default:
      return `最近总有人卡在“想出门但没人开局”这一步，所以我会一直看和「${topic}」有关的入口。不是为了认识很多人，就是希望周五下班、周末这种时候，想找搭子的人能更顺手地被接到。`
  }
}

function buildBuddyStoryBody(topic: string, scene: PartnerScene): string {
  switch (scene) {
    case 'meal':
      return `最近越来越觉得，饭搭子这种需求真的很具体。不是想认识很多人，就是某天突然想吃点好的，不想一个人去，所以我现在也会更留意和「${topic}」有关的这种小需求。`
    case 'walk':
      return `下班后想找个人一起走走这种事，真的比我想的更常见。不是要聊很深，就是想在忙完一天之后，有个人一起散会儿步，所以我会特别留意和「${topic}」有关的需求。`
    case 'sports':
      return `想运动又不想一个人去，其实就是很典型的搭子需求。不是要组多大的局，只是有人能一起出门、打完就散，这种和「${topic}」有关的状态我最近碰到很多。`
    default:
      return `最近越来越觉得，和「${topic}」有关的状态其实很多人都有。不是多缺朋友，就是偶尔下班后、周末突然想出门的时候，会想找个能一起吃饭、散步或者随便坐坐的人，所以我也会更留意这种搭子需求。`
  }
}

function buildCommentPrompt(topic: string, scene: PartnerScene): string {
  switch (scene) {
    case 'meal':
      return `如果你也是下班后想找饭搭子的人，留一句“想吃饭”就行，我先看看同频的人多不多。`
    case 'walk':
      return `如果你也是那种下班后想找人走走的人，留一句“想散步”就行，我先看看有没有同状态的人。`
    case 'sports':
      return `如果你也想找个不太卷的运动搭子，留一句“想动一动”就行，我先看看这类人多不多。`
    case 'tabletop':
      return `如果你也想找个轻松点的桌游搭子，留一句“想来”就行，我先看看能不能凑成一小局。`
    case 'drink':
      return `如果你也是下班后想找人坐坐的人，留一句“想坐坐”就行，我先看看有没有同频的人。`
    case 'passive':
      return `如果你也是“谁组我就去”的人，留一句“我也是”就行，我先把这类需求接起来。`
    default:
      return `如果你也是这种状态的人，留一句“我也想”就行，我先看看有没有同频的人。`
  }
}

function buildDmReply(topic: string, scene: PartnerScene): string {
  switch (scene) {
    case 'meal':
      return `看到你留言啦，你也像是会想找饭搭子的人。你一般更想约工作日下班后，还是周末轻松吃一顿？我先按时间和区域帮你理一下。`
    case 'walk':
      return `看到你留言啦，你这个状态我很懂。你一般更偏下班后随便走走，还是周末找个地方慢慢逛？我先按时间和区域帮你理一下。`
    case 'sports':
      return `看到你留言啦，如果你最近也想找个轻松点的运动搭子，我们可以先对一下项目、时间和大概区域，我再看看怎么接更顺。`
    case 'tabletop':
      return `看到你留言啦，如果你也想找个轻松局，我们可以先对一下你更想玩的类型、时间和大概区域，我再看看怎么接更顺。`
    case 'drink':
      return `看到你留言啦，如果你也是想找个能轻松坐坐的人，我们可以先对一下你更偏工作日还是周末、喝茶还是小酌，我再帮你理一下。`
    case 'passive':
      return `看到你留言啦，你像是那种“有人组就愿意来”的状态。你先告诉我你更想参加什么类型、什么时间段，我这边会更容易帮你接。`
    default:
      return `看到你留言啦，你这个需求还挺典型的。你先告诉我你更想约什么、什么时间、哪一片更方便，我再帮你往下接。`
  }
}

function buildWechatHandoff(topic: string, scene: PartnerScene): string {
  switch (scene) {
    case 'meal':
      return `如果你方便的话，后面我们可以微信上对一下时间和区域，这样约饭会更顺一点。`
    case 'walk':
      return `如果你方便的话，后面我们可以微信上对一下时间和常活动区域，这样约散步会更顺一点。`
    case 'sports':
      return `如果你方便的话，后面我们可以微信上对一下项目、时间和场地偏好，这样会更好约。`
    case 'tabletop':
      return `如果你方便的话，后面我们可以微信上对一下时间和想玩的类型，这样成局会更快。`
    case 'drink':
      return `如果你方便的话，后面我们可以微信上对一下时间和你更偏的节奏，这样会更顺一点。`
    case 'passive':
      return `如果你方便的话，后面我们可以微信上对一下你更想参加的类型和常出没区域，我这边会更好帮你留意。`
    default:
      return `如果你方便的话，后面我们可以微信上对一下时间、区域和你更想约的方向，这样往下接会更顺一点。`
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
}

function trimWrappingQuotes(value: string): string {
  return value.replace(/^[“"'「『]+/, '').replace(/[”"'」』]+$/, '').trim()
}

function stripOffsiteTerms(value: string): string {
  let nextValue = value

  for (const term of OFFSITE_TERMS) {
    nextValue = nextValue.replaceAll(term, '')
  }

  return nextValue
    .replace(/[，,、]{2,}/g, '，')
    .replace(/[。！？，,、]\s*$/g, '')
    .trim()
}

function normalizeTitleText(value: string): string {
  return stripOffsiteTerms(trimWrappingQuotes(normalizeWhitespace(value)))
    .replace(/^#/, '')
    .replace(/[。！？!?,，、]+$/g, '')
    .trim()
}

function normalizeBodyText(value: string): string {
  const cleaned = stripOffsiteTerms(trimWrappingQuotes(normalizeWhitespace(value)))
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)

  if (paragraphs.length === 0) {
    return ''
  }

  return paragraphs.join('\n\n')
}

function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[。！？!?])/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeHashtagText(value: string): string {
  return normalizeWhitespace(value)
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, '')
}

function readLabeledValue(lines: string[], label: string): string | null {
  const matchedLine = lines.find((line) => line.startsWith(`${label}：`) || line.startsWith(`${label}:`))

  if (!matchedLine) {
    return null
  }

  return matchedLine.replace(new RegExp(`^${label}[：:]\\s*`), '').trim() || null
}

function buildCoverImageHint(params: {
  topic: string
  platform: ContentPlatform
  contentType: ContentType
  coverImageHint: string
}): string {
  const lines = normalizeWhitespace(params.coverImageHint)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const subject =
    readLabeledValue(lines, '主体')
    ?? (params.contentType === 'activity_recruit'
      ? `${params.topic}相关的同城组局信息感画面`
      : params.contentType === 'product_seed'
        ? `${params.topic}相关的轻社交组织入口感画面`
        : `${params.topic}相关的重庆本地生活画面`)

  const scene =
    readLabeledValue(lines, '场景')
    ?? (params.platform === 'xiaohongshu'
      ? '重庆本地真实生活场景，像普通用户随手拍到的瞬间'
      : params.platform === 'douyin'
        ? '重庆同城活动或见面场景，主体清楚，第一眼能看懂'
        : '微信分享封面感场景，干净自然，不夸张')

  const composition =
    readLabeledValue(lines, '构图')
    ?? '竖版首图构图，主体明确，留出标题文案位置，不要过满'

  const lighting =
    readLabeledValue(lines, '光线')
    ?? '自然光为主，画面通透，避免棚拍和过强滤镜'

  const mood =
    readLabeledValue(lines, '氛围')
    ?? (params.contentType === 'activity_recruit'
      ? '真实、轻招募感、有人在组织但不硬推销'
      : params.contentType === 'product_seed'
        ? '有入口感、可信、真实，不要广告味'
        : '松弛、真实、有人味，不要文艺摆拍')

  const avoid =
    readLabeledValue(lines, '避免项')
    ?? '海报感、大字报、品牌KV、过度摆拍、夸张滤镜、强营销感'

  return [
    `主体：${subject}`,
    `场景：${scene}`,
    `构图：${composition}`,
    `光线：${lighting}`,
    `氛围：${mood}`,
    `避免项：${avoid}`,
  ].join('\n')
}

function buildFallbackCoverText(params: { title: string, contentType: ContentType }): string {
  const baseTitle = params.title.replace(/[。！？!?,，、]/g, '').trim()

  if (baseTitle.length >= 6) {
    return baseTitle.slice(0, 12)
  }

  return params.contentType === 'activity_recruit'
    ? '这局有人在组'
    : params.contentType === 'product_seed'
      ? '这里能接到局'
      : '这类人会懂'
}

function buildFallbackTitle(params: { topic: string, contentType: ContentType }): string {
  const cleanedTopic = params.topic.replace(/[。！？!?,，、]/g, '').trim()
  const scene = inferPartnerScene(cleanedTopic)

  if (cleanedTopic.length >= 8) {
    return cleanedTopic.slice(0, 18)
  }

  if (params.contentType === 'activity_recruit' && scene === 'meal') {
    return '周五饭搭子来吗'
  }

  if (params.contentType === 'activity_recruit' && scene === 'sports') {
    return '周末一起动一动'
  }

  if (params.contentType === 'product_seed' && scene === 'passive') {
    return '谁组我就去有门了'
  }

  return params.contentType === 'activity_recruit'
    ? '这局有人在组'
    : params.contentType === 'product_seed'
      ? '这个入口挺对路'
      : '这类状态有人懂'
}

function buildFallbackBody(params: { topic: string, contentType: ContentType }): string {
  const scene = inferPartnerScene(params.topic)

  if (params.contentType === 'activity_recruit') {
    return buildActivityRecruitBody(params.topic, scene)
  }

  if (params.contentType === 'product_seed') {
    return buildProductSeedBody(params.topic, scene)
  }

  if (params.contentType === 'local_guide') {
    return `最近在看和「${params.topic}」有关的重庆去处，发现很多推荐都太空了。我更想整理那种一看就知道适不适合自己、要不要专门跑一趟的信息。`
  }

  return buildBuddyStoryBody(params.topic, scene)
}

function looksStoryLike(body: string): boolean {
  const sentences = splitSentences(body)
  const firstSentence = sentences[0] ?? ''

  return STORY_LIKE_OPENINGS.some((prefix) => firstSentence.startsWith(prefix))
    || STORY_LIKE_MARKERS.filter((marker) => body.includes(marker)).length >= 2
}

function soundsLikeMetaExplanation(body: string): boolean {
  return META_EXPLANATION_MARKERS.some((marker) => body.includes(marker))
}

function lacksFlyerSignal(body: string): boolean {
  return !ORGANIZING_MARKERS.some((marker) => body.includes(marker))
}

function buildStructuredFlyerBody(params: { topic: string, contentType: ContentType, body: string }): string {
  const normalizedTopic = params.topic.replace(/[。！？!?,，、]/g, '').trim()
  const scene = inferPartnerScene(normalizedTopic)

  if (params.contentType === 'activity_recruit') {
    return buildActivityRecruitBody(normalizedTopic, scene)
  }

  if (params.contentType === 'product_seed') {
    return buildProductSeedBody(normalizedTopic, scene)
  }

  if (params.contentType === 'local_guide') {
    return `最近在找「${normalizedTopic}」这种重庆去处的时候，发现很多推荐都太空了。我更想整理那种一看就知道适不适合自己去、去了大概是什么感觉的真实信息。`
  }

  return buildBuddyStoryBody(normalizedTopic, scene)
}

function enforceFlyerBody(params: { topic: string, contentType: ContentType, body: string }): string {
  const trimmedBody = params.body.trim()

  if (!trimmedBody) {
    return buildFallbackBody({
      topic: params.topic,
      contentType: params.contentType,
    })
  }

  if (looksStoryLike(trimmedBody) || soundsLikeMetaExplanation(trimmedBody) || lacksFlyerSignal(trimmedBody)) {
    return buildStructuredFlyerBody(params)
  }

  const sentences = splitSentences(trimmedBody).slice(0, 3)
  return sentences.join('')
}

function enforceFlyerTitle(params: { topic: string, contentType: ContentType, title: string }): string {
  const cleanedTitle = params.title.trim()

  if (!cleanedTitle) {
    return buildFallbackTitle({
      topic: params.topic,
      contentType: params.contentType,
    })
  }

  if (STORY_LIKE_OPENINGS.some((prefix) => cleanedTitle.startsWith(prefix))) {
    return buildFallbackTitle({
      topic: params.topic,
      contentType: params.contentType,
    })
  }

  return cleanedTitle.slice(0, 18)
}

export function normalizeGeneratedContentNote(params: {
  topic: string
  platform: ContentPlatform
  contentType: ContentType
  note: GeneratedContentDraft
}): GeneratedContentDraft {
  const title = enforceFlyerTitle({
    topic: params.topic,
    contentType: params.contentType,
    title: normalizeTitleText(params.note.title),
  }) || buildFallbackTitle({
    topic: params.topic,
    contentType: params.contentType,
  })
  const body = enforceFlyerBody({
    topic: params.topic,
    contentType: params.contentType,
    body: normalizeBodyText(params.note.body),
  }) || buildFallbackBody({
    topic: params.topic,
    contentType: params.contentType,
  })
  const hashtags = Array.from(
    new Set(
      params.note.hashtags
        .map(normalizeHashtagText)
        .filter(Boolean)
        .filter((tag) => !OFFSITE_TERMS.some((term) => tag.includes(term)))
    )
  ).slice(0, 4)

  for (const fallbackTag of FALLBACK_TAGS_BY_TYPE[params.contentType]) {
    if (hashtags.length >= 3) {
      break
    }

    if (!hashtags.includes(fallbackTag)) {
      hashtags.push(fallbackTag)
    }
  }

  const coverText = normalizeTitleText(params.note.coverText) || buildFallbackCoverText({
    title,
    contentType: params.contentType,
  })

  return {
    title,
    body,
    hashtags,
    coverText,
    coverImageHint: buildCoverImageHint({
      topic: params.topic,
      platform: params.platform,
      contentType: params.contentType,
      coverImageHint: params.note.coverImageHint,
    }),
  }
}

export function normalizeSuggestedTopics(params: {
  platform: ContentPlatform
  contentType: ContentType
  items: string[]
}): string[] {
  const cleanedItems = params.items
    .map((item) => stripOffsiteTerms(trimWrappingQuotes(normalizeWhitespace(item))))
    .map((item) => item.replace(/^[0-9]+[.、]\s*/, '').replace(/[。！？!?,，、]+$/g, '').trim())
    .filter(Boolean)
    .filter((item) => item.length >= 8)
    .filter((item) => !STORY_LIKE_OPENINGS.some((prefix) => item.startsWith(prefix)))

  const uniqueItems = Array.from(new Set(cleanedItems)).slice(0, 3)

  const fallbackItems = params.platform === 'douyin'
    ? DEFAULT_TOPIC_SUGGESTIONS[params.contentType].map((item) => item.replace('可能会', '').replace('其实', ''))
    : DEFAULT_TOPIC_SUGGESTIONS[params.contentType]

  for (const fallback of fallbackItems) {
    if (uniqueItems.length >= 3) {
      break
    }

    if (!uniqueItems.includes(fallback)) {
      uniqueItems.push(fallback)
    }
  }

  return uniqueItems.slice(0, 3)
}

export function evaluateContentPublishCheck(params: {
  contentType: ContentType
  title: string
  body: string
  hashtags: string[]
  coverText: string | null
  coverImageHint: string | null
}): ContentPublishCheck {
  const rewriteIssues: string[] = []
  const reviewIssues: string[] = []

  const title = params.title.trim()
  const body = params.body.trim()
  const combinedText = `${title}\n${body}\n${params.coverText ?? ''}`
  const firstSentence = splitSentences(body)[0] ?? body

  if (!title || !body) {
    rewriteIssues.push('标题或正文还不完整')
  }

  if (OFFSITE_TERMS.some((term) => combinedText.includes(term))) {
    rewriteIssues.push('还有站外引流或私聊表达')
  }

  if (HYPE_MARKERS.some((term) => combinedText.includes(term))) {
    rewriteIssues.push('营销腔太重，像硬广')
  }

  if (body.length < 55) {
    reviewIssues.push('正文偏短，信息还不够完整')
  }

  if (looksStoryLike(body)) {
    reviewIssues.push('开头太像故事，不够直接')
  }

  if (soundsLikeMetaExplanation(body)) {
    reviewIssues.push('正文里有幕后分析口吻')
  }

  if (
    firstSentence
    && !DIRECT_OPENING_MARKERS.some((marker) => firstSentence.includes(marker))
    && !/搭子|组局|火锅|羽毛球|饭局|散步|桌游|喝茶|吃饭/.test(firstSentence)
  ) {
    reviewIssues.push('首句还不够像真人直接发帖')
  }

  if (
    (params.contentType === 'activity_recruit' || params.contentType === 'product_seed')
    && lacksFlyerSignal(body)
  ) {
    reviewIssues.push('这版的组织入口感还不够明确')
  }

  if (params.hashtags.length < 2 || params.hashtags.length > 4) {
    reviewIssues.push('标签数量建议控制在 2 到 4 个')
  }

  if (!(params.coverText ?? '').trim()) {
    reviewIssues.push('首图文案还不够稳')
  }

  if (!(params.coverImageHint ?? '').includes('主体：')) {
    reviewIssues.push('首图配图提示词还不够完整')
  }

  const uniqueRewriteIssues = Array.from(new Set(rewriteIssues))
  const uniqueReviewIssues = Array.from(new Set(reviewIssues))

  if (uniqueRewriteIssues.length > 0) {
    return {
      status: 'rewrite',
      summary: '这版先别发，建议先改掉明显问题。',
      issues: uniqueRewriteIssues.slice(0, 3),
    }
  }

  if (uniqueReviewIssues.length > 0) {
    return {
      status: 'review',
      summary: '这版可以继续看，但建议先顺手改一下。',
      issues: uniqueReviewIssues.slice(0, 3),
    }
  }

  return {
    status: 'ready',
    summary: '这版已经比较像可直接发布的内容。',
    issues: [],
  }
}

export function buildContentTrafficScript(params: {
  topic: string
  platform: ContentPlatform
  contentType: ContentType
  title: string
}): ContentTrafficScript {
  const topic = params.topic.replace(/[。！？!?,，、]/g, '').trim() || params.title
  const scene = inferPartnerScene(topic)

  if (params.platform !== 'xiaohongshu') {
    return {
      commentPrompt: '先观察评论区最自然的提问，再顺着对方具体需求往下接。',
      dmReply: '我看到了你的反馈，你可以直接说说你更想约什么、什么时间方便，我再帮你往下理。',
      wechatHandoff: '如果后面需要更顺手地对时间和细节，再视情况转到更方便沟通的渠道。',
    }
  }

  return {
    commentPrompt: buildCommentPrompt(topic, scene),
    dmReply: buildDmReply(topic, scene),
    wechatHandoff: buildWechatHandoff(topic, scene),
  }
}
