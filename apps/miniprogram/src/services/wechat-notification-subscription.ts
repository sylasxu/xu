import { WECHAT_NOTIFY_CONFIG } from '../config'

export type WechatNotifyScene =
  | 'activity_reminder'
  | 'discussion_reply'
  | 'post_activity'
  | 'partner_match_ready'

type RequestWechatNotificationSubscriptionParams = {
  scenes: WechatNotifyScene[]
  userId?: string | null
  source: 'join_success' | 'discussion_first_open'
}

type WechatSubscribeResult = Partial<Record<WechatNotifyScene, WechatMiniprogram.RequestSubscribeMessageSuccessCallbackResult[string]>>

const STORAGE_PREFIX = 'xu:miniprogram:wechat-notify-subscribe'

function getTemplateId(scene: WechatNotifyScene): string {
  return WECHAT_NOTIFY_CONFIG.TEMPLATE_IDS[scene]?.trim() || ''
}

function buildStorageKey(scene: WechatNotifyScene, userId?: string | null): string {
  return `${STORAGE_PREFIX}:${userId || 'visitor'}:${scene}`
}

function shouldPromptScene(scene: WechatNotifyScene, userId?: string | null): boolean {
  const storageKey = buildStorageKey(scene, userId)
  const lastPromptAt = wx.getStorageSync(storageKey)

  if (typeof lastPromptAt !== 'number' || !Number.isFinite(lastPromptAt)) {
    return true
  }

  return Date.now() - lastPromptAt >= WECHAT_NOTIFY_CONFIG.SUBSCRIBE_PROMPT_COOLDOWN_MS
}

function markPromptedScene(scene: WechatNotifyScene, userId?: string | null) {
  wx.setStorageSync(buildStorageKey(scene, userId), Date.now())
}

export async function requestWechatNotificationSubscription(
  params: RequestWechatNotificationSubscriptionParams
): Promise<WechatSubscribeResult | null> {
  const sceneEntries = params.scenes
    .map((scene) => ({ scene, templateId: getTemplateId(scene) }))
    .filter(({ scene, templateId }) => Boolean(templateId) && shouldPromptScene(scene, params.userId))

  if (sceneEntries.length === 0) {
    return null
  }

  const tmplIds = sceneEntries.map((entry) => entry.templateId)

  try {
    const result = await new Promise<WechatMiniprogram.RequestSubscribeMessageSuccessCallbackResult>((resolve, reject) => {
      wx.requestSubscribeMessage({
        tmplIds,
        success: resolve,
        fail: reject,
      })
    })

    const normalizedResult: WechatSubscribeResult = {}
    sceneEntries.forEach(({ scene, templateId }) => {
      normalizedResult[scene] = result[templateId]
      markPromptedScene(scene, params.userId)
    })

    return normalizedResult
  } catch (error) {
    console.warn('[wechat-notify] request subscribe message failed', {
      source: params.source,
      scenes: sceneEntries.map((entry) => entry.scene),
      error,
    })
    return null
  }
}
