/**
 * API 导出文件
 * 统一导出所有生成的 API 接口
 */

// 认证相关
export * from './endpoints/auth/auth'

// 用户相关
export * from './endpoints/users/users'

// 活动相关
export * from './endpoints/activities/activities'

// AI 相关
export * from './endpoints/ai/ai'

// 参与者相关
export * from './endpoints/participants/participants'

// 群聊相关
export * from './endpoints/chat/chat'

// 仪表板相关
export * from './endpoints/dashboard/dashboard'

// 类型定义
export * from './model'

/**
 * 使用示例：
 * 
 * import { postAuthWxLogin, getUsersMe, putUsersMe } from '@/api'
 * 
 * // 微信登录
 * const loginResponse = await postAuthWxLogin({ code: 'wx_code' })
 * if (loginResponse.status === 200) {
 *   const { user, token } = loginResponse.data
 *   // 处理登录成功
 * }
 * 
 * // 获取当前用户信息
 * const userResponse = await getUsersMe()
 * if (userResponse.status === 200) {
 *   const user = userResponse.data
 *   // 处理用户信息
 * }
 * 
 * // 更新用户信息
 * const updateResponse = await putUsersMe({
 *   nickname: '新昵称',
 *   bio: '个人简介'
 * })
 */
