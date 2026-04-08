import { Type, type Static } from '@sinclair/typebox'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Bot, FileClock, Route as RouteIcon, Zap } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PlaygroundLayout } from '@/features/ai-ops/components/playground/playground-layout'
import { AiConfig } from '@/features/ai-ops/ai-config'
import { TokenUsage } from '@/features/ai-ops/token-usage'
import { Conversations } from '@/features/conversations'

const aiOpsSearchSchema = Type.Object({
  view: Type.Optional(Type.Union([
    Type.Literal('playground'),
    Type.Literal('conversations'),
    Type.Literal('config'),
    Type.Literal('usage'),
  ])),
  page: Type.Optional(Type.Number({ minimum: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
  search: Type.Optional(Type.String()),
  hasError: Type.Optional(Type.Array(Type.String())),
})

type AiOpsSearchParams = Static<typeof aiOpsSearchSchema>

export const Route = createFileRoute('/_authenticated/ai-ops/')({
  validateSearch: (search: Record<string, unknown>): AiOpsSearchParams => ({
    view:
      search.view === 'conversations'
      || search.view === 'config'
      || search.view === 'usage'
        ? search.view
        : undefined,
    page: typeof search.page === 'number' ? search.page : undefined,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : undefined,
    search: typeof search.search === 'string' ? search.search : undefined,
    hasError: Array.isArray(search.hasError) ? search.hasError as string[] : undefined,
  }),
  component: AiOpsPage,
})

function AiOpsPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const activeView = search.view ?? 'playground'

  return (
    <div className='space-y-4'>
      <div className='px-4 pt-4'>
        <Tabs
          value={activeView}
          onValueChange={(value) =>
            navigate({
              search: (prev) => ({
                ...prev,
                view: value === 'playground' ? undefined : value as AiOpsSearchParams['view'],
              }),
            })
          }
        >
          <TabsList className='grid w-full max-w-xl grid-cols-4'>
            <TabsTrigger value='playground' className='gap-1.5'>
              <Bot className='h-3.5 w-3.5' />
              Playground
            </TabsTrigger>
            <TabsTrigger value='conversations' className='gap-1.5'>
              <FileClock className='h-3.5 w-3.5' />
              对话记录
            </TabsTrigger>
            <TabsTrigger value='config' className='gap-1.5'>
              <RouteIcon className='h-3.5 w-3.5' />
              模型路由
            </TabsTrigger>
            <TabsTrigger value='usage' className='gap-1.5'>
              <Zap className='h-3.5 w-3.5' />
              用量统计
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {activeView === 'conversations' && <Conversations />}
      {activeView === 'config' && <AiConfig />}
      {activeView === 'usage' && <TokenUsage />}
      {activeView === 'playground' && <PlaygroundLayout />}

      {activeView === 'conversations' && (
        <div className='px-6 pb-4 text-sm text-muted-foreground'>
          需要回放某条会话时，直接在列表里打开详情，不再占一个独立导航页面。
          {' '}
          <Link to='/ai-ops' search={{ view: 'playground' }} className='text-primary hover:underline'>
            回到 Playground
          </Link>
        </div>
      )}
    </div>
  )
}
