import { useEffect, useId, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  ChartWidget,
  KpiWidget,
  ListWidget,
  MarkdownWidget,
  MediaWidget,
  PipelineWidget,
  Row,
  TableWidget,
  WidgetAction
} from '../../../../shared/dashboard'
import { VIDEO_EXT } from '../../../../shared/dashboard'
import type { ProviderId } from '../../../../shared/types'
import { fileUrl } from '../../api'
import { PROVIDER_COLORS, ProviderBadge } from '../../ui'
import { Icon } from '../Icon'
import { color, fillTemplate, formatValue, PALETTE, shortLabel } from './format'

export type RunAction = (action: WidgetAction, row?: Row) => void

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [enabled])
  return now
}

const isProvider = (v: unknown): v is ProviderId => v === 'claude' || v === 'codex' || v === 'gemini'

/** 행 동작이 실제로 할 일이 있는지 (열기 대상 값이 있는지) */
function actionable(a: WidgetAction | undefined, row: Row): boolean {
  if (!a) return false
  if (a.do === 'openSession') return !!row[a.field ?? 'id']
  if (a.do === 'openFile') return !!(a.path ?? row[a.field ?? 'rel'])
  return true
}

// ───────────────────────── KPI

export function KpiView({ w, rows }: { w: KpiWidget; rows: Row[] }): ReactNode {
  const row = rows[0]
  const key = w.value ?? Object.keys(row ?? {})[0]
  const v = row?.[key]
  const warn = typeof v === 'number' && w.warnAbove !== undefined && v >= w.warnAbove
  return (
    <div className="w-kpi">
      <div className={`kpi-value ${warn ? 'warn-text' : ''}`}>{formatValue(v ?? 0, w.format ?? 'number')}</div>
      {w.sub && <div className="muted small ellipsis">{fillTemplate(w.sub, row)}</div>}
    </div>
  )
}

// ───────────────────────── 표

function Cell({ v, col, now }: { v: unknown; col: TableWidget['columns'][number]; now: number }): ReactNode {
  if (col.format === 'badge' && isProvider(v)) return <ProviderBadge id={v} />
  const text = formatValue(v, col.format, now)
  const c = col.colors ? color(col.colors[String(v)]) : undefined
  return (
    <span className={col.format === 'code' ? 'mono small step' : undefined} style={c ? { color: c, fontWeight: 600 } : undefined}>
      {text}
    </span>
  )
}

