import { createListContext } from '@/components/list-page/list-provider'
import type { GlobalKeyword } from '../data/schema'
import type { HotKeywordDialogType } from './hot-keywords-columns'

export const {
  ListProvider: HotKeywordsListProvider,
  useListContext: useHotKeywordsListContext,
} = createListContext<GlobalKeyword, HotKeywordDialogType>()
