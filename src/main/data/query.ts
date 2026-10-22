import type { AggSpec, Cond, Query, QueryResult, Row } from '../../shared/dashboard'
import type { Workspace } from '../workspace'
import { getSource, SOURCES } from './sources'

const MAX_ROWS = 2000

function sinceToMs(since: string): number {
  const now = Date.now()
  if (since === 'today') {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const m = /^(\d+)\s*(m|h|d|w)$/.exec(since.trim())
  if (!m) throw new Error(`since 형식이 잘못되었습니다: "${since}" (예: 1h, 24h, today, 7d, 30d)`)
  const unit = { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[m[2] as 'm' | 'h' | 'd' | 'w']
  return now - Number(m[1]) * unit
}

function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

function matches(row: Row, where: Record<string, Cond> | undefined): boolean {
  if (!where) return true
  for (const [field, cond] of Object.entries(where)) {
    const v = row[field]
    if (cond === null || typeof cond !== 'object') {
      if (v !== cond) return false
      continue
    }
    if ('eq' in cond && v !== cond.eq) return false
    if ('ne' in cond && v === cond.ne) return false
    if (cond.in && !cond.in.includes(v)) return false
    if (cond.gt !== undefined && !(cmp(v, cond.gt) > 0)) return false
    if (cond.gte !== undefined && !(cmp(v, cond.gte) >= 0)) return false
    if (cond.lt !== undefined && !(cmp(v, cond.lt) < 0)) return false
    if (cond.lte !== undefined && !(cmp(v, cond.lte) <= 0)) return false
    if (cond.contains !== undefined && !String(v ?? '').toLowerCase().includes(cond.contains.toLowerCase())) return false
    if (cond.exists !== undefined && (v !== null && v !== undefined && v !== '') !== cond.exists) return false
  }
  return true
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** "day(at)" 같은 묶음 키 → 값 */
function keyValue(row: Row, key: string): unknown {
  const m = /^(hour|day|week|month)\((\w+)\)$/.exec(key)
  if (!m) return row[key]
  const t = row[m[2]]
  if (typeof t !== 'number') return null
  const d = new Date(t)
  if (m[1] === 'hour') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`
  if (m[1] === 'day') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  if (m[1] === 'month') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`
}

function aggregate(rows: Row[], spec: AggSpec): number | null {
  const rs = spec.where ? rows.filter((r) => matches(r, spec.where)) : rows
  if (spec.op === 'count') return rs.length
  if (!spec.field) throw new Error(`${spec.op} 에는 field 가 필요합니다`)
  // 참/거짓은 1/0 으로 — avg(ok) 가 곧 성공률이 된다
  const nums = rs
    .map((r) => r[spec.field!])
    .map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v))
    .filter((v): v is number => typeof v === 'number')
  if (!nums.length) return spec.op === 'sum' ? 0 : null
  if (spec.op === 'sum') return nums.reduce((a, b) => a + b, 0)
  if (spec.op === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length
  if (spec.op === 'min') return Math.min(...nums)
  return Math.max(...nums)
}

/** 날짜 묶음에서 빈 날도 0으로 채워 추이 차트가 끊기지 않게 한다 */
function fillDays(rows: Row[], key: string, since: number | undefined, aggKeys: string[]): Row[] {
  if (!/^day\(/.test(key) || since === undefined) return rows
  const byKey = new Map(rows.map((r) => [r[key], r]))
  const out: Row[] = []
  const d = new Date(since)
  d.setHours(0, 0, 0, 0)
  const end = Date.now()
  for (; d.getTime() <= end; d.setDate(d.getDate() + 1)) {
    const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    out.push(byKey.get(k) ?? { [key]: k, ...Object.fromEntries(aggKeys.map((a) => [a, 0])) })
  }
  return out
}

export async function runQuery(ws: Workspace, q: Query, defaultProjectId?: string): Promise<QueryResult> {
  if (!q || typeof q.source !== 'string') throw new Error('query.source 가 필요합니다')
  const src = getSource(q.source)
  if (!src) throw new Error(`알 수 없는 소스: "${q.source}" (가능: ${SOURCES.map((s) => s.name).join(', ')})`)
  for (const p of src.params ?? []) if (p.required && !q.params?.[p.name]) throw new Error(`${src.name} 소스에는 params.${p.name} 이 필요합니다`)

  const pids =
    q.project === 'all' ? ws.store.db.projects.map((p) => p.id) : [q.project ?? defaultProjectId].filter((x): x is string => !!x)
  if (!pids.length && src.name !== 'providers') throw new Error('프로젝트가 지정되지 않았습니다 (query.project 또는 현재 프로젝트)')
  let rows = await src.rows(ws, pids, q.params ?? {})

  let since: number | undefined
  if (q.since) {
    if (!src.timeField) throw new Error(`${src.name} 소스는 since 를 지원하지 않습니다`)
    since = sinceToMs(q.since)
    rows = rows.filter((r) => typeof r[src.timeField!] === 'number' && (r[src.timeField!] as number) >= since!)
  }
  rows = rows.filter((r) => matches(r, q.where))
  const total = rows.length

  const groupKeys = q.groupBy ? (Array.isArray(q.groupBy) ? q.groupBy : [q.groupBy]) : []
  const agg = q.agg ?? (groupKeys.length ? { count: { op: 'count' as const } } : undefined)
  if (groupKeys.length) {
    const groups = new Map<string, { key: Row; rows: Row[] }>()
    for (const r of rows) {
      const key: Row = {}
      for (const k of groupKeys) key[k] = keyValue(r, k)
      const id = JSON.stringify(key)
      if (!groups.has(id)) groups.set(id, { key, rows: [] })
      groups.get(id)!.rows.push(r)
    }
    rows = [...groups.values()].map((g) => ({ ...g.key, ...Object.fromEntries(Object.entries(agg!).map(([name, spec]) => [name, aggregate(g.rows, spec)])) }))
    if (groupKeys.length === 1) {
      rows.sort((a, b) => cmp(a[groupKeys[0]], b[groupKeys[0]]))
      rows = fillDays(rows, groupKeys[0], since, Object.keys(agg!))
    }
  } else if (agg) {
    rows = [Object.fromEntries(Object.entries(agg).map(([name, spec]) => [name, aggregate(rows, spec)]))]
  }

  for (const s of [...(q.sort ? (Array.isArray(q.sort) ? q.sort : [q.sort]) : [])].reverse()) {
    if (typeof s !== 'string') throw new Error(`sort 는 필드 이름 문자열(내림차순은 "-필드")이나 그 배열입니다: ${JSON.stringify(s)}`)
    const desc = s.startsWith('-')
    const field = desc ? s.slice(1) : s
    rows = [...rows].sort((a, b) => (desc ? -1 : 1) * cmp(a[field], b[field]))
  }
  if (q.select) rows = rows.map((r) => Object.fromEntries(q.select!.map((k) => [k, r[k]])))
  rows = rows.slice(0, Math.min(q.limit ?? MAX_ROWS, MAX_ROWS))

  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  return { rows, columns, total }
}
