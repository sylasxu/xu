// 配置版本历史和回滚面板
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, RotateCcw, Clock } from 'lucide-react'
import { useAiConfigHistory, useRollbackAiConfig } from '../../hooks/use-ai-config'

interface Props {
  configKey: string | null
}

export function ConfigHistoryPanel({ configKey }: Props) {
  const { data: history, isLoading } = useAiConfigHistory(configKey || '')
  const rollback = useRollbackAiConfig()

  if (!configKey) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-4 w-4" />
            变更历史
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            点击编辑器中的「历史」按钮查看配置变更记录
          </p>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-4 w-4" />
            变更历史
          </CardTitle>
        </CardHeader>
        <CardContent className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  const items = Array.isArray(history) ? history : []

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Clock className="h-4 w-4" />
          变更历史
        </CardTitle>
        <p className="text-xs text-muted-foreground truncate">{configKey}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">暂无变更记录</p>
        )}
        {items.map((item: any, index: number) => (
          <div key={item.version ?? index} className="flex items-center justify-between rounded-md border p-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-xs shrink-0">v{item.version}</Badge>
                {index === 0 && <Badge className="text-xs">当前</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {item.updatedAt ? new Date(item.updatedAt).toLocaleString('zh-CN') : '未知时间'}
              </p>
              {item.updatedBy && (
                <p className="text-xs text-muted-foreground truncate">{item.updatedBy}</p>
              )}
            </div>
            {index > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 h-7 text-xs"
                disabled={rollback.isPending}
                onClick={() => rollback.mutate({ configKey, targetVersion: item.version })}
              >
                {rollback.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <RotateCcw className="h-3 w-3 mr-1" />
                    回滚
                  </>
                )}
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
