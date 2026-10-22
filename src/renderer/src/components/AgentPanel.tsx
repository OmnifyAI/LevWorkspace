import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { MODEL_HINTS, type AppState, type Project, type Session } from '../../../shared/types'
import { api } from '../api'
import { reloadMessages } from '../state'
import { useMessages } from '../state'
import { StatusDot } from '../ui'
import { Composer, MessageList, type SlashItem } from './Chat'
import { NewSessionModal, SessionSettingsModal, SpawnChildModal } from './SessionModals'
import { Icon } from './Icon'
import { ContextMenu } from './ContextMenu'

type Filter = 'all' | 'running' | 'error'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '전체' },
  { id: 'running', label: '실행 중' },
  { id: 'error', label: '오류' }
]

const STATUS_LABEL: Record<Session['status'], string> = { running: '실행 중', idle: '대기', error: '오류' }

/** 세션을 부모-자식 순서로 펼친 목록 (자식은 부모 바로 아래) */
function flatten(sessions: Session[]): { s: Session; depth: number }[] {
  const ids = new Set(sessions.map((s) => s.id))
  const kids = new Map<string, Session[]>()
  const roots: Session[] = []
  for (const s of [...sessions].sort((a, b) => b.createdAt - a.createdAt)) {
    if (s.parentId && ids.has(s.parentId)) kids.set(s.parentId, [...(kids.get(s.parentId) ?? []), s])
    else roots.push(s)
  }
  const out: { s: Session; depth: number }[] = []
  const walk = (s: Session, depth: number): void => {
    out.push({ s, depth })
    for (const c of (kids.get(s.id) ?? []).reverse()) walk(c, depth + 1)
  }
  roots.forEach((r) => walk(r, 0))
  return out
}

