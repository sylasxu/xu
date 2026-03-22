import { CONTENT_PLATFORM_VALUES, type ContentPlatform } from '@juchang/db'
import { t } from 'elysia'

const [xiaohongshu, douyin, wechat] = CONTENT_PLATFORM_VALUES

export const ContentPlatformSchema = t.Union([
  t.Literal(xiaohongshu),
  t.Literal(douyin),
  t.Literal(wechat),
])

export { CONTENT_PLATFORM_VALUES }
export type { ContentPlatform }

export function isContentPlatform(value: string): value is ContentPlatform {
  return CONTENT_PLATFORM_VALUES.some((item) => item === value)
}
