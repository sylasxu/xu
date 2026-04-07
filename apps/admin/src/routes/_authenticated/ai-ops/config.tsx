import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/ai-ops/config')({
  beforeLoad: () => {
    throw redirect({
      to: '/ai-ops/playground',
      search: { view: 'config' },
    })
  },
  component: () => null,
})
