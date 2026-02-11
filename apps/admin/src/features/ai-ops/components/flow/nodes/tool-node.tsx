import { memo } from 'react'
import { BaseNode, type BaseNodeProps } from './base-node'

export const ToolNode = memo((props: BaseNodeProps) => {
  return <BaseNode {...props} />
})

ToolNode.displayName = 'ToolNode'
