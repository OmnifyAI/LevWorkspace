import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { DashboardLoad, HtmlWidget, QueryResult, Row, Widget, WidgetAction } from '../../../../shared/dashboard'
import { BOARDS_DIR, MAIN_BOARD } from '../../../../shared/dashboard'
import { HtmlPanel } from './HtmlPanel'
import type { AppState, Project } from '../../../../shared/types'
import { api, errorText } from '../../api'
import { Icon } from '../Icon'
import { ChartView, KpiView, ListView, MarkdownView, MediaView, PipelineView, TableView, type RunAction } from './Widgets'

export interface DashboardActions {
  openSession: (id: string) => void
  openFile: (rel: string) => void
  openView: (view: 'projects' | 'multi' | 'skills' | 'assets' | 'cli') => void
  /** 대시보드 빌더 에이전트에게 요청 */
  ask: (prompt: string) => Promise<void>
}

/** 소스별 기본 갱신: 앱 상태 기반은 live, 파일·git 은 15초마다 */
const INTERVAL_SOURCES = new Set(['git', 'file', 'files'])

export function DynamicDashboard(props: {
  state: AppState
  project: Project
  board: string
  actions: DashboardActions
  onDelete: () => Promise<void>
}): ReactNode {
  const { project, board } = props
  const [load, setLoad] = useState<DashboardLoad | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  // 이 보드 파일이나 이 보드가 쓰는 패널이 바뀌면(에이전트·에디터) 다시 읽는다.
  // 다른 보드만 바뀐 경우에는 도구 패널의 입력 상태를 지키려고 새로고침하지 않는다
  const panelsRef = useRef<string[]>([])
  useEffect(() => {
    let alive = true
    const read = (): void =>
      void api.getDashboard(project.id, board).then(
        (l) => {
          if (!alive) return
          setLoad(l)
          panelsRef.current = (l.spec?.widgets ?? []).flatMap((w) => (w.type === 'html' ? [w.src.replace(/^\.?\/+/, '')] : []))
        },
        (e) => alive && setLoad({ board, path: '', spec: null, issues: [{ message: errorText(e) }] })
      )
    read()
    const off = api.on('dashboard', (p: { projectId: string; files?: string[] }) => {
      if (p.projectId !== project.id) return
      const files = p.files ?? []
      const mine = !files.length || files.some((f) => f === `${BOARDS_DIR}/${board}.json` || panelsRef.current.includes(f) || !/^(boards|panels)\//.test(f))
      if (files.some((f) => f === `${BOARDS_DIR}/${board}.json`) || !files.length) read()
      if (mine) setReloadKey((k) => k + 1)
    })
    return () => {
      alive = false
      off()
    }
  }, [project.id, board])

  const run: RunAction = (a: WidgetAction, row?: Row) => {
    if (a.do === 'openSession') {
      const id = row?.[a.field ?? 'id']
      if (typeof id === 'string') props.actions.openSession(id)
    } else if (a.do === 'openFile') {
      const rel = a.path ?? row?.[a.field ?? 'rel']
      if (typeof rel === 'string') props.actions.openFile(rel)
    } else if (a.do === 'openView') props.actions.openView(a.view)
  }

  const spec = load?.spec
  const isTool = spec?.kind === 'tool'
  return (
    <div className={`dashboard ${isTool ? 'is-tool' : ''}`}>
      <div className="dash-head">
        <div className="grow min0">
          <div className="muted small row">
            <span className="tag">{isTool ? '도구' : '대시보드'}</span>
            <span className="ellipsis">{project.name}</span>
          </div>
          <h1 className="ellipsis">{spec?.title ?? (board === MAIN_BOARD ? '대시보드' : board)}</h1>
          {spec?.description && <div className="muted small">{spec.description}</div>}
        </div>
        <button className="icon-btn" aria-label="모든 위젯 새로고침" title="새로고침" onClick={() => setReloadKey((k) => k + 1)}>
          <Icon name="refresh" size={14} />
        </button>
        <button title="보드 정의 파일을 탭에서 열기" onClick={() => load?.path && props.actions.openFile(load.path)}>
          JSON 보기
        </button>
        {board !== MAIN_BOARD && (
          <button
            className="icon-btn danger"
            aria-label="이 보드 삭제"
            title="보드 파일을 휴지통으로 (패널·스크립트는 남김)"
            onClick={() => {
              if (confirm(`"${spec?.title ?? board}" 보드를 삭제할까요?\n보드 파일(${load?.path})만 휴지통으로 옮기고, 패널·스크립트 파일은 남깁니다.`)) void props.onDelete()
            }}
          >
            <Icon name="close" size={13} />
          </button>
        )}
      </div>

      <AskBar onAsk={props.actions.ask} tool={isTool} suggestions={spec?.suggestions} />

      {load?.issues.length ? (
        <div className="error-box">
          <strong>대시보드 파일 문제 ({load.path})</strong>
          {load.issues.map((i, n) => (
            <div key={n}>
              {i.widget ? `[${i.widget}] ` : ''}
              {i.message}
            </div>
          ))}
        </div>
      ) : null}

      {!load ? (
        <div className="muted">불러오는 중…</div>
      ) : spec ? (
        <div className="dash-grid">
          {spec.widgets.map((w) => (
            <WidgetCard key={`${w.id}:${JSON.stringify(w)}`} w={w} project={project} state={props.state} reloadKey={reloadKey} run={run} actions={props.actions} />
          ))}
          {!spec.widgets.length && <div className="muted">위젯이 없습니다. 위 입력창에 원하는 대시보드를 설명해 보세요.</div>}
        </div>
      ) : null}
    </div>
  )
}

function AskBar({ onAsk, tool, suggestions }: { onAsk: (prompt: string) => Promise<void>; tool: boolean; suggestions?: string[] }): ReactNode {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const submit = async (): Promise<void> => {
    const t = text.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      await onAsk(t)
      setText('')
      setMsg('대시보드 빌더에게 보냈어요. 진행 상황은 에이전트 목록의 "대시보드 빌더"에서 볼 수 있어요.')
    } catch (e) {
      setMsg(errorText(e))
    } finally {
      setBusy(false)
      setTimeout(() => setMsg(''), 6000)
    }
  }
  return (
    <form
      className="ask-bar"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Icon name="skills" size={15} />
      <label className="sr-only" htmlFor="dash-ask">
        대시보드 변경 요청
      </label>
      <input id="dash-ask" ref={inputRef} value={text} placeholder={tool ? '이 도구를 어떻게 바꿀까요? 예: 결과를 표로 보여주고 CSV 저장 버튼 추가' : '이 대시보드에 무엇을 추가하거나 바꿀까요? 예: CLI별 비용을 원 차트로 보여줘'} onChange={(e) => setText(e.target.value)} />
      <button className="primary sm" type="submit" disabled={!text.trim() || busy}>
        요청
      </button>
      {msg && <span className="ask-msg small muted">{msg}</span>}
      {suggestions && suggestions.length > 0 && (
        <div className="ask-suggest" aria-label="예시 요청">
          <span className="muted small">예시</span>
          {suggestions.slice(0, 6).map((s) => (
            <button
              key={s}
              type="button"
              className="chip ask-chip"
              onClick={() => {
                setText(s)
                inputRef.current?.focus()
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </form>
  )
}

/** 위젯 하나: 쿼리를 돌리고, 갱신 규칙에 따라 다시 돌리고, 오류는 이 카드에만 표시 */
function WidgetCard(props: { w: Widget; project: Project; state: AppState; reloadKey: number; run: RunAction; actions: DashboardActions }): ReactNode {
  const { w, project } = props
  if (w.type === 'html') return <HtmlCard {...props} w={w} />
  return <QueryCard {...props} />
}

/** HTML 패널 카드 — 데이터는 패널이 aw 브리지로 직접 가져온다 */
function HtmlCard(props: { w: HtmlWidget; project: Project; state: AppState; reloadKey: number; run: RunAction; actions: DashboardActions }): ReactNode {
  const { w } = props
  const span = Math.max(1, Math.min(12, w.w ?? 12))
  return (
    <section className={`widget widget-html ${span <= 4 ? 'w-small' : span <= 6 ? 'w-half' : ''}`} style={{ gridColumn: `span ${span}`, minHeight: w.minHeight }}>
      {(w.title || w.actions?.length) && (
        <div className="widget-head">
          <h2 className="grow ellipsis">{w.title}</h2>
          {w.actions?.map((a, i) => (
            <button key={i} className="link small" onClick={() => props.run(a)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div className="widget-body panel-body">
        <HtmlPanel w={w} project={props.project} state={props.state} reloadKey={props.reloadKey} actions={props.actions} />
      </div>
    </section>
  )
}

/** JSON(기본) 위젯 카드 */
function QueryCard(props: { w: Widget; project: Project; state: AppState; reloadKey: number; run: RunAction }): ReactNode {
  const { w, project } = props
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState('')
  const seq = useRef(0)
  const refresh = w.refresh ?? (w.query && INTERVAL_SOURCES.has(w.query.source) ? 15000 : 'live')

  const runQuery = (): void => {
    if (!w.query) return
    const my = ++seq.current
    api.query(project.id, w.query).then(
      (r) => {
        if (my !== seq.current) return
        setResult(r)
        setError('')
      },
      (e) => my === seq.current && setError(errorText(e))
    )
  }

  // 처음 + 새로고침
  useEffect(runQuery, [props.reloadKey, project.id])

  // live: 앱 상태가 바뀔 때 (스트리밍 중 과도한 호출을 막으려고 0.4초 모아서)
  useEffect(() => {
    if (refresh !== 'live') return
    const t = setTimeout(runQuery, 400)
    return () => clearTimeout(t)
  }, [props.state])

  // 숫자: 주기적으로
  useEffect(() => {
    if (typeof refresh !== 'number') return
    const t = setInterval(runQuery, Math.max(refresh, 2000))
    return () => clearInterval(t)
  }, [refresh])

  const rows = result?.rows ?? []
  const span = Math.max(1, Math.min(12, w.w ?? 12))
  const empty = !!w.query && result && !rows.length && w.type !== 'kpi'

  return (
    <section className={`widget ${span <= 4 ? 'w-small' : span <= 6 ? 'w-half' : ''} ${w.type === 'kpi' ? 'w-kpi' : ''}`} style={{ gridColumn: `span ${span}`, minHeight: w.minHeight }}>
      {(w.title || w.actions?.length) && (
        <div className="widget-head">
          <h2 className="grow ellipsis">{w.title}</h2>
          {w.actions?.map((a, i) => (
            <button key={i} className="link small" onClick={() => props.run(a)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div className="widget-body">
        {error ? (
          <div className="error-box small">
            <strong>{w.id}</strong>: {error}
          </div>
        ) : w.query && !result ? (
          <div className="muted small">불러오는 중…</div>
        ) : empty ? (
          <div className="muted">{w.empty ?? '데이터가 없습니다'}</div>
        ) : (
          <WidgetBody w={w} rows={rows} project={project} run={props.run} />
        )}
      </div>
    </section>
  )
}

function WidgetBody({ w, rows, project, run }: { w: Widget; rows: Row[]; project: Project; run: RunAction }): ReactNode {
  switch (w.type) {
    case 'kpi':
      return <KpiView w={w} rows={rows} />
    case 'table':
      return <TableView w={w} rows={rows} run={run} />
    case 'list':
      return <ListView w={w} rows={rows} run={run} />
    case 'chart':
      return <ChartView w={w} rows={rows} />
    case 'markdown':
      return <MarkdownView w={w} rows={rows} />
    case 'pipeline':
      return <PipelineView w={w} rows={rows} run={run} />
    case 'media':
      return <MediaView w={w} rows={rows} projectId={project.id} run={run} />
    case 'html':
      return null // HtmlCard 가 그린다
  }
}
