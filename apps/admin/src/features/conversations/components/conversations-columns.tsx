import { type ColumnDef } from '@tanstack/react-table'
import { DotsHorizontalIcon } from '@radix-ui/react-icons'
import { Eye, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DataTableColumnHeader } from '@/components/data-table'
import type { ConversationSession } from '@/hooks/use-conversations'
import { useConversationsListContext } from '../list-context'

// 弹窗类型
export type ConversationDialogType = 'view' | 'delete' | 'batch-delete'

// 行操作组件
function SessionRowActions({ session }: { session: ConversationSession }) {
  const { setOpen, setCurrentRow } = useConversationsListContext()

  const handleView = () => {
    setCurrentRow(session)
    setOpen('view')
  }

  const handleDelete = () => {
    setCurrentRow(session)
    setOpen('delete')
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant='ghost' className='data-[state=open]:bg-muted flex h-8 w-8 p-0'>
          <DotsHorizontalIcon className='h-4 w-4' />
          <span className='sr-only'>打开菜单</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-[160px]'>
        <DropdownMenuItem onClick={handleView}>
          查看对话
          <DropdownMenuShortcut>
            <Eye size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleDelete} className='text-destructive focus:text-destructive'>
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
export const conversationsColumns: ColumnDef<ConversationSession>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && 'indeterminate')
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label='全选'
        className='translate-y-[2px]'
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label='选择行'
        className='translate-y-[2px]'
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  // v4.6: 评估状态列
  {
    id: 'evaluation',
    header: ({ column }) => <DataTableColumnHeader column={column} title='评估' />,
    cell: ({ row }) => {
      const status = row.original.evaluationStatus
      const hasError = row.original.hasError
      
      return (
        <div className='flex items-center gap-1'>
          {/* 评估状态图标 */}
          {status === 'good' && <span title='Good Case'>✅</span>}
          {status === 'bad' && <span title='Bad Case'>🔴</span>}
          {status === 'unreviewed' && <span title='未评估' className='opacity-50'>⚪</span>}
          {/* 错误标记 */}
          {hasError && <span title='有错误'>⚠️</span>}
        </div>
      )
    },
    enableSorting: false,
  },
  {
    accessorKey: 'userNickname',
    header: ({ column }) => <DataTableColumnHeader column={column} title='用户' />,
    cell: ({ row }) => (
      <span className='font-medium'>{row.getValue('userNickname') || '匿名用户'}</span>
    ),
    enableSorting: false,
  },
  {
    accessorKey: 'messageCount',
    header: ({ column }) => <DataTableColumnHeader column={column} title='消息数' />,
    cell: ({ row }) => (
      <Badge variant='secondary'>{row.getValue('messageCount')}</Badge>
    ),
    enableSorting: false,
  },
  {
    accessorKey: 'lastMessageAt',
    header: ({ column }) => <DataTableColumnHeader column={column} title='最后活跃' />,
    cell: ({ row }) => (
      <div className='text-sm text-muted-foreground whitespace-nowrap'>
        {new Date(row.getValue('lastMessageAt') as string).toLocaleString('zh-CN')}
      </div>
    ),
  },
  {
    id: 'actions',
    cell: ({ row }) => <SessionRowActions session={row.original} />,
  },
]
