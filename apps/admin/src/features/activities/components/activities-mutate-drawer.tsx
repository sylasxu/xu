import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { activityTypes, statuses } from '../data/data'
import { useActivitiesListContext } from '../list-context'

// 活动详情/编辑 Drawer - 只读展示，Admin 不直接编辑活动
export function ActivitiesMutateDrawer() {
  const { open, setOpen, currentRow } = useActivitiesListContext()
  const isOpen = open === 'update'

  if (!isOpen || !currentRow) return null

  const typeInfo = activityTypes.find(t => t.value === currentRow.type)
  const statusInfo = statuses.find(s => s.value === currentRow.status)

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(v) => {
        if (!v) setOpen(null)
      }}
    >
      <SheetContent className='flex flex-col'>
        <SheetHeader className='text-start'>
          <SheetTitle>活动详情</SheetTitle>
          <SheetDescription>
            查看活动的详细信息。活动内容由用户创建，管理员只能更改状态或删除。
          </SheetDescription>
        </SheetHeader>
        
        <div className='flex-1 space-y-6 overflow-y-auto px-4'>
          {/* 基础信息 */}
          <div className='space-y-4'>
            <div>
              <label className='text-sm font-medium text-muted-foreground'>活动ID</label>
              <p className='font-mono text-xs mt-1'>{currentRow.id}</p>
            </div>
            
            <div>
              <label className='text-sm font-medium text-muted-foreground'>活动标题</label>
              <p className='mt-1 font-medium'>{currentRow.title}</p>
            </div>

            {currentRow.description && (
              <div>
                <label className='text-sm font-medium text-muted-foreground'>活动描述</label>
                <p className='mt-1 text-sm'>{currentRow.description}</p>
              </div>
            )}

            <div className='flex gap-2'>
              {typeInfo && (
                <Badge variant='outline' className='gap-1'>
                  {typeInfo.label}
                </Badge>
              )}
              {statusInfo && (
                <Badge variant={currentRow.status === 'active' ? 'default' : 'secondary'} className='gap-1'>
                  {statusInfo.label}
                </Badge>
              )}
            </div>
          </div>

          {/* 位置信息 */}
          <div className='space-y-4 border-t pt-4'>
            <h4 className='font-medium'>位置信息</h4>
            <div>
              <label className='text-sm font-medium text-muted-foreground'>地点名称</label>
              <p className='mt-1'>{currentRow.locationName}</p>
            </div>
            <div>
              <label className='text-sm font-medium text-muted-foreground'>位置提示</label>
              <p className='mt-1 text-sm'>{currentRow.locationHint}</p>
            </div>
          </div>

          {/* 参与信息 */}
          <div className='space-y-4 border-t pt-4'>
            <h4 className='font-medium'>参与信息</h4>
            <div className='grid grid-cols-2 gap-4'>
              <div>
                <label className='text-sm font-medium text-muted-foreground'>当前人数</label>
                <p className='mt-1 text-lg font-bold'>{currentRow.currentParticipants}</p>
              </div>
              <div>
                <label className='text-sm font-medium text-muted-foreground'>最大人数</label>
                <p className='mt-1 text-lg font-bold'>{currentRow.maxParticipants}</p>
              </div>
            </div>
          </div>

          {/* 时间信息 */}
          <div className='space-y-4 border-t pt-4'>
            <h4 className='font-medium'>时间信息</h4>
            <div>
              <label className='text-sm font-medium text-muted-foreground'>开始时间</label>
              <p className='mt-1'>
                {new Date(currentRow.startAt).toLocaleString('zh-CN')}
              </p>
            </div>
          </div>
        </div>

        <SheetFooter className='gap-2'>
          <SheetClose asChild>
            <Button variant='outline'>关闭</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
