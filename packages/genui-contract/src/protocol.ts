export const GENUI_CONTRACT_VERSION = "2026-04-04";

export const GENUI_BLOCK_TYPES = [
  "text",
  "choice",
  "entity-card",
  "list",
  "form",
  "cta-group",
  "alert",
] as const;

export type GenUIBlockType = (typeof GENUI_BLOCK_TYPES)[number];
export type GenUIReplacePolicy = "append" | "replace" | "ignore-if-exists";
export type GenUIResponseStatus = "streaming" | "completed" | "error";
export type GenUIChoicePresentation = "inline-actions" | "card-form";
export type GenUIChoiceInputMode = "none" | "free-text-optional";
export type GenUICtaPresentation = "inline-actions" | "card-panel";
export type GenUIListPresentation = "compact-stack" | "immersive-carousel" | "partner-carousel";

export interface GenUISuggestionChoiceOption {
  label: string;
  action: string;
  params?: Record<string, unknown>;
  value?: string;
}

export interface GenUISuggestionListItem {
  title: string;
  action: string;
  params?: Record<string, unknown>;
  aliases?: string[];
}

export interface GenUISuggestionCtaItem {
  label: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface GenUIChoiceSuggestions {
  kind: "choice";
  question?: string;
  options: GenUISuggestionChoiceOption[];
}

export interface GenUIListSuggestions {
  kind: "list";
  title?: string;
  items: GenUISuggestionListItem[];
}

export interface GenUICtaSuggestions {
  kind: "cta-group";
  items: GenUISuggestionCtaItem[];
}

export type GenUISuggestions =
  | GenUIChoiceSuggestions
  | GenUIListSuggestions
  | GenUICtaSuggestions;

export interface GenUIRecentMessage {
  messageId?: string;
  parentId?: string;
  role: "user" | "assistant";
  text: string;
  primaryBlockType?: GenUIBlockType | null;
  suggestions?: GenUISuggestions;
  action?: string;
  actionId?: string;
  params?: Record<string, unknown>;
  source?: string;
  displayText?: string;
}

export interface GenUIRequestContext {
  client?: "web" | "miniprogram" | "admin";
  locale?: string;
  timezone?: string;
  platformVersion?: string;
  lat?: number;
  lng?: number;
  activityId?: string;
  activityMode?: "review" | "rebook" | "kickoff";
  entry?: string;
  recentMessages?: GenUIRecentMessage[];
}

export interface GenUIRequestAi {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface GenUITextInput {
  type: "text";
  text: string;
}

export interface GenUIActionInput {
  type: "action";
  action: string;
  actionId: string;
  params?: Record<string, unknown>;
  displayText?: string;
}

export type GenUIInput = GenUITextInput | GenUIActionInput;

export interface GenUIRequest {
  conversationId?: string;
  input: GenUIInput;
  context?: GenUIRequestContext;
  ai?: GenUIRequestAi;
  trace?: boolean;
  latestAssistantSuggestions?: GenUISuggestions;
}

export interface GenUIBlockMeta {
  traceRef?: string;
  choicePresentation?: GenUIChoicePresentation;
  choiceInputMode?: GenUIChoiceInputMode;
  choiceQuestionType?: string;
  choiceShowHeader?: boolean;
  ctaGroupPresentation?: GenUICtaPresentation;
  ctaShowHeader?: boolean;
  listPresentation?: GenUIListPresentation;
  listShowHeader?: boolean;
  formShowHeader?: boolean;
  [key: string]: unknown;
}

export interface GenUIBlockBase {
  blockId: string;
  type: GenUIBlockType;
  dedupeKey?: string;
  replacePolicy?: GenUIReplacePolicy;
  meta?: GenUIBlockMeta;
}

export interface GenUITextBlock extends GenUIBlockBase {
  type: "text";
  content: string;
}

export interface GenUIChoiceOption {
  label: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface GenUIChoiceBlock extends GenUIBlockBase {
  type: "choice";
  question: string;
  options: GenUIChoiceOption[];
}

export interface GenUIEntityCardBlock extends GenUIBlockBase {
  type: "entity-card";
  title: string;
  fields: Record<string, unknown>;
}

export interface GenUIListBlock extends GenUIBlockBase {
  type: "list";
  title?: string;
  subtitle?: string;
  items: Record<string, unknown>[];
  center?: { lat: number; lng: number; name: string };
  semanticQuery?: string;
  fetchConfig?: Record<string, unknown>;
  interaction?: Record<string, unknown>;
  preview?: Record<string, unknown>;
}

export interface GenUIFormBlock extends GenUIBlockBase {
  type: "form";
  title?: string;
  schema: Record<string, unknown>;
  initialValues?: Record<string, unknown>;
}

export interface GenUICtaItem {
  label: string;
  action: string;
  params?: Record<string, unknown>;
}

export interface GenUICtaGroupBlock extends GenUIBlockBase {
  type: "cta-group";
  items: GenUICtaItem[];
}

export interface GenUIAlertBlock extends GenUIBlockBase {
  type: "alert";
  level: "info" | "warning" | "error" | "success";
  message: string;
}

export type GenUIBlock =
  | GenUITextBlock
  | GenUIChoiceBlock
  | GenUIEntityCardBlock
  | GenUIListBlock
  | GenUIFormBlock
  | GenUICtaGroupBlock
  | GenUIAlertBlock;

export interface GenUIResponse {
  responseId: string;
  role: "assistant";
  status: GenUIResponseStatus;
  blocks: GenUIBlock[];
  suggestions?: GenUISuggestions;
}

export interface GenUIResponseEnvelope {
  traceId: string;
  conversationId: string;
  response: GenUIResponse;
}

export type GenUIStreamEventType =
  | "response-start"
  | "block-append"
  | "block-replace"
  | "response-status"
  | "response-complete"
  | "response-error"
  | "trace";

export interface GenUITracePayload {
  stage: string;
  detail: Record<string, unknown>;
}

export interface GenUIStreamEventBase {
  eventId: string;
  event: GenUIStreamEventType;
  timestamp: string;
}

export interface GenUIResponseStartEvent extends GenUIStreamEventBase {
  event: "response-start";
  data: {
    traceId: string;
    conversationId: string;
    responseId: string;
  };
}

export interface GenUIBlockAppendEvent extends GenUIStreamEventBase {
  event: "block-append";
  data: {
    responseId: string;
    block: GenUIBlock;
  };
}

export interface GenUIBlockReplaceEvent extends GenUIStreamEventBase {
  event: "block-replace";
  data: {
    responseId: string;
    block: GenUIBlock;
  };
}

export interface GenUIResponseStatusEvent extends GenUIStreamEventBase {
  event: "response-status";
  data: {
    responseId: string;
    status: GenUIResponseStatus;
  };
}

export interface GenUIResponseCompleteEvent extends GenUIStreamEventBase {
  event: "response-complete";
  data: GenUIResponseEnvelope;
}

export interface GenUIResponseErrorEvent extends GenUIStreamEventBase {
  event: "response-error";
  data: {
    responseId?: string;
    message: string;
  };
}

export interface GenUITraceEvent extends GenUIStreamEventBase {
  event: "trace";
  data: GenUITracePayload;
}

export type GenUIStreamEvent =
  | GenUIResponseStartEvent
  | GenUIBlockAppendEvent
  | GenUIBlockReplaceEvent
  | GenUIResponseStatusEvent
  | GenUIResponseCompleteEvent
  | GenUIResponseErrorEvent
  | GenUITraceEvent;
