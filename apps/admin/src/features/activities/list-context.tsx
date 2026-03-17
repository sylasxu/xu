import { createListContext } from '@/components/list-page/list-provider'
import type { Activity } from './data/schema'
import type { ActivityDialogType } from './components/activities-columns'

export const {
  ListProvider: ActivitiesListProvider,
  useListContext: useActivitiesListContext,
} = createListContext<Activity, ActivityDialogType>()
