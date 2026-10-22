import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppState, GitChange, Project } from '../../shared/types'
import { BUILDER_ARGS } from '../../shared/types'
import type { BoardInfo, BoardKind } from '../../shared/dashboard'
import { DASHBOARD_DIR, MAIN_BOARD } from '../../shared/dashboard'
import { boardIcon, BoardsMenu, NewBoardModal } from './components/BoardsMenu'
import { api } from './api'
import { AgentList, ChatPane } from './components/AgentPanel'
import { FloatingChat } from './components/FloatingChat'
import { DynamicDashboard } from './components/dashboard/DynamicDashboard'
import { FilePanel } from './components/FilePanel'
import { FilePreviewView } from './components/FilePreview'
import { Icon } from './components/Icon'
import { ContextMenu } from './components/ContextMenu'
import { useAppState } from './state'
import { AssetsView } from './views/AssetsView'
import { CliView } from './views/CliView'
import { MultiView } from './views/MultiView'
import { ProjectsView } from './views/ProjectsView'
import { SkillsView } from './views/SkillsView'
import { PermissionsView } from './views/PermissionsView'
import { McpView } from './views/McpView'
import { GitView } from './views/GitView'
import { PermissionPrompt } from './components/PermissionPrompt'

/** 가운데 탭으로 여는 화면. 'sessions' 는 왼쪽 패널의 세션 선택을 뜻한다 */
export type View = 'projects' | 'sessions' | 'multi' | 'git' | 'skills' | 'assets' | 'mcp' | 'cli' | 'permissions'

export interface Focus {
  sessionId?: string
  runId?: string
}

export interface ViewProps {
  state: AppState
  project: Project | undefined
  focus: Focus
  go: (view: View, focus?: Focus) => void
  /** 프로젝트 파일을 가운데 탭으로 연다 */
  openFile: (rel: string) => void
}

type TabView = Exclude<View, 'sessions'>

type Tab =
  | { key: string; kind: 'chat' }
  | { key: string; kind: 'board'; board: string }
  | { key: string; kind: 'view'; view: TabView; focus: Focus }
  | { key: string; kind: 'file'; rel: string }

const VIEW_META: Record<TabView, { label: string; icon: string; needsProject: boolean }> = {
  projects: { label: '프로젝트', icon: 'projects', needsProject: false },
  multi: { label: '멀티 에이전트', icon: 'multi', needsProject: true },
  git: { label: 'Git', icon: 'branch', needsProject: true },
  skills: { label: '스킬', icon: 'skills', needsProject: true },
  assets: { label: '에셋', icon: 'assets', needsProject: true },
  mcp: { label: 'MCP 서버', icon: 'plug', needsProject: false },
  cli: { label: 'CLI 연결', icon: 'cli', needsProject: false },
  permissions: { label: '권한', icon: 'shield', needsProject: false }
}

/** 왼쪽 내비게이션: 화면 이동 (보드 메뉴는 따로) */
// 멀티 에이전트(에이전트끼리 aw_send_message 로 대화)와 에셋(오른쪽 파일 트리에서 첨부)은 메뉴에서 뺐다. 링크·aw.openView 로는 여전히 열린다
const NAV_MAIN: TabView[] = ['projects', 'git', 'skills']
const NAV_FOOT: TabView[] = ['mcp', 'cli', 'permissions']

const PANEL = {
  left: { min: 200, def: 248, max: 400 },
  right: { min: 220, def: 280 },
  center: 480,
  handles: 12
}

export default function App(): ReactNode {
  const state = useAppState()
  if (!state) return <div className="boot">불러오는 중…</div>
  const project = state.projects.find((p) => p.id === state.settings.lastProjectId) ?? state.projects[0]
  // 프로젝트가 바뀌면 탭·선택 상태를 새로 시작. 권한 확인 창은 프로젝트와 무관하게 늘 떠 있다
  return (
    <>
      <Workspace key={project?.id ?? 'none'} state={state} project={project} />
      <PermissionPrompt state={state} />
    </>
  )
}

