import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { ContentLibrary, ContentDetail } from '@/features/content-ops'

type LibrarySearch = { id?: string }

export const Route = createFileRoute('/_authenticated/growth/library')({
  component: LibraryPage,
  validateSearch: (search: Record<string, unknown>): LibrarySearch => ({
    id: typeof search.id === 'string' ? search.id : undefined,
  }),
})

function LibraryPage() {
  const { id } = Route.useSearch()
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
        {id ? (
          <div className='space-y-4'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => navigate({ to: '/growth/library' })}
            >
              <ArrowLeft className='h-4 w-4 mr-1' />
              返回列表
            </Button>
            <ContentDetail id={id} />
          </div>
        ) : (
          <ContentLibrary />
        )}
      </Main>
    </>
  )
}
