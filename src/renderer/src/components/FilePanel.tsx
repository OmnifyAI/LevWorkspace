import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { FsEntry, GitChange, Project, Session } from '../../../shared/types'
import { api, errorText } from '../api'
import { CODE_COLOR } from './FilePreview'
import { Icon } from './Icon'
import { ContextMenu } from './ContextMenu'

export function FilePanel(props: {
  project: Project | undefined
  git: GitChange[] | null
  /** git 상태가 바뀔 때마다 증가 — 열린 폴더를 다시 읽는다 */
  version: number
  activeFile: string | undefined
  onOpenFile: (rel: string) => void
  onRefresh: () => void
  /** 지금 대화 중인 세션 — 우클릭 "세션에 첨부" 대상 */
  session?: Session
}): ReactNode {
  const { project, git } = props
  const [dirs, setDirs] = useState<Record<string, FsEntry[]>>({})
  const [open, setOpen] = useState<Set<string>>(new Set(['']))
  const [filter, setFilter] = useState('')
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<{ e: FsEntry; x: number; y: number } | null>(null)
  const [notice, setNotice] = useState('')
  const flash = (t: string): void => {
    setNotice(t)
    setTimeout(() => setNotice(''), 2500)
  }

  const load = useCallback(
    async (rel: string) => {
      if (!project) return
      try {
        const list = await api.listDir(project.id, rel)
        setDirs((d) => ({ ...d, [rel]: list }))
      } catch (e) {
        if (!rel) setError(errorText(e))
      }
    },
    [project?.id]
  )

  // 프로젝트가 바뀌면 처음부터
  useEffect(() => {
    setDirs({})
    setOpen(new Set(['']))
    setError('')
    void load('')
  }, [project?.id])

  // 에이전트 작업 등으로 git 상태가 바뀌면 열린 폴더를 다시 읽는다
  useEffect(() => {
    if (props.version) for (const rel of open) void load(rel)
  }, [props.version])

  const codes = useMemo(() => {
    const m = new Map<string, GitChange['code']>()
    for (const g of git ?? []) m.set(g.rel, g.code)
    return m
  }, [git])
  const dirtyDirs = useMemo(() => {
    const s = new Set<string>()
    for (const g of git ?? []) {
      const parts = g.rel.split('/')
      for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join('/'))
    }
    return s
  }, [git])

  const toggle = (rel: string): void => {
    const next = new Set(open)
    if (next.has(rel)) next.delete(rel)
    else {
      next.add(rel)
      if (!dirs[rel]) void load(rel)
    }
    setOpen(next)
  }

  const rows: { e: FsEntry; depth: number }[] = []
  const q = filter.trim().toLowerCase()
  if (q) {
    // 필터 중에는 지금까지 읽은 파일을 평평하게 보여준다
    for (const list of Object.values(dirs)) for (const e of list) if (!e.dir && e.rel.toLowerCase().includes(q)) rows.push({ e, depth: 0 })
    rows.sort((a, b) => a.e.rel.localeCompare(b.e.rel))
  } else {
    const walk = (rel: string, depth: number): void => {
      for (const e of dirs[rel] ?? []) {
        rows.push({ e, depth })
        if (e.dir && open.has(e.rel)) walk(e.rel, depth + 1)
      }
    }
    walk('', 0)
  }

  return (
    <aside className="pane pane-right">
      <section className="bento tree-card" aria-label="파일 트리">
        <div className="bento-head">
          <div className="row">
            <h2 className="grow">파일</h2>
            <button className="icon-btn" aria-label="새로고침" title="새로고침" disabled={!project} onClick={props.onRefresh}>
              <Icon name="refresh" size={14} />
            </button>
          </div>
          <label className="search">
            <Icon name="search" size={13} />
            <span className="sr-only">파일 필터</span>
            <input placeholder="파일 필터 (열어 본 폴더 기준)" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        </div>
        <div className="file-tree mono">
          {error && <div className="error-box small">{error}</div>}
          {!project && <div className="muted small pad">프로젝트를 선택하세요</div>}
          {rows.map(({ e, depth }) => {
            const code = codes.get(e.rel)
            const color = code ? CODE_COLOR[code] : undefined
            return (
              <button
                key={e.rel}
                className={`tree-row ${props.activeFile === e.rel ? 'on' : ''}`}
                style={{ paddingLeft: 6 + depth * 14 }}
                title={e.rel}
                onClick={() => (e.dir ? toggle(e.rel) : props.onOpenFile(e.rel))}
                onContextMenu={(ev) => {
                  ev.preventDefault()
                  const r = ev.currentTarget.getBoundingClientRect()
                  setMenu({ e, x: ev.clientX || r.left + 24, y: ev.clientY || r.bottom - 4 })
                }}
              >
                {e.dir ? (
                  <>
                    <span className={`chev ${open.has(e.rel) ? 'open' : ''}`}>
                      <Icon name="chevron" size={11} />
                    </span>
                    <span className="folder-icon">
                      <Icon name="folder" size={14} />
                    </span>
                  </>
                ) : (
                  <>
                    <span className="chev" />
                    <span className="muted">
                      <Icon name="file" size={14} />
                    </span>
                  </>
                )}
                <span className="ellipsis grow" style={{ color }}>
                  {q ? e.rel : e.name}
                </span>
                {code && <span className="code-mark" style={{ color }}>{code}</span>}
                {e.dir && dirtyDirs.has(e.rel) && <span className="dirty-dot" />}
              </button>
            )
          })}
        </div>
      </section>

      <section className="bento changes-card" aria-labelledby="changes-title">
        <div className="row bento-head-tight">
          <h2 id="changes-title" className="grow">
            변경 사항 <span className="muted count">{git?.length ?? 0}</span>
          </h2>
        </div>
        <div className="changes-list">
          {!project ? (
            <div className="muted small pad">프로젝트를 선택하세요</div>
          ) : git === null ? (
            <div className="muted small pad">git 저장소가 아닙니다</div>
          ) : !git.length ? (
            <div className="muted small pad">변경된 파일이 없습니다</div>
          ) : (
            git.map((g) => {
              const parts = g.rel.split('/')
              const name = parts.pop()
              return (
                <button key={g.rel} className={`change-row ${props.activeFile === g.rel ? 'on' : ''}`} title={g.rel} onClick={() => props.onOpenFile(g.rel)}>
                  <span className="code-mark" style={{ color: CODE_COLOR[g.code] }}>
                    {g.code}
                  </span>
                  <span className="mono change-name">{name}</span>
                  <span className="mono muted change-dir ellipsis">{parts.join('/')}</span>
                </button>
              )
            })
          )}
        </div>
      </section>
      {notice && <div className="tree-notice small" role="status">{notice}</div>}
      {menu && project && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={`${menu.e.name} 메뉴`}
          onClose={() => setMenu(null)}
          items={[
            ...(menu.e.dir
              ? [{ label: open.has(menu.e.rel) ? '접기' : '펼치기', run: () => toggle(menu.e.rel) }]
              : [
                  { label: '열기', run: () => props.onOpenFile(menu.e.rel) },
                  {
                    label: props.session ? `"${props.session.title}" 세션에 첨부` : '세션에 첨부 (세션을 먼저 고르세요)',
                    disabled: !props.session,
                    run: () => {
                      const s = props.session!
                      void api.attachFile(s.id, menu.e.rel).then(() => flash(`"${s.title}" 에 첨부했습니다`), (err) => flash(errorText(err)))
                    }
                  }
                ]),
            { sep: true as const },
            { label: '경로 복사', run: () => void navigator.clipboard.writeText(menu.e.rel).then(() => flash('경로를 복사했습니다')) },
            { label: '폴더에서 보기', run: () => void api.revealFile(project.id, menu.e.rel) }
          ]}
        />
      )}
    </aside>
  )
}
