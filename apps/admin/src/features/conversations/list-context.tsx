import { createListContext } from '@/components/list-page/list-provider'
import type { ConversationSession } from '@/hooks/use-conversations'
import type { ConversationDialogType } from './components/conversations-columns'

export const {
  ListProvider: ConversationsListProvider,
  useListContext: useConversationsListContext,
} = createListContext<ConversationSession, ConversationDialogType>()
