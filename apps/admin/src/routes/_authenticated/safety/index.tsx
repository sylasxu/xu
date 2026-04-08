import { createFileRoute } from '@tanstack/react-router'
import { SafetyPage } from '@/features/safety'

export const Route = createFileRoute('/_authenticated/safety/')({
  component: SafetyPage,
})
