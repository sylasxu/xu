import type { JSONSchema7 } from '@ai-sdk/provider'
import type { TSchema } from '@sinclair/typebox';

export const formatPrice = (fen: number) => `¥${(fen / 100).toFixed(2)}`;
export const LOGO_TEXT = "xu";

/**
 * 将 TypeBox Schema 转换为纯 JSON Schema
 * 
 * TypeBox 的 Schema 对象包含 Symbol 属性（如 Kind, Hint），
 * 这些属性在传递给某些库时会导致问题。
 * 此函数通过 JSON.parse(JSON.stringify()) 移除所有 Symbol 属性，
 * 返回纯净的 JSON Schema 对象。
 * 
 * 注意：对于 Vercel AI SDK，推荐直接使用 `jsonSchema()`：
 * ```typescript
 * import { jsonSchema } from 'ai';
 * parameters: jsonSchema<MyType>(toJsonSchema(MyTypeBoxSchema))
 * ```
 * 
 * @example
 * ```typescript
 * import { t } from 'elysia';
 * import { toJsonSchema } from '@xu/utils';
 * 
 * const MySchema = t.Object({
 *   title: t.String(),
 *   location: t.String(),
 * });
 * 
 * const pureJsonSchema = toJsonSchema(MySchema);
 * // { type: 'object', properties: { title: { type: 'string' }, ... } }
 * ```
 */
export function toJsonSchema<T extends TSchema>(schema: T): JSONSchema7 {
  return JSON.parse(JSON.stringify(schema));
}
