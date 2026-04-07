import {
  LayoutDashboard,
  Calendar,
  Command,
  Shield,
  FileText,
  Zap,
  Bot,
  MessageSquare,
  Settings,
  Users,
  Wrench,
} from 'lucide-react'
import { type SidebarData } from '../types'

// v5.6: Admin IA 收口为稳定领域分组，保留完整能力但不再按角色或临时主线组织
export const sidebarData: SidebarData = {
  user: {
    name: '管理员',
    email: 'admin@juchang.app',
    avatar: '/avatars/admin.png',
  },
  teams: [
    {
      name: 'JC',
      logo: Command,
      plan: 'Admin',
    },
  ],
  navGroups: [
    {
      title: '概览',
      items: [
        {
          title: '指挥舱',
          url: '/',
          icon: LayoutDashboard,
        },
      ],
    },
    {
      title: '内容',
      items: [
        {
          title: '内容工作台',
          url: '/content',
          icon: FileText,
        },
      ],
    },
    {
      title: '组局',
      items: [
        {
          title: '组局',
          url: '/activities',
          icon: Calendar,
        },
      ],
    },
    {
      title: '风控',
      items: [
        {
          title: '风险审核',
          url: '/safety/moderation',
          icon: Shield,
        },
      ],
    },
    {
      title: 'AI',
      items: [
        {
          title: 'AI Playground',
          url: '/ai-ops/playground',
          icon: Bot,
        },
        {
          title: '对话记录',
          url: '/ai-ops/conversations',
          icon: MessageSquare,
        },
        {
          title: '模型路由',
          url: '/ai-ops/config',
          icon: Wrench,
        },
        {
          title: '用量统计',
          url: '/ai-ops/usage',
          icon: Zap,
        },
      ],
    },
    {
      title: '设置',
      items: [
        {
          title: '用户管理',
          url: '/users',
          icon: Users,
        },
        {
          title: '系统设置',
          url: '/settings',
          icon: Settings,
        },
      ],
    },
  ],
}