function Workspace({ state, project }: { state: AppState; project: Project | undefined }): ReactNode {
  const MAIN_KEY = `board:${MAIN_BOARD}`
  const CHAT_KEY = 'chat'
  const [sessionId, setSessionId] = useState<string | undefined>(() => {
    const own = state.sessions.filter((s) => s.projectId === project?.id && !s.parentId)
    return own.sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id
  })
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const base: Tab[] = [
      { key: CHAT_KEY, kind: 'chat' },
      { key: MAIN_KEY, kind: 'board', board: MAIN_BOARD }
    ]
    return project ? base : [...base, { key: 'view:projects', kind: 'view', view: 'projects', focus: {} }]
  })
  const [active, setActive] = useState<string>(project ? (sessionId ? CHAT_KEY : MAIN_KEY) : 'view:projects')
  /** 에이전트를 고르면 대화 탭으로 */
  const selectSession = (id: string): void => {
    setSessionId(id)
    setActive(CHAT_KEY)
  }
  /** 대화 탭을 보고 있지 않을 때(대시보드 등)는 떠 있는 창으로 연다 */
  const [floatId, setFloatId] = useState<string | undefined>()
  const pickAgent = (id: string): void => {
    if (active === CHAT_KEY) selectSession(id)
    else setFloatId(id)
  }
  const [boards, setBoards] = useState<BoardInfo[]>([])
  const [newBoard, setNewBoard] = useState<BoardKind | null>(null)

  // ── 보드 목록: 처음, 그리고 .dashboard 가 바뀔 때마다
  useEffect(() => {
    if (!project) return
    const load = (): void => void api.listBoards(project.id).then(setBoards, () => setBoards([]))
    load()
    return api.on('dashboard', (m: { projectId: string }) => m.projectId === project.id && load())
  }, [project?.id])
  // 지워진 보드의 탭은 닫는다
  useEffect(() => {
    if (!boards.length) return
    const gone = tabs.filter((t) => t.kind === 'board' && t.board !== MAIN_BOARD && !boards.some((b) => b.id === t.board))
    if (gone.length) {
      setTabs((ts) => ts.filter((t) => !gone.includes(t)))
      if (gone.some((t) => t.key === active)) setActive(MAIN_KEY)
    }
  }, [boards])
  const [git, setGit] = useState<GitChange[] | null>(null)
  const [gitVersion, setGitVersion] = useState(0)

  // ── git 상태: 처음, 수동 새로고침, 그리고 에이전트 턴이 끝날 때마다
  const refreshGit = useCallback(() => {
    if (!project) return
    void api.gitStatus(project.id).then((g) => {
      setGit(g)
      setGitVersion((v) => v + 1)
    })
  }, [project?.id])
  const running = state.sessions.filter((s) => s.projectId === project?.id && s.status === 'running').length
  const prevRunning = useRef(running)
  useEffect(() => refreshGit(), [refreshGit])
  // Git 화면에서 커밋·브랜치 전환 등을 하면 오른쪽 파일 패널의 변경 목록도 다시 읽는다
  useEffect(() => api.on('git', (m: { projectId: string }) => m.projectId === project?.id && refreshGit()), [project?.id, refreshGit])
  useEffect(() => {
    if (running < prevRunning.current) refreshGit()
    prevRunning.current = running
  }, [running, refreshGit])

  // ── 탭
  const openTab = (tab: Tab): void => {
    setTabs((ts) => (ts.some((t) => t.key === tab.key) ? ts.map((t) => (t.key === tab.key ? tab : t)) : [...ts, tab]))
    setActive(tab.key)
  }
  const closeTab = (key: string): void => {
    const idx = tabs.findIndex((t) => t.key === key)
    const rest = tabs.filter((t) => t.key !== key)
    setTabs(rest)
    if (active === key) setActive(rest[Math.min(idx, rest.length - 1)]?.key ?? MAIN_KEY)
  }
  const openView = (view: TabView, focus: Focus = {}): void => openTab({ key: `view:${view}`, kind: 'view', view, focus })
  const openFile = (rel: string): void => openTab({ key: `file:${rel}`, kind: 'file', rel })
  const openBoard = (board: string): void => openTab({ key: `board:${board}`, kind: 'board', board })
  const go = (view: View, focus: Focus = {}): void => {
    if (view === 'sessions') {
      if (focus.sessionId) selectSession(focus.sessionId)
      else setActive(CHAT_KEY)
    } else openView(view, focus)
  }

  // ── 패널 폭
  const [lw, setLw] = useState(state.settings.agentsWidth ?? PANEL.left.def)
  const [rw, setRw] = useState(state.settings.rightWidth ?? PANEL.right.def)
  // 즐겨찾기한 보드 (지워진 보드는 빼고, 즐겨찾기한 순서대로)
  const favIds = project ? (state.settings.favoriteBoards?.[project.id] ?? []) : []
  const favBoards = favIds.map((id) => boards.find((b) => b.id === id)).filter((b): b is BoardInfo => !!b)
  const toggleFavorite = (id: string): void => {
    if (!project) return
    const next = favIds.includes(id) ? favIds.filter((x) => x !== id) : [...favIds, id]
    void api.setSettings({ favoriteBoards: { ...(state.settings.favoriteBoards ?? {}), [project.id]: next } })
  }
  const [projectMenu, setProjectMenu] = useState<{ x: number; y: number; w: number } | null>(null)
  const navCollapsed = !!state.settings.navCollapsed
  const agentsHidden = !!state.settings.agentsHidden
  const navW = navCollapsed ? 60 : 208
  const clamp = (side: 'left' | 'right', w: number): number => {
    const other = (side === 'left' ? rw : agentsHidden ? 0 : lw) + navW
    const room = window.innerWidth - other - PANEL.center - PANEL.handles
    const max = Math.max(PANEL[side].min, side === 'left' ? Math.min(PANEL.left.max, room) : room)
    return Math.round(Math.min(max, Math.max(PANEL[side].min, w)))
  }

  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0]
  const selectedSession = state.sessions.find((s) => s.id === sessionId)
  const floatSession = floatId ? state.sessions.find((s) => s.id === floatId) : undefined
  const props: ViewProps = { state, project, focus: activeTab.kind === 'view' ? activeTab.focus : {}, go, openFile }

  return (
    <div className="app">
      <nav className={`sidenav ${navCollapsed ? 'collapsed' : ''}`} aria-label="화면">
        <div className="sidenav-brand">
          <span className="brand-mark" aria-hidden="true">L</span>
          <span className="brand nav-label">Lev</span>
          <button
            className="icon-btn nav-toggle"
            aria-label={navCollapsed ? '내비게이션 펼치기' : '내비게이션 접기'}
            title={navCollapsed ? '펼치기' : '접기'}
            onClick={() => void api.setSettings({ navCollapsed: !navCollapsed })}
          >
            <Icon name="sidebar" size={15} />
          </button>
        </div>
        <div className="sidenav-project">
          <button
            className={`project-select ${projectMenu ? 'open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={!!projectMenu}
            title={project?.path}
            // 열린 상태에서 누르면 메뉴의 "바깥 클릭 닫기"와 겹쳐 다시 열리지 않게, 이 버튼이 직접 닫는다
            onMouseDown={(e) => projectMenu && e.stopPropagation()}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setProjectMenu(projectMenu ? null : { x: r.left, y: r.bottom + 4, w: r.width })
            }}
          >
            <span className="grow ellipsis">{project?.name ?? '프로젝트 없음'}</span>
            <span className="project-chev" aria-hidden="true">
              <Icon name="chevron" size={12} />
            </span>
          </button>
        </div>
        {projectMenu && (
          <ContextMenu
            x={projectMenu.x}
            y={projectMenu.y}
            width={projectMenu.w}
            label="프로젝트 고르기"
            onClose={() => setProjectMenu(null)}
            items={[
              ...state.projects.map((p) => ({
                label: p.name,
                detail: p.path,
                checked: p.id === project?.id,
                run: () => void api.setSettings({ lastProjectId: p.id })
              })),
              { sep: true as const },
              { label: '프로젝트 관리…', run: () => openView('projects') }
            ]}
          />
        )}
        <div className="sidenav-group">
          <button
            className={`nav-btn ${active === CHAT_KEY ? 'on' : ''}`}
            title="대화"
            onClick={() => {
              setActive(CHAT_KEY)
              if (agentsHidden) void api.setSettings({ agentsHidden: false })
            }}
          >
            <Icon name="chat" size={16} />
            <span className="nav-label">대화</span>
            {running > 0 && <span className="nav-count">{running}</span>}
          </button>
          <BoardsMenu
            boards={boards}
            activeBoard={activeTab.kind === 'board' ? activeTab.board : undefined}
            disabled={!project}
            onOpen={openBoard}
            onNew={setNewBoard}
            favorites={favIds}
            onToggleFavorite={toggleFavorite}
          />
          {NAV_MAIN.map((v) => (
            <button
              key={v}
              className={`nav-btn ${active === `view:${v}` ? 'on' : ''}`}
              title={VIEW_META[v].label}
              disabled={VIEW_META[v].needsProject && !project}
              onClick={() => openView(v)}
            >
              <Icon name={VIEW_META[v].icon} size={16} />
              <span className="nav-label">{VIEW_META[v].label}</span>
            </button>
          ))}
        </div>
        {favBoards.length > 0 && (
          <>
            <hr className="nav-sep" />
            <div className="sidenav-group" aria-label="즐겨찾기 보드">
              <span className="nav-label nav-section">즐겨찾기</span>
              {favBoards.map((b) => (
                <button
                  key={b.id}
                  className={`nav-btn ${active === `board:${b.id}` ? 'on' : ''}`}
                  title={b.title}
                  onClick={() => openBoard(b.id)}
                >
                  <Icon name={boardIcon(b.kind)} size={16} />
                  <span className="nav-label">{b.title}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="grow" />
        <div className="sidenav-group">
          {NAV_FOOT.map((v) => (
            <button key={v} className={`nav-btn ${active === `view:${v}` ? 'on' : ''}`} title={VIEW_META[v].label} onClick={() => openView(v)}>
              <Icon name={VIEW_META[v].icon} size={16} />
              <span className="nav-label">{VIEW_META[v].label}</span>
              {v === 'cli' && <CliDots state={state} />}
              {v === 'permissions' && state.settings.autoApprove && (
                <span className="auto-badge" title="자동 모드: 모든 요청을 묻지 않고 허용">
                  AUTO
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      <div
        className="workspace"
        style={{ gridTemplateColumns: agentsHidden ? `minmax(0, 1fr) 6px ${rw}px` : `${lw}px 6px minmax(0, 1fr) 6px ${rw}px` }}
      >
        {!agentsHidden && (
          <>
            <AgentList
              state={state}
              project={project}
              selectedId={active !== CHAT_KEY && floatSession ? floatSession.id : sessionId}
              onSelect={pickAgent}
              onHide={() => void api.setSettings({ agentsHidden: true })}
              onOpenChat={selectSession}
              onOpenFloat={setFloatId}
            />
            <Resizer
              label="에이전트 목록 크기 조절"
              width={lw}
              dir={1}
              onChange={(w) => setLw(clamp('left', w))}
              onReset={() => setLw(PANEL.left.def)}
              onCommit={(w) => void api.setSettings({ agentsWidth: w })}
            />
          </>
        )}

        <main className="center">
          <div className="tabbar" role="tablist" aria-label="열린 화면">
            {agentsHidden && (
              <button className="icon-btn tabbar-toggle" aria-label="에이전트 목록 보이기" title="에이전트 목록" onClick={() => void api.setSettings({ agentsHidden: false })}>
                <Icon name="sidebar" size={15} />
              </button>
            )}
            {tabs.map((t) => {
              const info = t.kind === 'board' ? boards.find((b) => b.id === t.board) : undefined
              const label =
                t.kind === 'chat'
                  ? (selectedSession?.title ?? '대화')
                  : t.kind === 'board'
                    ? (info?.title ?? (t.board === MAIN_BOARD ? '대시보드' : t.board))
                    : t.kind === 'view'
                      ? VIEW_META[t.view].label
                      : t.rel.split('/').pop()
              const icon = t.kind === 'chat' ? 'chat' : t.kind === 'board' ? boardIcon(info?.kind ?? 'dashboard') : t.kind === 'view' ? VIEW_META[t.view].icon : 'file'
              return (
                <div key={t.key} className={`tab ${active === t.key ? 'on' : ''}`}>
                  <button role="tab" aria-selected={active === t.key} title={t.kind === 'file' ? t.rel : label} className={`tab-label ${t.kind === 'file' ? 'mono' : ''}`} onClick={() => setActive(t.key)}>
                    <Icon name={icon} size={13} />
                    <span className="ellipsis">{label}</span>
                  </button>
                  {t.key !== MAIN_KEY && t.key !== CHAT_KEY && (
                    <button className="tab-close" aria-label={`${label} 닫기`} onClick={() => closeTab(t.key)}>
                      <Icon name="close" size={11} />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <div className={`tab-body ${activeTab.kind === 'view' ? 'is-view' : ''} ${activeTab.kind === 'chat' ? 'is-chat' : ''}`} role="tabpanel">
            {activeTab.kind === 'chat' ? (
              <ChatPane state={state} project={project} session={selectedSession} onSelect={selectSession} onOpenRun={(runId) => openView('multi', { runId })} />
            ) : activeTab.kind === 'board' ? (
              project ? (
                <DynamicDashboard
                  key={activeTab.board}
                  state={state}
                  project={project}
                  board={activeTab.board}
                  actions={{
                    openSession: pickAgent,
                    openFile,
                    openView: (v) => openView(v),
                    ask: async (prompt) => setSessionId(await askBoardBuilder(state, project, activeTab.board, prompt, boards.find((b) => b.id === activeTab.board)?.kind))
                  }}
                  onDelete={async () => {
                    await api.removeBoard(project.id, activeTab.board)
                    closeTab(activeTab.key)
                  }}
                />
              ) : (
                <div className="empty">
                  <div className="empty-title">먼저 프로젝트를 만드세요</div>
                  <p className="muted">에이전트는 프로젝트 폴더를 작업 디렉터리로 사용합니다.</p>
                  <button className="primary" onClick={() => openView('projects')}>
                    프로젝트 열기
                  </button>
                </div>
              )
            ) : activeTab.kind === 'file' ? (
              project && (
                <FilePreviewView
                  key={activeTab.rel}
                  project={project}
                  rel={activeTab.rel}
                  change={git?.find((g) => g.rel === activeTab.rel)}
                  version={gitVersion}
                  session={selectedSession}
                />
              )
            ) : activeTab.view === 'projects' ? (
              <ProjectsView {...props} />
            ) : activeTab.view === 'skills' ? (
              <SkillsView {...props} />
            ) : activeTab.view === 'cli' ? (
              <CliView {...props} />
            ) : activeTab.view === 'permissions' ? (
              <PermissionsView {...props} />
            ) : activeTab.view === 'mcp' ? (
              <McpView {...props} />
            ) : activeTab.view === 'git' && project ? (
              <GitView key={project.id} {...props} />
            ) : !project ? null : activeTab.view === 'multi' ? (
              <MultiView key={JSON.stringify(activeTab.focus)} {...props} />
            ) : (
              <AssetsView {...props} />
            )}
          </div>
        </main>

        <Resizer
          label="오른쪽 패널 크기 조절"
          width={rw}
          dir={-1}
          onChange={(w) => setRw(clamp('right', w))}
          onReset={() => setRw(PANEL.right.def)}
          onCommit={(w) => void api.setSettings({ rightWidth: w })}
        />
        <FilePanel
          project={project}
          git={git}
          version={gitVersion}
          activeFile={activeTab.kind === 'file' ? activeTab.rel : undefined}
          onOpenFile={openFile}
          onRefresh={refreshGit}
          session={selectedSession}
        />
      </div>

      {floatSession && (
        <FloatingChat
          state={state}
          session={floatSession}
          onSelect={setFloatId}
          onOpenRun={(runId) => openView('multi', { runId })}
          onExpand={() => {
            selectSession(floatSession.id)
            setFloatId(undefined)
          }}
          onClose={() => setFloatId(undefined)}
        />
      )}

      {newBoard && project && (
        <NewBoardModal
          projectId={project.id}
          kind={newBoard}
          onClose={() => setNewBoard(null)}
          onCreated={(b, request) => {
            setNewBoard(null)
            setBoards((bs) => (bs.some((x) => x.id === b.id) ? bs : [...bs, b]))
            openBoard(b.id)
            if (request) void askBoardBuilder(state, project, b.id, request, b.kind).then(setSessionId)
          }}
        />
      )}
    </div>
  )
}

const BUILDER_TITLE = '대시보드 빌더'

/**
 * 보드(대시보드·도구) 변경 요청을 전용 세션으로 보낸다. 세션이 없으면 dashboard-builder 스킬과
 * 파일 편집 권한을 붙여 새로 만든다. 보낸 세션 id 를 돌려준다.
 */
async function askBoardBuilder(state: AppState, project: Project, board: string, text: string, kind?: BoardKind): Promise<string> {
  const what = kind === 'tool' ? '도구' : '보드'
  const prompt =
    `[${what} 요청 · ${DASHBOARD_DIR}/boards/${board}.json] ${text}\n\n` +
    // 기존 빌더 세션은 첫 턴의 옛 스킬 내용만 기억하므로 매번 최신 스킬 파일을 읽게 한다
    `먼저 .skills/dashboard-builder/SKILL.md 를 읽어 최신 형식을 확인하고, 그 스킬을 따라 ${DASHBOARD_DIR} 폴더만 수정해줘` +
    `(이 보드 파일과 필요한 panels·scripts). 끝나면 바꾼 내용을 짧게 알려줘.`
  const existing = state.sessions
    .filter((s) => s.projectId === project.id && s.title === BUILDER_TITLE && !s.parentId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
  if (existing) {
    // 앱 업데이트로 빌더 권한 인자가 바뀌었을 수 있다
    if (existing.extraArgs !== BUILDER_ARGS[existing.provider]) await api.updateSession(existing.id, { extraArgs: BUILDER_ARGS[existing.provider] })
    await api.send(existing.id, prompt)
    return existing.id
  }
  const hasSkill = state.skills.some((k) => k.projectId === project.id && k.id === 'dashboard-builder')
  const s = await api.createSession({
    projectId: project.id,
    title: BUILDER_TITLE,
    provider: project.defaultProvider,
    model: '',
    allowDelegation: false,
    skillIds: hasSkill ? ['dashboard-builder'] : [],
    assetIds: [],
    prompt,
    extraArgs: BUILDER_ARGS[project.defaultProvider]
  })
  return s.id
}

/** 패널 사이의 드래그 핸들. dir=1 이면 오른쪽으로 끌 때 넓어지고, -1 이면 반대 */
function Resizer(props: {
  label: string
  width: number
  dir: 1 | -1
  onChange: (w: number) => void
  onReset: () => void
  onCommit: (w: number) => void
}): ReactNode {
  const [on, setOn] = useState(false)
  const widthRef = useRef(props.width)
  widthRef.current = props.width
  const propsRef = useRef(props)
  propsRef.current = props

  return (
    <div
      className={`resizer ${on ? 'on' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuenow={props.width}
      tabIndex={0}
      title="드래그해서 크기 조절 · 더블클릭으로 초기화"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const start = { x: e.clientX, w: props.width }
        // 드래그 동안은 창 전체에서 포인터를 따라간다 (핸들 밖으로 벗어나도 유지)
        const move = (ev: PointerEvent): void => propsRef.current.onChange(start.w + (ev.clientX - start.x) * propsRef.current.dir)
        const up = (): void => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
          setOn(false)
          document.body.classList.remove('resizing')
          // 마지막 렌더가 반영된 뒤 저장
          setTimeout(() => propsRef.current.onCommit(widthRef.current))
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
        setOn(true)
        document.body.classList.add('resizing')
      }}
      onDoubleClick={() => {
        props.onReset()
        setTimeout(() => props.onCommit(widthRef.current))
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          props.onChange(props.width + (e.key === 'ArrowRight' ? step : -step) * props.dir)
        }
      }}
      onKeyUp={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') props.onCommit(widthRef.current)
      }}
    />
  )
}

function CliDots({ state }: { state: AppState }): ReactNode {
  return (
    <span className="cli-status" aria-label="CLI 연결 상태">
      {state.providers.map((p) => {
        const st = state.providerStatus[p.id]
        const cls = !p.enabled ? 'off' : !st ? 'checking' : st.available ? 'ok' : 'bad'
        return <span key={p.id} className={`cli-dot ${cls}`} title={`${p.label}: ${st?.version ?? st?.error ?? '확인 중'}`} />
      })}
    </span>
  )
}
