import { memo } from 'react'
import { BaseNode, type BaseNodeProps } from './base-node'

export const LLMNode = memo((props: BaseNodeProps) => {
  return <BaseNode {...props} />
})

LLMNode.displayName = 'LLMNode'
