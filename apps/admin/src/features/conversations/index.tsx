import { useState } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { MessageSquare, Trash2 } from 'lucide-react'
import { DatePicker } from '@/components/date-picker'
import { DataTable, ListPage } from '@/components/list-page'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSessionsList } from '@/hooks/use-conversations'
import { conversationsColumns } from './components/conversations-columns'
import { ConversationsDialogs } from './components/conversations-dialogs'
import { ConversationsListProvider, useConversationsListContext } from './list-context'

const route = getRouteApi('/_authenticated/ai-ops/')

type EvaluationFilter = 'all' | 'unreviewed' | 'bad' | 'hasError'

function getDefaultDateRange() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 30)
  return { start, end }
}

function BatchActions() {
  const { selectedRows, setOpen } = useConversationsListContext()

  if (!selectedRows || selectedRows.length === 0) return null

  return (
    <Button variant='destructive' size='sm' onClick={() => setOpen('batch-delete')}>
      <Trash2 className='mr-2 h-4 w-4' />
      删除选中 ({selectedRows.length})
    </Button>
  )
}

function ConversationsContent() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const pageSize = search.pageSize ?? 20
  const { setSelectedRows } = useConversationsListContext()

  const defaultRange = getDefaultDateRange()
  const [startDate, setStartDate] = useState<Date | undefined>(defaultRange.start)
  const [endDate, setEndDate] = useState<Date | undefined>(defaultRange.end)
  const [evaluationFilter, setEvaluationFilter] = useState<EvaluationFilter>('all')

  const getFilterParams = () => {
    switch (evaluationFilter) {
      case 'unreviewed':
        return { evaluationStatus: 'unreviewed' as const }
      case 'bad':
        return { evaluationStatus: 'bad' as const }
      case 'hasError':
        return { hasError: true }
      default:
        return {}
    }
  }

  const { data, isLoading, error } = useSessionsList({
    page: search.page ?? 1,
    limit: pageSize,
    userId: search.search || undefined,
    startDate: startDate?.toISOString().split('T')[0],
    endDate: endDate?.toISOString().split('T')[0],
    ...getFilterParams(),
  })

  const sessions = data?.data ?? []
  const total = data?.total ?? 0

  return (
    <ListPage
      title='对话记录'
      description='筛查 bad case、错误会话和关键用户对话，不再单独堆一层弱价值统计。'
      icon={MessageSquare}
      isLoading={isLoading}
      error={error ?? undefined}
      dialogs={<ConversationsDialogs />}
      headerActions={<BatchActions />}
    >
      <Tabs value={evaluationFilter} onValueChange={(value) => setEvaluationFilter(value as EvaluationFilter)}>
        <TabsList>
          <TabsTrigger value='all'>全部</TabsTrigger>
          <TabsTrigger value='unreviewed'>⚪ 未评估</TabsTrigger>
          <TabsTrigger value='bad'>🔴 Bad Case</TabsTrigger>
          <TabsTrigger value='hasError'>⚠️ 有错误</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className='flex items-center gap-4'>
        <div className='flex items-center gap-2'>
          <Label className='text-sm text-muted-foreground'>从</Label>
          <DatePicker selected={startDate} onSelect={setStartDate} placeholder='开始日期' />
        </div>
        <div className='flex items-center gap-2'>
          <Label className='text-sm text-muted-foreground'>至</Label>
          <DatePicker selected={endDate} onSelect={setEndDate} placeholder='结束日期' />
        </div>
      </div>

      <DataTable
        data={sessions}
        columns={conversationsColumns}
        pageCount={Math.ceil(total / pageSize)}
        search={search}
        navigate={navigate}
        searchPlaceholder='按用户昵称搜索...'
        emptyMessage='暂无会话记录'
        onSelectedRowsChange={setSelectedRows}
      />
    </ListPage>
  )
}

export function Conversations() {
  return (
    <ConversationsListProvider>
      <ConversationsContent />
    </ConversationsListProvider>
  )
}
