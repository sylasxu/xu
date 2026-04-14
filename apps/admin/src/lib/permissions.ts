/**
 * xu 管理后台权限系统
 * 基于角色的访问控制 (RBAC)
 */

// 权限枚举
export enum Permission {
  // 用户管理权限
  USER_VIEW = 'user:view',
  USER_EDIT = 'user:edit',
  USER_MODERATE = 'user:moderate',
  USER_DELETE = 'user:delete',

  // 活动管理权限
  ACTIVITY_VIEW = 'activity:view',
  ACTIVITY_EDIT = 'activity:edit',
  ACTIVITY_MODERATE = 'activity:moderate',
  ACTIVITY_DELETE = 'activity:delete',

  // 交易管理权限
  TRANSACTION_VIEW = 'transaction:view',
  TRANSACTION_EDIT = 'transaction:edit',
  TRANSACTION_REFUND = 'transaction:refund',

  // 内容审核权限
  MODERATION_VIEW = 'moderation:view',
  MODERATION_APPROVE = 'moderation:approve',
  MODERATION_REJECT = 'moderation:reject',
  MODERATION_RULES = 'moderation:rules',

  // 风险管理权限
  RISK_VIEW = 'risk:view',
  RISK_ASSESS = 'risk:assess',
  RISK_INVESTIGATE = 'risk:investigate',
  RISK_RESOLVE = 'risk:resolve',

  // 增值服务权限
  PREMIUM_VIEW = 'premium:view',
  PREMIUM_CONFIG = 'premium:config',
  PREMIUM_ANALYTICS = 'premium:analytics',

  // 地理分析权限
  GEOGRAPHY_VIEW = 'geography:view',
  GEOGRAPHY_MANAGE = 'geography:manage',

  // 沟通管理权限
  COMMUNICATION_VIEW = 'communication:view',
  COMMUNICATION_MODERATE = 'communication:moderate',
  COMMUNICATION_NOTIFY = 'communication:notify',

  // 系统管理权限
  SYSTEM_VIEW = 'system:view',
  SYSTEM_CONFIG = 'system:config',
  SYSTEM_MAINTENANCE = 'system:maintenance',
  SYSTEM_AUDIT = 'system:audit',

  // 分析报告权限
  ANALYTICS_VIEW = 'analytics:view',
  ANALYTICS_EXPORT = 'analytics:export',

  // 超级管理员权限
  ADMIN_FULL = 'admin:full',
}

// 角色定义
export enum Role {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
  MODERATOR = 'moderator',
  ANALYST = 'analyst',
  SUPPORT = 'support',
  VIEWER = 'viewer',
}

// 角色权限映射
export const rolePermissions: Record<Role, Permission[]> = {
  [Role.SUPER_ADMIN]: [Permission.ADMIN_FULL], // 超级管理员拥有所有权限

  [Role.ADMIN]: [
    // 用户管理
    Permission.USER_VIEW,
    Permission.USER_EDIT,
    Permission.USER_MODERATE,
    Permission.USER_DELETE,
    // 活动管理
    Permission.ACTIVITY_VIEW,
    Permission.ACTIVITY_EDIT,
    Permission.ACTIVITY_MODERATE,
    Permission.ACTIVITY_DELETE,
    // 交易管理
    Permission.TRANSACTION_VIEW,
    Permission.TRANSACTION_EDIT,
    Permission.TRANSACTION_REFUND,
    // 内容审核
    Permission.MODERATION_VIEW,
    Permission.MODERATION_APPROVE,
    Permission.MODERATION_REJECT,
    Permission.MODERATION_RULES,
    // 风险管理
    Permission.RISK_VIEW,
    Permission.RISK_ASSESS,
    Permission.RISK_INVESTIGATE,
    Permission.RISK_RESOLVE,
    // 增值服务
    Permission.PREMIUM_VIEW,
    Permission.PREMIUM_CONFIG,
    Permission.PREMIUM_ANALYTICS,
    // 地理分析
    Permission.GEOGRAPHY_VIEW,
    Permission.GEOGRAPHY_MANAGE,
    // 沟通管理
    Permission.COMMUNICATION_VIEW,
    Permission.COMMUNICATION_MODERATE,
    Permission.COMMUNICATION_NOTIFY,
    // 系统管理
    Permission.SYSTEM_VIEW,
    Permission.SYSTEM_CONFIG,
    Permission.SYSTEM_MAINTENANCE,
    Permission.SYSTEM_AUDIT,
    // 分析报告
    Permission.ANALYTICS_VIEW,
    Permission.ANALYTICS_EXPORT,
  ],

  [Role.MODERATOR]: [
    // 用户管理（有限）
    Permission.USER_VIEW,
    Permission.USER_MODERATE,
    // 活动管理（有限）
    Permission.ACTIVITY_VIEW,
    Permission.ACTIVITY_MODERATE,
    // 内容审核
    Permission.MODERATION_VIEW,
    Permission.MODERATION_APPROVE,
    Permission.MODERATION_REJECT,
    // 风险管理（有限）
    Permission.RISK_VIEW,
    Permission.RISK_ASSESS,
    // 沟通管理
    Permission.COMMUNICATION_VIEW,
    Permission.COMMUNICATION_MODERATE,
    // 分析查看
    Permission.ANALYTICS_VIEW,
  ],

  [Role.ANALYST]: [
    // 查看权限
    Permission.USER_VIEW,
    Permission.ACTIVITY_VIEW,
    Permission.TRANSACTION_VIEW,
    Permission.MODERATION_VIEW,
    Permission.RISK_VIEW,
    Permission.PREMIUM_VIEW,
    Permission.GEOGRAPHY_VIEW,
    Permission.COMMUNICATION_VIEW,
    Permission.SYSTEM_VIEW,
    // 分析权限
    Permission.ANALYTICS_VIEW,
    Permission.ANALYTICS_EXPORT,
    Permission.PREMIUM_ANALYTICS,
  ],

  [Role.SUPPORT]: [
    // 用户支持
    Permission.USER_VIEW,
    Permission.USER_EDIT,
    // 活动支持
    Permission.ACTIVITY_VIEW,
    // 交易支持
    Permission.TRANSACTION_VIEW,
    // 沟通管理
    Permission.COMMUNICATION_VIEW,
    Permission.COMMUNICATION_NOTIFY,
    // 风险查看
    Permission.RISK_VIEW,
  ],

  [Role.VIEWER]: [
    // 只读权限
    Permission.USER_VIEW,
    Permission.ACTIVITY_VIEW,
    Permission.TRANSACTION_VIEW,
    Permission.MODERATION_VIEW,
    Permission.RISK_VIEW,
    Permission.PREMIUM_VIEW,
    Permission.GEOGRAPHY_VIEW,
    Permission.COMMUNICATION_VIEW,
    Permission.SYSTEM_VIEW,
    Permission.ANALYTICS_VIEW,
  ],
}

