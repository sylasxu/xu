import { useCallback, useMemo, useState } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { FileText } from 'lucide-react'
import { DataTable, ListPage, type FacetedFilterConfig } from '@/components/list-page'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type NavigateFn } from '@/hooks/use-table-url-state'
import { useContentAnalytics, useContentLibrary, useDeleteNote } from '../hooks/use-content'
import { HotKeywordsListView } from '@/features/hot-keywords/components/hot-keywords-list'
import { HotKeywordsDialogs } from '@/features/hot-keywords/components/hot-keywords-dialogs'
import { HotKeywordsPrimaryButtons } from '@/features/hot-keywords/components/hot-keywords-primary-buttons'
import {
  CONTENT_PLATFORM_OPTIONS,
  CONTENT_TYPE_OPTIONS,
  isContentPlatform,
  isContentType,
  type ContentPlatform,
  type ContentType,
} from '../data/schema'
import { ContentGenerate } from './content-generate'
import { getContentColumns } from './content-columns'

const route = getRouteApi('/_authenticated/content/')

export function ContentLibrary() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const [keywordSearch, setKeywordSearch] = useState<Record<string, unknown>>({
    page: 1,
    pageSize: 10,
  })
  const pageSize = search.pageSize ?? 10
  const activeTab = search.tab === 'keywords' ? 'keywords' : 'notes'
  const selectedPlatforms = Array.isArray(search.platform)
    ? search.platform.filter((value): value is ContentPlatform => isContentPlatform(value))
    : []
  const selectedTypes = Array.isArray(search.contentType)
    ? search.contentType.filter((value): value is ContentType => isContentType(value))
    : []
  const activePlatform = selectedPlatforms[0]
  const activeContentType = selectedTypes[0]

  const { data, isLoading, error } = useContentLibrary({
    page: search.page ?? 1,
    limit: pageSize,
    platform: activePlatform,
    contentType: activeContentType,
    keyword: search.filter,
  })
  const { data: analytics } = useContentAnalytics()
  const deleteMutation = useDeleteNote()

  const notes = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const columns = useMemo(
    () =>
      getContentColumns({
        onOpen: (id) => navigate({ to: '/content/$id', params: { id } }),
        onOpenGenerate: (id) =>
          navigate({ to: '/content/$id', params: { id }, search: { tab: 'generate' } }),
        onOpenPerformance: (id) =>
          navigate({ to: '/content/$id', params: { id }, search: { tab: 'current', focus: 'performance' } }),
        onDelete: (id) => deleteMutation.mutate(id),
        deleting: deleteMutation.isPending,
      }),
    [deleteMutation, navigate]
  )
  const facetedFilters = useMemo<FacetedFilterConfig[]>(
    () => [
      {
        columnId: 'platform',
        title: '平台',
        options: CONTENT_PLATFORM_OPTIONS.map((option) => ({
          label: option.label,
          value: option.value,
        })),
      },
      {
        columnId: 'contentType',
        title: '类型',
        options: CONTENT_TYPE_OPTIONS.map((option) => ({
          label: option.label,
          value: option.value,
        })),
      },
    ],
    []
  )

  const keywordNavigate = useCallback<NavigateFn>(({ search: nextSearch }) => {
    setKeywordSearch((prev) => {
      if (nextSearch === true) {
        return prev
      }

      const resolved = typeof nextSearch === 'function' ? nextSearch(prev) : nextSearch
      const merged = { ...prev, ...resolved }

      return Object.fromEntries(
        Object.entries(merged).filter(([, value]) => value !== undefined)
      )
    })
  }, [])

  return (
    <ListPage
      title='内容工作台'
      description='围绕真实需求做选题、出稿、热词承接和效果回填，不再拆成两套独立页面。'
      icon={FileText}
      isLoading={isLoading}
      error={error instanceof Error ? error : undefined}
      headerActions={<span className='text-muted-foreground text-sm'>共 {total} 条内容</span>}
    >
      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          navigate({
            search: (prev) => ({
              ...prev,
              tab: value === 'notes' ? undefined : value,
            }),
          })
        }
        className='space-y-6'
      >
        <TabsList className='grid w-full max-w-sm grid-cols-2'>
          <TabsTrigger value='notes'>内容</TabsTrigger>
          <TabsTrigger value='keywords'>热词</TabsTrigger>
        </TabsList>

        <TabsContent value='notes' className='space-y-6'>
          <ContentGenerate
            showPageTitle={false}
            heading='快速生成'
            description='先出 1 到 3 版小红书、抖音或微信内容，再决定要不要继续做这个方向。'
          />

          <section className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
            <SummaryCard
              title='内容总数'
              value={analytics?.totalNotes ?? 0}
              hint='已经进入内容库、可继续追踪结果的内容版本。'
            />
            <SummaryCard
              title='待补效果'
              value={analytics?.pendingPerformanceCount ?? 0}
              hint='这些内容还没补浏览、点赞或涨粉数据。'
            />
            <SummaryCard
              title='高表现内容'
              value={analytics?.highPerformingCount ?? 0}
              hint='基于当前互动综合分，值得继续沿同方向扩写。'
            />
            <SummaryCard
              title='累计涨粉'
              value={analytics?.newFollowersTotal ?? 0}
              hint='先看内容有没有带来真实新增关注，再决定要不要继续投。'
            />
          </section>

          <section className='space-y-4'>
            <div>
              <h2 className='text-lg font-semibold'>最近生成内容</h2>
              <p className='text-sm text-muted-foreground'>
                统一按列表查看，方便继续修改、补效果或删除过时版本。
              </p>
            </div>

            <DataTable
              data={notes}
              columns={columns}
              pageCount={pageCount}
              search={search}
              navigate={navigate}
              getRowId={(row) => row.id}
              searchPlaceholder='按标题或主题搜索...'
              emptyMessage='暂无内容版本'
              enableRowSelection={false}
              enableColumnVisibility={false}
              facetedFilters={facetedFilters}
            />
          </section>
        </TabsContent>

        <TabsContent value='keywords' className='space-y-4'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <h2 className='text-lg font-semibold'>热词承接</h2>
              <p className='text-sm text-muted-foreground'>
                热词不是单独运营系统，而是内容工作台里的入口配置层，用来判断哪些词值得接、怎么接。
              </p>
            </div>
            <HotKeywordsPrimaryButtons />
          </div>

          <HotKeywordsListView
            search={keywordSearch}
            navigate={keywordNavigate}
            showPageTitle={false}
            dialogs={<HotKeywordsDialogs />}
          />
        </TabsContent>
      </Tabs>
    </ListPage>
  )
}

function SummaryCard({
  title,
  value,
  hint,
}: {
  title: string
  value: number
  hint: string
}) {
  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-sm font-medium text-muted-foreground'>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='text-2xl font-bold'>{value.toLocaleString()}</div>
        <p className='mt-1 text-xs text-muted-foreground'>{hint}</p>
      </CardContent>
    </Card>
  )
}
