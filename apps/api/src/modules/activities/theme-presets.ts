/**
 * v5.0: 活动主题预设配置
 * 
 * 6 种预设主题 + 活动类型自动映射
 * 与 apps/web/lib/themes.ts 保持同步
 */
import type { ThemeConfig } from '@xu/db';

/** 活动类型 → 预设主题名称映射 */
export const ACTIVITY_TYPE_THEME_MAP: Record<string, string> = {
  food: 'warm',
  entertainment: 'party',
  sports: 'sport',
  boardgame: 'neon',
  other: 'minimal',
};

/** 6 种预设主题的 ThemeConfig */
export const PRESET_THEMES: Record<string, ThemeConfig> = {
  aurora: {
    background: { component: 'Aurora', config: { colorStops: ['#3A29FF', '#FF94B4', '#FF3232'], speed: 0.5, blend: 0.5 } },
    colorScheme: { primary: '#6366F1', secondary: '#A78BFA', text: '#FFFFFF' },
  },
  party: {
    background: { component: 'Ballpit', config: { count: 50, gravity: 0.5, size: 0.8, colors: [0xff6b6b, 0xffd93d, 0x6bcb77] } },
    colorScheme: { primary: '#F43F5E', secondary: '#FB923C', text: '#FFFFFF' },
  },
  minimal: {
    background: { component: 'Gradient', config: { from: '#f5f7fa', to: '#c3cfe2' } },
    colorScheme: { primary: '#374151', secondary: '#6B7280', text: '#1F2937' },
  },
  neon: {
    background: { component: 'Threads', config: { color: [0.1, 0.8, 0.9], amplitude: 1, distance: 0, enableMouseInteraction: true } },
    colorScheme: { primary: '#06B6D4', secondary: '#8B5CF6', text: '#FFFFFF' },
  },
  warm: {
    background: { component: 'Gradient', config: { from: '#ffecd2', to: '#fcb69f' } },
    colorScheme: { primary: '#EA580C', secondary: '#F59E0B', text: '#1C1917' },
  },
  sport: {
    background: { component: 'Particles', config: { particleCount: 80, speed: 0.3, particleColors: ['#22C55E', '#3B82F6'] } },
    colorScheme: { primary: '#16A34A', secondary: '#2563EB', text: '#FFFFFF' },
  },
};

/** 根据活动类型解析最终 ThemeConfig */
export function resolveThemeConfig(theme: string, themeConfig: ThemeConfig | null, activityType: string): ThemeConfig {
  if (theme === 'custom' && themeConfig) return themeConfig;
  const presetName = theme === 'auto' ? (ACTIVITY_TYPE_THEME_MAP[activityType] || 'minimal') : theme;
  return PRESET_THEMES[presetName] || PRESET_THEMES.minimal;
}
