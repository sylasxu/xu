export function normalizeAiProviderErrorMessage(message: string): string {
  const normalized = message.trim()
  const lowerCased = normalized.toLowerCase()

  if (!normalized) {
    return 'AI 服务暂时不可用'
  }

  if (
    lowerCased.includes('invalid api key')
    || lowerCased.includes('incorrect api key')
    || lowerCased.includes('authentication')
    || lowerCased.includes('unauthorized')
    || lowerCased.includes('invalid_api_key')
    || lowerCased.includes('api key not valid')
  ) {
    return 'AI 服务鉴权失败，请检查上游 API Key 是否有效。'
  }

  if (
    lowerCased.includes('free tier of the model has been exhausted')
    || (lowerCased.includes('use free tier only') && lowerCased.includes('management console'))
  ) {
    return '当前上游模型的免费额度已经用完了，请切换可用模型或调整上游账号设置后再试。'
  }

  if (
    lowerCased.includes('insufficient_quota')
    || lowerCased.includes('quota exceeded')
    || lowerCased.includes('exceeded your current quota')
    || lowerCased.includes('billing')
    || lowerCased.includes('credit balance')
    || lowerCased.includes('balance is not enough')
    || lowerCased.includes('recharge')
  ) {
    return 'AI 服务上游账户余额或账单状态异常，请检查后再试。'
  }

  if (
    lowerCased.includes('rate limit')
    || lowerCased.includes('too many requests')
    || lowerCased.includes('429')
  ) {
    return 'AI 服务请求过于频繁，请稍后再试。'
  }

  if (
    lowerCased.includes('model not found')
    || lowerCased.includes('does not exist')
    || lowerCased.includes('unknown model')
  ) {
    return '当前 AI 模型不可用，请检查模型配置后再试。'
  }

  return normalized
}
