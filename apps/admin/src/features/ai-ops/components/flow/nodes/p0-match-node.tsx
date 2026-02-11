import { memo } from 'react'
import { BaseNode, type BaseNodeProps } from './base-node'

export const P0MatchNode = memo((props: BaseNodeProps) => {
  return <BaseNode {...props} />
})

P0MatchNode.displayName = 'P0MatchNode'
