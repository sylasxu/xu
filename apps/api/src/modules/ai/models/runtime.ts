import {
  generateObject,
  generateText,
  streamText,
  type LanguageModel,
} from 'ai';
import { getDefaultChatModel } from './router';

type GenerateTextInvocation = Parameters<typeof generateText>[0];
type StreamTextInvocation = Parameters<typeof streamText>[0];
type GenerateObjectInvocation = Parameters<typeof generateObject>[0];

export type RunTextOptions = Omit<GenerateTextInvocation, 'model'> & {
  model?: LanguageModel;
};

export type RunStreamOptions = Omit<StreamTextInvocation, 'model'> & {
  model?: LanguageModel;
};

export interface RunObjectOptions {
  model?: LanguageModel;
  schema: unknown;
  prompt?: string;
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

function resolveModel(model?: LanguageModel): LanguageModel {
  return model ?? getDefaultChatModel();
}

export async function runText(options: RunTextOptions) {
  const { model, ...rest } = options;

  return generateText({
    ...(rest as Omit<GenerateTextInvocation, 'model'>),
    model: resolveModel(model),
  } as GenerateTextInvocation);
}

export function runStream(options: RunStreamOptions): ReturnType<typeof streamText> {
  const { model, ...rest } = options;

  return streamText({
    ...(rest as Omit<StreamTextInvocation, 'model'>),
    model: resolveModel(model),
  } as StreamTextInvocation);
}

export async function runObject<TResult = unknown>(
  options: RunObjectOptions
): Promise<{ object: TResult }> {
  const { model, ...rest } = options;

  return generateObject({
    ...(rest as Omit<GenerateObjectInvocation, 'model'>),
    model: resolveModel(model),
  } as GenerateObjectInvocation) as Promise<{ object: TResult }>;
}
