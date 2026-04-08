import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { HotKeywordForm } from './hot-keyword-form'
import { HotKeywordDeleteDialog } from './hot-keyword-delete-dialog'
import { HotKeywordViewDialog } from './hot-keyword-view-dialog'
import { useHotKeywordsListContext } from './list-context'

export function HotKeywordsDialogs({
  editorMode,
  keywordId,
  onEditorClose,
}: {
  editorMode?: 'create' | 'edit'
  keywordId?: string
  onEditorClose?: () => void
}) {
  const { open } = useHotKeywordsListContext()
  const editorOpen = editorMode === 'create' || editorMode === 'edit'

  return (
    <>
      {open === 'delete' && <HotKeywordDeleteDialog />}
      {open === 'view' && <HotKeywordViewDialog />}
      <Dialog open={editorOpen} onOpenChange={(nextOpen) => !nextOpen && onEditorClose?.()}>
        <DialogContent className='max-h-[90vh] max-w-3xl overflow-y-auto'>
          <DialogHeader>
            <DialogTitle>{editorMode === 'edit' ? '编辑热词' : '创建热词'}</DialogTitle>
            <DialogDescription>直接在内容工作台里维护热词承接规则。</DialogDescription>
          </DialogHeader>
          {editorOpen ? (
            <HotKeywordForm
              keywordId={editorMode === 'edit' ? keywordId : undefined}
              onSuccess={onEditorClose}
              onCancel={onEditorClose}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
