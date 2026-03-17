import { CONTENT_TYPE_VALUES, type ContentType } from '@juchang/db'
import { t } from 'elysia'

const [activityRecruit, buddyStory, localGuide, productSeed] = CONTENT_TYPE_VALUES

export const ContentTypeSchema = t.Union([
  t.Literal(activityRecruit),
  t.Literal(buddyStory),
  t.Literal(localGuide),
  t.Literal(productSeed),
])

export { CONTENT_TYPE_VALUES }
export type { ContentType }

export function isContentType(value: string): value is ContentType {
  return CONTENT_TYPE_VALUES.some((item) => item === value)
}
