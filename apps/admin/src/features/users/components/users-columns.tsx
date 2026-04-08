import { type ColumnDef } from '@tanstack/react-table'
import { DotsHorizontalIcon } from '@radix-ui/react-icons'
import { Trash2, Edit, Eye } from 'lucide-react'
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
import { TruncatedCell } from '@/components/truncated-cell'
import { type User } from '../data/schema'
import { useUsersListContext } from '../list-context'

// 用户弹窗类型
export type UserDialogType = 'update' | 'delete' | 'import'

// 行操作组件
function UserRowActions({ user }: { user: User }) {
  const navigate = useNavigate()
  const { setOpen, setCurrentRow } = useUsersListContext()

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
          onClick={() => navigate({ to: '/users/$id', params: { id: user.id } })}
        >
          查看详情
          <DropdownMenuShortcut>
            <Eye size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setCurrentRow(user)
            setOpen('update')
          }}
        >
          编辑
          <DropdownMenuShortcut>
            <Edit size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className='text-destructive focus:text-destructive'
          onClick={() => {
            setCurrentRow(user)
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

// 列定义（不包含 select 列，由 DataTable 自动添加）
export const usersColumns: ColumnDef<User>[] = [
  {
    accessorKey: 'id',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='ID' />
    ),
    cell: ({ row }) => (
      <TruncatedCell value={row.getValue('id')} maxLength={8} mono showCopy />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: 'nickname',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='昵称' />
    ),
    cell: ({ row }) => (
      <span className='font-medium'>
        {(row.getValue('nickname') as string) || '匿名搭子'}
      </span>
    ),
  },
  {
    accessorKey: 'phoneNumber',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='手机号' />
    ),
    cell: ({ row }) => {
      const phoneNumber = row.getValue('phoneNumber') as string | undefined
      return phoneNumber ? (
        <span>{phoneNumber}</span>
      ) : (
        <Badge variant='outline' className='text-muted-foreground'>
          未绑定
        </Badge>
      )
    },
  },
  {
    accessorKey: 'createdAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='注册时间' />
    ),
    cell: ({ row }) => {
      const date = new Date(row.getValue('createdAt'))
      return <span className='text-sm'>{date.toLocaleDateString('zh-CN')}</span>
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => <UserRowActions user={row.original} />,
  },
]
