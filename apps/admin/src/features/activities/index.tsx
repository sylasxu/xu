import { Calendar } from 'lucide-react'
import { getRouteApi } from '@tanstack/react-router'
import { ListPage, DataTable } from '@/components/list-page'
import { useActivities } from '@/hooks/use-activities'
import { type Activity } from './data/schema'
import { activitiesColumns } from './components/activities-columns'
import { ActivitiesDialogs } from './components/activities-dialogs'
import { ActivitiesPrimaryButtons } from './components/activities-primary-buttons'
import { DataTableBulkActions } from './components/data-table-bulk-actions'
import { ActivitiesListProvider } from './list-context'

const route = getRouteApi('/_authenticated/activities/')

export function Activities() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const pageSize = search.pageSize ?? 10
  
  const { data, isLoading, error } = useActivities({
    page: search.page ?? 1,
    limit: pageSize,
    status: search.status?.join(','),
    type: search.type?.join(','),
    search: search.filter,
  })
  
  // 转换 API 返回数据为组件需要的格式
  const activities: Activity[] = (data?.data ?? []).map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description ?? null,
    location: [item.location[0], item.location[1]] as [number, number],
    locationName: item.locationName,
    locationHint: item.locationHint,
    startAt: item.startAt,
    type: item.type,
    maxParticipants: item.maxParticipants,
    currentParticipants: item.currentParticipants,
    status: item.status,
    creator: item.creator || null,
    isArchived: item.isArchived || false,
  }))
  const total = data?.total ?? 0

  return (
    <ActivitiesListProvider>
      <ListPage
        title='活动管理'
        description='管理平台活动，查看活动信息和状态'
        icon={Calendar}
        isLoading={isLoading}
        error={error ?? undefined}
        headerActions={<ActivitiesPrimaryButtons />}
        dialogs={<ActivitiesDialogs />}
      >
        <DataTable
          data={activities}
          columns={activitiesColumns}
          pageCount={Math.ceil(total / pageSize)}
          search={search}
          navigate={navigate}
          getRowId={(row) => row.id}
          searchPlaceholder='按标题、ID或地点搜索...'
          emptyMessage='暂无活动'
          enableRowSelection={true}
          facetedFilters={[
            {
              columnId: 'status',
              title: '状态',
              options: [
                { label: '草稿', value: 'draft' },
                { label: '进行中', value: 'active' },
                { label: '已完成', value: 'completed' },
                { label: '已取消', value: 'cancelled' },
              ],
            },
            {
              columnId: 'type',
              title: '类型',
              options: [
                { label: '美食', value: 'food' },
                { label: '运动', value: 'sports' },
                { label: '娱乐', value: 'entertainment' },
                { label: '桌游', value: 'boardgame' },
                { label: '其他', value: 'other' },
              ],
            },
          ]}
          bulkActions={(table) => <DataTableBulkActions table={table} />}
        />
      </ListPage>
    </ActivitiesListProvider>
  )
}
