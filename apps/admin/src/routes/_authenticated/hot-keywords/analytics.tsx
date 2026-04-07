import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/hot-keywords/analytics')({
  beforeLoad: () => {
    throw redirect({
      to: '/content',
      search: { tab: 'keywords' },
    })
  },
  component: () => null,
})
