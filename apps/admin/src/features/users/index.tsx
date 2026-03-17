import { Users as UsersIcon } from 'lucide-react'
import { getRouteApi } from '@tanstack/react-router'
import { ListPage, DataTable } from '@/components/list-page'
import { useUsersList } from '@/hooks/use-users'
import { usersColumns } from './components/users-columns'
import { UsersDialogs } from './components/users-dialogs'
import { UsersPrimaryButtons } from './components/users-primary-buttons'
import { UsersBulkActions } from './components/data-table-bulk-actions'
import { UsersListProvider } from './list-context'

const route = getRouteApi('/_authenticated/users/')

export function Users() {
  const search = route.useSearch()
  const navigate = route.useNavigate()
  const pageSize = search.pageSize ?? 10

  const { data, isLoading, error } = useUsersList({
    page: search.page ?? 1,
    limit: pageSize,
    search: search.filter,
  })

  const users = data?.data ?? []
  const total = data?.total ?? 0

  return (
    <UsersListProvider>
      <ListPage
        title='用户管理'
        description='管理平台用户，查看用户信息和状态'
        icon={UsersIcon}
        isLoading={isLoading}
        error={error ?? undefined}
        headerActions={<UsersPrimaryButtons />}
        dialogs={<UsersDialogs />}
      >
        <DataTable
          data={users}
          columns={usersColumns}
          pageCount={Math.ceil(total / pageSize)}
          search={search}
          navigate={navigate}
          getRowId={(row) => row.id}
          searchPlaceholder='按昵称、ID或手机号搜索...'
          emptyMessage='暂无用户'
          enableRowSelection={true}
          bulkActions={(table) => <UsersBulkActions table={table} />}
        />
      </ListPage>
    </UsersListProvider>
  )
}
