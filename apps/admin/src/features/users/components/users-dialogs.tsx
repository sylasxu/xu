import { UsersMutateDrawer } from './users-mutate-drawer'
import { UsersDeleteDialog } from './users-delete-dialog'
import { useUsersListContext } from '../list-context'

export function UsersDialogs() {
  const { open, setOpen, currentRow } = useUsersListContext()

  return (
    <>
      <UsersMutateDrawer />
      {open === 'delete' && currentRow && (
        <UsersDeleteDialog
          open={true}
          onOpenChange={() => setOpen(null)}
          currentRow={currentRow}
        />
      )}
    </>
  )
}
