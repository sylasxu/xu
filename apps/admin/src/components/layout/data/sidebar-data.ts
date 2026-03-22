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
    // 📊 指挥舱 - God View
    {
      title: '指挥舱',
      items: [
        {
          title: '仪表盘',
          url: '/',
          icon: LayoutDashboard,
        },
      ],
    },
    // 🧠 AI Ops - 大脑调优
    {
      title: 'AI Ops',
      items: [
        {
          title: 'Playground',
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
      ],
    },
    // 🛡️ 安全 - 保命模块
    {
      title: '安全',
      items: [
        {
          title: '风险审核',
          url: '/safety/moderation',
          icon: Shield,
        },
        {
          title: '活动管理',
          url: '/safety/activities',
          icon: Calendar,
        },
      ],
    },
    // 📝 内容运营
    {
      title: '内容运营',
      items: [
        {
          title: '内容生成',
          url: '/content',
          icon: FileText,
        },
      ],
    },
    // 👥 用户 - 私域运营
    {
      title: '用户',
      items: [
        {
          title: '用户管理',
          url: '/users',
          icon: Users,
        },
      ],
    },
    // ⚙️ 设置
    {
      title: '设置',
      items: [
        {
          title: '系统配置',
          url: '/settings',
          icon: Settings,
        },
      ],
    },
  ],
}
