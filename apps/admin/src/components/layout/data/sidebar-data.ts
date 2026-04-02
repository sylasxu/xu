import {
  LayoutDashboard,
  Settings,
  Users,
  Calendar,
  Command,
  MessageSquare,
  Play,
  Shield,
  TrendingUp,
  FileText,
  Zap,
} from 'lucide-react'
import { type SidebarData } from '../types'

// v4.7: Admin Cockpit Redesign - AI 驾驶舱 + 内容运营工作台
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
      title: '运营主线',
      items: [
        {
          title: '首页',
          url: '/',
          icon: LayoutDashboard,
        },
        {
          title: '内容工作台',
          url: '/content',
          icon: FileText,
        },
        {
          title: '热词运营',
          url: '/hot-keywords',
          icon: Zap,
        },
        {
          title: '活动与搭子',
          url: '/activities',
          icon: Calendar,
        },
        {
          title: '风险审核',
          url: '/safety/moderation',
          icon: Shield,
        },
      ],
    },
    {
      title: '辅助工具',
      items: [
        {
          title: 'AI 调试',
          url: '/ai-ops/playground',
          icon: Play,
        },
        {
          title: '对话审计',
          url: '/ai-ops/conversations',
          icon: MessageSquare,
        },
        {
          title: '用量统计',
          url: '/ai-ops/usage',
          icon: TrendingUp,
        },
        {
          title: '用户管理',
          url: '/users',
          icon: Users,
        },
        {
          title: '系统配置',
          url: '/settings',
          icon: Settings,
        },
      ],
    },
  ],
}
