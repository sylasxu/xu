import { useMemo } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { FileText } from 'lucide-react'
import { DataTable, ListPage, type FacetedFilterConfig } from '@/components/list-page'
import { useContentLibrary, useDeleteNote } from '../hooks/use-content'
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
  const pageSize = search.pageSize ?? 10
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

  return (
    <ListPage
      title='内容生成'
      description='先出内容版本，再判断哪个方向值得继续做。'
      icon={FileText}
      isLoading={isLoading}
      error={error instanceof Error ? error : undefined}
      headerActions={<span className='text-muted-foreground text-sm'>共 {total} 条内容</span>}
    >
      <ContentGenerate
        showPageTitle={false}
        heading='快速生成'
        description='先出 1 到 3 版小红书、抖音或微信内容，再决定要不要继续做这个方向。'
      />

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
    </ListPage>
  )
}
