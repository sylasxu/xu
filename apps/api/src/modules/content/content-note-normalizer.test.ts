import { describe, expect, it } from 'bun:test'
import {
  evaluateContentPublishCheck,
  normalizeGeneratedContentNote,
  normalizeSuggestedTopics,
  type GeneratedContentDraft,
} from './content-note-normalizer'

describe('content note normalizer', () => {
  it('cleans generated note into publishable flyer-style fields', () => {
    const draft: GeneratedContentDraft = {
      title: '“这周末谁来吃火锅”',
      body: '本来只是想约人。\n\n评论区带你进群，想来的私信我。',
      hashtags: ['#重庆同城', ' 重庆同城 ', '找搭子', '微信'],
      coverText: '“这周末有人组局”',
      coverImageHint: '一张有组局感的图',
    }

    const normalized = normalizeGeneratedContentNote({
      topic: '这周末观音桥火锅小局',
      platform: 'xiaohongshu',
      contentType: 'activity_recruit',
      note: draft,
    })

    expect(normalized.title).toBe('这周末谁来吃火锅')
    expect(normalized.body).not.toContain('评论区带你')
    expect(normalized.body).not.toContain('私信我')
    expect(normalized.hashtags).toContain('重庆同城')
    expect(normalized.hashtags).toContain('找搭子')
    expect(normalized.coverText).toBe('这周末有人组局')
    expect(normalized.coverImageHint).toContain('主体：')
    expect(normalized.coverImageHint).toContain('避免项：')
  })

  it('filters story-like topic suggestions and fills direct fallback items', () => {
    const normalized = normalizeSuggestedTopics({
      platform: 'xiaohongshu',
      contentType: 'product_seed',
      items: [
        '本来只是想找个地方坐坐',
        '加我进群一起玩',
        '谁组我就去的人，也想找个更稳定的重庆组局入口',
      ],
    })

    expect(normalized).toHaveLength(3)
    expect(normalized.some((item) => item.startsWith('本来'))).toBe(false)
    expect(normalized.some((item) => item.includes('加我进群'))).toBe(false)
    expect(normalized[0]).toContain('组局入口')
  })

  it('rewrites story-like body into flyer-style direct expression', () => {
    const normalized = normalizeGeneratedContentNote({
      topic: '周末重庆羽毛球小局',
      platform: 'xiaohongshu',
      contentType: 'activity_recruit',
      note: {
        title: '本来只是想打会球',
        body: '本来只是想随便找个场打会球，后来刚好碰到两个也想运动的人，我们就慢慢聊开了，原来大家都觉得周末一个人出门有点没劲。',
        hashtags: ['重庆运动', '羽毛球'],
        coverText: '有人一起打球',
        coverImageHint: '主体：羽毛球球拍',
      },
    })

    expect(normalized.title).not.toStartWith('本来')
    expect(normalized.body).not.toContain('后来')
    expect(normalized.body).toContain('小局')
    expect(normalized.body).not.toContain('这版')
    expect(normalized.body).not.toContain('更适合')
  })

  it('uses passive-match phrasing for who-organizes-i-go topics', () => {
    const normalized = normalizeGeneratedContentNote({
      topic: '谁组我就去型用户入口',
      platform: 'xiaohongshu',
      contentType: 'product_seed',
      note: {
        title: '',
        body: '',
        hashtags: [],
        coverText: '',
        coverImageHint: '',
      },
    })

    expect(normalized.title).toContain('谁组我就去')
    expect(normalized.body).toContain('想找搭子的人')
    expect(normalized.body).toContain('不用再自己到处喊')
  })

  it('uses meal-specific phrasing for after-work meal topics', () => {
    const normalized = normalizeGeneratedContentNote({
      topic: '周五下班饭搭子',
      platform: 'xiaohongshu',
      contentType: 'activity_recruit',
      note: {
        title: '',
        body: '',
        hashtags: [],
        coverText: '',
        coverImageHint: '',
      },
    })

    expect(normalized.title).toContain('饭搭子')
    expect(normalized.body).toContain('周五下班')
    expect(normalized.body).toContain('AA')
  })

  it('marks offsite and marketing copy as rewrite before publish', () => {
    const publishCheck = evaluateContentPublishCheck({
      contentType: 'product_seed',
      title: '家人们闭眼冲',
      body: '评论区聊聊，想来的加我微信，我带你进群。',
      hashtags: ['重庆同城'],
      coverText: '',
      coverImageHint: '',
    })

    expect(publishCheck.status).toBe('rewrite')
    expect(publishCheck.issues.some((issue) => issue.includes('站外引流'))).toBe(true)
  })
})
