/**
 * Output Node Component
 * 
 * 显示最终输出节点
 */

import { memo } from 'react';
import { BaseNode, formatDuration } from './base-node';
import type { OutputNodeData } from '../../../types/flow';

interface OutputNodeProps {
  data: OutputNodeData;
  selected?: boolean;
}

export const OutputNode = memo(({ data, selected }: OutputNodeProps) => {
  return (
    <BaseNode data={data} selected={selected} hideSourceHandle>
      {data.status !== 'pending' && (
        <div className="mt-1 space-y-0.5">
          <div className="text-xs text-muted-foreground">
            {data.responseType === 'tool_calls' 
              ? `${data.itemCount} 个 Tool` 
              : '文本响应'}
          </div>
          {data.totalDuration != null && data.totalDuration > 0 && (
            <div className="text-xs text-muted-foreground">
              总耗时：{formatDuration(data.totalDuration)}
            </div>
          )}
        </div>
      )}
    </BaseNode>
  );
});

OutputNode.displayName = 'OutputNode';
