import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useListContext } from '@/components/list-page'
import { useSetUserQuota, DAILY_QUOTA_LIMIT } from '@/hooks/use-users'
import { type User } from '../data/schema'
import { type UserDialogType } from './users-columns'
import { UsersMutateDrawer } from './users-mutate-drawer'
import { UsersDeleteDialog } from './users-delete-dialog'

export function UsersDialogs() {
  const { open, setOpen, currentRow } = useListContext<User, UserDialogType>()
  const setUserQuota = useSetUserQuota()
  const [quotaValue, setQuotaValue] = useState<string>('')

  const handleQuotaSubmit = () => {
    if (!currentRow) return
    const quota = parseInt(quotaValue, 10)
    if (isNaN(quota) || quota < 0 || quota > 999) return

    setUserQuota.mutate(
      { userId: currentRow.id, quota },
      {
        onSuccess: () => {
          setOpen(null)
          setQuotaValue('')
        },
      }
    )
  }

  const handleQuotaClose = () => {
    setOpen(null)
    setQuotaValue('')
  }

  return (
    <>
      <UsersMutateDrawer />
      {open === 'delete' && currentRow && (
        <UsersDeleteDialog
          open={true}
          onOpenChange={() => setOpen(null)}
          currentRow={currentRow}
        />
      )}

      {/* 创建活动额度调整弹窗 */}
      <Dialog open={open === 'quota'} onOpenChange={handleQuotaClose}>
        <DialogContent className='sm:max-w-[400px]'>
          <DialogHeader>
            <DialogTitle>调整创建活动额度</DialogTitle>
            <DialogDescription>
              为「{currentRow?.nickname || '未设置昵称'}」设置新的创建活动额度
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-4 py-4'>
            <div className='grid gap-2'>
              <Label htmlFor='quota'>新额度值</Label>
              <Input
                id='quota'
                type='number'
                min={0}
                max={999}
                placeholder={`当前: ${(currentRow as any)?.aiCreateQuotaToday ?? DAILY_QUOTA_LIMIT}`}
                value={quotaValue}
                onChange={(e) => setQuotaValue(e.target.value)}
              />
              <p className='text-xs text-muted-foreground'>
                设置为 999 表示无限额度（管理员）
              </p>
            </div>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setQuotaValue(String(DAILY_QUOTA_LIMIT))}
              >
                重置为默认 ({DAILY_QUOTA_LIMIT})
              </Button>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setQuotaValue('999')}
              >
                设为无限
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={handleQuotaClose}>
              取消
            </Button>
            <Button
              onClick={handleQuotaSubmit}
              disabled={setUserQuota.isPending || !quotaValue}
            >
              {setUserQuota.isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
