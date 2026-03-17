import React, { useState, createContext, useContext } from 'react'
import useDialogState from '@/hooks/use-dialog-state'

export interface ListContextValue<TData, TDialogType extends string> {
  open: TDialogType | null
  setOpen: (type: TDialogType | null) => void
  currentRow: TData | null
  setCurrentRow: React.Dispatch<React.SetStateAction<TData | null>>
  selectedRows: TData[]
  setSelectedRows: React.Dispatch<React.SetStateAction<TData[]>>
}

interface ListProviderProps {
  children: React.ReactNode
}

export function createListContext<TData, TDialogType extends string>() {
  const ListContext = createContext<ListContextValue<TData, TDialogType> | null>(null)

  function ListProvider({ children }: ListProviderProps) {
    const [open, setOpen] = useDialogState<TDialogType>(null)
    const [currentRow, setCurrentRow] = useState<TData | null>(null)
    const [selectedRows, setSelectedRows] = useState<TData[]>([])

    return (
      <ListContext.Provider
        value={{
          open,
          setOpen,
          currentRow,
          setCurrentRow,
          selectedRows,
          setSelectedRows,
        }}
      >
        {children}
      </ListContext.Provider>
    )
  }

  function useListContext() {
    const context = useContext(ListContext)

    if (!context) {
      throw new Error('useListContext must be used within ListProvider')
    }

    return context
  }

  return {
    ListProvider,
    useListContext,
  }
}
