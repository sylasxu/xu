import type {
  GenUIBlock,
  GenUIChoiceOption,
  GenUIChoiceSuggestions,
  GenUISuggestionChoiceOption,
  GenUISuggestions,
  GenUICtaSuggestions,
  GenUISuggestionCtaItem,
  GenUIListSuggestions,
  GenUISuggestionListItem,
} from '@juchang/genui-contract';
import { isStructuredActionType, type StructuredAction } from './user-action';

type ChoiceBlock = Extract<GenUIBlock, { type: 'choice' }>;
type ListBlock = Extract<GenUIBlock, { type: 'list' }>;
type CtaGroupBlock = Extract<GenUIBlock, { type: 'cta-group' }>;

export interface SuggestionResolution {
  contextKind: GenUISuggestions['kind'];
  matchedBy: 'label' | 'value' | 'ordinal' | 'title' | 'alias' | 'default';
  matchedText: string;
  structuredAction: StructuredAction;
}

const TEXT_NOISE_PATTERN = /[\s?？!！。,.，、;；:：'"`~\-_/\\()[\]{}]/g;
const LIST_DEFAULT_PATTERN = /^(继续|继续吧|就这个|就这个吧|就那个|就那个吧|这个|这个吧|那个|那个吧|还是这个|还是那个|看这个|看那个|就它|它吧)$/;
const CTA_DEFAULT_PATTERN = /^(继续|继续吧|就这个|就这个吧|就那个|就那个吧|这个|这个吧|那个|那个吧|可以|行|好|好的)$/;
const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  boardgame: '桌游',
  sports: '运动',
  food: '约饭',
  entertainment: '娱乐',
  other: '活动',
  ktv: 'K歌',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStringValue(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return '';
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(TEXT_NOISE_PATTERN, '');
}

function isSameOrIncludedMatch(inputText: string, candidateText: string): boolean {
  const normalizedInput = normalizeMatchText(inputText);
  const normalizedCandidate = normalizeMatchText(candidateText);

  if (!normalizedInput || !normalizedCandidate) {
    return false;
  }

  return (
    normalizedInput === normalizedCandidate
    || normalizedInput.includes(normalizedCandidate)
    || normalizedCandidate.includes(normalizedInput)
  );
}

function dedupeTextList(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const normalized = normalizeMatchText(trimmed);
    if (!trimmed || !normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(trimmed);
  }

  return deduped;
}

function readChoiceOptionValue(option: GenUIChoiceOption): string {
  const params = isRecord(option.params) ? option.params : {};

  return (
    toStringValue(params.value)
    || toStringValue(params.selectedValue)
    || toStringValue(params.location)
    || toStringValue(params.activityType)
    || toStringValue(params.slot)
    || option.label
  );
}

function normalizeChoiceContextOptions(options: unknown[]): GenUISuggestionChoiceOption[] {
  return options
    .map((option) => {
      if (!isRecord(option)) {
        return null;
      }

      const label = toStringValue(option.label);
      const action = toStringValue(option.action);
      if (!label || !action) {
        return null;
      }

      const value = toStringValue(option.value);
      const params = isRecord(option.params) ? option.params : undefined;

      return {
        label,
        action,
        ...(params ? { params } : {}),
        ...(value ? { value } : {}),
      };
    })
    .filter((item): item is GenUISuggestionChoiceOption => Boolean(item))
    .slice(0, 12);
}

function normalizeListContextItems(items: unknown[]): GenUISuggestionListItem[] {
  return items
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const title = toStringValue(item.title);
      const action = toStringValue(item.action);
      if (!title || !action) {
        return null;
      }

      const params = isRecord(item.params) ? item.params : undefined;
      const aliases = Array.isArray(item.aliases)
        ? dedupeTextList(item.aliases.map((entry) => toStringValue(entry)).filter(Boolean)).slice(0, 8)
        : [];

      return {
        title,
        action,
        ...(params ? { params } : {}),
        ...(aliases.length > 0 ? { aliases } : {}),
      };
    })
    .filter((item): item is GenUISuggestionListItem => Boolean(item))
    .slice(0, 12);
}

