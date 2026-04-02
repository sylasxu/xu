import { Zap } from 'lucide-react'
import { getRouteApi } from '@tanstack/react-router'
import { ListPage, DataTable } from '@/components/list-page'
import { useHotKeywordsList } from '../hooks/use-hot-keywords'
import { hotKeywordsColumns } from './hot-keywords-columns'
import { HotKeywordsDialogs } from './hot-keywords-dialogs'
import { HotKeywordsPrimaryButtons } from './hot-keywords-primary-buttons'
import { HotKeywordsBulkActions } from './hot-keywords-bulk-actions'
import { HotKeywordsListProvider } from './list-context'

const route = getRouteApi('/_authenticated/hot-keywords/')

export function HotKeywordsList() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const pageSize = search.pageSize ?? 10

  const { data, isLoading, error } = useHotKeywordsList({
    page: search.page ?? 1,
    limit: pageSize,
    isActive: search.isActive,
    matchType: search.matchType,
    responseType: search.responseType,
    sortBy: search.sortBy,
    sortOrder: search.sortOrder,
    filter: search.filter,
  })

  const keywords = data?.data ?? []
  const total = data?.total ?? 0

  return (
    <HotKeywordsListProvider>
      <ListPage
        title='热词运营'
        description='统一看直播间、海报和群分发入口里的热词命中、承接内容和转化效果'
        icon={Zap}
        isLoading={isLoading}
        error={error ?? undefined}
        headerActions={<HotKeywordsPrimaryButtons />}
        dialogs={<HotKeywordsDialogs />}
      >
        <DataTable
          data={keywords}
          columns={hotKeywordsColumns}
          pageCount={Math.ceil(total / pageSize)}
          search={search}
          navigate={navigate}
          getRowId={(row) => row.id}
          searchPlaceholder='按关键词搜索...'
          emptyMessage='暂无热词'
          enableRowSelection={true}
          bulkActions={(table) => <HotKeywordsBulkActions table={table} />}
        />
      </ListPage>
    </HotKeywordsListProvider>
  )
}
