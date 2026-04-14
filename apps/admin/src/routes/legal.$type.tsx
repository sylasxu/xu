/**
 * 法务页面 - 公开访问（无需认证）
 * 
 * 路由：/legal/:type
 * - /legal/user-agreement - 用户协议
 * - /legal/privacy-policy - 隐私政策
 * - /legal/about - 关于 xu
 * 
 * 用途：
 * - 小程序 web-view 加载
 * - H5 直接访问
 */

import { createFileRoute } from '@tanstack/react-router'

// 法务内容配置
const LEGAL_CONTENT = {
  'user-agreement': {
    title: 'xu 用户服务协议',
    content: `
## 一、服务条款的确认和接纳

欢迎使用 xu（以下简称"本平台"）提供的服务。在使用本平台服务之前，请您仔细阅读本协议的全部内容。

如果您对本协议的任何条款表示异议，您可以选择不使用本平台服务。当您注册成功，无论是进入本平台，还是在本平台上发布任何内容，均意味着您完全接受本协议项下的全部条款。

## 二、服务内容

本平台为用户提供基于地理位置的社交活动发布、参与和交流服务，包括但不限于：

- 发布线下活动
- 参与他人发起的活动
- 活动群聊交流
- AI 辅助活动创建

## 三、用户行为规范

用户在使用本平台服务时，必须遵守中华人民共和国相关法律法规，不得利用本平台从事违法违规活动。

用户不得发布以下内容：

- 违反国家法律法规的内容
- 涉及色情、暴力、赌博等不良信息
- 侵犯他人合法权益的内容
- 虚假、欺诈性信息

## 四、免责声明

本平台仅提供信息发布和交流平台，不对用户发布的活动内容及线下活动的安全性承担责任。用户参与活动时应注意人身和财产安全。

## 五、协议修改

本平台有权随时修改本协议的任何条款，修改后的协议一经公布即生效。

---

更新日期：2024年12月

生效日期：2024年12月
    `,
  },
  'privacy-policy': {
    title: 'xu 隐私政策',
    content: `
## 一、我们收集的信息

为了向您提供服务，我们可能会收集以下信息：

- **账号信息**：微信昵称、头像、手机号码
- **位置信息**：用于显示附近活动和活动地点
- **设备信息**：设备型号、操作系统版本
- **使用记录**：您发布和参与的活动记录

## 二、信息的使用

我们收集的信息将用于：

- 提供、维护和改进我们的服务
- 向您推荐附近的活动
- 在活动有变动时通知您
- 保障平台安全和用户权益

## 三、信息的共享

我们不会将您的个人信息出售给第三方。在以下情况下，我们可能会共享您的信息：

- 经您明确同意
- 法律法规要求
- 保护本平台或用户的合法权益

## 四、信息的保护

我们采取合理的技术和管理措施保护您的个人信息安全，防止信息泄露、损毁或丢失。

## 五、您的权利

您有权：

- 访问和更正您的个人信息
- 删除您的账号和相关数据
- 撤回您的授权同意

## 六、联系我们

如果您对本隐私政策有任何疑问，请通过小程序内的意见反馈功能联系我们。

---

更新日期：2024年12月

生效日期：2024年12月
    `,
  },
  'about': {
    title: '关于 xu',
    content: `
## 产品介绍

xu 是一款碎片化社交助理，帮助用户把找人、凑局、开口和活动后跟进变得更轻松。

## 核心功能

- **对话组局**：说出你想玩什么，帮你整理成可推进的活动
- **探索附近**：发现身边正在进行的活动
- **轻量群聊**：活动参与者实时交流
- **一键分享**：快速邀请好友参与

## 联系我们

如有任何问题或建议，欢迎通过意见反馈功能联系我们。

---

版本：1.0.0
    `,
  },
} as const

type LegalType = keyof typeof LEGAL_CONTENT

export const Route = createFileRoute('/legal/$type')({
  component: LegalPage,
})

function LegalPage() {
  const { type } = Route.useParams()
  const legalType = type as LegalType
  const content = LEGAL_CONTENT[legalType] || LEGAL_CONTENT['user-agreement']

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 dark:bg-slate-800/80 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {content.title}
          </h1>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-6">
        <article className="prose prose-slate dark:prose-invert prose-sm max-w-none">
          <div 
            className="legal-content"
            dangerouslySetInnerHTML={{ 
              __html: parseMarkdown(content.content) 
            }} 
          />
        </article>
      </main>

      {/* Footer */}
      <footer className="max-w-2xl mx-auto px-4 py-8 text-center">
        <p className="text-xs text-slate-400 dark:text-slate-500">
          © 2024 xu. All rights reserved.
        </p>
      </footer>
    </div>
  )
}

/**
 * 简单的 Markdown 解析器
 * 支持：标题、列表、粗体、分隔线
 */
function parseMarkdown(md: string): string {
  return md
    // 标题
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold mt-6 mb-3 text-slate-800 dark:text-slate-200">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-medium mt-4 mb-2 text-slate-700 dark:text-slate-300">$1</h3>')
    // 粗体
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-medium">$1</strong>')
    // 无序列表
    .replace(/^- (.+)$/gm, '<li class="ml-4 text-slate-600 dark:text-slate-400">$1</li>')
    // 分隔线
    .replace(/^---$/gm, '<hr class="my-6 border-slate-200 dark:border-slate-700" />')
    // 段落
    .replace(/^(?!<[hl]|<li|<hr)(.+)$/gm, '<p class="text-slate-600 dark:text-slate-400 leading-relaxed mb-3">$1</p>')
    // 包装列表
    .replace(/(<li[^>]*>.*<\/li>\n?)+/g, '<ul class="list-disc space-y-1 mb-4">$&</ul>')
}
