import { ActivitiesMutateDrawer } from './activities-mutate-drawer'
import { ActivitiesDeleteDialog } from './activities-delete-dialog'
import { ActivityPromptDialog } from './activity-prompt-dialog'
import { ActivitiesCreateDialog } from './activities-create-dialog'
import { AIModerationDialog } from './ai-moderation-dialog'
import { useActivitiesListContext } from '../list-context'

export function ActivitiesDialogs() {
  const { open, setOpen, currentRow } = useActivitiesListContext()

  return (
    <>
      <ActivitiesMutateDrawer />
      {open === 'create' && <ActivitiesCreateDialog />}
      {open === 'prompt' && <ActivityPromptDialog />}
      {open === 'delete' && currentRow && (
        <ActivitiesDeleteDialog
          open={true}
          onOpenChange={() => setOpen(null)}
          currentRow={currentRow}
        />
      )}
      {open === 'ai-moderation' && currentRow && (
        <AIModerationDialog
          open={true}
          onOpenChange={() => setOpen(null)}
          activity={{
            id: currentRow.id,
            title: currentRow.title,
            description: currentRow.description,
          }}
        />
      )}
    </>
  )
}
