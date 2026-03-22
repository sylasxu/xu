import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

const CONTENT_REMARKS_STORAGE_KEY = 'content_ops_remarks'

type ContentRemarksMap = Record<string, string>

function readContentRemarks(): ContentRemarksMap {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const stored = window.localStorage.getItem(CONTENT_REMARKS_STORAGE_KEY)
    if (!stored) {
      return {}
    }

    const parsed = JSON.parse(stored)
    return typeof parsed === 'object' && parsed !== null ? (parsed as ContentRemarksMap) : {}
  } catch {
    return {}
  }
}

function writeContentRemarks(remarks: ContentRemarksMap) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(CONTENT_REMARKS_STORAGE_KEY, JSON.stringify(remarks))
}

export function useContentRemark(noteId: string) {
  const [savedRemark, setSavedRemark] = useState('')
  const [draftRemark, setDraftRemark] = useState('')

  useEffect(() => {
    const nextRemark = readContentRemarks()[noteId] ?? ''
    setSavedRemark(nextRemark)
    setDraftRemark(nextRemark)
  }, [noteId])

  const hasRemark = savedRemark.trim().length > 0
  const isDirty = useMemo(
    () => draftRemark.trim() !== savedRemark.trim(),
    [draftRemark, savedRemark]
  )

  const saveRemark = () => {
    const nextRemarks = readContentRemarks()
    const trimmedDraft = draftRemark.trim()

    if (trimmedDraft) {
      nextRemarks[noteId] = trimmedDraft
    } else {
      delete nextRemarks[noteId]
    }

    writeContentRemarks(nextRemarks)
    setSavedRemark(trimmedDraft)
    setDraftRemark(trimmedDraft)
    toast.success(trimmedDraft ? '备注已保存' : '备注已清空')
  }

  return {
    draftRemark,
    hasRemark,
    isDirty,
    savedRemark,
    saveRemark,
    setDraftRemark,
  }
}
