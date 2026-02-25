---
inclusion: fileMatch
fileMatchPattern: "apps/api/src/modules/ai/**/*.ts"
---

# AI SDK Guide (Vercel)

> Source: vercel/ai/skills/use-ai-sdk
> 适用于 JuChang AI 模块 (ElysiaJS + AI SDK)
> ⚠️ 注意：JuChang 使用 TypeBox 而非 Zod，使用 jsonSchema() 包装

## Critical: Do Not Trust Internal Knowledge

AI SDK API 变化很快，训练数据可能过时。关键变更：

### `parameters` → `inputSchema` (tool definition)

```typescript
// ❌ Deprecated
const weatherTool = tool({
  description: 'Get weather',
  parameters: z.object({ location: z.string() }),  // deprecated
  execute: async ({ location }) => ({ temp: 72 }),
});

// ✅ Current (Zod)
const weatherTool = tool({
  description: 'Get weather',
  inputSchema: z.object({ location: z.string() }),
  execute: async ({ location }) => ({ temp: 72 }),
});

// ✅ JuChang 项目用法 (TypeBox + jsonSchema)
import { t } from 'elysia';
import { tool, jsonSchema } from 'ai';
import { toJsonSchema } from '@juchang/utils';

const schema = t.Object({ location: t.String({ description: '城市名' }) });
type Params = typeof schema.static;

export function weatherTool() {
  return tool({
    description: '获取天气',
    parameters: jsonSchema<Params>(toJsonSchema(schema)),
    execute: async ({ location }) => ({ temp: 72 }),
  });
}
```

### `maxTokens` → `maxOutputTokens`

```typescript
// ❌ Deprecated
await generateText({ model, maxTokens: 512, prompt });

// ✅ Current
await generateText({ model, maxOutputTokens: 512, prompt });
```

### `maxSteps` → `stopWhen: stepCountIs(n)`

```typescript
// ❌ Deprecated
await generateText({ model, tools, maxSteps: 5, prompt });

// ✅ Current
import { generateText, stepCountIs } from 'ai';
await generateText({ model, tools, stopWhen: stepCountIs(5), prompt });
```

### `generateObject` → `generateText` with `output`

```typescript
// ❌ Deprecated
import { generateObject } from 'ai';
const result = await generateObject({ model, schema, prompt });

// ✅ Current
import { generateText, Output } from 'ai';
const result = await generateText({
  model,
  output: Output.object({ schema }),
  prompt,
});
console.log(result.output); // typed object
```

### Other Output Options

```typescript
// Output.array
output: Output.array({ element: z.object({ city: z.string() }) })

// Output.choice
output: Output.choice({ options: ['positive', 'negative', 'neutral'] as const })
```

## Streaming

### `toDataStreamResponse` → `toUIMessageStreamResponse`

```typescript
// ❌ Deprecated (when using useChat)
return result.toDataStreamResponse();

// ✅ Current
return result.toUIMessageStreamResponse();
```

## useChat Changes (v6+)

### Removed Managed Input State

```tsx
// ❌ Deprecated
const { input, handleInputChange, handleSubmit } = useChat({ api: '/api/chat' });

// ✅ Current
import { DefaultChatTransport } from 'ai';
const [input, setInput] = useState('');
const { sendMessage } = useChat({
  transport: new DefaultChatTransport({ api: '/api/chat' }),
});
```

### Tool Part Types Changed

```tsx
// ❌ Deprecated
case 'tool-invocation':
  part.toolInvocation.args    // → part.input
  part.toolInvocation.result  // → part.output
  part.toolInvocation.state: 'partial-call' | 'call' | 'result'

// ✅ Current — typed tool parts
case 'tool-getWeather':
  part.input     // typed input
  part.output    // typed output
  part.state: 'input-streaming' | 'input-available' | 'output-available'
```

### `addToolResult` → `addToolOutput`

```tsx
// ❌ Deprecated
addToolResult({ toolCallId, result: 'confirmed' });

// ✅ Current
addToolOutput({ tool: 'askForConfirmation', toolCallId: part.toolCallId, output: 'confirmed' });
```

## Type-Safe Agents (ToolLoopAgent)

```typescript
import { ToolLoopAgent, InferAgentUIMessage } from 'ai';

export const myAgent = new ToolLoopAgent({
  model: 'anthropic/claude-sonnet-4.5',
  instructions: 'You are a helpful assistant.',
  tools: { weather: weatherTool, calculator: calculatorTool },
});

export type MyAgentUIMessage = InferAgentUIMessage<typeof myAgent>;
```

### Type-Safe Tool Rendering

```tsx
function Message({ message }: { message: MyAgentUIMessage }) {
  return (
    <div>
      {message.parts.map((part, i) => {
        switch (part.type) {
          case 'text':
            return <p key={i}>{part.text}</p>;
          case 'tool-weather':
            if (part.state === 'output-available') {
              return <div key={i}>{part.output.temperature}F</div>;
            }
            return <div key={i}>Loading...</div>;
          default:
            return null;
        }
      })}
    </div>
  );
}
```

## Finding Documentation

- Bundled docs: `node_modules/ai/docs/`
- Source: `node_modules/ai/src/`
- Provider docs: `node_modules/@ai-sdk/<provider>/docs/`
- Online: `https://ai-sdk.dev/api/search-docs?q=your_query`
