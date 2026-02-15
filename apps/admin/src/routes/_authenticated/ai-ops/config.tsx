import { createFileRoute } from '@tanstack/react-router'
import { AiConfig } from '@/features/ai-ops/ai-config'

export const Route = createFileRoute('/_authenticated/ai-ops/config')({
  component: AiConfig,
})
