import { memo } from 'react'
import { BaseNode, type BaseNodeProps } from './base-node'

export const InputNode = memo((props: BaseNodeProps) => {
  return <BaseNode {...props} hideTargetHandle />
})

InputNode.displayName = 'InputNode'
