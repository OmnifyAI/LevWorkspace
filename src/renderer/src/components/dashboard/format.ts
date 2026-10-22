import type { ColorName, Format, Row } from '../../../../shared/dashboard'

const NAMED: Record<string, string> = {
  ok: 'var(--ok)',
  bad: 'var(--bad)',
  warn: 'var(--warn)',
  accent: 'var(--accent)',
  muted: 'var(--muted)'
}

/** 차트·파이에서 순서대로 쓰는 색 */
export const PALETTE = ['#8d96e8', '#3fbf8a', '#e5a94f', '#ef6b6b', '#b48ae8', '#4fb3e0', '#e07aa8', '#9ccc4a']

export function color(name: ColorName | undefined): string | undefined {
  if (!name) return undefined
  return NAMED[name] ?? (/^#[0-9a-f]{3,8}$/i.test(name) ? name : undefined)
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function formatValue(v: unknown, fmt: Format | undefined, now = Date.now()): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = typeof v === 'number' ? v : Number(v)
  switch (fmt) {
    case 'number':
      return isNaN(n) ? String(v) : n.toLocaleString(undefined, { maximumFractionDigits: 2 })
    case 'currency':
      return isNaN(n) ? String(v) : `$${n.toFixed(n !== 0 && Math.abs(n) < 0.1 ? 3 : 2)}`
    case 'percent':
      return isNaN(n) ? String(v) : `${(n * 100).toFixed(1)}%`
    case 'bytes':
      if (isNaN(n)) return String(v)
      return n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`
    case 'time': {
      if (isNaN(n)) return String(v)
      const d = new Date(n)
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    case 'datetime': {
      if (isNaN(n)) return String(v)
      const d = new Date(n)
      return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    case 'ago': {
      if (isNaN(n)) return String(v)
      const s = Math.floor((now - n) / 1000)
      return s < 60 ? '방금' : s < 3600 ? `${Math.floor(s / 60)}분 전` : s < 86400 ? `${Math.floor(s / 3600)}시간 전` : `${Math.floor(s / 86400)}일 전`
    }
    case 'elapsed': {
      if (isNaN(n)) return String(v)
      const s = Math.max(0, Math.floor((now - n) / 1000))
      return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`
    }
    default:
      if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
      if (typeof v === 'boolean') return v ? '예' : '아니오'
      return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
}

/** "{{field}}" 를 행의 값으로 바꾼다 */
export function fillTemplate(text: string, row: Row | undefined): string {
  return text.replace(/\{\{\s*([\w().]+)\s*\}\}/g, (_, k: string) => formatValue(row?.[k], undefined))
}

/** 날짜 묶음 키(2026-10-21)는 짧게 */
export function shortLabel(v: unknown): string {
  const s = String(v ?? '')
  const day = /^\d{4}-(\d{2})-(\d{2})$/.exec(s)
  if (day) return `${Number(day[1])}/${Number(day[2])}`
  const hour = /^\d{4}-\d{2}-\d{2} (\d{2}):00$/.exec(s)
  if (hour) return `${hour[1]}시`
  return s
}
