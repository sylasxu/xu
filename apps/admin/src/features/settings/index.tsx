import { useMemo } from 'react'
import { getRouteApi } from '@tanstack/react-router'
import { Palette, Wrench, UserCog } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ConfigDrawer } from '@/components/config-drawer'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { SettingsAccount } from './account'
import { SettingsAppearance } from './appearance'
import { SettingsProfile } from './profile'

const route = getRouteApi('/_authenticated/settings')
export function Settings() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const activeTab = search.tab ?? 'profile'
  const activeContent = useMemo(() => {
    switch (activeTab) {
      case 'account':
        return <SettingsAccount />
      case 'appearance':
        return <SettingsAppearance />
      default:
        return <SettingsProfile />
    }
  }, [activeTab])

  return (
    <>
      <Header>
        <Search />
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ConfigDrawer />
          <ProfileDropdown />
        </div>
      </Header>

      <Main fixed>
        <div className='space-y-0.5'>
          <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>设置</h1>
          <p className='text-muted-foreground'>管理您的账户、资料和后台偏好。</p>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) =>
            navigate({
              search: {
                tab: value === 'profile' ? undefined : value,
              },
            })
          }
          className='mt-6 space-y-6'
        >
          <TabsList className='grid w-full max-w-md grid-cols-3'>
            <TabsTrigger value='profile' className='gap-1.5'>
              <UserCog size={16} />
              个人资料
            </TabsTrigger>
            <TabsTrigger value='account' className='gap-1.5'>
              <Wrench size={16} />
              账户设置
            </TabsTrigger>
            <TabsTrigger value='appearance' className='gap-1.5'>
              <Palette size={16} />
              外观设置
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className='mt-2 max-w-4xl'>{activeContent}</div>
      </Main>
    </>
  )
}