/** 왼쪽 슬림 사이드바: 대화할 에이전트 고르기 전용 */
export function AgentList(props: {
  state: AppState
  project: Project | undefined
  selectedId: string | undefined
  onSelect: (id: string) => void
  onHide: () => void
  /** 우클릭 메뉴: 대화 탭에서 / 떠 있는 창으로 열기 */
  onOpenChat?: (id: string) => void
  onOpenFloat?: (id: string) => void
}): ReactNode {
  const { state, project, selectedId, onSelect } = props
  const [filter, setFilter] = useState<Filter>('all')
  const [showNew, setShowNew] = useState(false)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [settingsId, setSettingsId] = useState<string | null>(null)
  const settingsSession = settingsId ? state.sessions.find((s) => s.id === settingsId) : undefined

  const openMenu = (e: MouseEvent | KeyboardEvent, id: string): void => {
    e.preventDefault()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = 'clientX' in e && e.clientX ? e.clientX : r.left + 24
    const y = 'clientY' in e && e.clientY ? e.clientY : r.bottom - 4
    setMenu({ id, x, y })
  }

  const rename = (s: Session, title: string): void => {
    setRenaming(null)
    const t = title.trim()
    if (t && t !== s.title) void api.updateSession(s.id, { title: t })
  }

  const remove = (s: Session): void => {
    const n = state.sessions.filter((x) => x.parentId === s.id).length
    if (confirm(`"${s.title}" 세션을 삭제할까요?${n ? `\n자식 세션 ${n}개도 함께 삭제됩니다.` : ''}`)) void api.removeSession(s.id)
  }

  const sessions = useMemo(() => state.sessions.filter((s) => s.projectId === project?.id), [state.sessions, project?.id])
  const rows = useMemo(() => {
    const visible = sessions.filter((s) => filter === 'all' || (filter === 'running' ? s.status === 'running' : s.status === 'error'))
    return flatten(visible)
  }, [sessions, filter])

  return (
    <aside className="agents-side" aria-labelledby="agents-title">
      <div className="agents-head">
        <h2 id="agents-title" className="grow">
          에이전트 <span className="muted count">{rows.length}</span>
        </h2>
        <button className="icon-btn" aria-label="새 세션" title="새 세션" disabled={!project} onClick={() => setShowNew(true)}>
          <Icon name="plus" />
        </button>
        <button className="icon-btn" aria-label="에이전트 목록 숨기기" title="목록 숨기기" onClick={props.onHide}>
          <Icon name="sidebar" />
        </button>
      </div>
      <div className="chips agents-filter">
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      <fieldset className="agent-list">
        <legend className="sr-only">대화할 에이전트 선택</legend>
        {rows.map(({ s, depth }) =>
          renaming === s.id ? (
            <div key={s.id} className="agent-row on" style={{ paddingLeft: 8 + depth * 16 }}>
              <span className={`agent-avatar av-${s.provider}`} aria-hidden="true">
                {s.provider[0].toUpperCase()}
              </span>
              <input
                autoFocus
                className="agent-rename"
                aria-label="세션 이름"
                defaultValue={s.title}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => rename(s, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') rename(s, e.currentTarget.value)
                  if (e.key === 'Escape') setRenaming(null)
                }}
              />
            </div>
          ) : (
          <label
            key={s.id}
            className={`agent-row ${s.id === selectedId ? 'on' : ''} ${menu?.id === s.id ? 'menu-open' : ''}`}
            style={{ paddingLeft: 8 + depth * 16 }}
            title={`${s.title}\n${s.provider} · ${STATUS_LABEL[s.status]}${s.model || s.cliModel ? ` · ${s.model || s.cliModel}` : ''}${s.costUsd ? ` · $${s.costUsd.toFixed(2)}` : ''}`}
            onContextMenu={(e) => openMenu(e, s.id)}
            onDoubleClick={(e) => {
              e.preventDefault()
              setRenaming(s.id)
            }}
          >
            <input
              type="radio"
              name="agent"
              className="sr-only"
              checked={s.id === selectedId}
              onChange={() => {}}
              onClick={() => onSelect(s.id)}
              onKeyDown={(e) => {
                if (e.key === 'F2') {
                  e.preventDefault()
                  setRenaming(s.id)
                }
              }}
            />
            <span className={`agent-avatar av-${s.provider}`} aria-hidden="true">
              {s.provider[0].toUpperCase()}
              <span className={`agent-status st-${s.status}`} />
            </span>
            <span className="agent-text">
              <span className="agent-title">
                {depth > 0 && <span className="muted">↳</span>}
                <span className="ellipsis">{s.title}</span>
              </span>
              <span className="agent-sub ellipsis">
                {STATUS_LABEL[s.status]}
                {s.costUsd ? ` · $${s.costUsd.toFixed(2)}` : ''}
                {s.multiRunId && ' · 멀티'}
              </span>
            </span>
          </label>
          )
        )}
        {!rows.length && <div className="muted small pad">{project ? '세션이 없습니다' : '프로젝트를 먼저 선택하세요'}</div>}
      </fieldset>

      {menu &&
        (() => {
          const s = sessions.find((x) => x.id === menu.id)
          if (!s) return null
          const running = s.status === 'running'
          return (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              label={`${s.title} 메뉴`}
              onClose={() => setMenu(null)}
              items={[
                { label: '이름 바꾸기', hint: 'F2', run: () => setRenaming(s.id) },
                { sep: true },
                { label: '대화 탭에서 열기', run: () => (props.onOpenChat ?? onSelect)(s.id) },
                ...(props.onOpenFloat ? [{ label: '떠 있는 창으로 열기', run: () => props.onOpenFloat!(s.id) }] : []),
                { label: '세션 설정', run: () => setSettingsId(s.id) },
                { sep: true },
                ...(running ? [{ label: '실행 중지', run: () => void api.stop(s.id) }] : []),
                {
                  label: '대화 초기화',
                  disabled: running,
                  run: () => {
                    if (confirm(`"${s.title}" 의 대화 기록을 지우고 새 CLI 세션으로 시작할까요?`)) void api.resetSession(s.id).then(() => reloadMessages(s.id))
                  }
                },
                { label: '삭제', danger: true, run: () => remove(s) }
              ]}
            />
          )
        })()}
      {settingsSession && <SessionSettingsModal state={state} session={settingsSession} onClose={() => setSettingsId(null)} />}

      {showNew && project && (
        <NewSessionModal
          state={state}
          project={project}
          onClose={() => setShowNew(false)}
          onCreated={(s) => {
            setShowNew(false)
            onSelect(s.id)
          }}
        />
      )}
    </aside>
  )
}

