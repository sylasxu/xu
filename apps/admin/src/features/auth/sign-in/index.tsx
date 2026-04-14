import { useSearch } from '@tanstack/react-router'
import { Logo } from '@/assets/logo'
import { cn } from '@/lib/utils'
import dashboardDark from './assets/dashboard-dark.png'
import dashboardLight from './assets/dashboard-light.png'
import { UserAuthForm } from './components/user-auth-form'

export function SignIn() {
  const { redirect } = useSearch({ from: '/(auth)/sign-in' })

  return (
    <div className='relative container grid h-svh flex-col items-center justify-center lg:max-w-none lg:grid-cols-2 lg:px-0'>
      <div className='lg:p-8'>
        <div className='mx-auto flex w-full flex-col justify-center space-y-2 py-8 sm:w-[480px] sm:p-8'>
          <div className='mb-4 flex items-center justify-center'>
            <Logo className='me-2' />
            <h1 className='text-xl font-medium'>xu 管理后台</h1>
          </div>
        </div>
        <div className='mx-auto flex w-full max-w-sm flex-col justify-center space-y-2'>
          <div className='flex flex-col space-y-2 text-start'>
            <h2 className='text-lg font-semibold tracking-tight'>登录</h2>
            <p className='text-muted-foreground text-sm'>
              使用微信扫码或手机号登录管理后台
            </p>
          </div>
          <UserAuthForm redirectTo={redirect} />
          <p className='text-muted-foreground px-8 text-center text-sm'>
            登录即表示您同意我们的{' '}
            <a
              href='/terms'
              className='hover:text-primary underline underline-offset-4'
            >
              服务条款
            </a>{' '}
            和{' '}
            <a
              href='/privacy'
              className='hover:text-primary underline underline-offset-4'
            >
              隐私政策
            </a>
            。
          </p>
        </div>
      </div>

      <div
        className={cn(
          'bg-muted relative h-full overflow-hidden max-lg:hidden',
          '[&>img]:absolute [&>img]:top-[15%] [&>img]:left-20 [&>img]:h-full [&>img]:w-full [&>img]:object-cover [&>img]:object-top-left [&>img]:select-none'
        )}
      >
        <img
          src={dashboardLight}
          className='dark:hidden'
          width={1024}
          height={1151}
          alt='xu 管理后台'
        />
        <img
          src={dashboardDark}
          className='hidden dark:block'
          width={1024}
          height={1138}
          alt='xu 管理后台'
        />
      </div>
    </div>
  )
}
