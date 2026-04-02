/**
 * 偏好信号前置检查
 *
 * 仅当对话中检测到偏好信号关键词时才触发 LLM 偏好提取，
 * 避免对无偏好表达的对话浪费 LLM 调用。
 */

/** 偏好/画像信号模式列表 */
export const PREFERENCE_SIGNAL_PATTERNS = [
  /喜欢|不喜欢|讨厌|爱|想吃|不吃|想玩|不想|偏好|习惯|常去|最爱|爱吃|不爱|受不了|特别喜欢|最喜欢/,
  /我叫|我的名字是|我住在|我在.{1,12}(上班|工作)|我是(一个|个)?/,
  /我喜欢一个叫|她住在|他住在|她在.{1,12}(上班|工作)|他在.{1,12}(上班|工作)|她性格|他性格|她喜欢|他喜欢/,
];

/**
 * 检测对话中是否包含偏好信号
 *
 * 仅检查 user 角色的消息内容，任一消息命中任一关键词即返回 true
 *
 * @param messages - 对话消息列表
 * @returns 是否包含偏好信号
 */
export function hasPreferenceSignal(
  messages: Array<{ role: string; content: string }>,
): boolean {
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    for (const pattern of PREFERENCE_SIGNAL_PATTERNS) {
      if (pattern.test(msg.content)) return true;
    }
  }
  return false;
}
