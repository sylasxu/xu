import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Library, Search, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { useContentLibrary, useDeleteNote } from '../hooks/use-content'
import { CONTENT_TYPE_OPTIONS, type ContentType } from '../data/schema'

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  CONTENT_TYPE_OPTIONS.map((o) => [o.value, o.label])
)

export function ContentLibrary() {
  const [page, setPage] = useState(1)
  const [contentType, setContentType] = useState<string>('all')
  const [keyword, setKeyword] = useState('')
  const navigate = useNavigate()
  const limit = 10

  const { data, isLoading } = useContentLibrary({
    page,
    limit,
    contentType: contentType === 'all' ? undefined : (contentType as ContentType),
    keyword: keyword || undefined,
  })
  const deleteMutation = useDeleteNote()

  const notes = (data as any)?.data ?? []
  const total = (data as any)?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / limit))

  return (
    <div className='space-y-6'>
      <div className='flex items-center gap-3'>
        <Library className='h-6 w-6' />
        <h1 className='text-2xl font-bold'>内容库</h1>
        <span className='text-muted-foreground text-sm'>共 {total} 条</span>
      </div>

      {/* 筛选栏 */}
      <Card>
        <CardContent className='pt-6'>
          <div className='flex gap-4'>
            <div className='relative flex-1'>
              <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
              <Input
                placeholder='搜索主题或正文...'
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value)
                  setPage(1)
                }}
                className='pl-9'
              />
            </div>
            <Select
              value={contentType}
              onValueChange={(v) => {
                setContentType(v)
                setPage(1)
              }}
            >
              <SelectTrigger className='w-40'>
                <SelectValue placeholder='全部类型' />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>全部类型</SelectItem>
                {CONTENT_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* 表格 */}
      <Card>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-[40%]'>标题</TableHead>
                <TableHead>类型</TableHead>
                <TableHead className='text-right'>浏览</TableHead>
                <TableHead className='text-right'>点赞</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className='w-16' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className='text-center py-8 text-muted-foreground'>
                    加载中...
                  </TableCell>
                </TableRow>
              ) : notes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className='text-center py-8 text-muted-foreground'>
                    暂无数据
                  </TableCell>
                </TableRow>
              ) : (
                notes.map((note: any) => (
                  <TableRow
                    key={note.id}
                    className='cursor-pointer'
                    onClick={() => navigate({ to: '/growth/library', search: { id: note.id } })}
                  >
                    <TableCell className='font-medium truncate max-w-[300px]'>
                      {note.title}
                    </TableCell>
                    <TableCell>
                      <Badge variant='outline'>{TYPE_LABEL[note.contentType] ?? note.contentType}</Badge>
                    </TableCell>
                    <TableCell className='text-right'>{note.views ?? '-'}</TableCell>
                    <TableCell className='text-right'>{note.likes ?? '-'}</TableCell>
                    <TableCell className='text-muted-foreground text-sm'>
                      {new Date(note.createdAt).toLocaleDateString('zh-CN')}
                    </TableCell>
                    <TableCell>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant='ghost'
                            size='icon'
                            className='h-8 w-8'
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Trash2 className='h-4 w-4 text-destructive' />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
                          <AlertDialogHeader>
                            <AlertDialogTitle>确认删除</AlertDialogTitle>
                            <AlertDialogDescription>
                              删除后不可恢复，确定要删除这条笔记吗？
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(note.id)}
                            >
                              删除
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className='flex items-center justify-center gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className='h-4 w-4' />
          </Button>
          <span className='text-sm text-muted-foreground'>
            {page} / {totalPages}
          </span>
          <Button
            variant='outline'
            size='sm'
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className='h-4 w-4' />
          </Button>
        </div>
      )}
    </div>
  )
}
