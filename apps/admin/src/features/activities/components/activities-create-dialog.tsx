'use client'

import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { activityTypes } from '../data/data'
import { toast } from 'sonner'
import { api } from '@/lib/eden'
import { useActivitiesListContext } from '../list-context'

// 从 Eden Treaty 推导创建活动的 body 类型
type CreateActivityBody = NonNullable<Parameters<typeof api.activities.post>[0]>
type CreateActivityForm = Pick<CreateActivityBody, 'title' | 'description' | 'locationName' | 'address' | 'locationHint' | 'startAt' | 'type' | 'maxParticipants'>

export function ActivitiesCreateDialog() {
  const { open, setOpen } = useActivitiesListContext()
  const isOpen = open === 'create'

  // 无需 resolver，API 层已做验证
  const form = useForm<CreateActivityForm>({
    defaultValues: {
      title: '',
      description: '',
      locationName: '',
      address: '',
      locationHint: '',
      startAt: '',
      type: 'other',
      maxParticipants: 4,
    },
  })

  const onSubmit = async (_values: CreateActivityForm) => {
    try {
      await new Promise(resolve => setTimeout(resolve, 1000))
      toast.success('活动创建成功')
      form.reset()
      setOpen(null)
    } catch (error) {
      toast.error('活动创建失败')
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(state) => {
        if (!state) {
          form.reset()
          setOpen(null)
        }
      }}
    >
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader className='text-start'>
          <DialogTitle>创建活动</DialogTitle>
          <DialogDescription>
            填写活动信息，点击保存完成创建。
          </DialogDescription>
        </DialogHeader>
        <div className='max-h-[60vh] overflow-y-auto py-1 pe-3'>
          <Form {...form}>
            <form
              id='activity-create-form'
              onSubmit={form.handleSubmit(onSubmit)}
              className='space-y-4 px-0.5'
            >
              <FormField
                control={form.control}
                name='title'
                render={({ field }) => (
                  <FormItem className='grid grid-cols-6 items-center space-y-0 gap-x-4 gap-y-1'>
                    <FormLabel className='col-span-2 text-end'>活动标题</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='请输入活动标题'
                        className='col-span-4'
                        autoComplete='off'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className='col-span-4 col-start-3' />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='description'
                render={({ field }) => (
                  <FormItem className='grid grid-cols-6 items-start space-y-0 gap-x-4 gap-y-1'>
                    <FormLabel className='col-span-2 text-end pt-2'>活动描述</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder='请输入活动描述（可选）'
                        className='col-span-4 min-h-[80px]'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className='col-span-4 col-start-3' />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='type'
                render={({ field }) => (
                  <FormItem className='grid grid-cols-6 items-center space-y-0 gap-x-4 gap-y-1'>
                    <FormLabel className='col-span-2 text-end'>活动类型</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className='col-span-4'>
                          <SelectValue placeholder='请选择活动类型' />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {activityTypes.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage className='col-span-4 col-start-3' />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='locationName'
                render={({ field }) => (
                  <FormItem className='grid grid-cols-6 items-center space-y-0 gap-x-4 gap-y-1'>
                    <FormLabel className='col-span-2 text-end'>地点名称</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='请输入地点名称'
                        className='col-span-4'
                        autoComplete='off'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className='col-span-4 col-start-3' />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='address'
                render={({ field }) => (
                  <FormItem className='grid grid-cols-6 items-center space-y-0 gap-x-4 gap-y-1'>
                    <FormLabel className='col-span-2 text-end'>详细地址</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='请输入详细地址（可选）'
                        className='col-span-4'
                        autoComplete='off'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className='col-span-4 col-start-3' />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='locationHint'
                render={({ field }) => (
                  <FormItem className='grid grid-cols-6 items-center space-y-0 gap-x-4 gap-y-1'>
                    <FormLabel className='col-span-2 text-end'>位置提示</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='请输入位置提示（如：XX商场3楼）'
                        className='col-span-4'
                        autoComplete='off'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className='col-span-4 col-start-3' />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='startAt'
                render={({ field }) => (
                  <FormItem className='grid grid-cols-6 items-center space-y-0 gap-x-4 gap-y-1'>
                    <FormLabel className='col-span-2 text-end'>开始时间</FormLabel>
                    <FormControl>
                      <Input
                        type='datetime-local'
                        className='col-span-4'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className='col-span-4 col-start-3' />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name='maxParticipants'
                render={({ field }) => (
                  <FormItem className='grid grid-cols-6 items-center space-y-0 gap-x-4 gap-y-1'>
                    <FormLabel className='col-span-2 text-end'>最大人数</FormLabel>
                    <FormControl>
                      <Input
                        type='number'
                        min={1}
                        max={100}
                        placeholder='请输入最大参与人数'
                        className='col-span-4'
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className='col-span-4 col-start-3' />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => setOpen(null)}>
            取消
          </Button>
          <Button type='submit' form='activity-create-form'>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