function normalizeCtaContextItems(items: unknown[]): GenUISuggestionCtaItem[] {
  return items
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }

      const label = toStringValue(item.label);
      const action = toStringValue(item.action);
      if (!label || !action) {
        return null;
      }

      const params = isRecord(item.params) ? item.params : undefined;

      return {
        label,
        action,
        ...(params ? { params } : {}),
      };
    })
    .filter((item): item is GenUISuggestionCtaItem => Boolean(item))
    .slice(0, 12);
}

function parseSuggestions(value: unknown): GenUISuggestions | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return undefined;
  }

  if (value.kind === 'choice') {
    const options = Array.isArray(value.options) ? normalizeChoiceContextOptions(value.options) : [];
    if (options.length === 0) {
      return undefined;
    }

    return {
      kind: 'choice',
      ...(typeof value.question === 'string' && value.question.trim()
        ? { question: value.question.trim() }
        : {}),
      options,
    };
  }

  if (value.kind === 'list') {
    const items = Array.isArray(value.items) ? normalizeListContextItems(value.items) : [];
    if (items.length === 0) {
      return undefined;
    }

    return {
      kind: 'list',
      ...(typeof value.title === 'string' && value.title.trim()
        ? { title: value.title.trim() }
        : {}),
      items,
    };
  }

  if (value.kind === 'cta-group') {
    const items = Array.isArray(value.items) ? normalizeCtaContextItems(value.items) : [];
    if (items.length === 0) {
      return undefined;
    }

    return {
      kind: 'cta-group',
      items,
    };
  }

  return undefined;
}

function isChoiceBlock(value: unknown): value is ChoiceBlock {
  return (
    isRecord(value)
    && value.type === 'choice'
    && typeof value.question === 'string'
    && Array.isArray(value.options)
  );
}

function isListBlock(value: unknown): value is ListBlock {
  return (
    isRecord(value)
    && value.type === 'list'
    && (value.title === undefined || typeof value.title === 'string')
    && Array.isArray(value.items)
  );
}

function isCtaGroupBlock(value: unknown): value is CtaGroupBlock {
  return (
    isRecord(value)
    && value.type === 'cta-group'
    && Array.isArray(value.items)
  );
}

function readListItemTitle(item: Record<string, unknown>): string {
  return (
    toStringValue(item.title)
    || toStringValue(item.name)
    || toStringValue(item.activityTitle)
  );
}

function buildStartAtAliases(rawStartAt: string): string[] {
  if (!rawStartAt) {
    return [];
  }

  const date = new Date(rawStartAt);
  if (Number.isNaN(date.getTime())) {
    return [];
  }

  const weekday = new Intl.DateTimeFormat('zh-CN', {
    weekday: 'short',
    timeZone: 'Asia/Shanghai',
  }).format(date);
  const monthDay = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Shanghai',
  }).format(date);

  return dedupeTextList([
    weekday,
    weekday.startsWith('周') ? weekday.replace(/^周/, '星期') : '',
    monthDay,
  ]);
}

function buildListItemAliases(item: Record<string, unknown>, title: string): string[] {
  const typeValue = toStringValue(item.type).toLowerCase();

  return dedupeTextList([
    title,
    toStringValue(item.locationName),
    toStringValue(item.typeLabel),
    toStringValue(item.activityTypeLabel),
    toStringValue(item.activityType),
    ACTIVITY_TYPE_LABELS[typeValue] || '',
    ...buildStartAtAliases(toStringValue(item.startAt)),
  ]).slice(0, 8);
}

