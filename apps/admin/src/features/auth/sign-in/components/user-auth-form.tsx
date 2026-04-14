import { useState, useEffect, useCallback } from 'react'
import { Type, type Static } from '@sinclair/typebox'
import { useForm } from 'react-hook-form'
import { typeboxResolver } from '@hookform/resolvers/typebox'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, Smartphone, QrCode } from 'lucide-react'
import { toast } from 'sonner'

import { useAuthStore } from '@/stores/auth-store'
import { api } from '@/lib/eden'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// 手机号验证码表单 Schema
const phoneFormSchema = Type.Object({
  phone: Type.String({ pattern: '^1[3-9]\\d{9}$' }),
  code: Type.String({ minLength: 4, maxLength: 6 }),
})

type PhoneFormValues = Static<typeof phoneFormSchema>

interface UserAuthFormProps extends React.HTMLAttributes<HTMLDivElement> {
  redirectTo?: string
}

interface LoginResult {
  user: {
    id: string
    nickname?: string | null
    phoneNumber?: string
    avatarUrl?: string | null
    role?: {
      id: string
      name: string
      permissions: Array<{ resource: string; actions: string[] }>
    }
  }
  token: string
  exp: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readErrorMessage(value: unknown): string | null {
  return isRecord(value) && typeof value.msg === 'string' ? value.msg : null
}

function readLoginResult(value: unknown): LoginResult | null {
  if (!isRecord(value) || !isRecord(value.user) || typeof value.token !== 'string' || typeof value.exp !== 'number') {
    return null
  }

  const user = value.user
  if (typeof user.id !== 'string') {
    return null
  }

  const role = isRecord(user.role) &&
    typeof user.role.id === 'string' &&
    typeof user.role.name === 'string' &&
    Array.isArray(user.role.permissions)
      ? {
          id: user.role.id,
          name: user.role.name,
          permissions: user.role.permissions.filter(
            (permission): permission is { resource: string; actions: string[] } =>
              isRecord(permission) &&
              typeof permission.resource === 'string' &&
              Array.isArray(permission.actions) &&
              permission.actions.every((action) => typeof action === 'string')
          ),
        }
      : undefined

  return {
    user: {
      id: user.id,
      nickname: typeof user.nickname === 'string' ? user.nickname : null,
      phoneNumber: typeof user.phoneNumber === 'string' ? user.phoneNumber : undefined,
      avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : null,
      role,
    },
    token: value.token,
    exp: value.exp,
  }
}

export function UserAuthForm({
  className,
  redirectTo,
  ...props
}: UserAuthFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const navigate = useNavigate()
  const { setUser, setAccessToken } = useAuthStore()

  const form = useForm<PhoneFormValues>({
    resolver: typeboxResolver(phoneFormSchema),
    defaultValues: {
      phone: '',
      code: '',
    },
  })

  // 发送验证码
  const sendCode = async () => {
    const phone = form.getValues('phone')
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      form.setError('phone', { message: '请输入正确的手机号' })
      return
    }

    setCountdown(60)
    toast.success('验证码已发送（测试验证码：9999）')
    
    // TODO: 接入真实短信服务
  }

  // 倒计时
  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(timer)
    }
  }, [countdown])

  // 手机号登录
  async function onPhoneSubmit(data: PhoneFormValues) {
    setIsLoading(true)

    try {
      const response = await api.auth.login.post({
        grantType: 'phone_otp',
        phone: data.phone,
        code: data.code,
      })

      if (response.error) {
        const errorMsg = readErrorMessage(response.error) || '登录失败'
        toast.error(errorMsg)
        setIsLoading(false)
        return
      }

      const rawResult: unknown =
        response.data instanceof Response ? await response.data.json() : response.data
      const parsedResult = readLoginResult(rawResult)

      if (!parsedResult) {
        toast.error('登录失败，服务器返回数据异常')
        setIsLoading(false)
        return
      }

      const { user, token, exp } = parsedResult

      // 设置认证状态
      setUser({
        id: user.id,
        username: user.nickname || '管理员',
        email: `${user.phoneNumber}@xu.example`,
        phoneNumber: user.phoneNumber,
        avatarUrl: user.avatarUrl || undefined,
        role: user.role ? {
          id: user.role.id,
          name: user.role.name,
          permissions: user.role.permissions,
        } : undefined,
        exp,
      })
      setAccessToken(token)

      toast.success('登录成功')

      // 跳转
      const targetPath = redirectTo || '/'
      navigate({ to: targetPath, replace: true })
    } catch (error: unknown) {
      console.error('登录失败:', error)
      toast.error(error instanceof Error ? error.message : '登录失败，请稍后重试')
    } finally {
      setIsLoading(false)
    }
  }

  // 生成微信二维码
  const generateQrCode = useCallback(async () => {
    // TODO: 调用真实 API 获取微信登录二维码
    setQrCodeUrl('https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=weixin://wxpay/bizpayurl?pr=xxx')
  }, [])

  // 初始化时生成二维码
  useEffect(() => {
    generateQrCode()
  }, [generateQrCode])

  return (
    <div className={cn('w-full', className)} {...props}>
      <Tabs defaultValue='phone' className='w-full'>
        <TabsList className='grid w-full grid-cols-2'>
          <TabsTrigger value='phone' className='gap-2'>
            <Smartphone className='h-4 w-4' />
            手机号
          </TabsTrigger>
          <TabsTrigger value='wechat' className='gap-2'>
            <QrCode className='h-4 w-4' />
            微信扫码
          </TabsTrigger>
        </TabsList>

        {/* 手机号登录 */}
        <TabsContent value='phone' className='mt-6'>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onPhoneSubmit)}
              className='grid gap-4'
            >
              <FormField
                control={form.control}
                name='phone'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>手机号</FormLabel>
                    <FormControl>
                      <Input
                        placeholder='请输入手机号'
                        maxLength={11}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='code'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>验证码</FormLabel>
                    <div className='flex gap-2'>
                      <FormControl>
                        <Input
                          placeholder='请输入验证码'
                          maxLength={6}
                          {...field}
                        />
                      </FormControl>
                      <Button
                        type='button'
                        variant='outline'
                        onClick={sendCode}
                        disabled={countdown > 0}
                        className='shrink-0 w-28'
                      >
                        {countdown > 0 ? `${countdown}s` : '获取验证码'}
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button className='mt-2' disabled={isLoading}>
                {isLoading && <Loader2 className='animate-spin' />}
                登录
              </Button>
            </form>
          </Form>
        </TabsContent>

        {/* 微信扫码登录 */}
        <TabsContent value='wechat' className='mt-6'>
          <div className='flex flex-col items-center gap-4'>
            <div className='bg-white rounded-lg p-3 border'>
              {qrCodeUrl ? (
                <img
                  src={qrCodeUrl}
                  alt='微信登录二维码'
                  className='w-48 h-48'
                />
              ) : (
                <div className='w-48 h-48 flex items-center justify-center'>
                  <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
                </div>
              )}
            </div>
            <p className='text-sm text-muted-foreground text-center'>
              请使用微信扫描二维码登录
            </p>
            <Button
              variant='ghost'
              size='sm'
              onClick={generateQrCode}
              className='text-muted-foreground'
            >
              刷新二维码
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
