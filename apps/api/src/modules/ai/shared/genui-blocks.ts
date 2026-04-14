import { randomUUID } from 'crypto';
import type {
  GenUIAlertBlock,
  GenUIBlock,
  GenUIChoiceOption,
} from '@xu/genui-contract';

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
