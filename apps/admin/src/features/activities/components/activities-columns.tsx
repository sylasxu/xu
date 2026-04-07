import { type ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTableColumnHeader } from '@/components/data-table'
import { TruncatedCell } from '@/components/truncated-cell'
import { statuses, activityTypes } from '../data/data'
import { type Activity } from '../data/schema'
import { DataTableRowActions } from './data-table-row-actions'

// 活动弹窗类型
export type ActivityDialogType = 'update' | 'delete' | 'moderate' | 'prompt' | 'ai-moderation' | 'create'

export const activitiesColumns: ColumnDef<Activity>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && 'indeterminate')
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label='Select all'
        className='translate-y-[2px]'
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label='Select row'
        className='translate-y-[2px]'
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
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
    accessorKey: 'title',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='活动标题' />
    ),
    meta: { className: 'ps-1', tdClassName: 'ps-4' },
    cell: ({ row }) => {
      const activity = row.original
      return (
        <span className='font-medium max-w-48 truncate'>{activity.title}</span>
      )
    },
  },
  {
    accessorKey: 'type',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='类型' />
    ),
    cell: ({ row }) => {
      const category = activityTypes.find(
        (cat) => cat.value === row.getValue('type')
      )
      return category ? (
        <Badge variant='outline'>{category.label}</Badge>
      ) : null
    },
    enableHiding: true,
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },
  {
    accessorKey: 'locationName',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='地点' />
    ),
    cell: ({ row }) => {
      const activity = row.original
      return (
        <div className='flex items-center gap-2 text-sm'>
          {activity.locationName}
        </div>
      )
    },
  },
  {
    accessorKey: 'status',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='状态' />
    ),
    meta: { className: 'ps-1', tdClassName: 'ps-4' },
    cell: ({ row }) => {
      const status = statuses.find(
        (status) => status.value === row.getValue('status')
      )

      if (!status) {
        return null
      }

      return (
        <div className='flex w-[100px] items-center gap-2'>
          {status.icon && (
            <status.icon className='text-muted-foreground size-4' />
          )}
          <span>{status.label}</span>
        </div>
      )
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },
  {
    accessorKey: 'participants',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='参与人数' />
    ),
    cell: ({ row }) => {
      const activity = row.original
      const waitlistText = 'waitlistCount' in activity && typeof activity.waitlistCount === 'number' && activity.waitlistCount > 0
        ? ` · 候补${activity.waitlistCount}`
        : ''
      const remainingSeatsText = 'remainingSeats' in activity && typeof activity.remainingSeats === 'number'
        ? ` · 剩余${activity.remainingSeats}`
        : ''
      return (
        <div className='text-sm'>
          {activity.currentParticipants}/{activity.maxParticipants}
          {waitlistText}
          {remainingSeatsText}
        </div>
      )
    },
    enableSorting: false,
  },
  {
    accessorKey: 'startAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='开始时间' />
    ),
    cell: ({ row }) => {
      const value = row.getValue('startAt')
      if (!value) return <div className='text-sm text-muted-foreground'>-</div>
      
      const date = new Date(value as string)
      if (isNaN(date.getTime())) {
        return <div className='text-sm text-muted-foreground'>-</div>
      }
      
      return (
        <div className='text-sm'>
          {date.toLocaleDateString('zh-CN')} {date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )
    },
  },
  {
    accessorKey: 'createdAt',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='创建时间' />
    ),
    cell: ({ row }) => {
      const value = row.getValue('createdAt')
      if (!value) return <div className='text-sm text-muted-foreground'>-</div>
      
      const date = new Date(value as string)
      if (isNaN(date.getTime())) {
        return <div className='text-sm text-muted-foreground'>-</div>
      }
      
      return (
        <div className='text-sm'>
          {date.toLocaleDateString('zh-CN')}
        </div>
      )
    },
  },
  {
    id: 'actions',
    cell: ({ row }) => <DataTableRowActions row={row} />,
  },
]
