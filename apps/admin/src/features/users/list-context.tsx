import { createListContext } from '@/components/list-page/list-provider'
import type { User } from './data/schema'
import type { UserDialogType } from './components/users-columns'

export const {
  ListProvider: UsersListProvider,
  useListContext: useUsersListContext,
} = createListContext<User, UserDialogType>()
