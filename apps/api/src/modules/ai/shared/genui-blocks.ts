import { randomUUID } from 'crypto';
import type {
  GenUIAlertBlock,
  GenUIBlock,
  GenUIChoiceOption,
} from '@juchang/genui-contract';
import type { SearchPartnerCandidate, SearchSummary, SearchNextAction } from '../tools/partner-tools';

function createBlockId(): string {
  return `block_${randomUUID().slice(0, 8)}`;
}

export function createChoiceBlock(params: {
  question: string;
  options: GenUIChoiceOption[];
  dedupeKey: string;
  traceRef: string;
  meta?: Record<string, unknown>;
}): GenUIBlock {
  return {
    blockId: createBlockId(),
    type: 'choice',
    question: params.question,
    options: params.options,
    dedupeKey: params.dedupeKey,
    replacePolicy: 'replace',
    meta: {
      ...(params.meta ?? {}),
      traceRef: params.traceRef,
    },
  };
}

export function createEntityCardBlock(params: {
  title: string;
  fields: Record<string, unknown>;
  dedupeKey: string;
  traceRef: string;
}): GenUIBlock {
  return {
    blockId: createBlockId(),
    type: 'entity-card',
    title: params.title,
    fields: params.fields,
    dedupeKey: params.dedupeKey,
    replacePolicy: 'replace',
    meta: { traceRef: params.traceRef },
  };
}

export function createCtaGroupBlock(params: {
  items: Array<{ label: string; action: string; params?: Record<string, unknown> }>;
  dedupeKey: string;
  traceRef: string;
  meta?: Record<string, unknown>;
}): GenUIBlock {
  return {
    blockId: createBlockId(),
    type: 'cta-group',
    items: params.items,
    dedupeKey: params.dedupeKey,
    replacePolicy: 'replace',
    meta: {
      ...(params.meta ?? {}),
      traceRef: params.traceRef,
    },
  };
}

export function createFormBlock(params: {
  title?: string;
  schema: Record<string, unknown>;
  initialValues?: Record<string, unknown>;
  dedupeKey: string;
  traceRef: string;
  meta?: Record<string, unknown>;
}): GenUIBlock {
  return {
    blockId: createBlockId(),
    type: 'form',
    ...(params.title ? { title: params.title } : {}),
    schema: params.schema,
    ...(params.initialValues ? { initialValues: params.initialValues } : {}),
    dedupeKey: params.dedupeKey,
    replacePolicy: 'replace',
    meta: {
      ...(params.meta ?? {}),
      traceRef: params.traceRef,
    },
  };
}

export function createAlertBlock(params: {
  level: GenUIAlertBlock['level'];
  message: string;
  dedupeKey: string;
  traceRef: string;
  meta?: Record<string, unknown>;
}): GenUIBlock {
  return {
    blockId: createBlockId(),
    type: 'alert',
    level: params.level,
    message: params.message,
    dedupeKey: params.dedupeKey,
    replacePolicy: 'replace',
    meta: {
      ...(params.meta ?? {}),
      traceRef: params.traceRef,
    },
  };
}

export function pushBlock(blocks: GenUIBlock[], block: GenUIBlock): void {
  if (!block.dedupeKey) {
    blocks.push(block);
    return;
  }

  const index = blocks.findIndex(item => item.dedupeKey === block.dedupeKey);
  if (index >= 0) {
    blocks[index] = block;
    return;
  }

  blocks.push(block);
}

/**
 * 创建搭子搜索结果列表 Block
 * 
 * 与小程序组件 widget-partner-search-results 兼容的数据格式
 */
export function createPartnerSearchResultsBlock(params: {
  candidates: SearchPartnerCandidate[];
  searchSummary: SearchSummary;
  nextAction: SearchNextAction;
  secondaryAction?: SearchNextAction;
  dedupeKey: string;
  traceRef: string;
}): GenUIBlock {
  // 将候选人转换为组件期望的格式
  const items = params.candidates.map(c => ({
    id: c.intentId,
    partnerIntentId: c.intentId,
    candidateUserId: c.userId,
    title: c.nickname,
    avatarUrl: c.avatarUrl,
    type: c.typeName,
    locationName: c.locationHint,
    locationHint: c.locationHint,
    timePreference: c.timePreference,
    summary: c.summary,
    matchReason: c.matchReason,
    score: c.score,
    tags: c.tags,
    // 每个候选人都有相同的动作（简化交互）
    actions: [
      {
        label: params.nextAction.label,
        action: params.nextAction.type,
        params: { candidateId: c.intentId },
      },
      ...(params.secondaryAction ? [{
        label: params.secondaryAction.label,
        action: params.secondaryAction.type,
        params: {},
      }] : []),
    ],
  }));

  return {
    blockId: createBlockId(),
    type: 'list',
    title: `为你找到${params.searchSummary.total}位搭子`,
    subtitle: [params.searchSummary.locationHint, params.searchSummary.timeHint]
      .filter(Boolean)
      .join('，'),
    items,
    // list 级别的 meta，用于组件识别
    meta: { 
      traceRef: params.traceRef,
      listKind: 'partner_search_results',
      listPresentation: 'partner-carousel',
      listShowHeader: true,
      // 搜索摘要信息
      searchSummary: params.searchSummary,
      // 全局动作（显示在卡片底部）
      primaryAction: {
        label: params.nextAction.label,
        action: params.nextAction.type,
      },
      secondaryAction: params.secondaryAction ? {
        label: params.secondaryAction.label,
        action: params.secondaryAction.type,
      } : undefined,
    },
    dedupeKey: params.dedupeKey,
    replacePolicy: 'replace',
  };
}
