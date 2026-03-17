import { useState } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import { format } from 'date-fns'
import { ArrowLeft, CheckCircle, User, Phone, Brain } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

const UNLIMITED_AI_CREATE_QUOTA = 999
import { useUserDetail } from '@/hooks/use-users'
import { AIProfileTab } from './ai-profile-tab'

export function UserDetail() {
  const { id } = useParams({ from: '/_authenticated/users/$id' })
  const navigate = useNavigate()
  const { data: user, isLoading, isError, error } = useUserDetail(id)

  const [activeTab, setActiveTab] = useState('overview')

  if (isLoading) {
    return (
      <>
        <Header fixed>
          <div className='flex items-center gap-4'>
            <Button variant='ghost' size='sm' onClick={() => navigate({ to: '/users' })}>
              <ArrowLeft className='h-4 w-4' />
              返回
            </Button>
            <Separator orientation='vertical' className='h-6' />
            <div>
              <Skeleton className='h-6 w-32' />
              <Skeleton className='h-4 w-24 mt-1' />
            </div>
          </div>
          <div className='ms-auto flex items-center space-x-4'>
            <ThemeSwitch />
            <ProfileDropdown />
          </div>
        </Header>

        <Main className='flex flex-1 flex-col gap-6'>
          <div className='grid gap-6 md:grid-cols-3'>
            <div className='md:col-span-2 space-y-6'>
              <Skeleton className='h-48 w-full' />
              <Skeleton className='h-64 w-full' />
            </div>
            <div className='space-y-6'>
              <Skeleton className='h-32 w-full' />
              <Skeleton className='h-48 w-full' />
            </div>
          </div>
        </Main>
      </>
    )
  }

  if (isError || !user) {
    return (
      <>
        <Header fixed>
          <div className='flex items-center gap-4'>
            <Button variant='ghost' size='sm' onClick={() => navigate({ to: '/users' })}>
              <ArrowLeft className='h-4 w-4' />
              返回
            </Button>
          </div>
          <div className='ms-auto flex items-center space-x-4'>
            <ThemeSwitch />
            <ProfileDropdown />
          </div>
        </Header>

        <Main className='flex flex-1 flex-col gap-6'>
          <div className='rounded-lg border border-destructive/50 bg-destructive/10 p-4'>
            <p className='text-destructive'>
              加载失败: {error?.message || '用户不存在'}
            </p>
          </div>
        </Main>
      </>
    )
  }

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-4'>
          <Button variant='ghost' size='sm' onClick={() => navigate({ to: '/users' })}>
            <ArrowLeft className='h-4 w-4' />
            返回
          </Button>
          <Separator orientation='vertical' className='h-6' />
          <div>
            <h1 className='text-lg font-semibold'>{user.nickname || '匿名搭子'}</h1>
            <p className='text-sm text-muted-foreground'>用户详情</p>
          </div>
        </div>
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main className='flex flex-1 flex-col gap-6'>
        <div className='grid gap-6 md:grid-cols-3'>
          {/* 主要内容区域 */}
          <div className='md:col-span-2'>
            <Tabs value={activeTab} onValueChange={setActiveTab} className='space-y-6'>
              <TabsList className='grid w-full grid-cols-3'>
                <TabsTrigger value='overview'>概览</TabsTrigger>
                <TabsTrigger value='ai-profile'>
                  <Brain className='h-4 w-4 mr-1' />
                  AI 画像
                </TabsTrigger>
                <TabsTrigger value='activities'>活动记录</TabsTrigger>
              </TabsList>

              <TabsContent value='overview' className='space-y-6'>
                {/* 基础信息 */}
                <Card>
                  <CardHeader>
                    <CardTitle className='flex items-center gap-2'>
                      <User className='h-5 w-5' />
                      基础信息
                    </CardTitle>
                  </CardHeader>
                  <CardContent className='space-y-4'>
                    <div className='flex items-center gap-4'>
                      <Avatar className='h-16 w-16'>
                        <AvatarImage src={user.avatarUrl || undefined} alt={user.nickname || ''} />
                        <AvatarFallback className='text-lg'>
                          {(user.nickname || '匿')[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div className='space-y-1'>
                        <h3 className='text-lg font-semibold'>{user.nickname || '匿名搭子'}</h3>
                        <div className='flex items-center gap-2'>
                          <Badge variant='outline' className={cn(
                            user.phoneNumber 
                              ? 'text-green-600 border-green-200' 
                              : 'text-gray-500 border-gray-200'
                          )}>
                            <Phone className='h-3 w-3 mr-1' />
                            {user.phoneNumber ? '已绑定手机' : '未绑定手机'}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div className='grid grid-cols-2 gap-4 pt-4 border-t'>
                      <div>
                        <p className='text-sm font-medium text-muted-foreground'>手机号</p>
                        <p className='text-sm'>{user.phoneNumber || '未绑定'}</p>
                      </div>
                      <div>
                        <p className='text-sm font-medium text-muted-foreground'>注册时间</p>
                        <p className='text-sm'>{format(new Date(user.createdAt), 'yyyy-MM-dd HH:mm')}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 统计数据 */}
                <Card>
                  <CardHeader>
                    <CardTitle>活动统计</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className='grid grid-cols-2 gap-4'>
                      <div className='text-center p-4 rounded-lg bg-muted/50'>
                        <p className='text-2xl font-bold text-blue-600'>{user.activitiesCreatedCount || 0}</p>
                        <p className='text-sm text-muted-foreground'>创建活动</p>
                      </div>
                      <div className='text-center p-4 rounded-lg bg-muted/50'>
                        <p className='text-2xl font-bold text-green-600'>{user.participationCount || 0}</p>
                        <p className='text-sm text-muted-foreground'>参与活动</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value='ai-profile'>
                <AIProfileTab userId={id} />
              </TabsContent>

              <TabsContent value='activities'>
                <Card>
                  <CardHeader>
                    <CardTitle>活动记录</CardTitle>
                    <CardDescription>用户创建和参与的活动历史</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className='text-muted-foreground text-center py-8'>
                      活动记录功能开发中...
                    </p>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* 侧边栏 */}
          <div className='space-y-6'>
            {/* 状态卡片 */}
            <Card>
              <CardHeader>
                <CardTitle className='flex items-center gap-2'>
                  <CheckCircle className='h-5 w-5' />
                  账户状态
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div className='flex items-center justify-between'>
                  <span className='text-sm font-medium'>账户状态</span>
                  <Badge variant='outline' className='bg-teal-100/30 text-teal-900 border-teal-200'>
                    <CheckCircle className='h-3 w-3 mr-1' />
                    正常
                  </Badge>
                </div>
                <div className='flex items-center justify-between'>
                  <span className='text-sm font-medium'>手机绑定</span>
                  <Badge variant='outline' className={cn(
                    user.phoneNumber 
                      ? 'text-green-600 border-green-200' 
                      : 'text-gray-500 border-gray-200'
                  )}>
                    {user.phoneNumber ? '已绑定' : '未绑定'}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {/* 创建活动额度信息 */}
            <Card>
              <CardHeader>
                <CardTitle>创建活动额度</CardTitle>
              </CardHeader>
              <CardContent className='space-y-3'>
                <div className='flex justify-between text-sm'>
                  <span>今日创建配额</span>
                  <span className='font-medium'>
                    {user.aiCreateQuotaToday >= UNLIMITED_AI_CREATE_QUOTA ? '无限' : (user.aiCreateQuotaToday || 3)}
                  </span>
                </div>
                {user.aiQuotaResetAt && (
                  <div className='flex justify-between text-sm'>
                    <span>配额重置时间</span>
                    <span className='font-medium text-xs'>
                      {format(new Date(user.aiQuotaResetAt), 'MM-dd HH:mm')}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </Main>
    </>
  )
}
