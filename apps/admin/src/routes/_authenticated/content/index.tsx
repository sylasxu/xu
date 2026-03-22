import { Type, type Static } from '@sinclair/typebox'
import { createFileRoute } from '@tanstack/react-router'
import { ContentLibrary } from '@/features/content-ops'

const contentSearchSchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 10 })),
  platform: Type.Optional(Type.Array(Type.Union([
    Type.Literal('xiaohongshu'),
    Type.Literal('douyin'),
    Type.Literal('wechat'),
  ]))),
  contentType: Type.Optional(Type.Array(Type.Union([
    Type.Literal('activity_recruit'),
    Type.Literal('buddy_story'),
    Type.Literal('local_guide'),
    Type.Literal('product_seed'),
  ]))),
  filter: Type.Optional(Type.String()),
})

type ContentSearchParams = Static<typeof contentSearchSchema>

export const Route = createFileRoute('/_authenticated/content/')({
  validateSearch: (search: Record<string, unknown>): ContentSearchParams => ({
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : 10,
    platform: Array.isArray(search.platform)
      ? search.platform as ContentSearchParams['platform']
      : undefined,
    contentType: Array.isArray(search.contentType)
      ? search.contentType as ContentSearchParams['contentType']
      : undefined,
    filter: typeof search.filter === 'string' ? search.filter : undefined,
  }),
  component: ContentPage,
})

function ContentPage() {
  return <ContentLibrary />
}
