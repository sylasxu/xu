import { DotsHorizontalIcon } from '@radix-ui/react-icons'
import { type Row } from '@tanstack/react-table'
import { Trash2, Eye, MessageSquare, CheckCircle, XCircle, Brain } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { type Activity } from '../data/schema'
import { useUpdateActivityStatus } from '@/hooks/use-activities'
import { useActivitiesListContext } from '../list-context'

type DataTableRowActionsProps<TData> = {
  row: Row<TData>
}

export function DataTableRowActions<TData>({
  row,
}: DataTableRowActionsProps<TData>) {
  const activity = row.original as Activity
  const { setOpen, setCurrentRow } = useActivitiesListContext()
  const updateStatusMutation = useUpdateActivityStatus()

  const canChangeStatus = activity.status === 'active'

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
      <DropdownMenuContent align='end' className='w-[180px]'>
        <DropdownMenuItem
          onClick={() => {
            setCurrentRow(activity)
            setOpen('update')
          }}
        >
          查看详情
          <DropdownMenuShortcut>
            <Eye size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setCurrentRow(activity)
            setOpen('prompt')
          }}
        >
          查看关联 Prompt
          <DropdownMenuShortcut>
            <MessageSquare size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            setCurrentRow(activity)
            setOpen('ai-moderation')
          }}
        >
          AI 审核
          <DropdownMenuShortcut>
            <Brain size={16} className='text-primary' />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {canChangeStatus && (
          <>
            <DropdownMenuItem
              onClick={() => updateStatusMutation.mutate({ id: activity.id, status: 'completed' })}
              disabled={updateStatusMutation.isPending}
            >
              标记为成局
              <DropdownMenuShortcut>
                <CheckCircle size={16} className='text-green-600' />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => updateStatusMutation.mutate({ id: activity.id, status: 'cancelled' })}
              disabled={updateStatusMutation.isPending}
            >
              取消活动
              <DropdownMenuShortcut>
                <XCircle size={16} className='text-orange-600' />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          className='text-destructive focus:text-destructive'
          onClick={() => {
            setCurrentRow(activity)
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
