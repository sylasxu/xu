import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { useGodViewData } from '@/hooks/use-dashboard'
import { 
  RefreshCw, 
  Users, 
  Calendar, 
  Coins, 
  MessageSquare,
  TrendingUp, 
  TrendingDown,
  Brain,
  AlertTriangle,
  Shield,
  Clock,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'

export function Dashboard() {
  const { data, isLoading, error, refetch } = useGodViewData()

  return (
    <>
      <Header>
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main>
        <div className='mb-4 flex items-center justify-between'>
          <h1 className='text-2xl font-bold tracking-tight'>指挥舱</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-lg">
            加载失败，请刷新重试
          </div>
        )}

        {/* 实时概览 - 4 个核心指标 */}
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6'>
          {/* 今日活跃 */}
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>今日活跃</CardTitle>
              <Users className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className='text-2xl font-bold'>
                  {data?.realtime.activeUsers || 0}
                </div>
              )}
              <p className='text-xs text-muted-foreground'>活跃用户数</p>
            </CardContent>
          </Card>

          {/* 今日成局 */}
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>今日成局</CardTitle>
              <Calendar className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className='text-2xl font-bold'>
                  {data?.realtime.todayActivities || 0}
                </div>
              )}
              <p className='text-xs text-muted-foreground'>完成的活动</p>
            </CardContent>
          </Card>

          {/* Token 消耗 */}
          <Card>
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>Token 消耗</CardTitle>
              <Coins className='text-muted-foreground h-4 w-4' />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <div className='text-2xl font-bold'>
                  ¥{data?.realtime.tokenCost?.toFixed(2) || '0.00'}
                </div>
              )}
              <p className='text-xs text-muted-foreground'>
                {data?.realtime.totalConversations || 0} 次对话
              </p>
            </CardContent>
          </Card>

          {/* J2C 转化率 - 北极星指标 */}
          <Card className="border-primary/50">
            <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-2'>
              <CardTitle className='text-sm font-medium'>J2C 转化率</CardTitle>
              <TrendingUp className='text-primary h-4 w-4' />
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <>
                  <div className='text-2xl font-bold'>
                    {data?.northStar.value?.toFixed(1) || 0}%
                  </div>
                  <p className='text-xs text-muted-foreground'>
                    {data?.northStar.comparison}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* AI 健康度 + 异常警报 */}
        <div className='grid gap-4 lg:grid-cols-2 mb-6'>
          {/* AI 健康度 */}
          <Card>
            <CardHeader className='flex flex-row items-center justify-between'>
              <CardTitle className='flex items-center gap-2'>
                <Brain className='h-5 w-5' />
                AI 健康度
              </CardTitle>
              <Link to="/ai-ops/conversations" className="text-sm text-primary hover:underline">
                查看详情 →
              </Link>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : (
                <div className='grid grid-cols-3 gap-4'>
                  {/* Bad Case 率 */}
                  <div className='text-center p-3 bg-muted/50 rounded-lg'>
                    <div className='text-2xl font-bold'>
                      {data?.aiHealth.badCaseRate?.toFixed(1) || 0}%
                    </div>
                    <div className='text-xs text-muted-foreground mb-1'>Bad Case</div>
                    <div className={`flex items-center justify-center text-xs ${
                      (data?.aiHealth.badCaseTrend || 0) <= 0 
                        ? 'text-green-600' 
                        : 'text-red-600'
                    }`}>
                      {(data?.aiHealth.badCaseTrend || 0) <= 0 ? (
                        <TrendingDown className='h-3 w-3 mr-1' />
                      ) : (
                        <TrendingUp className='h-3 w-3 mr-1' />
                      )}
                      {Math.abs(data?.aiHealth.badCaseTrend || 0).toFixed(1)}%
                    </div>
                  </div>

                  {/* Tool 错误率 */}
                  <div className='text-center p-3 bg-muted/50 rounded-lg'>
                    <div className='text-2xl font-bold'>
                      {data?.aiHealth.toolErrorRate?.toFixed(1) || 0}%
                    </div>
                    <div className='text-xs text-muted-foreground mb-1'>Tool Error</div>
                    <div className={`flex items-center justify-center text-xs ${
                      (data?.aiHealth.toolErrorTrend || 0) <= 0 
                        ? 'text-green-600' 
                        : 'text-red-600'
                    }`}>
                      {(data?.aiHealth.toolErrorTrend || 0) <= 0 ? (
                        <TrendingDown className='h-3 w-3 mr-1' />
                      ) : (
                        <TrendingUp className='h-3 w-3 mr-1' />
                      )}
                      {Math.abs(data?.aiHealth.toolErrorTrend || 0).toFixed(1)}%
                    </div>
                  </div>

                  {/* 平均响应时长 */}
                  <div className='text-center p-3 bg-muted/50 rounded-lg'>
                    <div className='text-2xl font-bold flex items-center justify-center'>
                      <Clock className='h-4 w-4 mr-1' />
                      {((data?.aiHealth.avgResponseTime || 0) / 1000).toFixed(1)}s
                    </div>
                    <div className='text-xs text-muted-foreground'>响应时长</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 异常警报 */}
          <Card>
            <CardHeader className='flex flex-row items-center justify-between'>
              <CardTitle className='flex items-center gap-2'>
                <AlertTriangle className='h-5 w-5' />
                异常警报
              </CardTitle>
              <Link to="/safety/moderation" className="text-sm text-primary hover:underline">
                去处理 →
              </Link>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <div className='space-y-3'>
                  {/* 24h 报错 */}
                  <div className='flex items-center justify-between p-3 bg-muted/50 rounded-lg'>
                    <div className='flex items-center gap-2'>
                      <div className={`w-2 h-2 rounded-full ${
                        (data?.alerts.errorCount24h || 0) > 5 ? 'bg-red-500' : 
                        (data?.alerts.errorCount24h || 0) > 0 ? 'bg-yellow-500' : 'bg-green-500'
                      }`} />
                      <span className='text-sm'>24h 报错</span>
                    </div>
                    <span className='font-bold'>{data?.alerts.errorCount24h || 0}</span>
                  </div>

                  {/* 敏感词触发 */}
                  <div className='flex items-center justify-between p-3 bg-muted/50 rounded-lg'>
                    <div className='flex items-center gap-2'>
                      <div className={`w-2 h-2 rounded-full ${
                        (data?.alerts.sensitiveWordHits || 0) > 10 ? 'bg-yellow-500' : 'bg-green-500'
                      }`} />
                      <span className='text-sm'>敏感词触发</span>
                    </div>
                    <span className='font-bold'>{data?.alerts.sensitiveWordHits || 0}</span>
                  </div>

                  {/* 待审核 */}
                  <div className='flex items-center justify-between p-3 bg-muted/50 rounded-lg'>
                    <div className='flex items-center gap-2'>
                      <Shield className='h-4 w-4 text-muted-foreground' />
                      <span className='text-sm'>待审核</span>
                    </div>
                    <span className='font-bold'>{data?.alerts.pendingModeration || 0}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* 快捷入口 */}
        <Card>
          <CardHeader>
            <CardTitle>快捷入口</CardTitle>
          </CardHeader>
          <CardContent>
            <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
              <Link 
                to="/ai-ops/playground" 
                className="flex flex-col items-center p-4 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
              >
                <MessageSquare className='h-8 w-8 mb-2 text-primary' />
                <span className='text-sm font-medium'>Playground</span>
                <span className='text-xs text-muted-foreground'>调试 AI</span>
              </Link>

              <Link 
                to="/ai-ops/conversations" 
                className="flex flex-col items-center p-4 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
              >
                <Brain className='h-8 w-8 mb-2 text-primary' />
                <span className='text-sm font-medium'>对话审计</span>
                <span className='text-xs text-muted-foreground'>查看 Bad Case</span>
              </Link>

              <Link 
                to="/safety/moderation" 
                className="flex flex-col items-center p-4 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
              >
                <Shield className='h-8 w-8 mb-2 text-primary' />
                <span className='text-sm font-medium'>风险审核</span>
                <span className='text-xs text-muted-foreground'>处理违规</span>
              </Link>

              <Link 
                to="/growth/poster" 
                className="flex flex-col items-center p-4 bg-muted/50 rounded-lg hover:bg-muted transition-colors"
              >
                <TrendingUp className='h-8 w-8 mb-2 text-primary' />
                <span className='text-sm font-medium'>文案工厂</span>
                <span className='text-xs text-muted-foreground'>生成素材</span>
              </Link>
            </div>
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
