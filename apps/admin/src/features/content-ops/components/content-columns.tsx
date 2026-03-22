import { type ColumnDef } from '@tanstack/react-table'
import { DotsHorizontalIcon } from '@radix-ui/react-icons'
import { Edit, Eye, Sparkles, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DataTableColumnHeader } from '@/components/data-table'
import { TruncatedCell } from '@/components/truncated-cell'
import { CONTENT_PLATFORM_OPTIONS, CONTENT_TYPE_OPTIONS, type ContentNote } from '../data/schema'

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  CONTENT_TYPE_OPTIONS.map((option) => [option.value, option.label])
)

const PLATFORM_LABEL: Record<string, string> = Object.fromEntries(
  CONTENT_PLATFORM_OPTIONS.map((option) => [option.value, option.label])
)

function hasPerformanceData(note: ContentNote) {
  return [note.views, note.likes, note.collects, note.comments, note.newFollowers].some(
    (value) => typeof value === 'number' && value > 0
  )
}

function ContentRowActions({
  note,
  onOpen,
  onOpenGenerate,
  onOpenPerformance,
  onDelete,
  deleting,
}: {
  note: ContentNote
  onOpen: (id: string) => void
  onOpenGenerate: (id: string) => void
  onOpenPerformance: (id: string) => void
  onDelete: (id: string) => void
  deleting: boolean
}) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  return (
    <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            className='data-[state=open]:bg-muted flex h-8 w-8 p-0'
          >
            <DotsHorizontalIcon className='h-4 w-4' />
            <span className='sr-only'>打开菜单</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-[180px]'>
          <DropdownMenuItem onClick={() => onOpen(note.id)}>
            查看详情
            <DropdownMenuShortcut>
              <Eye size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onOpenGenerate(note.id)}>
            继续生成
            <DropdownMenuShortcut>
              <Sparkles size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onOpenPerformance(note.id)}>
            补效果
            <DropdownMenuShortcut>
              <Edit size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className='text-destructive focus:text-destructive'
            disabled={deleting}
            onClick={() => setDeleteDialogOpen(true)}
          >
            删除
            <DropdownMenuShortcut>
              <Trash2 size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            删除后不可恢复，确定要删除这条内容吗？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={() => onDelete(note.id)}>
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function getContentColumns(params: {
  onOpen: (id: string) => void
  onOpenGenerate: (id: string) => void
  onOpenPerformance: (id: string) => void
  onDelete: (id: string) => void
  deleting: boolean
}): ColumnDef<ContentNote>[] {
  return [
    {
      accessorKey: 'title',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='标题' />
      ),
      cell: ({ row }) => (
        <button
          type='button'
          className='text-left font-medium hover:underline'
          onClick={() => params.onOpen(row.original.id)}
        >
          <TruncatedCell value={row.original.title} maxLength={24} showCopy />
        </button>
      ),
      enableHiding: false,
    },
    {
      accessorKey: 'body',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='正文' />
      ),
      cell: ({ row }) => (
        <TruncatedCell value={row.original.body} maxLength={40} showCopy />
      ),
    },
    {
      accessorKey: 'platform',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='平台' />
      ),
      cell: ({ row }) => (
        <Badge variant='outline'>
          {PLATFORM_LABEL[row.original.platform] ?? row.original.platform}
        </Badge>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'contentType',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='类型' />
      ),
      cell: ({ row }) => (
        <Badge variant='outline'>
          {TYPE_LABEL[row.original.contentType] ?? row.original.contentType}
        </Badge>
      ),
      enableSorting: false,
    },
    {
      id: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='状态' />
      ),
      cell: ({ row }) => (
        <Badge variant={hasPerformanceData(row.original) ? 'secondary' : 'outline'}>
          {hasPerformanceData(row.original) ? '已回填效果' : '待补效果'}
        </Badge>
      ),
      enableSorting: false,
    },
    {
      accessorKey: 'views',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='浏览' />
      ),
      cell: ({ row }) => <span>{row.original.views ?? '-'}</span>,
    },
    {
      accessorKey: 'likes',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='点赞' />
      ),
      cell: ({ row }) => <span>{row.original.likes ?? '-'}</span>,
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='创建时间' />
      ),
      cell: ({ row }) => (
        <span className='text-sm'>
          {new Date(row.original.createdAt).toLocaleDateString('zh-CN')}
        </span>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <ContentRowActions
          note={row.original}
          onOpen={params.onOpen}
          onOpenGenerate={params.onOpenGenerate}
          onOpenPerformance={params.onOpenPerformance}
          onDelete={params.onDelete}
          deleting={params.deleting}
        />
      ),
    },
  ]
}
