import { Type, type Static } from '@sinclair/typebox'
import { createFileRoute } from '@tanstack/react-router'
import { Settings } from '@/features/settings'

const settingsSearchSchema = Type.Object({
  tab: Type.Optional(Type.Union([
    Type.Literal('profile'),
    Type.Literal('account'),
    Type.Literal('appearance'),
  ])),
})

type SettingsSearchParams = Static<typeof settingsSearchSchema>

export const Route = createFileRoute('/_authenticated/settings')({
  validateSearch: (search: Record<string, unknown>): SettingsSearchParams => ({
    tab:
      search.tab === 'account' || search.tab === 'appearance'
        ? search.tab
        : undefined,
  }),
  component: Settings,
})
