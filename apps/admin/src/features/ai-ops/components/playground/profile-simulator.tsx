/**
 * ProfileSimulator Component
 *
 * 支持手动编辑 EnhancedUserProfile（偏好列表、置信度、时间衰减权重）
 * 以模拟画像重新执行请求，观察个性化效果差异
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Plus, Trash2, Play } from 'lucide-react'

interface SimulatedPreference {
  category: string
  value: string
  sentiment: 'positive' | 'negative' | 'neutral'
  confidence: number
}

interface ProfileSimulatorProps {
  onSimulate?: (profile: { preferences: SimulatedPreference[] }) => void
}

export function ProfileSimulator({ onSimulate }: ProfileSimulatorProps) {
  const [preferences, setPreferences] = useState<SimulatedPreference[]>([
    { category: '美食', value: '喜欢火锅', sentiment: 'positive', confidence: 0.9 },
  ])

  const addPreference = () => {
    setPreferences([...preferences, { category: '', value: '', sentiment: 'positive', confidence: 0.8 }])
  }

  const removePreference = (index: number) => {
    setPreferences(preferences.filter((_, i) => i !== index))
  }

  const updatePreference = (index: number, field: keyof SimulatedPreference, value: string | number) => {
    const updated = [...preferences]
    updated[index] = { ...updated[index], [field]: value }
    setPreferences(updated)
  }

  const handleSimulate = () => {
    onSimulate?.({ preferences })
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">用户画像模拟</h3>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={addPreference}>
            <Plus className="h-3 w-3 mr-1" />
            添加偏好
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={handleSimulate}>
            <Play className="h-3 w-3 mr-1" />
            模拟执行
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        {preferences.map((pref, index) => (
          <div key={index} className="rounded-md border p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-[10px]">偏好 #{index + 1}</Badge>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removePreference(index)}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px]">类别</Label>
                <Input value={pref.category} onChange={(e) => updatePreference(index, 'category', e.target.value)} placeholder="美食" className="h-7 text-xs" />
              </div>
              <div>
                <Label className="text-[10px]">内容</Label>
                <Input value={pref.value} onChange={(e) => updatePreference(index, 'value', e.target.value)} placeholder="喜欢火锅" className="h-7 text-xs" />
              </div>
              <div>
                <Label className="text-[10px]">情感</Label>
                <select
                  value={pref.sentiment}
                  onChange={(e) => updatePreference(index, 'sentiment', e.target.value)}
                  className="h-7 w-full rounded-md border bg-background px-2 text-xs"
                >
                  <option value="positive">正面</option>
                  <option value="negative">负面</option>
                  <option value="neutral">中性</option>
                </select>
              </div>
              <div>
                <Label className="text-[10px]">置信度</Label>
                <Input type="number" step="0.1" min="0" max="1" value={pref.confidence} onChange={(e) => updatePreference(index, 'confidence', parseFloat(e.target.value) || 0)} className="h-7 text-xs" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {preferences.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
          点击「添加偏好」构建模拟画像
        </p>
      )}
    </div>
  )
}