/** 가운데 "대화" 탭: 고른 에이전트와의 대화를 넓게 */
export function ChatPane(props: {
  state: AppState
  project: Project | undefined
  session: Session | undefined
  onSelect: (id: string) => void
  onOpenRun: (runId: string) => void
}): ReactNode {
  const [showNew, setShowNew] = useState(false)
  if (!props.session) {
    return (
      <div className="empty">
        <div className="empty-title">대화할 에이전트를 고르세요</div>
        <p className="muted">왼쪽 목록에서 에이전트를 고르거나 새 세션을 만드세요.</p>
        <button className="primary" disabled={!props.project} onClick={() => setShowNew(true)}>
          + 새 세션
        </button>
        {showNew && props.project && (
          <NewSessionModal
            state={props.state}
            project={props.project}
            onClose={() => setShowNew(false)}
            onCreated={(s) => {
              setShowNew(false)
              props.onSelect(s.id)
            }}
          />
        )}
      </div>
    )
  }
  return <ChatCard key={props.session.id} state={props.state} session={props.session} onSelect={props.onSelect} onOpenRun={props.onOpenRun} />
}

/** claude -p 에서는 동작하지 않는 대화형 전용 명령 — / 목록에서 뺀다 */
const INTERACTIVE_ONLY = new Set([
  'advisor', 'agents', 'auto-mode-setup', 'autocompact', 'color', 'config', 'context', 'design-consent', 'design-revoke',
  'effort', 'extra-usage', 'fast', 'focus', 'goal', 'heapdump', 'import', 'insights', 'list-agents', 'mcp', 'output-style',
  'recap', 'reload-plugins', 'reload-skills', 'rename', 'team-onboarding', 'ultrareview', 'usage', 'usage-credits'
])

/** 채팅 입력창의 / 명령: 앱 명령 + CLI 가 시작할 때 알려 준 명령·스킬 */
function useSlash(state: AppState, s: Session, open: (m: 'child' | 'settings') => void): SlashItem[] {
  const info = state.cliInfo?.[s.provider]
  const sessions = state.sessions
  const provider = state.providers.find((p) => p.id === s.provider)
  return useMemo(() => {
    const current = s.model || s.cliModel || provider?.model || ''
    const models = [
      'default',
      ...new Set(
        [current, info?.model, provider?.model, ...MODEL_HINTS[s.provider], ...sessions.filter((x) => x.provider === s.provider).flatMap((x) => [x.model, x.cliModel])].filter(
          (m): m is string => !!m
        )
      )
    ]
    const app: SlashItem[] = [
      {
        name: 'model',
        tag: '앱',
        desc: `모델 바꾸기 — 지금 ${current || 'CLI 기본값'}`,
        args: models,
        run: (arg) => {
          if (arg) void api.updateSession(s.id, { model: arg === 'default' ? '' : arg })
        }
      },
      {
        name: 'clear',
        tag: '앱',
        desc: '대화 초기화 (새 CLI 세션)',
        run: () => {
          if (s.status === 'running' || !confirm('대화 기록을 지우고 새 CLI 세션으로 시작할까요?')) return
          void api.resetSession(s.id).then(() => reloadMessages(s.id))
        }
      },
      { name: 'stop', tag: '앱', desc: '실행 중지', run: () => void api.stop(s.id) },
      { name: 'child', tag: '앱', desc: '자식 에이전트 만들기', run: () => open('child') },
      { name: 'settings', tag: '앱', desc: '세션 설정', run: () => open('settings') }
    ]
    // 이 프로젝트의 .skills 스킬: 부르면 에이전트가 그 SKILL.md 를 먼저 읽고 따르게 한다
    const project: SlashItem[] = state.skills
      .filter((k) => k.projectId === s.projectId && !app.some((a) => a.name === k.id))
      .map((k) => ({
        name: k.id,
        tag: '프로젝트',
        desc: k.description,
        run: (arg: string) =>
          void api.send(
            s.id,
            `이번 요청은 프로젝트 스킬 "${k.name}" 의 지침(.skills/${k.id}/SKILL.md)을 먼저 읽고 그대로 따라 주세요.${arg ? `

${arg}` : ''}`
          )
      }))
    const taken = new Set([...app, ...project].map((a) => a.name))
    const skills = new Set(info?.skills ?? [])
    const cli: SlashItem[] = (info?.commands ?? [])
      .filter((c) => !taken.has(c) && !INTERACTIVE_ONLY.has(c) && !c.startsWith('_'))
      .map((c) => ({ name: c, tag: skills.has(c) ? '스킬' : 'CLI' }))
      .sort((a, b) => Number(a.name.includes(':')) - Number(b.name.includes(':')) || a.name.localeCompare(b.name))
    return [...app, ...project, ...cli]
  }, [s.id, s.projectId, s.provider, s.model, s.cliModel, s.status, info, provider?.model, sessions, state.skills, open])
}

