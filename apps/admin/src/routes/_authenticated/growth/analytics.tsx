import { createFileRoute } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { ContentAnalytics } from '@/features/content-ops'

export const Route = createFileRoute('/_authenticated/growth/analytics')({
  component: AnalyticsPage,
})

function AnalyticsPage() {
  return (
    <>
      <Header>
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <ContentAnalytics />
      </Main>
    </>
  )
}
