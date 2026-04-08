import { createFileRoute } from '@tanstack/react-router'
import { ReportsPage, reportsSearchSchema, type ReportsSearchParams } from '@/features/reports'

export const Route = createFileRoute('/_authenticated/reports/')({
  validateSearch: (search: Record<string, unknown>): ReportsSearchParams => ({
    status:
      search.status === 'pending' || search.status === 'resolved' || search.status === 'ignored'
        ? search.status
        : undefined,
    type:
      search.type === 'activity' || search.type === 'message' || search.type === 'user'
        ? search.type
        : undefined,
    page: typeof search.page === 'number' ? search.page : 1,
    pageSize: typeof search.pageSize === 'number' ? search.pageSize : 20,
  }),
  component: ReportsPage,
})
