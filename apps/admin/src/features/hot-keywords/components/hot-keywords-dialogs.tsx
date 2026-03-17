import { HotKeywordDeleteDialog } from './hot-keyword-delete-dialog'
import { HotKeywordViewDialog } from './hot-keyword-view-dialog'
import { useHotKeywordsListContext } from './list-context'

export function HotKeywordsDialogs() {
  const { open } = useHotKeywordsListContext()

  return (
    <>
      {open === 'delete' && <HotKeywordDeleteDialog />}
      {open === 'view' && <HotKeywordViewDialog />}
    </>
  )
}
