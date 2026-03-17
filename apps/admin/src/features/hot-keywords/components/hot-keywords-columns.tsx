import { type ColumnDef } from '@tanstack/react-table'
import { DotsHorizontalIcon } from '@radix-ui/react-icons'
import { Trash2, Edit, Eye, Power, PowerOff } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DataTableColumnHeader } from '@/components/data-table'
import { type GlobalKeyword } from '../data/schema'
import { useUpdateHotKeyword } from '../hooks/use-hot-keywords'
import { useHotKeywordsListContext } from './list-context'

// 热词弹窗类型
export type HotKeywordDialogType = 'delete' | 'view'

// 匹配类型标签
const matchTypeLabels: Record<string, string> = {
  exact: '完全匹配',
  prefix: '前缀匹配',
  fuzzy: '模糊匹配',
}

// 响应类型标签
const responseTypeLabels: Record<string, string> = {
  widget_explore: '探索活动',
  widget_draft: '创建草稿',
  widget_launcher: '快速发起',
  widget_action: '操作引导',
  widget_ask_preference: '偏好询问',
  text: '文本回复',
}

// 行操作组件
function HotKeywordRowActions({ keyword }: { keyword: GlobalKeyword }) {
  const navigate = useNavigate()
  const { setOpen, setCurrentRow } = useHotKeywordsListContext()
  const updateMutation = useUpdateHotKeyword()

  const handleToggleStatus = () => {
    updateMutation.mutate({
      id: keyword.id,
      data: { isActive: !keyword.isActive },
    })
  }

  return (
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
      <DropdownMenuContent align='end' className='w-[160px]'>
        <DropdownMenuItem
          onClick={() => {
            setCurrentRow(keyword)
            setOpen('view')
          }}
        >
          查看详情
          <DropdownMenuShortcut>
            <Eye size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => navigate({ to: '/hot-keywords/$id/edit', params: { id: keyword.id } })}
        >
          编辑
          <DropdownMenuShortcut>
            <Edit size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleToggleStatus}>
          {keyword.isActive ? '停用' : '启用'}
          <DropdownMenuShortcut>
            {keyword.isActive ? <PowerOff size={16} /> : <Power size={16} />}
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className='text-destructive focus:text-destructive'
          onClick={() => {
            setCurrentRow(keyword)
            setOpen('delete')
          }}
        >
          删除
          <DropdownMenuShortcut>
            <Trash2 size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// 列定义
export const hotKeywordsColumns: ColumnDef<GlobalKeyword>[] = [
  {
    accessorKey: 'keyword',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='关键词' />
    ),
    cell: ({ row }) => (
      <span className='font-medium'>
        {row.getValue('keyword')}
      </span>
    ),
    enableSorting: false,
  },
  {
    accessorKey: 'matchType',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='匹配方式' />
    ),
    cell: ({ row }) => {
      const matchType = row.getValue('matchType') as string
      return (
        <Badge variant='outline'>
          {matchTypeLabels[matchType] || matchType}
        </Badge>
      )
    },
    enableSorting: false,
  },
  {
    accessorKey: 'responseType',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='响应类型' />
    ),
    cell: ({ row }) => {
      const responseType = row.getValue('responseType') as string
      return (
        <Badge variant='secondary'>
          {responseTypeLabels[responseType] || responseType}
        </Badge>
      )
    },
    enableSorting: false,
  },
  {
    accessorKey: 'priority',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='优先级' />
    ),
    cell: ({ row }) => {
      const priority = row.getValue('priority') as number
      return <span className='font-mono'>{priority}</span>
    },
    enableSorting: false,
  },
  {
    accessorKey: 'hitCount',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='命中次数' />
    ),
    cell: ({ row }) => {
      const count = row.getValue('hitCount') as number
      return <span className='font-bold'>{count}</span>
    },
  },
  {
    accessorKey: 'conversionCount',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='转化次数' />
    ),
    cell: ({ row }) => {
      const count = row.getValue('conversionCount') as number
      return <span className='font-bold'>{count}</span>
    },
  },
  {
    id: 'conversionRate',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='转化率' />
    ),
    cell: ({ row }) => {
      const hitCount = row.original.hitCount
      const conversionCount = row.original.conversionCount
      const rate = hitCount > 0 ? (conversionCount / hitCount) * 100 : 0
      return (
        <span className='font-bold'>
          {rate.toFixed(2)}%
        </span>
      )
    },
  },
  {
    accessorKey: 'isActive',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='状态' />
    ),
    cell: ({ row }) => {
      const isActive = row.getValue('isActive') as boolean
      return (
        <Badge variant={isActive ? 'default' : 'secondary'}>
          {isActive ? '活跃' : '已停用'}
        </Badge>
      )
    },
    enableSorting: false,
  },
  {
    accessorKey: 'createdAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='创建时间' />
    ),
    cell: ({ row }) => {
      const date = new Date(row.getValue('createdAt'))
      return <span className='text-sm'>{date.toLocaleDateString('zh-CN')}</span>
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => <HotKeywordRowActions keyword={row.original} />,
  },
]