export function TableView({ w, rows, run }: { w: TableWidget; rows: Row[]; run: RunAction }): ReactNode {
  const now = useNow(w.columns.some((c) => c.format === 'elapsed' || c.format === 'ago'))
  return (
    <div className="table-wrap">
      <table className="run-table">
        <thead>
          <tr>
            {w.columns.map((c) => (
              <th key={c.field} className={c.align === 'right' ? 'num' : undefined}>
                {c.label ?? c.field}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const clickable = actionable(w.rowAction, r)
            return (
              <tr key={i} className={clickable ? 'clickable' : undefined} onClick={clickable ? () => run(w.rowAction!, r) : undefined}>
                {w.columns.map((c) => (
                  <td key={c.field} className={`${c.align === 'right' ? 'num mono' : ''} ellipsis`}>
                    <Cell v={r[c.field]} col={c} now={now} />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ───────────────────────── 목록

export function ListView({ w, rows, run }: { w: ListWidget; rows: Row[]; run: RunAction }): ReactNode {
  const now = useNow(w.timeFormat === 'ago' || w.timeFormat === 'elapsed')
  return (
    <div className="activity">
      {rows.map((r, i) => {
        const dot = w.dot ? (color(w.dot.colors[String(r[w.dot.field])]) ?? 'var(--muted)') : undefined
        const clickable = actionable(w.rowAction, r)
        const text = (
          <>
            <span className="ellipsis">{formatValue(r[w.primary], undefined)}</span>
            {w.secondary && <span className="muted small ellipsis">{formatValue(r[w.secondary], undefined)}</span>}
          </>
        )
        return (
          <div key={i} className={`activity-row ${w.time ? '' : 'no-time'}`}>
            {w.time && <span className="mono small muted">{formatValue(r[w.time], w.timeFormat ?? 'time', now)}</span>}
            <span className="dot" style={{ background: dot ?? 'var(--line)' }} />
            {clickable ? (
              <button className="link activity-text list-text" onClick={() => run(w.rowAction!, r)}>
                {text}
              </button>
            ) : (
              <span className="activity-text list-text">{text}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ───────────────────────── 차트 (SVG 직접 그림)

export function ChartView({ w, rows }: { w: ChartWidget; rows: Row[] }): ReactNode {
  const values = rows.map((r) => (typeof r[w.y] === 'number' ? (r[w.y] as number) : Number(r[w.y]) || 0))
  const labels = rows.map((r) => shortLabel(r[w.x]))
  const main = color(w.color) ?? 'var(--accent)'
  const gid = `g${useId().replace(/:/g, '')}`

  if (w.chart === 'pie') {
    const total = values.reduce((a, b) => a + b, 0) || 1
    let acc = 0
    const R = 40
    const C = 2 * Math.PI * R
    // 조각 사이에 작은 틈 (조각이 하나면 틈 없이)
    const gap = values.filter((v) => v > 0).length > 1 ? 1.6 : 0
    return (
      <div className="w-pie">
        <svg viewBox="0 0 100 100" className="pie-svg" role="img" aria-label={w.title ?? '원 차트'}>
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--bg-3)" strokeWidth="10" />
          {values.map((v, i) => {
            const len = (v / total) * C
            const el = len > 0 && (
              <circle
                key={i}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={PALETTE[i % PALETTE.length]}
                strokeWidth="10"
                strokeDasharray={`${Math.max(len - gap, 0.01)} ${C - Math.max(len - gap, 0.01)}`}
                strokeDashoffset={-acc}
                transform="rotate(-90 50 50)"
              >
                <title>{`${labels[i]}: ${formatValue(v, w.format ?? 'number')}`}</title>
              </circle>
            )
            acc += len
            return el
          })}
          <text x="50" y="47" textAnchor="middle" className="pie-total">
            {formatValue(values.reduce((a, b) => a + b, 0), w.format ?? 'number')}
          </text>
          <text x="50" y="59" textAnchor="middle" className="pie-caption">
            합계
          </text>
        </svg>
        <div className="legend">
          {labels.map((l, i) => (
            <div key={i} className="legend-row">
              <span className="dot" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="ellipsis grow">{l}</span>
              <span className="mono small">{formatValue(values[i], w.format ?? 'number')}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const W = 600
  const H = 200
  const PAD = { l: 8, r: 8, t: 16, b: 26 }
  const max = Math.max(...values, 0) || 1
  const step = (W - PAD.l - PAD.r) / Math.max(values.length, 1)
  const y = (v: number): number => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max)
  const every = Math.ceil(values.length / 10)

  return (
    <div className="w-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="chart-svg" role="img" aria-label={w.title ?? '차트'}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={main} stopOpacity={w.chart === 'bar' ? 0.95 : 0.28} />
            <stop offset="100%" stopColor={main} stopOpacity={w.chart === 'bar' ? 0.45 : 0} />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + (H - PAD.t - PAD.b) * f} y2={PAD.t + (H - PAD.t - PAD.b) * f} stroke="var(--card-line)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
        {w.chart === 'bar' ? (
          values.map((v, i) => {
            const h = H - PAD.b - y(v)
            const bw = step * 0.56
            return (
              <rect key={i} x={PAD.l + i * step + (step - bw) / 2} y={y(v)} width={bw} height={Math.max(h, v > 0 ? 2 : 0)} rx={Math.min(6, bw / 2)} fill={`url(#${gid})`}>
                <title>{`${labels[i]}: ${formatValue(v, w.format ?? 'number')}`}</title>
              </rect>
            )
          })
        ) : (
          <>
            <polygon
              fill={`url(#${gid})`}
              points={[
                `${PAD.l + step / 2},${H - PAD.b}`,
                ...values.map((v, i) => `${PAD.l + i * step + step / 2},${y(v)}`),
                `${PAD.l + (values.length - 1) * step + step / 2},${H - PAD.b}`
              ].join(' ')}
            />
            <polyline
              fill="none"
              stroke={main}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              points={values.map((v, i) => `${PAD.l + i * step + step / 2},${y(v)}`).join(' ')}
            />
          </>
        )}
      </svg>
      <div className="chart-labels" style={{ gridTemplateColumns: `repeat(${Math.max(values.length, 1)}, minmax(0, 1fr))` }}>
        {labels.map((l, i) => (
          <span key={i} className="muted small ellipsis" title={`${l}: ${formatValue(values[i], w.format ?? 'number')}`}>
            {i % every === 0 ? l : ''}
          </span>
        ))}
      </div>
      <div className="muted small">
        최대 {formatValue(Math.max(...values, 0), w.format ?? 'number')} · 합계 {formatValue(values.reduce((a, b) => a + b, 0), w.format ?? 'number')}
      </div>
    </div>
  )
}

// ───────────────────────── 마크다운

export function MarkdownView({ w, rows }: { w: MarkdownWidget; rows: Row[] }): ReactNode {
  return (
    <div className="markdown w-markdown">
      <Markdown remarkPlugins={[remarkGfm]}>{fillTemplate(w.text, rows[0])}</Markdown>
    </div>
  )
}

// ───────────────────────── 이미지 · GIF · 동영상

function mediaUrl(projectId: string, src: string): string {
  return /^https:\/\//i.test(src) ? src : fileUrl(projectId, src.replace(/^\.?\/+/, ''))
}

function MediaItem(props: { w: MediaWidget; projectId: string; src: string; caption?: string; height: number; onOpen?: () => void }): ReactNode {
  const { w } = props
  const [failed, setFailed] = useState(false)
  const video = w.kind ? w.kind === 'video' : VIDEO_EXT.test(props.src)
  const url = mediaUrl(props.projectId, props.src)
  const style = { height: props.height, objectFit: w.fit ?? 'cover' } as const
  return (
    <figure className="media-item">
      {failed ? (
        <div className="media-missing muted small" style={{ height: props.height }}>
          불러올 수 없음
          <span className="mono">{props.src}</span>
        </div>
      ) : video ? (
        <video
          src={url}
          style={style}
          controls={w.controls ?? !w.autoplay}
          autoPlay={w.autoplay}
          muted={w.autoplay}
          loop={w.loop ?? w.autoplay}
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
        />
      ) : (
        <img src={url} alt={props.caption ?? props.src} style={style} loading="lazy" onError={() => setFailed(true)} onClick={props.onOpen} className={props.onOpen ? 'clickable' : undefined} />
      )}
      {props.caption && <figcaption className="muted small ellipsis">{props.caption}</figcaption>}
    </figure>
  )
}

export function MediaView({ w, rows, projectId, run }: { w: MediaWidget; rows: Row[]; projectId: string; run: RunAction }): ReactNode {
  if (w.src) {
    return <MediaItem w={w} projectId={projectId} src={w.src} caption={w.caption} height={w.height ?? 260} />
  }
  const items = rows.map((r) => ({ src: String(r[w.srcField ?? 'rel'] ?? ''), caption: w.captionField ? String(r[w.captionField] ?? '') : undefined })).filter((x) => x.src)
  return (
    <div className="media-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(w.columns ?? 3, 8))}, minmax(0, 1fr))` }}>
      {items.map((it) => (
        <MediaItem
          key={it.src}
          w={w}
          projectId={projectId}
          src={it.src}
          caption={it.caption}
          height={w.height ?? 140}
          onOpen={/^https:/i.test(it.src) ? undefined : () => run({ do: 'openFile', path: it.src })}
        />
      ))}
    </div>
  )
}

// ───────────────────────── 멀티 실행 단계

const STEP_LABEL: Record<string, string> = { done: '완료', running: '실행 중', error: '오류', waiting: '대기' }

export function PipelineView({ rows, run }: { w: PipelineWidget; rows: Row[]; run: RunAction }): ReactNode {
  const pipeline = rows[0]?.mode === 'pipeline'
  return (
    <div className="pipeline">
      {rows.map((r, i) => {
        const state = String(r.state ?? 'waiting')
        return (
          <div key={i} className="pipe-step-wrap">
            <button className={`pipe-step ${state}`} disabled={!r.sessionId} onClick={() => run({ do: 'openSession', field: 'sessionId' }, r)}>
              <span className="row">
                <span className="mono small muted">{String(r.key ?? i + 1)}</span>
                <span className="strong grow ellipsis">{String(r.role ?? '')}</span>
                {isProvider(r.provider) && <ProviderBadge id={r.provider} />}
              </span>
              <span className={`small step-${state}`}>{STEP_LABEL[state] ?? state}</span>
              <span className="bar">
                <span className={`bar-fill ${state}`} style={state === 'done' || state === 'error' ? undefined : { background: isProvider(r.provider) ? PROVIDER_COLORS[r.provider] : undefined }} />
              </span>
            </button>
            {pipeline && i < rows.length - 1 && (
              <span className="pipe-arrow">
                <Icon name="arrow" size={16} />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
