import { Type, type Static } from '@sinclair/typebox'
import { createFileRoute } from '@tanstack/react-router'
import { AiConfig } from '@/features/ai-ops/ai-config'
import { PlaygroundLayout } from '@/features/ai-ops/components/playground/playground-layout'

const playgroundSearchSchema = Type.Object({
  view: Type.Optional(Type.Union([
    Type.Literal('playground'),
    Type.Literal('config'),
  ])),
})

type PlaygroundSearchParams = Static<typeof playgroundSearchSchema>

export const Route = createFileRoute('/_authenticated/ai-ops/playground')({
  validateSearch: (search: Record<string, unknown>): PlaygroundSearchParams => ({
    view: search.view === 'config' ? 'config' : undefined,
  }),
  component: PlaygroundPage,
})

function PlaygroundPage() {
  const search = Route.useSearch()

  if (search.view === 'config') {
    return <AiConfig />
  }

  return <PlaygroundLayout />
}
