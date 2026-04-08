import { useState } from 'react'
import { Shield, Check, X, Ban, AlertTriangle, Loader2 } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useApproveModeration,
  useBanModeration,
  useModerationQueue,
  useRejectModeration,
} from '@/hooks/use-moderation'

export function SafetyPage() {
  const [page] = useState(1)
  const { data, isLoading, error } = useModerationQueue({ page, limit: 20 })
  const approveMutation = useApproveModeration()
  const rejectMutation = useRejectModeration()
  const banMutation = useBanModeration()
  const pendingCount = data?.pendingCount ?? 0
  const items = data?.items ?? []

  const handleApprove = (id: string) => {
    if (confirm('确认通过审核？')) {
      approveMutation.mutate(id)
    }
  }

  const handleReject = (id: string) => {
    if (confirm('确认删除该内容？')) {
      rejectMutation.mutate(id)
    }
  }

  const handleBan = (id: string) => {
    if (confirm('确认删除内容并封禁用户？此操作不可撤销。')) {
      banMutation.mutate(id)
    }
  }

  return (
    <>
      <Header>
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main>
        <div className='mb-6 flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <Shield className='h-6 w-6' />
            <div>
              <h1 className='text-2xl font-bold'>风险审核</h1>
              <p className='text-muted-foreground'>集中处理 AI 拦截出来、需要人工拍板的内容。</p>
            </div>
            {pendingCount > 0 && (
              <Badge variant='destructive'>{pendingCount} 待处理</Badge>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className='space-y-4'>
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className='h-6 w-full' />
                </CardHeader>
                <CardContent>
                  <Skeleton className='h-24 w-full' />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : error ? (
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-12'>
              <AlertTriangle className='mb-4 h-12 w-12 text-destructive' />
              <p className='text-destructive'>加载失败: {error.message}</p>
            </CardContent>
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className='flex flex-col items-center justify-center py-12'>
              <Shield className='mb-4 h-12 w-12 text-muted-foreground' />
              <p className='text-muted-foreground'>暂无待审核内容</p>
            </CardContent>
          </Card>
        ) : (
          <div className='space-y-4'>
            {items.map((item) => (
              <Card key={item.id} className={item.status === 'pending' ? 'border-destructive/50' : ''}>
                <CardHeader className='pb-3'>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-2'>
                      <AlertTriangle className='h-4 w-4 text-destructive' />
                      <CardTitle className='text-base'>
                        {item.contentType === 'input' ? '用户输入' : 'AI 输出'}疑似违规
                      </CardTitle>
                      <Badge variant='outline'>{item.reason}</Badge>
                      {item.status === 'pending' && <Badge variant='destructive'>待审核</Badge>}
                      {item.status === 'approved' && <Badge variant='secondary'>已通过</Badge>}
                      {item.status === 'rejected' && <Badge variant='outline'>已拒绝</Badge>}
                    </div>
                    <span className='text-sm text-muted-foreground'>
                      {new Date(item.createdAt).toLocaleString('zh-CN')}
                    </span>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className='space-y-4'>
                    <div>
                      <p className='mb-1 text-sm text-muted-foreground'>用户</p>
                      <p>{item.userNickname || item.userId}</p>
                    </div>
                    <div>
                      <p className='mb-1 text-sm text-muted-foreground'>内容</p>
                      <p className='rounded-md bg-muted p-3 whitespace-pre-wrap'>{item.content}</p>
                    </div>
                    {item.status === 'pending' && (
                      <div className='flex gap-2'>
                        <Button
                          variant='outline'
                          size='sm'
                          className='text-green-600'
                          onClick={() => handleApprove(item.id)}
                          disabled={approveMutation.isPending}
                        >
                          {approveMutation.isPending ? (
                            <Loader2 className='mr-1 h-4 w-4 animate-spin' />
                          ) : (
                            <Check className='mr-1 h-4 w-4' />
                          )}
                          通过
                        </Button>
                        <Button
                          variant='outline'
                          size='sm'
                          className='text-destructive'
                          onClick={() => handleReject(item.id)}
                          disabled={rejectMutation.isPending}
                        >
                          {rejectMutation.isPending ? (
                            <Loader2 className='mr-1 h-4 w-4 animate-spin' />
                          ) : (
                            <X className='mr-1 h-4 w-4' />
                          )}
                          删除
                        </Button>
                        <Button
                          variant='destructive'
                          size='sm'
                          onClick={() => handleBan(item.id)}
                          disabled={banMutation.isPending}
                        >
                          {banMutation.isPending ? (
                            <Loader2 className='mr-1 h-4 w-4 animate-spin' />
                          ) : (
                            <Ban className='mr-1 h-4 w-4' />
                          )}
                          删除并封号
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </Main>
    </>
  )
}