function buildChoiceSuggestions(block: ChoiceBlock): GenUIChoiceSuggestions | undefined {
  const options = block.options
    .map((option) => {
      const label = toStringValue(option.label);
      const action = toStringValue(option.action);
      if (!label || !action) {
        return null;
      }

      const params = isRecord(option.params) ? option.params : undefined;
      const value = readChoiceOptionValue(option);

      return {
        label,
        action,
        ...(params ? { params } : {}),
        ...(value ? { value } : {}),
      };
    })
    .filter((item): item is GenUISuggestionChoiceOption => Boolean(item))
    .slice(0, 12);

  if (options.length === 0) {
    return undefined;
  }

  return {
    kind: 'choice',
    ...(block.question.trim() ? { question: block.question.trim() } : {}),
    options,
  };
}

function buildListSuggestions(block: ListBlock): GenUIListSuggestions | undefined {
  const items: GenUISuggestionListItem[] = [];

  for (const item of block.items) {
    if (!isRecord(item)) {
      continue;
    }

    const title = readListItemTitle(item);
    if (!title) {
      continue;
    }

    const explicitAction = toStringValue(item.action);
    const action = isStructuredActionType(explicitAction) ? explicitAction : 'view_activity';
    const params = isStructuredActionType(explicitAction)
      ? (isRecord(item.params) ? item.params : {})
      : (() => {
          const activityId = toStringValue(item.activityId) || toStringValue(item.id);
          return activityId ? { activityId } : null;
        })();

    if (!params) {
      continue;
    }

    const aliases = buildListItemAliases(item, title);
    items.push({
      title,
      action,
      params,
      ...(aliases.length > 0 ? { aliases } : {}),
    });

    if (items.length >= 12) {
      break;
    }
  }

  if (items.length === 0) {
    return undefined;
  }

  return {
    kind: 'list',
    ...(typeof block.title === 'string' && block.title.trim()
      ? { title: block.title.trim() }
      : {}),
    items,
  };
}

function buildCtaGroupSuggestions(block: CtaGroupBlock): GenUICtaSuggestions | undefined {
  const items = block.items
    .map((item) => {
      const label = toStringValue(item.label);
      const action = toStringValue(item.action);
      if (!label || !action) {
        return null;
      }

      const params = isRecord(item.params) ? item.params : undefined;

      return {
        label,
        action,
        ...(params ? { params } : {}),
      };
    })
    .filter((item): item is GenUISuggestionCtaItem => Boolean(item))
    .slice(0, 12);

  if (items.length === 0) {
    return undefined;
  }

  return {
    kind: 'cta-group',
    items,
  };
}

function createStructuredActionFromSuggestions(params: {
  action: string;
  rawParams?: Record<string, unknown>;
  inputText: string;
}): StructuredAction | undefined {
  if (!isStructuredActionType(params.action)) {
    return undefined;
  }

  return {
    action: params.action,
    payload: params.rawParams || {},
    source: 'recent_message_context',
    originalText: params.inputText.trim(),
  };
}

function toOrdinalNumber(rawValue: string): number | null {
  if (!rawValue) {
    return null;
  }

  if (/^\d+$/.test(rawValue)) {
    return Number(rawValue);
  }

  const digitMap: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };

  if (digitMap[rawValue] !== undefined) {
    return digitMap[rawValue];
  }

  if (rawValue.startsWith('十')) {
    const tail = rawValue.slice(1);
    return tail ? 10 + (digitMap[tail] || 0) : 10;
  }

  if (rawValue.endsWith('十')) {
    const head = rawValue.slice(0, -1);
    return (digitMap[head] || 0) * 10;
  }

  const [head, tail] = rawValue.split('十');
  if (head && tail && digitMap[head] !== undefined && digitMap[tail] !== undefined) {
    return digitMap[head] * 10 + digitMap[tail];
  }

  return null;
}