// 用户权限接口
export interface UserPermissions {
  userId: string
  role: Role
  permissions: Permission[]
  customPermissions?: Permission[] // 自定义权限
}

// 权限检查工具类
export class PermissionChecker {
  private userPermissions: UserPermissions

  constructor(userPermissions: UserPermissions) {
    this.userPermissions = userPermissions
  }

  /**
   * 检查用户是否拥有指定权限
   */
  hasPermission(permission: Permission): boolean {
    // 超级管理员拥有所有权限
    if (this.userPermissions.role === Role.SUPER_ADMIN) {
      return true
    }

    // 检查角色权限
    const rolePerms = rolePermissions[this.userPermissions.role] || []
    if (rolePerms.includes(permission)) {
      return true
    }

    // 检查自定义权限
    const customPerms = this.userPermissions.customPermissions || []
    return customPerms.includes(permission)
  }

  /**
   * 检查用户是否拥有任一权限
   */
  hasAnyPermission(permissions: Permission[]): boolean {
    return permissions.some(permission => this.hasPermission(permission))
  }

  /**
   * 检查用户是否拥有所有权限
   */
  hasAllPermissions(permissions: Permission[]): boolean {
    return permissions.every(permission => this.hasPermission(permission))
  }

  /**
   * 获取用户所有权限
   */
  getAllPermissions(): Permission[] {
    if (this.userPermissions.role === Role.SUPER_ADMIN) {
      return Object.values(Permission)
    }

    const rolePerms = rolePermissions[this.userPermissions.role] || []
    const customPerms = this.userPermissions.customPermissions || []
    
    return [...new Set([...rolePerms, ...customPerms])]
  }
}

// 权限装饰器/HOC 工具
export function requirePermission(permission: Permission) {
  return function <T extends (...args: any[]) => any>(
    _target: any,
    _propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ) {
    const originalMethod = descriptor.value!

    descriptor.value = function (this: any, ...args: any[]) {
      const userPermissions = getCurrentUserPermissions() // 需要实现
      const checker = new PermissionChecker(userPermissions)
      
      if (!checker.hasPermission(permission)) {
        throw new Error(`Access denied: Missing permission ${permission}`)
      }
      
      return originalMethod.apply(this, args)
    } as T

    return descriptor
  }
}

// 模拟当前用户权限获取（实际应该从认证系统获取）
export function getCurrentUserPermissions(): UserPermissions {
  // 这里应该从认证上下文或 API 获取当前用户权限
  // 暂时返回模拟数据
  return {
    userId: 'current-user',
    role: Role.ADMIN,
    permissions: rolePermissions[Role.ADMIN],
  }
}

// 权限检查 Hook
export function usePermissions() {
  const userPermissions = getCurrentUserPermissions()
  const checker = new PermissionChecker(userPermissions)

  return {
    hasPermission: (permission: Permission) => checker.hasPermission(permission),
    hasAnyPermission: (permissions: Permission[]) => checker.hasAnyPermission(permissions),
    hasAllPermissions: (permissions: Permission[]) => checker.hasAllPermissions(permissions),
    getAllPermissions: () => checker.getAllPermissions(),
    userRole: userPermissions.role,
    userPermissions,
  }
}

// 权限相关的 UI 组件 Props
export interface PermissionGuardProps {
  permission?: Permission
  permissions?: Permission[]
  requireAll?: boolean // 是否需要所有权限，默认 false（任一权限即可）
  fallback?: React.ReactNode
  children: React.ReactNode
}
