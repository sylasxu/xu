import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useActivitiesListContext } from '../list-context'

export function ActivitiesPrimaryButtons() {
  const { setOpen } = useActivitiesListContext()
  return (
    <Button className='space-x-1' onClick={() => setOpen('create')}>
      <span>创建</span> <Plus size={18} />
    </Button>
  )
}
