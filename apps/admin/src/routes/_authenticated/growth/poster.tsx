import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Image, Copy, Sparkles, Loader2 } from 'lucide-react'
import { useGeneratePoster } from '@/hooks/use-growth'
import { toast } from 'sonner'

export const Route = createFileRoute('/_authenticated/growth/poster')({
  component: PosterFactoryPage,
})

interface PosterResult {
  headline: string
  subheadline: string
  body: string
  cta: string
  hashtags: string[]
}

function PosterFactoryPage() {
  const [inputText, setInputText] = useState('')
  const [style, setStyle] = useState<'minimal' | 'cyberpunk' | 'handwritten'>('minimal')
  const [result, setResult] = useState<PosterResult | null>(null)
  
  const generateMutation = useGeneratePoster()

  const handleGenerate = async () => {
    if (!inputText.trim()) return
    
    const data = await generateMutation.mutateAsync({
      text: inputText,
      style,
    })
    
    setResult(data)
    toast.success('文案生成成功')
  }

  const handleCopy = () => {
    if (!result) return
    const text = `${result.headline}\n${result.subheadline}\n\n${result.body}\n\n${result.cta}\n\n${result.hashtags.join(' ')}`
    navigator.clipboard.writeText(text)
    toast.success('已复制到剪贴板')
  }

  return (
    <>
      <Header>
        <div className='ms-auto flex items-center space-x-4'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>

      <Main>
        <div className='mb-6 flex items-center gap-3'>
          <Image className='h-6 w-6' />
          <h1 className='text-2xl font-bold'>文案工厂</h1>
        </div>

        <div className='grid gap-6 lg:grid-cols-2'>
          {/* 输入区 */}
          <Card>
            <CardHeader>
              <CardTitle>输入</CardTitle>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div>
                <Label htmlFor='input'>活动描述</Label>
                <Textarea
                  id='input'
                  placeholder='描述你想组的活动，比如：周末想组个火锅局，地点在观音桥，4-6人...'
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  rows={5}
                  className='mt-2'
                />
              </div>

              <div>
                <Label>风格</Label>
                <RadioGroup value={style} onValueChange={(value) => setStyle(value as typeof style)} className='mt-2 flex gap-4'>
                  <div className='flex items-center space-x-2'>
                    <RadioGroupItem value='minimal' id='minimal' />
                    <Label htmlFor='minimal' className='font-normal'>极简</Label>
                  </div>
                  <div className='flex items-center space-x-2'>
                    <RadioGroupItem value='cyberpunk' id='cyberpunk' />
                    <Label htmlFor='cyberpunk' className='font-normal'>赛博朋克</Label>
                  </div>
                  <div className='flex items-center space-x-2'>
                    <RadioGroupItem value='handwritten' id='handwritten' />
                    <Label htmlFor='handwritten' className='font-normal'>手写风</Label>
                  </div>
                </RadioGroup>
              </div>

              <Button 
                onClick={handleGenerate} 
                disabled={!inputText.trim() || generateMutation.isPending}
                className='w-full'
              >
                {generateMutation.isPending ? (
                  <>
                    <Loader2 className='h-4 w-4 mr-2 animate-spin' />
                    生成中...
                  </>
                ) : (
                  <>
                    <Sparkles className='h-4 w-4 mr-2' />
                    生成文案
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* 预览区 */}
          <Card>
            <CardHeader>
              <CardTitle>预览</CardTitle>
            </CardHeader>
            <CardContent>
              {result ? (
                <div className='space-y-4'>
                  <div className='p-6 bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-950 dark:to-red-950 rounded-lg'>
                    <h2 className='text-2xl font-bold mb-2'>{result.headline}</h2>
                    <p className='text-lg text-muted-foreground mb-4'>{result.subheadline}</p>
                    <p className='mb-4'>{result.body}</p>
                    <p className='font-medium text-primary'>{result.cta}</p>
                    <div className='mt-4 flex flex-wrap gap-2'>
                      {result.hashtags.map((tag, i) => (
                        <span key={i} className='text-sm text-blue-600 dark:text-blue-400'>{tag}</span>
                      ))}
                    </div>
                  </div>
                  <Button variant='outline' onClick={handleCopy} className='w-full'>
                    <Copy className='h-4 w-4 mr-2' />
                    复制文案
                  </Button>
                </div>
              ) : (
                <div className='flex flex-col items-center justify-center py-12 text-muted-foreground'>
                  <Image className='h-12 w-12 mb-4' />
                  <p>输入活动描述，生成小红书文案</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </Main>
    </>
  )
}
