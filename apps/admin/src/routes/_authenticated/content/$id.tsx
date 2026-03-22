import { Type, type Static } from '@sinclair/typebox'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { ContentDetail } from '@/features/content-ops'

const contentDetailSearchSchema = Type.Object({
  tab: Type.Optional(Type.Union([
    Type.Literal('current'),
    Type.Literal('generate'),
    Type.Literal('history'),
  ])),
  focus: Type.Optional(Type.Union([
    Type.Literal('performance'),
  ])),
})

type ContentDetailSearchParams = Static<typeof contentDetailSearchSchema>

export const Route = createFileRoute('/_authenticated/content/$id')({
  validateSearch: (search: Record<string, unknown>): ContentDetailSearchParams => ({
    tab:
      search.tab === 'current' || search.tab === 'generate' || search.tab === 'history'
        ? search.tab
        : undefined,
    focus: search.focus === 'performance' ? search.focus : undefined,
  }),
  component: ContentDetailPage,
})

function ContentDetailPage() {
  const { id } = Route.useParams()
  const search = Route.useSearch()
  const navigate = useNavigate()

  return (
    <>
      <Header>
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className='space-y-4'>
          <Button variant='ghost' size='sm' onClick={() => navigate({ to: '/content' })}>
            <ArrowLeft className='h-4 w-4 mr-1' />
            返回内容列表
          </Button>
          <ContentDetail id={id} initialTab={search.tab} focusTarget={search.focus} />
        </div>
      </Main>
    </>
  )
}
