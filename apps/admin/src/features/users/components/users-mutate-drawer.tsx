import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { api } from '@/lib/eden'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useUpdateUser } from '@/hooks/use-users'
import { useUsersListContext } from '../list-context'

// 从 Eden Treaty 推导用户更新的 body 类型
type UpdateUserBody = NonNullable<Parameters<ReturnType<typeof api.users>['put']>[0]>
type UserForm = Pick<UpdateUserBody, 'nickname' | 'avatarUrl'>

export function UsersMutateDrawer() {
  const { open, setOpen, currentRow } = useUsersListContext()
  const isOpen = open === 'update'
  const updateMutation = useUpdateUser()

  const form = useForm<UserForm>({
    defaultValues: {
      nickname: '',
      avatarUrl: '',
    },
  })

  // 当 currentRow 变化时重置表单
  useEffect(() => {
    if (currentRow && isOpen) {
      form.reset({
        nickname: currentRow.nickname || '',
        avatarUrl: currentRow.avatarUrl || '',
      })
    }
  }, [currentRow, isOpen, form])

  const onSubmit = async (data: UserForm) => {
    if (!currentRow) return
    
    await updateMutation.mutateAsync({
      id: currentRow.id,
      data: {
        nickname: data.nickname,
        avatarUrl: data.avatarUrl || undefined,
      },
    })
    
    setOpen(null)
    form.reset()
  }

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(v) => {
        if (!v) {
          setOpen(null)
          form.reset()
        }
      }}
    >
      <SheetContent className='flex flex-col'>
        <SheetHeader className='text-start'>
          <SheetTitle>编辑用户</SheetTitle>
          <SheetDescription>
            更新用户的昵称和头像信息。完成后点击保存。
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form
            id='users-form'
            onSubmit={form.handleSubmit(onSubmit)}
            className='flex-1 space-y-6 overflow-y-auto px-4'
          >
            {/* 只读信息展示 */}
            {currentRow && (
              <div className='space-y-2 rounded-lg border p-4 bg-muted/50'>
                <div className='text-sm'>
                  <span className='text-muted-foreground'>用户ID：</span>
                  <span className='font-mono text-xs'>{currentRow.id}</span>
                </div>
                <div className='text-sm'>
                  <span className='text-muted-foreground'>手机号：</span>
                  <span>{currentRow.phoneNumber || '未绑定'}</span>
                </div>
              </div>
            )}

            <FormField
              control={form.control}
              name='nickname'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>昵称</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='请输入昵称' maxLength={50} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='avatarUrl'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>头像URL</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder='请输入头像URL' />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
        <SheetFooter className='gap-2'>
          <SheetClose asChild>
            <Button variant='outline'>关闭</Button>
          </SheetClose>
          <Button 
            form='users-form' 
            type='submit'
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? '保存中...' : '保存更改'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