export function ChatCard(props: {
  state: AppState
  session: Session
  onSelect: (id: string) => void
  onOpenRun: (runId: string) => void
  /** 떠 있는 창: 좁은 모양 + 머리 줄 오른쪽에 창 버튼 */
  floating?: boolean
  headExtra?: ReactNode
}): ReactNode {
  const { state, session: s } = props
  const messages = useMessages(s.id)
  const [hideTools, setHideTools] = useState(false)
  const [modal, setModal] = useState<'child' | 'settings' | null>(null)
  const parent = s.parentId ? state.sessions.find((x) => x.id === s.parentId) : undefined
  const children = state.sessions.filter((x) => x.parentId === s.id)
  const running = s.status === 'running'
  const slash = useSlash(state, s, setModal)

  return (
    <section className={props.floating ? "chat-float-body" : "chat-main"} aria-label="대화">
      <div className="chat-head">
        <StatusDot status={s.status} />
        <div className="grow min0">
          <div className="chat-title ellipsis">{s.title}</div>
          <div className="muted small ellipsis">
            {s.provider}
            {(s.model || s.cliModel) && ` · ${s.model || s.cliModel}`}
            {s.costUsd ? ` · $${s.costUsd.toFixed(3)}` : ''}
          </div>
        </div>
        {running && (
          <button className="icon-btn danger" aria-label="실행 중지" title="중지" onClick={() => void api.stop(s.id)}>
            <Icon name="stop" />
          </button>
        )}
        <button className="icon-btn" aria-label="세션 설정" title="설정" onClick={() => setModal('settings')}>
          <Icon name="settings" />
        </button>
        {props.headExtra}
      </div>

      {(parent || children.length > 0 || s.multiRunId) && (
        <div className="relations small">
          {parent && (
            <span>
              부모 <button className="link" onClick={() => props.onSelect(parent.id)}>{parent.title}</button>
            </span>
          )}
          {children.length > 0 && (
            <span>
              자식{' '}
              {children.map((c) => (
                <button key={c.id} className="link child-link" onClick={() => props.onSelect(c.id)}>
                  <StatusDot status={c.status} /> {c.title}
                </button>
              ))}
            </span>
          )}
          {s.multiRunId && (
            <button className="link" onClick={() => props.onOpenRun(s.multiRunId!)}>
              멀티 실행 보드 →
            </button>
          )}
        </div>
      )}

      <MessageList messages={messages} running={running} hideTools={hideTools} compact={props.floating} />
      {s.status === 'error' && s.lastError && <div className="msg msg-error small inset">마지막 오류: {s.lastError}</div>}

      <Composer
        autoFocusKey={s.id}
        slash={slash}
        onSend={(t) => void api.send(s.id, t)}
        placeholder={running ? '실행 중 — 보내면 대기열에 추가 (Ctrl+Enter)' : '메시지 입력 · / 명령 (Ctrl+Enter 전송)'}
        footer={
          <>
            {s.queue.length > 0 && <span className="pill">대기 {s.queue.length}</span>}
            {(s.skillIds.length > 0 || s.assetIds.length > 0) && (
              <span className="muted small">
                스킬 {s.skillIds.length} · 첨부 {s.assetIds.length}
              </span>
            )}
            <label className="check small muted">
              <input type="checkbox" checked={hideTools} onChange={(e) => setHideTools(e.target.checked)} /> 도구 숨김
            </label>
          </>
        }
        actions={
          <>
            {parent && (
              <button className="sm" disabled={running} title="마지막 결과를 부모 세션에 전달" onClick={() => void api.reportToParent(s.id)}>
                ↑ 보고
              </button>
            )}
            <button className="sm" title="하위 에이전트 생성" onClick={() => setModal('child')}>
              ↳ 자식
            </button>
          </>
        }
      />

      {modal === 'child' && (
        <SpawnChildModal
          state={state}
          parent={s}
          onClose={() => setModal(null)}
          onCreated={(c) => {
            setModal(null)
            props.onSelect(c.id)
          }}
        />
      )}
      {modal === 'settings' && <SessionSettingsModal state={state} session={s} onClose={() => setModal(null)} />}
    </section>
  )
}
