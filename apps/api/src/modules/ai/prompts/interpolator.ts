/**
 * 模板插值 — 将 {{variableName}} 替换为变量值
 * 未匹配的占位符替换为空字符串
 */
export function interpolateTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? '');
}
