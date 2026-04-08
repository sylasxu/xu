/**
 * API 导出文件
 * 统一导出所有生成的 API 接口
 */

// 认证相关
export * from './endpoints/auth/auth'

// 活动相关
export * from './endpoints/activities/activities'

// AI 相关
export * from './endpoints/ai/ai'

// 参与者相关
export * from './endpoints/participants/participants'

// 群聊相关
export * from './endpoints/chat/chat'

// 内部/后台相关（当前仍包含用户资料与举报能力）
export * from './endpoints/internal/internal'

// 类型定义
export * from './model'
