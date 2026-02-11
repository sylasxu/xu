import { memo } from 'react'
import { BaseNode, type BaseNodeProps } from './base-node'

export const P1IntentNode = memo((props: BaseNodeProps) => {
  return <BaseNode {...props} />
})

P1IntentNode.displayName = 'P1IntentNode'
