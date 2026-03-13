// Token Usage Page - 用量统计（合并 token-usage + quota）
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTokenUsageStats } from '@/hooks/use-ai-metrics'
import { Loader2, TrendingUp, Users, DollarSign, RefreshCw } from 'lucide-react'

export function TokenUsage() {
  const { data, isLoading, error, refetch } = useTokenUsageStats()

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center text-destructive">
        加载失败: {error.message}
      </div>
    )
  }

  const summary = data?.summary
  
  // 成本粗估（按内部统一系数计算，仅供排查）
  const estimatedCost = ((summary?.totalTokens ?? 0) / 1000) * 0.002

  return (
    <div className="space-y-6">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">用量统计</h1>
          <p className="text-muted-foreground">Token 消耗、API 调用和用户额度管理</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          刷新
        </Button>
      </div>

      {/* 概览卡片 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              总 Token 数
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.totalTokens?.toLocaleString() ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              输入: {summary?.totalInputTokens?.toLocaleString() ?? 0} | 
              输出: {summary?.totalOutputTokens?.toLocaleString() ?? 0}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="h-4 w-4" />
              总请求数
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary?.totalRequests?.toLocaleString() ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              平均: {summary?.avgTokensPerRequest?.toFixed(0) ?? 0} tokens/请求
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              成本粗估
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ¥{estimatedCost.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              按内部统一系数粗估，仅供内部排查
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              缓存命中率
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {((summary?.overallCacheHitRate ?? 0) * 100).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              命中: {summary?.totalCacheHitTokens?.toLocaleString() ?? 0} tokens
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs: 统计 / 用户额度 */}
      <Tabs defaultValue="stats" className="space-y-4">
        <TabsList>
          <TabsTrigger value="stats">统计详情</TabsTrigger>
          <TabsTrigger value="quota">用户额度</TabsTrigger>
        </TabsList>

        {/* 统计详情 Tab */}
        <TabsContent value="stats" className="space-y-4">
          {/* Tool 调用统计 */}
          {data?.toolCalls && data.toolCalls.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Tool 调用统计</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.toolCalls.map((tool) => (
                    <div
                      key={tool.toolName}
                      className="flex items-center justify-between border-b py-2 last:border-0"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{tool.toolName}</span>
                        <Badge variant="secondary" className="text-xs">
                          {((tool.successRate ?? 0) * 100).toFixed(0)}% 成功率
                        </Badge>
                      </div>
                      <span className="text-muted-foreground">
                        {tool.totalCount} 次
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 每日趋势 */}
          {data?.daily && data.daily.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>每日趋势</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.daily.slice(0, 7).map((day) => (
                    <div
                      key={day.date}
                      className="flex items-center justify-between border-b py-2 last:border-0"
                    >
                      <span className="text-sm">{day.date}</span>
                      <div className="flex items-center gap-4">
                        <span className="text-sm text-muted-foreground">
                          {day.totalTokens.toLocaleString()} tokens
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {day.totalRequests} 请求
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* 用户额度 Tab */}
        <TabsContent value="quota" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>用户额度管理</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="rounded-lg border p-4">
                  <h3 className="font-medium mb-2">默认额度配置</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">每日创建活动额度</span>
                      <span className="font-medium">3 次</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">AI 对话额度</span>
                      <span className="font-medium">无限制</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border p-4">
                  <h3 className="font-medium mb-2">额度使用情况</h3>
                  <p className="text-sm text-muted-foreground">
                    查看用户详情页可以管理单个用户的额度
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