function resolveOrdinalIndex(inputText: string, count: number): number | null {
  if (count <= 0) {
    return null;
  }

  const compact = inputText.replace(/\s+/g, '');
  if (/最后(一个|那个|一条|一家|一场|一项)?/.test(compact)) {
    return count - 1;
  }

  const arabicMatch = compact.match(/(?:第(\d+)(个|条|家|场|项)?|(\d+)(个|条|家|场|项))/);
  if (arabicMatch) {
    const rawValue = arabicMatch[1] || arabicMatch[3] || '';
    const index = Number(rawValue) - 1;
    return index >= 0 && index < count ? index : null;
  }

  const chineseMatch = compact.match(/(?:第([一二两三四五六七八九十]+)(个|条|家|场|项)?|([一二两三四五六七八九十]+)(个|条|家|场|项))/);
  if (chineseMatch) {
    const rawValue = chineseMatch[1] || chineseMatch[3] || '';
    const ordinal = toOrdinalNumber(rawValue);
    const index = ordinal === null ? null : ordinal - 1;
    return index !== null && index >= 0 && index < count ? index : null;
  }

  return null;
}

function resolveChoiceContinuation(
  inputText: string,
  context: GenUIChoiceSuggestions
): SuggestionResolution | undefined {
  const ordinalIndex = resolveOrdinalIndex(inputText, context.options.length);
  if (ordinalIndex !== null) {
    const matched = context.options[ordinalIndex];
    const structuredAction = createStructuredActionFromSuggestions({
      action: matched.action,
      rawParams: matched.params,
      inputText,
    });

    if (structuredAction) {
      return {
        contextKind: context.kind,
        matchedBy: 'ordinal',
        matchedText: matched.label,
        structuredAction,
      };
    }
  }

  for (const option of context.options) {
    if (isSameOrIncludedMatch(inputText, option.label)) {
      const structuredAction = createStructuredActionFromSuggestions({
        action: option.action,
        rawParams: option.params,
        inputText,
      });

      if (structuredAction) {
        return {
          contextKind: context.kind,
          matchedBy: 'label',
          matchedText: option.label,
          structuredAction,
        };
      }
    }

    if (option.value && isSameOrIncludedMatch(inputText, option.value)) {
      const structuredAction = createStructuredActionFromSuggestions({
        action: option.action,
        rawParams: option.params,
        inputText,
      });

      if (structuredAction) {
        return {
          contextKind: context.kind,
          matchedBy: 'value',
          matchedText: option.value,
          structuredAction,
        };
      }
    }
  }

  return undefined;
}

function resolveListContinuation(
  inputText: string,
  context: GenUIListSuggestions
): SuggestionResolution | undefined {
  const ordinalIndex = resolveOrdinalIndex(inputText, context.items.length);
  if (ordinalIndex !== null) {
    const matched = context.items[ordinalIndex];
    const structuredAction = createStructuredActionFromSuggestions({
      action: matched.action,
      rawParams: matched.params,
      inputText,
    });

    if (structuredAction) {
      return {
        contextKind: context.kind,
        matchedBy: 'ordinal',
        matchedText: matched.title,
        structuredAction,
      };
    }
  }

  for (const item of context.items) {
    if (isSameOrIncludedMatch(inputText, item.title)) {
      const structuredAction = createStructuredActionFromSuggestions({
        action: item.action,
        rawParams: item.params,
        inputText,
      });

      if (structuredAction) {
        return {
          contextKind: context.kind,
          matchedBy: 'title',
          matchedText: item.title,
          structuredAction,
        };
      }
    }

    for (const alias of item.aliases || []) {
      if (!isSameOrIncludedMatch(inputText, alias)) {
        continue;
      }

      const structuredAction = createStructuredActionFromSuggestions({
        action: item.action,
        rawParams: item.params,
        inputText,
      });

      if (structuredAction) {
        return {
          contextKind: context.kind,
          matchedBy: 'alias',
          matchedText: alias,
          structuredAction,
        };
      }
    }
  }

  if (context.items.length > 0 && LIST_DEFAULT_PATTERN.test(inputText.trim())) {
    const firstItem = context.items[0];
    const structuredAction = createStructuredActionFromSuggestions({
      action: firstItem.action,
      rawParams: firstItem.params,
      inputText,
    });

    if (structuredAction) {
      return {
        contextKind: context.kind,
        matchedBy: 'default',
        matchedText: firstItem.title,
        structuredAction,
      };
    }
  }

  return undefined;
}

