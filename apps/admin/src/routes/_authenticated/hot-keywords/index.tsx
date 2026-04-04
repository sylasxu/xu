import { Type, type Static } from '@sinclair/typebox'
import { createFileRoute } from '@tanstack/react-router'
import { HotKeywordsList } from '@/features/hot-keywords/components/hot-keywords-list'

const hotKeywordsSearchSchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 10 })),
  isActive: Type.Optional(Type.Boolean()),
  matchType: Type.Optional(Type.Union([
    Type.Literal('exact'),
    Type.Literal('prefix'),
    Type.Literal('fuzzy'),
  ])),
  responseType: Type.Optional(Type.Union([
    Type.Literal('widget_explore'),
    Type.Literal('widget_draft'),
    Type.Literal('widget_ask_preference'),
    Type.Literal('text'),
  ])),
  sortBy: Type.Optional(Type.Union([
    Type.Literal('hitCount'),
    Type.Literal('conversionRate'),
    Type.Literal('createdAt'),
  ])),
  sortOrder: Type.Optional(Type.Union([
    Type.Literal('asc'),
    Type.Literal('desc'),
  ])),
  filter: Type.Optional(Type.String()),
})

type HotKeywordsSearchParams = Static<typeof hotKeywordsSearchSchema>

export const Route = createFileRoute('/_authenticated/hot-keywords/')({
  validateSearch: (search: Record<string, unknown>): HotKeywordsSearchParams => ({
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : 10,
    isActive: typeof search.isActive === 'boolean' ? search.isActive : undefined,
    matchType: typeof search.matchType === 'string' ? search.matchType as HotKeywordsSearchParams['matchType'] : undefined,
    responseType: typeof search.responseType === 'string' ? search.responseType as HotKeywordsSearchParams['responseType'] : undefined,
    sortBy: typeof search.sortBy === 'string' ? search.sortBy as HotKeywordsSearchParams['sortBy'] : undefined,
    sortOrder: typeof search.sortOrder === 'string' ? search.sortOrder as HotKeywordsSearchParams['sortOrder'] : undefined,
    filter: typeof search.filter === 'string' ? search.filter : undefined,
  }),
  component: HotKeywordsList,
})
