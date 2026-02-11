import { memo } from 'react'
import { BaseNode, type BaseNodeProps } from './base-node'

export const ProcessorNode = memo((props: BaseNodeProps) => {
  return <BaseNode {...props} />
})

ProcessorNode.displayName = 'ProcessorNode'