function resolveCtaContinuation(
  inputText: string,
  context: GenUICtaSuggestions
): SuggestionResolution | undefined {
  const ordinalIndex = resolveOrdinalIndex(inputText, context.items.length);
  if (ordinalIndex !== null) {
    const matched = context.items[ordinalIndex];
    const structuredAction = createStructuredActionFromSuggestions({
      action: matched.action,
      rawParams: matched.params,
      inputText,
    });

    if (structuredAction) {
      return {
        contextKind: context.kind,
        matchedBy: 'ordinal',
        matchedText: matched.label,
        structuredAction,
      };
    }
  }

  for (const item of context.items) {
    if (!isSameOrIncludedMatch(inputText, item.label)) {
      continue;
    }

    const structuredAction = createStructuredActionFromSuggestions({
      action: item.action,
      rawParams: item.params,
      inputText,
    });

    if (structuredAction) {
      return {
        contextKind: context.kind,
        matchedBy: 'label',
        matchedText: item.label,
        structuredAction,
      };
    }
  }

  if (context.items.length > 0 && CTA_DEFAULT_PATTERN.test(inputText.trim())) {
    const firstItem = context.items[0];
    const structuredAction = createStructuredActionFromSuggestions({
      action: firstItem.action,
      rawParams: firstItem.params,
      inputText,
    });

    if (structuredAction) {
      return {
        contextKind: context.kind,
        matchedBy: 'default',
        matchedText: firstItem.label,
        structuredAction,
      };
    }
  }

  return undefined;
}

export function buildSuggestionsFromBlocks(blocks: GenUIBlock[]): GenUISuggestions | undefined {
  for (const block of blocks) {
    if (block.type === 'choice') {
      const context = buildChoiceSuggestions(block);
      if (context) {
        return context;
      }
      continue;
    }

    if (block.type === 'list') {
      const context = buildListSuggestions(block);
      if (context) {
        return context;
      }
      continue;
    }

    if (block.type === 'cta-group') {
      const context = buildCtaGroupSuggestions(block);
      if (context) {
        return context;
      }
    }
  }

  return undefined;
}

export function readSuggestionsFromStoredMessage(content: unknown): GenUISuggestions | undefined {
  if (!isRecord(content)) {
    return undefined;
  }

  const responseRecord = isRecord(content.response) ? content.response : null;
  if (responseRecord) {
    const nestedSuggestions = parseSuggestions(responseRecord.suggestions);
    if (nestedSuggestions) {
      return nestedSuggestions;
    }
  }

  const storedSuggestions = parseSuggestions(content.suggestions);
  if (storedSuggestions) {
    return storedSuggestions;
  }

  const rawBlocks = Array.isArray(responseRecord?.blocks)
    ? responseRecord.blocks
    : Array.isArray(content.blocks)
      ? content.blocks
      : [];
  if (rawBlocks.length === 0) {
    return undefined;
  }

  const parsedBlocks: GenUIBlock[] = [];
  for (const block of rawBlocks) {
    if (isChoiceBlock(block) || isListBlock(block) || isCtaGroupBlock(block)) {
      parsedBlocks.push(block);
    }
  }

  return buildSuggestionsFromBlocks(parsedBlocks);
}

export function resolveContinuationFromSuggestions(
  inputText: string,
  suggestions: GenUISuggestions | null | undefined
): SuggestionResolution | undefined {
  const normalizedText = inputText.trim();
  if (!normalizedText || !suggestions) {
    return undefined;
  }

  if (suggestions.kind === 'choice') {
    return resolveChoiceContinuation(normalizedText, suggestions);
  }

  if (suggestions.kind === 'list') {
    return resolveListContinuation(normalizedText, suggestions);
  }

  return resolveCtaContinuation(normalizedText, suggestions);
}
