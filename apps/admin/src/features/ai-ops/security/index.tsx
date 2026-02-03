/**
 * AI Ops Security Module - 风险审核
 */

import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { ProfileDropdown } from '@/components/profile-dropdown'

export function ModerationQueue() {
  return (
    <>
      <Header fixed>
        <Search />
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ConfigDrawer />
          <ProfileDropdown />
        </div>
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>风险审核</h2>
            <p className='text-muted-foreground'>审核 AI 对话中的风险内容</p>
          </div>
        </div>

        <div className='flex flex-1 items-center justify-center rounded-lg border border-dashed p-8'>
          <div className='text-center'>
            <p className='text-muted-foreground'>暂无待审核内容</p>
          </div>
        </div>
      </Main>
    </>
  )
}
