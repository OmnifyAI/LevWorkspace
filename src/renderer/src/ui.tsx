import { useEffect, type ReactNode } from 'react'
import type { AppState, ProviderId, SessionStatus } from '../../shared/types'
import { PROVIDER_IDS } from '../../shared/types'

export const PROVIDER_COLORS: Record<ProviderId, string> = {
  claude: '#d97757',
  codex: '#10a37f',
  gemini: '#4c8df6'
}

export function ProviderBadge({ id }: { id: ProviderId }): ReactNode {
  return (
    <span className="badge" style={{ borderColor: PROVIDER_COLORS[id], color: PROVIDER_COLORS[id] }}>
      {id}
    </span>
  )
}

export function StatusDot({ status }: { status: SessionStatus }): ReactNode {
  return <span className={`dot dot-${status}`} title={status} />
}

export function ProviderSelect(props: {
  state: AppState
  value: ProviderId
  onChange: (v: ProviderId) => void
}): ReactNode {
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value as ProviderId)}>
      {PROVIDER_IDS.map((id) => {
        const p = props.state.providers.find((x) => x.id === id)
        const st = props.state.providerStatus[id]
        const suffix = !p?.enabled ? ' (꺼짐)' : st && !st.available ? ' (미설치)' : ''
        return (
          <option key={id} value={id}>
            {p?.label ?? id}
            {suffix}
          </option>
        )
      })}
    </select>
  )
}

export function Modal(props: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }): ReactNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className={`modal ${props.wide ? 'modal-wide' : ''}`}>
        <div className="modal-head">
          <h3>{props.title}</h3>
          <button className="ghost" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-foot">{props.footer}</div>}
      </div>
    </div>
  )
}

export function Field(props: { label: string; hint?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  )
}

/** 체크박스 목록으로 id 다중 선택 */
export function MultiPick(props: {
  items: { id: string; label: string; sub?: string }[]
  value: string[]
  onChange: (v: string[]) => void
  empty: string
}): ReactNode {
  if (!props.items.length) return <div className="muted small">{props.empty}</div>
  return (
    <div className="pick-list">
      {props.items.map((it) => (
        <label key={it.id} className="pick-item">
          <input
            type="checkbox"
            checked={props.value.includes(it.id)}
            onChange={(e) =>
              props.onChange(e.target.checked ? [...props.value, it.id] : props.value.filter((x) => x !== it.id))
            }
          />
          <span>{it.label}</span>
          {it.sub && <span className="muted small">{it.sub}</span>}
        </label>
      ))}
    </div>
  )
}

export function Empty(props: { title: string; children?: ReactNode }): ReactNode {
  return (
    <div className="empty">
      <div className="empty-title">{props.title}</div>
      {props.children}
    </div>
  )
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function timeAgo(t: number): string {
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return '방금'
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  return new Date(t).toLocaleDateString()
}
