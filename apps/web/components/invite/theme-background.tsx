"use client"

import type { CSSProperties } from "react"
import type { ThemeConfig } from "@/lib/themes"

function toHex(color: unknown, fallback: string): string {
  if (typeof color === "number") {
    return `#${color.toString(16).padStart(6, "0")}`
  }
  if (typeof color === "string" && color.trim().length > 0) {
    return color
  }
  return fallback
}

function getPrimaryGradient(config: Record<string, unknown>): string {
  const from = typeof config.from === "string" ? config.from : "#f5f7fa"
  const to = typeof config.to === "string" ? config.to : "#c3cfe2"
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`
}

function getAuroraGradient(config: Record<string, unknown>): string {
  const stops = Array.isArray(config.colorStops) ? config.colorStops : ["#3A29FF", "#FF94B4", "#FF3232"]
  const [a, b, c] = stops
  return `radial-gradient(1200px 500px at 0% 0%, ${toHex(a, "#3A29FF")} 0%, transparent 60%),
          radial-gradient(1000px 400px at 100% 100%, ${toHex(b, "#FF94B4")} 0%, transparent 60%),
          linear-gradient(135deg, ${toHex(c, "#FF3232")} 0%, #111827 100%)`
}

function getBallpitGradient(config: Record<string, unknown>): string {
  const colors = Array.isArray(config.colors) ? config.colors : [0xff6b6b, 0xffd93d, 0x6bcb77]
  const [a, b, c] = colors
  return `radial-gradient(circle at 20% 20%, ${toHex(a, "#ff6b6b")} 0 6%, transparent 7%),
          radial-gradient(circle at 65% 30%, ${toHex(b, "#ffd93d")} 0 6%, transparent 7%),
          radial-gradient(circle at 35% 70%, ${toHex(c, "#6bcb77")} 0 6%, transparent 7%),
          linear-gradient(135deg, #fff5f5 0%, #fffaf0 100%)`
}

function getParticlesGradient(config: Record<string, unknown>): string {
  const colors = Array.isArray(config.particleColors) ? config.particleColors : ["#22C55E", "#3B82F6"]
  const [a, b] = colors
  return `radial-gradient(circle at 15% 25%, ${toHex(a, "#22C55E")} 0 2px, transparent 3px),
          radial-gradient(circle at 70% 40%, ${toHex(b, "#3B82F6")} 0 2px, transparent 3px),
          radial-gradient(circle at 40% 75%, ${toHex(a, "#22C55E")} 0 2px, transparent 3px),
          linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)`
}

function getThreadsGradient(config: Record<string, unknown>): string {
  const color = Array.isArray(config.color) ? config.color : [0.1, 0.8, 0.9]
  const r = Math.round(Number(color[0] ?? 0.1) * 255)
  const g = Math.round(Number(color[1] ?? 0.8) * 255)
  const b = Math.round(Number(color[2] ?? 0.9) * 255)
  return `repeating-linear-gradient(
            135deg,
            rgba(${r}, ${g}, ${b}, 0.18) 0px,
            rgba(${r}, ${g}, ${b}, 0.18) 2px,
            transparent 2px,
            transparent 16px
          ),
          linear-gradient(135deg, #0f172a 0%, #1e293b 100%)`
}

function getSquaresGradient(): string {
  return `linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px),
          linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px),
          linear-gradient(135deg, #1f2937 0%, #111827 100%)`
}

export function ThemeBackground({ config }: { config: ThemeConfig }) {
  const backgroundConfig = config.background.config || {}
  const background = (() => {
    switch (config.background.component) {
      case "Aurora":
        return getAuroraGradient(backgroundConfig)
      case "Ballpit":
        return getBallpitGradient(backgroundConfig)
      case "Particles":
        return getParticlesGradient(backgroundConfig)
      case "Threads":
        return getThreadsGradient(backgroundConfig)
      case "Gradient":
        return getPrimaryGradient(backgroundConfig)
      case "Squares":
        return getSquaresGradient()
      default:
        return "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)"
    }
  })()

  const style: CSSProperties = {
    backgroundImage: background,
    backgroundSize:
      config.background.component === "Squares" ? "40px 40px, 40px 40px, cover" : "cover",
  }

  return (
    <div className="absolute inset-0" style={style} />
  )
}
