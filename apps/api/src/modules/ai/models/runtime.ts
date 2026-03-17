import {
  type FlexibleSchema,
  generateObject,
  generateText,
  streamText,
  type GenerateObjectResult,
  type GenerateTextResult,
  type LanguageModel,
  type ModelMessage,
  type StreamTextResult,
} from 'ai';
import { getDefaultChatModel } from './router';

type GenerateTextInvocation = Parameters<typeof generateText>[0];
type StreamTextInvocation = Parameters<typeof streamText>[0];

type PromptInput =
  | {
      messages: ModelMessage[];
      prompt?: never;
    }
  | {
      prompt: string;
      messages?: never;
    };

type GenerateTextSharedOptions = Pick<
  GenerateTextInvocation,
  | 'system'
  | 'temperature'
  | 'maxOutputTokens'
  | 'maxRetries'
  | 'abortSignal'
  | 'timeout'
  | 'headers'
  | 'providerOptions'
  | 'tools'
  | 'toolChoice'
  | 'stopWhen'
  | 'onStepFinish'
  | 'onFinish'
>;

type StreamTextSharedOptions = Pick<
  StreamTextInvocation,
  | 'system'
  | 'temperature'
  | 'maxOutputTokens'
  | 'maxRetries'
  | 'abortSignal'
  | 'timeout'
  | 'headers'
  | 'providerOptions'
  | 'tools'
  | 'toolChoice'
  | 'stopWhen'
  | 'onStepFinish'
  | 'onFinish'
>;

export type RunTextOptions = GenerateTextSharedOptions & {
  model?: LanguageModel;
} & PromptInput;

export type RunStreamOptions = StreamTextSharedOptions & {
  model?: LanguageModel;
} & PromptInput;

export interface RunObjectOptions {
  model?: LanguageModel;
  schema: FlexibleSchema<unknown>;
  prompt: string;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

function resolveModel(model?: LanguageModel): LanguageModel {
  return model ?? getDefaultChatModel();
}

function hasMessages<T extends PromptInput>(
  input: T
): input is T & { messages: ModelMessage[]; prompt?: never } {
  return 'messages' in input;
}

export async function runText(options: RunTextOptions): Promise<GenerateTextResult<any, any>> {
  const resolvedModel = resolveModel(options.model);

  if (hasMessages(options)) {
    const { model: _model, ...request } = options;
    return generateText({
      ...request,
      model: resolvedModel,
    });
  }

  const { model: _model, ...request } = options;
  return generateText({
    ...request,
    model: resolvedModel,
  });
}

export function runStream(options: RunStreamOptions): StreamTextResult<any, any> {
  const resolvedModel = resolveModel(options.model);

  if (hasMessages(options)) {
    const { model: _model, ...request } = options;
    return streamText({
      ...request,
      model: resolvedModel,
    });
  }

  const { model: _model, ...request } = options;
  return streamText({
    ...request,
    model: resolvedModel,
  });
}

export async function runObject<TResult = unknown>(
  options: RunObjectOptions & { schema: FlexibleSchema<TResult> }
): Promise<GenerateObjectResult<TResult>> {
  const { model, ...rest } = options;

  return generateObject({
    ...rest,
    model: resolveModel(model),
  });
}
