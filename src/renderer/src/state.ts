import { useEffect, useSyncExternalStore } from 'react'
import type { AppState, Message } from '../../shared/types'
import { api } from './api'

// ───────── 앱 상태 (메인 프로세스가 변경 시마다 스냅샷을 보낸다)

let state: AppState | null = null
const listeners = new Set<() => void>()
const notify = (): void => listeners.forEach((l) => l())

api.on('state', (s: AppState) => {
  state = s
  notify()
})
void api.getState().then((s) => {
  state ??= s
  notify()
})

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useAppState(): AppState | null {
  return useSyncExternalStore(subscribe, () => state)
}

// ───────── 세션 메시지 (필요할 때 불러오고 이후는 이벤트로 갱신)

const cache = new Map<string, Message[]>()
const msgListeners = new Map<string, Set<() => void>>()
const loading = new Set<string>()
const EMPTY: Message[] = []

function notifyMsgs(sessionId: string): void {
  msgListeners.get(sessionId)?.forEach((l) => l())
}

api.on('message', (m: Message) => {
  const arr = cache.get(m.sessionId)
  if (!arr) return
  const i = arr.findIndex((x) => x.id === m.id)
  cache.set(m.sessionId, i >= 0 ? arr.map((x, j) => (j === i ? m : x)) : [...arr, m])
  notifyMsgs(m.sessionId)
})

export function reloadMessages(sessionId: string): void {
  if (loading.has(sessionId)) return
  loading.add(sessionId)
  void api.messages(sessionId).then((ms) => {
    loading.delete(sessionId)
    cache.set(sessionId, ms)
    notifyMsgs(sessionId)
  })
}

export function useMessages(sessionId: string | undefined): Message[] {
  useEffect(() => {
    if (sessionId && !cache.has(sessionId)) reloadMessages(sessionId)
  }, [sessionId])
  return useSyncExternalStore(
    (l) => {
      if (!sessionId) return () => {}
      let set = msgListeners.get(sessionId)
      if (!set) msgListeners.set(sessionId, (set = new Set()))
      set.add(l)
      return () => set.delete(l)
    },
    () => (sessionId ? (cache.get(sessionId) ?? EMPTY) : EMPTY)
  )
}
