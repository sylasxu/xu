import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BarChart3, FileText, Eye, Heart, Bookmark } from 'lucide-react'
import { useContentAnalytics } from '../hooks/use-content'
import { CONTENT_TYPE_OPTIONS } from '../data/schema'

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  CONTENT_TYPE_OPTIONS.map((o) => [o.value, o.label])
)

export function ContentAnalytics() {
  const { data, isLoading } = useContentAnalytics()

  if (isLoading) {
    return <div className='py-12 text-center text-muted-foreground'>加载中...</div>
  }

  const analytics = data as any
  if (!analytics) {
    return <div className='py-12 text-center text-muted-foreground'>暂无数据</div>
  }

  const { byType = [], topNotes = [], totalNotes = 0, totalWithPerformance = 0 } = analytics

  return (
    <div className='space-y-6'>
      <div className='flex items-center gap-3'>
        <BarChart3 className='h-6 w-6' />
        <h1 className='text-2xl font-bold'>效果分析</h1>
      </div>

      {/* 总览 */}
      <div className='grid grid-cols-2 gap-4'>
        <Card>
          <CardContent className='pt-6 text-center'>
            <FileText className='h-8 w-8 mx-auto mb-2 text-muted-foreground' />
            <div className='text-3xl font-bold'>{totalNotes}</div>
            <div className='text-sm text-muted-foreground'>总笔记数</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className='pt-6 text-center'>
            <BarChart3 className='h-8 w-8 mx-auto mb-2 text-muted-foreground' />
            <div className='text-3xl font-bold'>{totalWithPerformance}</div>
            <div className='text-sm text-muted-foreground'>已回填效果数据</div>
          </CardContent>
        </Card>
      </div>

      {/* 按类型平均指标 */}
      {byType.length > 0 && (
        <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-4'>
          {byType.map((item: any) => (
            <Card key={item.contentType}>
              <CardHeader className='pb-2'>
                <CardTitle className='text-sm font-medium'>
                  {TYPE_LABEL[item.contentType] ?? item.contentType}
                  <Badge variant='outline' className='ml-2'>
                    {item.count} 篇
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-2'>
                <MetricRow icon={Eye} label='平均浏览' value={item.avgViews} />
                <MetricRow icon={Heart} label='平均点赞' value={item.avgLikes} />
                <MetricRow icon={Bookmark} label='平均收藏' value={item.avgCollects} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 排行榜 */}
      {topNotes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>内容表现排行榜</CardTitle>
          </CardHeader>
          <CardContent className='p-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-10'>#</TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead className='text-right'>浏览</TableHead>
                  <TableHead className='text-right'>点赞</TableHead>
                  <TableHead className='text-right'>收藏</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topNotes.map((note: any, idx: number) => (
                  <TableRow key={note.id}>
                    <TableCell className='font-mono text-muted-foreground'>
                      {idx + 1}
                    </TableCell>
                    <TableCell className='font-medium truncate max-w-[250px]'>
                      {note.title}
                    </TableCell>
                    <TableCell>
                      <Badge variant='outline'>
                        {TYPE_LABEL[note.contentType] ?? note.contentType}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-right'>{note.views ?? '-'}</TableCell>
                    <TableCell className='text-right'>{note.likes ?? '-'}</TableCell>
                    <TableCell className='text-right'>{note.collects ?? '-'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function MetricRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
}) {
  return (
    <div className='flex items-center justify-between text-sm'>
      <span className='flex items-center gap-1.5 text-muted-foreground'>
        <Icon className='h-3.5 w-3.5' />
        {label}
      </span>
      <span className='font-medium'>{Math.round(value)}</span>
    </div>
  )
}
