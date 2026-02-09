"use client"

import dynamic from "next/dynamic"
import type { ThemeConfig } from "@/lib/themes"

// 动态导入 React Bits 背景组件（ssr: false 避免服务端渲染 WebGL/Canvas）
const BACKGROUND_COMPONENTS: Record<
  string,
  React.ComponentType<Record<string, unknown>>
> = {}

// 使用 lazy map 避免一次性导入所有组件
const loaders: Record<string, () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>> = {
  Aurora: () => import("react-bits").then((m) => ({ default: m.Aurora as unknown as React.ComponentType<Record<string, unknown>> })),
  Ballpit: () => import("react-bits").then((m) => ({ default: m.Ballpit as unknown as React.ComponentType<Record<string, unknown>> })),
  Particles: () => import("react-bits").then((m) => ({ default: m.Particles as unknown as React.ComponentType<Record<string, unknown>> })),
  Threads: () => import("react-bits").then((m) => ({ default: m.Threads as unknown as React.ComponentType<Record<string, unknown>> })),
  Gradient: () => import("react-bits").then((m) => ({ default: m.Gradient as unknown as React.ComponentType<Record<string, unknown>> })),
  Squares: () => import("react-bits").then((m) => ({ default: m.Squares as unknown as React.ComponentType<Record<string, unknown>> })),
}

// 预创建动态组件
const DynamicComponents: Record<string, React.ComponentType<Record<string, unknown>>> = {}
for (const [name, loader] of Object.entries(loaders)) {
  DynamicComponents[name] = dynamic(loader, { ssr: false })
}

export function ThemeBackground({ config }: { config: ThemeConfig }) {
  const Component = DynamicComponents[config.background.component]

  if (!Component) {
    return (
      <div className="absolute inset-0 bg-gradient-to-br from-slate-100 to-slate-200" />
    )
  }

  return (
    <div className="absolute inset-0">
      <Component {...config.background.config} />
    </div>
  )
}
