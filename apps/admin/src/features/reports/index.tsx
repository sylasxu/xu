import { Type, type Static } from '@sinclair/typebox'
import { getRouteApi } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Flag, MessageSquareWarning } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useReportsList, useUpdateReport } from '@/hooks/use-reports'

const route = getRouteApi('/_authenticated/reports/')

const reportTypeLabels: Record<string, string> = {
  activity: '活动',
  message: '消息',
  user: '用户',
}

const reportReasonLabels: Record<string, string> = {
  inappropriate: '不当内容',
  fake: '虚假信息',
  harassment: '骚扰',
  other: '其他',
}

type ReportStatus = 'all' | 'pending' | 'resolved' | 'ignored'
type ReportType = 'all' | 'activity' | 'message' | 'user'

export const reportsSearchSchema = Type.Object({
  status: Type.Optional(Type.Union([
    Type.Literal('pending'),
    Type.Literal('resolved'),
    Type.Literal('ignored'),
  ])),
  type: Type.Optional(Type.Union([
    Type.Literal('activity'),
    Type.Literal('message'),
    Type.Literal('user'),
  ])),
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
})

export type ReportsSearchParams = Static<typeof reportsSearchSchema>

export function ReportsPage() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const activeStatus: ReportStatus = search.status ?? 'all'
  const activeType: ReportType = search.type ?? 'all'
  const page = search.page ?? 1
  const pageSize = search.pageSize ?? 20
  const { data, isLoading, error } = useReportsList({
    page,
    limit: pageSize,
    status: activeStatus === 'all' ? undefined : activeStatus,
    type: activeType === 'all' ? undefined : activeType,
  })
  const updateReport = useUpdateReport()
  const reports = data?.items ?? []
  const total = data?.total ?? 0
  const pendingCount = reports.filter((item) => item.status === 'pending').length

  const updateStatus = (id: string, status: 'resolved' | 'ignored') => {
    updateReport.mutate({ id, status })
  }

  return (
    <>
      <Header>
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main>
        <div className='mb-6 flex items-start justify-between gap-4'>
          <div className='flex items-center gap-3'>
            <Flag className='h-6 w-6' />
            <div>
              <h1 className='text-2xl font-bold'>用户举报</h1>
              <p className='text-muted-foreground'>集中处理用户主动提交的问题内容和问题对象。</p>
            </div>
          </div>
          <div className='text-sm text-muted-foreground'>
            当前共 {total} 条
            {pendingCount > 0 ? `，其中 ${pendingCount} 条待处理` : ''}
          </div>
        </div>

        <div className='mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
          <Tabs
            value={activeStatus}
            onValueChange={(value) =>
              navigate({
                search: (prev) => ({
                  ...prev,
                  page: 1,
                  status: value === 'all' ? undefined : value as ReportsSearchParams['status'],
                }),
              })
            }
          >
            <TabsList>
              <TabsTrigger value='all'>全部</TabsTrigger>
              <TabsTrigger value='pending'>待处理</TabsTrigger>
              <TabsTrigger value='resolved'>已解决</TabsTrigger>
              <TabsTrigger value='ignored'>已忽略</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className='w-full max-w-[220px]'>
            <Select
              value={activeType}
              onValueChange={(value) =>
                navigate({
                  search: (prev) => ({
                    ...prev,
                    page: 1,
                    type: value === 'all' ? undefined : value as ReportsSearchParams['type'],
                  }),
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder='全部类型' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部类型</SelectItem>
                <SelectItem value='activity'>活动</SelectItem>
                <SelectItem value='message'>消息</SelectItem>
                <SelectItem value='user'>用户</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className='space-y-4'>
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className='h-6 w-full' />
                </CardHeader>
                <CardContent>
                  <Skeleton className='h-20 w-full' />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : error ? (
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-12'>
              <AlertTriangle className='mb-4 h-12 w-12 text-destructive' />
              <p className='text-destructive'>加载失败: {error.message}</p>
            </CardContent>
          </Card>
        ) : reports.length === 0 ? (
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-12'>
              <MessageSquareWarning className='mb-4 h-12 w-12 text-muted-foreground' />
              <p className='text-muted-foreground'>当前筛选条件下暂无举报</p>
            </CardContent>
          </Card>
        ) : (
          <div className='space-y-4'>
            {reports.map((report) => (
              <Card key={report.id}>
                <CardHeader className='pb-3'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <CardTitle className='text-base'>
                      {reportTypeLabels[report.type] ?? report.type}举报
                    </CardTitle>
                    <Badge variant='outline'>{reportReasonLabels[report.reason] ?? report.reason}</Badge>
                    <Badge
                      variant={
                        report.status === 'pending'
                          ? 'destructive'
                          : report.status === 'resolved'
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      {report.status === 'pending'
                        ? '待处理'
                        : report.status === 'resolved'
                          ? '已解决'
                          : '已忽略'}
                    </Badge>
                    <span className='ml-auto text-sm text-muted-foreground'>
                      {new Date(report.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <div className='grid gap-4 md:grid-cols-2'>
                    <div>
                      <p className='mb-1 text-sm text-muted-foreground'>举报人</p>
                      <p>{report.reporter?.nickname || report.reporterId}</p>
                    </div>
                    <div>
                      <p className='mb-1 text-sm text-muted-foreground'>目标 ID</p>
                      <p className='font-mono text-sm'>{report.targetId}</p>
                    </div>
                  </div>

                  {report.description ? (
                    <div>
                      <p className='mb-1 text-sm text-muted-foreground'>举报说明</p>
                      <p className='rounded-md bg-muted p-3 whitespace-pre-wrap'>{report.description}</p>
                    </div>
                  ) : null}

                  <div>
                    <p className='mb-1 text-sm text-muted-foreground'>内容快照</p>
                    <pre className='overflow-x-auto rounded-md bg-muted p-3 text-sm whitespace-pre-wrap'>
                      {report.targetContent}
                    </pre>
                  </div>

                  {report.adminNote ? (
                    <div>
                      <p className='mb-1 text-sm text-muted-foreground'>处理备注</p>
                      <p className='rounded-md border p-3 whitespace-pre-wrap'>{report.adminNote}</p>
                    </div>
                  ) : null}

                  {report.status === 'pending' ? (
                    <div className='flex gap-2'>
                      <Button
                        size='sm'
                        onClick={() => updateStatus(report.id, 'resolved')}
                        disabled={updateReport.isPending}
                      >
                        <CheckCircle2 className='mr-1 h-4 w-4' />
                        标记已解决
                      </Button>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => updateStatus(report.id, 'ignored')}
                        disabled={updateReport.isPending}
                      >
                        忽略
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Main>
    </>
  )
}
