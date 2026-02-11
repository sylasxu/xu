/**
 * RoundSelector Component
 *
 * 画布左侧浮层，显示轮次列表，当前选中高亮
 */

import { cn } from '@/lib/utils'

interface RoundSelectorProps {
  rounds: number
  selectedRound: number
  onRoundChange: (round: number) => void
}

export function RoundSelector({ rounds, selectedRound, onRoundChange }: RoundSelectorProps) {
  if (rounds <= 1) return null

  return (
    <div className="absolute left-4 top-1/2 z-30 -translate-y-1/2 rounded-lg border bg-background/80 backdrop-blur-md p-1.5">
      <div className="flex flex-col gap-1">
        {Array.from({ length: rounds }, (_, i) => (
          <button
            key={i}
            onClick={() => onRoundChange(i)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs transition-colors',
              i === selectedRound
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            R{i + 1}
          </button>
        ))}
      </div>
    </div>
  )
}
