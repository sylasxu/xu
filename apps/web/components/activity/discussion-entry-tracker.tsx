"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"

import { readClientToken } from "@/lib/client-auth"

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:1996"

export function DiscussionEntryTracker({
  activityId,
}: {
  activityId: string
}) {
  const searchParams = useSearchParams()
  const entry = searchParams.get("entry")
  const [authToken, setAuthToken] = useState<string | null>(null)

  useEffect(() => {
    const syncAuth = () => {
      setAuthToken(readClientToken())
    }

    syncAuth()
    window.addEventListener("focus", syncAuth)
    window.addEventListener("storage", syncAuth)
    window.addEventListener("xu-auth-updated", syncAuth)
    document.addEventListener("visibilitychange", syncAuth)

    return () => {
      window.removeEventListener("focus", syncAuth)
      window.removeEventListener("storage", syncAuth)
      window.removeEventListener("xu-auth-updated", syncAuth)
      document.removeEventListener("visibilitychange", syncAuth)
    }
  }, [])

  useEffect(() => {
    if (!authToken || !entry) {
      return
    }

    const storageKey = `xu:web:discussion-entered:${activityId}:${entry}`
    if (window.sessionStorage.getItem(storageKey) === "1") {
      return
    }

    void fetch(`${API_BASE}/ai/tasks/discussion-entered`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        activityId,
        entry,
      }),
    })
      .then((response) => {
        if (!response.ok) {
          return
        }

        window.sessionStorage.setItem(storageKey, "1")
      })
      .catch(() => {
        // best effort only
      })
  }, [activityId, authToken, entry])

  return null
}
