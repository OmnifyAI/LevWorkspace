import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BrowserWindow, dialog, shell, type MessageBoxOptions } from 'electron'
import type {
  ActivityItem,
  AppState,
  Asset,
  Message,
  MultiAgentSpec,
  NewMultiRunInput,
  NewProjectInput,
  NewSessionInput,
  Project,
  ProviderConfig,
  ProviderId,
  CliInfo,
  ProviderStatus,
  Session,
  Skill,
  SkillInput,
  SpawnChildInput,
  WriteAction,
  WriteOrigin,
  MessageFrom,
  QueueItem
} from '../shared/types'
import { PROVIDER_IDS } from '../shared/types'
import { gitDiff, gitStatus, listDir, mimeOf, readPreview, resolveIn } from './files'
import { detectProvider } from './providers'
import { copySkillFolders, ensureSkillsDir, newSkillDir, readSkills, skillFolder, skillsRoot, writeSkill } from './skills'
import { boardPath, createBoard, ensureBuilderSkill, ensureDashboard, listBoards, loadDashboard } from './data/dashboard'
import { ensureCreateSkill } from './createSkill'
import { runQuery } from './data/query'
import { DataServer } from './data/server'
import { installAwCli } from './data/awcli'
import { PermissionBroker } from './permissions'
import { McpHub } from './mcpHub'
import type { TurnOutcome } from './runner'
import { clearApiFile, codexMcpArgs, installMcpServer, MCP_SERVER_NAME, mcpLaunch, writeApiFile, writeCliConfigs, type McpPaths } from './data/mcp'
import type { ApiInfo, BoardInfo, DashboardLoad, NewBoardInput, Query, QueryResult, ScriptInfo, ScriptResult, ScriptRunOptions } from '../shared/dashboard'
import { execScript, hashFile, listScripts, runtimeLabel, scriptPath, scriptPreview, scriptsRoot } from './data/scripts'
import { DASHBOARD_DIR, MAIN_BOARD, PANEL_DATA_DIR } from '../shared/dashboard'
import type { DataFileEntry, FileEncoding } from '../shared/dashboard'
import { dataPath, listDataFiles, previewOf, readDataFile, toBuffer, writeDataFile } from './data/panelFiles'

interface DirWatch {
  watcher: fs.FSWatcher | null
  timer: NodeJS.Timeout | null
}
import { AgentManager, MAX_DEPTH, type TurnResult } from './runner'
import { Store } from './store'

export const ASSET_DIR = '.agent-assets'
const MAX_DELEGATES = 5
const REPORT_CLIP = 12000

const now = (): number => Date.now()
const id = (): string => randomUUID()
const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n) + '\n…(생략)' : s)

/** aw_send_message(wait: true) 가 답을 기다리는 최대 시간 (중계기의 HTTP 요청 제한 5분보다 짧게) */
const REPLY_WAIT_MS = 4 * 60_000

/** 셸 명령의 첫 단어 (경로·따옴표 제거) */
function firstWord(cmd: string): string {
  const t = cmd.trim().split(/\s+/)[0] ?? ''
  return t.replace(/^["']|["']$/g, '').split(/[\\/]/).pop() ?? t
}

/** "항상 허용"으로 저장할 규칙 (claude 권한 문법) */
function cliRuleFor(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  if ((tool === 'Bash' || tool === 'PowerShell') && typeof i.command === 'string' && firstWord(i.command)) return `${tool}(${firstWord(i.command)} *)`
  if (tool === 'WebFetch' && typeof i.url === 'string') {
    try {
      return `WebFetch(domain:${new URL(i.url).hostname})`
    } catch {
      // 주소가 이상하면 도구 단위
    }
  }
  return tool
}

function cliRuleMatches(rule: string, tool: string, input: unknown): boolean {
  if (rule === tool) return true
  const m = /^([A-Za-z_]+)\((.*)\)$/.exec(rule)
  if (!m || m[1] !== tool) return false
  const i = (input ?? {}) as Record<string, unknown>
  if (tool === 'WebFetch' && m[2].startsWith('domain:') && typeof i.url === 'string') {
    try {
      return new URL(i.url).hostname === m[2].slice(7)
    } catch {
      return false
    }
  }
  if (m[2].endsWith(' *') && typeof i.command === 'string') return firstWord(i.command) === m[2].slice(0, -2)
  return false
}

function cliSummary(tool: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>
  if (typeof i.command === 'string') return `${tool} 명령 실행`
  if (typeof i.url === 'string') return `${tool}: ${i.url}`
  if (typeof i.file_path === 'string') return `${tool}: ${i.file_path}`
  if (tool === 'Skill' && typeof i.skill === 'string') return `스킬 사용: ${i.skill}`
  return `${tool} 도구 사용`
}

export class Workspace {
  readonly store = new Store()
  readonly manager: AgentManager
  private status: Partial<Record<ProviderId, ProviderStatus>> = {}
  private stateTimer: NodeJS.Timeout | null = null
  /** 프로젝트별 .skills 스캔 결과와 폴더 감시자 */
  private skills = new Map<string, Skill[]>()
  private watchers = new Map<string, DirWatch[]>()
  readonly api = new DataServer(this)
  readonly permissions = new PermissionBroker(this)

  constructor(readonly broadcast: (channel: string, payload: unknown) => void) {
    this.manager = new AgentManager(this)
    this.manager.on('turn', (r: TurnResult) => this.onTurn(r))
    this.migrateLegacySkills()
    for (const p of this.store.db.projects) this.watchSkills(p)
  }

  // ───────────────────────── 상태 동기화

  snapshot(): AppState {
    const { messages: _messages, version: _version, skills: _legacy, turns: _turns, trustedScripts: _trusted, trustedMcp: _trustedMcp, mcpDisabled: _mcpDisabled, mcpPolicy: _mcpPolicy, mcpCalls: _mcpCalls, grants: _grants, ...rest } = this.store.db
    return { ...rest, skills: [...this.skills.values()].flat(), providerStatus: this.status, grants: this.permissions.grants() }
  }

  /** 상태가 바뀌었음을 알린다 — 렌더러 갱신과 저장 모두 디바운스된다 */
  changed(): void {
    this.store.save()
    if (this.stateTimer) return
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null
      this.broadcast('state', this.snapshot())
    }, 40)
  }

  /** CLI 시작 정보 기록 — 목록이 바뀌었을 때만 렌더러에 알린다 */
  setCliInfo(provider: ProviderId, info: { model?: string; commands?: string[]; skills?: string[] }): void {
    const prev = this.store.db.cliInfo[provider]
    const next: CliInfo = {
      model: info.model ?? prev?.model,
      commands: info.commands ?? prev?.commands ?? [],
      skills: info.skills ?? prev?.skills ?? [],
      at: now()
    }
    const same = prev && prev.model === next.model && prev.commands.join() === next.commands.join() && prev.skills.join() === next.skills.join()
    this.store.db.cliInfo[provider] = next
    if (same) this.store.save()
    else this.changed()
  }

  touch(s: Session): void {
    s.updatedAt = now()
    this.changed()
  }

  addMessage(sessionId: string, m: Pick<Message, 'role' | 'content'> & { title?: string; from?: MessageFrom }): Message {
    const msg: Message = { id: id(), sessionId, createdAt: now(), ...m }
    this.store.messages(sessionId).push(msg)
    this.broadcast('message', msg)
    this.store.save()
    return msg
  }

  updateMessage(m: Message): void {
    this.broadcast('message', m)
    this.store.save()
  }

  recordTurn(s: Session, r: { ok: boolean; costUsd: number; durationMs: number }): void {
    const list = this.store.db.turns
    list.push({ id: id(), at: now(), projectId: s.projectId, sessionId: s.id, provider: s.provider, model: s.model, ...r })
    if (list.length > 5000) list.splice(0, list.length - 5000)
  }

  /** 대시보드 '최근 활동'에 남길 이벤트 (최근 200개 유지) */
  log(s: Session | undefined, kind: ActivityItem['kind'], text: string, projectId = s?.projectId): void {
    if (!projectId) return
    const list = this.store.db.activity
    list.unshift({ id: id(), at: now(), projectId, sessionId: s?.id, kind, text })
    if (list.length > 200) list.length = 200
    this.changed()
  }

  // ───────────────────────── 파일 / git (프로젝트 폴더 기준)

  private root(projectId: string): string {
    const p = this.store.project(projectId)
    if (!p) throw new Error('프로젝트를 찾을 수 없습니다')
    return p.path
  }

  listDir(projectId: string, rel: string) {
    return listDir(this.root(projectId), rel)
  }

  readFile(projectId: string, rel: string) {
    return readPreview(this.root(projectId), rel)
  }

  gitStatus(projectId: string) {
    return gitStatus(this.root(projectId))
  }

  gitDiff(projectId: string, rel: string) {
    return gitDiff(this.root(projectId), rel)
  }

  /** Git 화면: 읽기는 그대로, 바꾸는 동작은 끝나면 렌더러에 알리고(파일 트리·Git 화면 갱신) 주요 동작은 활동 로그에 */
  gitRead<T>(projectId: string, fn: (root: string) => Promise<T>): Promise<T> {
    return fn(this.root(projectId))
  }

  async gitChange<T>(projectId: string, fn: (root: string) => Promise<T>, logText?: (r: T) => string): Promise<T> {
    try {
      const r = await fn(this.root(projectId))
      if (logText) this.log(undefined, 'write', logText(r), projectId)
      return r
    } finally {
      this.broadcast('git', { projectId })
    }
  }

  revealFile(projectId: string, rel: string): void {
    shell.showItemInFolder(resolveIn(this.root(projectId), rel))
  }

  /** 프로젝트 안의 파일을 에셋으로 등록하지 않고 그대로 세션에 첨부할 수 있도록 에셋 레코드를 만든다 */
  fileAsAsset(projectId: string, rel: string): Asset {
    const existing = this.store.db.assets.find((a) => a.projectId === projectId && a.relPath === rel)
    if (existing) return existing
    const abs = resolveIn(this.root(projectId), rel)
    const a: Asset = {
      id: id(), projectId, name: path.basename(rel), relPath: rel, size: fs.statSync(abs).size,
      mime: mimeOf(rel), tags: [], note: '', createdAt: now()
    }
    this.store.db.assets.push(a)
    this.changed()
    return a
  }

  attachFile(sessionId: string, rel: string): void {
    const s = this.store.session(sessionId)
    if (!s) return
    const a = this.fileAsAsset(s.projectId, rel)
    if (!s.assetIds.includes(a.id)) s.assetIds.push(a.id)
    this.touch(s)
  }

  // ───────────────────────── 프로젝트

  createProject(input: NewProjectInput): Project {
    if (!fs.existsSync(input.path)) throw new Error(`폴더가 없습니다: ${input.path}`)
    const p: Project = { id: id(), ...input, skillIds: [], createdAt: now(), updatedAt: now() }
    this.store.db.projects.push(p)
    this.store.db.settings.lastProjectId = p.id
    this.watchSkills(p)
    this.changed()
    return p
  }

  updateProject(projectId: string, patch: Partial<Project>): void {
    const p = this.store.project(projectId)
    if (!p) return
    const pathChanged = patch.path !== undefined && patch.path !== p.path
    Object.assign(p, patch, { id: p.id, updatedAt: now() })
    if (pathChanged) this.watchSkills(p)
    this.changed()
  }

  /** 기록만 지운다. 프로젝트 폴더의 파일은 건드리지 않는다. */
  removeProject(projectId: string): void {
    const db = this.store.db
    for (const s of db.sessions.filter((s) => s.projectId === projectId)) {
      this.manager.stop(s.id)
      delete db.messages[s.id]
    }
    db.sessions = db.sessions.filter((s) => s.projectId !== projectId)
    db.assets = db.assets.filter((a) => a.projectId !== projectId)
    db.multiRuns = db.multiRuns.filter((r) => r.projectId !== projectId)
    db.activity = db.activity.filter((a) => a.projectId !== projectId)
    db.projects = db.projects.filter((p) => p.id !== projectId)
    if (db.settings.lastProjectId === projectId) db.settings.lastProjectId = db.projects[0]?.id
    this.unwatchSkills(projectId)
    this.skills.delete(projectId)
    this.changed()
  }

  setSettings(patch: Partial<AppState['settings']>): void {
    Object.assign(this.store.db.settings, patch)
    this.changed()
  }

  // ───────────────────────── CLI 연결

  updateProvider(pid: ProviderId, patch: Partial<ProviderConfig>): void {
    const p = this.store.provider(pid)
    if (!p) return
    const commandChanged = patch.command !== undefined && patch.command !== p.command
    Object.assign(p, patch, { id: p.id })
    this.changed()
    if (commandChanged) void this.detect(pid)
  }

  async detect(only?: ProviderId): Promise<void> {
    const ids = only ? [only] : PROVIDER_IDS
    await Promise.all(
      ids.map(async (pid) => {
        const p = this.store.provider(pid)
        if (!p) return
        this.status[pid] = await detectProvider(p)
        this.changed()
      })
    )
  }

  // ───────────────────────── 세션

  createSession(input: NewSessionInput, extra: Partial<Session> = {}): Session {
    const project = this.store.project(input.projectId)
    if (!project) throw new Error('프로젝트를 찾을 수 없습니다')
    const s: Session = {
      id: id(),
      projectId: input.projectId,
      title: input.title.trim() || '새 세션',
      provider: input.provider,
      model: input.model,
      status: 'idle',
      depth: 0,
      autoReport: false,
      allowDelegation: input.allowDelegation,
      skillIds: input.skillIds,
      assetIds: input.assetIds,
      extraArgs: input.extraArgs,
      access: input.access,
      queue: [],
      createdAt: now(),
      updatedAt: now(),
      ...extra
    }
    this.store.db.sessions.push(s)
    this.changed()
    if (input.prompt?.trim()) this.manager.send(s.id, input.prompt)
    return s
  }

  updateSession(sessionId: string, patch: Partial<Session>): void {
    const s = this.store.session(sessionId)
    if (!s) return
    // CLI 를 바꾸면 기존 CLI 세션 id 로는 이어갈 수 없다
    if (patch.provider && patch.provider !== s.provider) {
      s.cliSessionId = undefined
      s.cliModel = undefined
    }
    if (patch.model !== undefined && patch.model !== s.model) {
      if (patch.model) s.cliModel = undefined
      this.addMessage(s.id, { role: 'system', content: patch.model ? `모델 → ${patch.model} (다음 턴부터)` :'모델 → CLI 기본값 (다음 턴부터)' })
    }
    Object.assign(s, patch, { id: s.id })
    this.touch(s)
  }

  /** 자식 세션까지 함께 지운다 */
  removeSession(sessionId: string): void {
    const db = this.store.db
    const doomed = new Set<string>([sessionId])
    let grew = true
    while (grew) {
      grew = false
      for (const s of db.sessions) {
        if (s.parentId && doomed.has(s.parentId) && !doomed.has(s.id)) {
          doomed.add(s.id)
          grew = true
        }
      }
    }
    for (const sid of doomed) {
      this.manager.stop(sid)
      delete db.messages[sid]
      this.permissions.forgetOrigin(`session:${sid}`)
    }
    db.sessions = db.sessions.filter((s) => !doomed.has(s.id))
    for (const r of db.multiRuns) r.sessionIds = r.sessionIds.filter((sid) => !doomed.has(sid))
    this.changed()
  }

  // ───────────────────────── 쓰기 동작 (패널·에이전트·외부 도구 → 권한 확인 → 실행)

  panelOrigin(projectId: string, src: string): WriteOrigin {
    const rel = src.replace(/^\.?\/+/, '')
    return { kind: 'panel', key: `panel:${projectId}:${rel}`, label: `대시보드 패널 ${rel}`, projectId }
  }

  /** HTTP API·MCP 요청의 출처. 세션 id 가 이 프로젝트의 세션이면 그 에이전트, 아니면 일반 API */
  apiOrigin(projectId: string, sessionId: string | undefined): WriteOrigin {
    const s = sessionId ? this.store.session(sessionId) : undefined
    if (s && s.projectId === projectId) {
      return { kind: 'agent', key: `session:${s.id}`, label: `에이전트 세션 "${s.title}" (${s.provider})`, projectId, sessionId: s.id }
    }
    return { kind: 'api', key: `api:${projectId}`, label: 'HTTP API (스크립트·외부 도구)', projectId }
  }

  private targetOf(projectId: string, sessionId: string): Session {
    const t = this.store.session(sessionId)
    if (!t || t.projectId !== projectId) throw new Error(`이 프로젝트에 없는 세션입니다: ${sessionId}`)
    return t
  }

  /** 쓰기 동작을 권한 확인 후 실행한다. 거부·제한이면 예외 */
  // ───────────────────────── claude CLI 자체 도구 권한 (--permission-prompt-tool)

  /**
   * claude 가 권한이 필요한 도구(WebFetch·Bash·Skill 등)를 쓰려 할 때 중계기를 거쳐 온다.
   * 프로젝트 규칙에 맞으면 바로 허용, 아니면 앱 확인 창. 결과는 claude 가 기대하는 형식 그대로.
   */
  async cliPermission(origin: WriteOrigin, tool: string, input: unknown): Promise<{ behavior: 'allow'; updatedInput: unknown } | { behavior: 'deny'; message: string }> {
    const rule = cliRuleFor(tool, input)
    const rules = this.store.db.cliRules[origin.projectId] ?? []
    if (rules.some((r) => cliRuleMatches(r, tool, input))) return { behavior: 'allow', updatedInput: input }
    try {
      const d = await this.permissions.check(origin, { type: 'cliTool', tool, input, rule }, { summary: cliSummary(tool, input) })
      if (d === 'always') {
        this.store.db.cliRules[origin.projectId] = [...new Set([...rules, rule])]
        this.changed()
      }
      const s = origin.sessionId ? this.store.session(origin.sessionId) : undefined
      this.log(s, 'write', `${tool} ${this.store.db.settings.autoApprove ? '자동 허용' : '허용'}${d === 'always' ? ` (항상: ${rule})` : ''}`, origin.projectId)
      return { behavior: 'allow', updatedInput: input }
    } catch (e) {
      return { behavior: 'deny', message: `사용자(Lev 앱)가 허용하지 않았습니다: ${(e as Error).message}` }
    }
  }

  removeCliRule(projectId: string, rule: string): void {
    const list = (this.store.db.cliRules[projectId] ?? []).filter((r) => r !== rule)
    this.store.db.cliRules[projectId] = list
    this.changed()
  }

  async writeAction(origin: WriteOrigin, action: WriteAction): Promise<Record<string, unknown>> {
    const p = this.projectOrThrow(origin.projectId)
    const short = (t: string): string => (t.length > 40 ? t.slice(0, 40) + '…' : t)
    switch (action?.type) {
      case 'sendMessage': {
        const t = this.targetOf(p.id, String(action.sessionId))
        if (origin.sessionId === t.id) throw new Error('자기 자신의 세션에는 메시지를 보낼 수 없습니다')
        const prompt = String(action.prompt ?? '').trim()
        if (!prompt) throw new Error('prompt 가 비어 있습니다')
        if (prompt.length > 20000) throw new Error('메시지가 너무 깁니다 (20,000자까지)')
        const running = t.status === 'running'
        await this.permissions.check(origin, { ...action, prompt }, {
          summary: `세션 "${t.title}" 에 메시지를 보냅니다${running ? ' (실행 중이라 대기열에 들어갑니다)' : ''}`,
          target: { id: t.id, title: t.title, provider: t.provider, status: t.status }
        })
        const sender = origin.kind === 'agent' && origin.sessionId ? this.store.session(origin.sessionId) : undefined
        if (!sender) {
          // 패널·HTTP API 가 보낸 메시지는 지금처럼 일반 입력으로
          this.send(t.id, prompt)
          this.log(t, 'write', `${origin.label} → "${t.title}" 에 메시지: ${short(prompt)}`)
          return { sessionId: t.id, queued: running }
        }
        const requestId = randomUUID()
        const from = { sessionId: sender.id, title: sender.title, provider: sender.provider }
        // 서로 기다리면 둘 다 멈춘다 — 상대가 이미 나를 기다리고 있으면 wait 는 쓸 수 없다
        const cycle = [...this.replyWaiters.values()].some((w) => w.from === t.id && w.to === sender.id)
        if (action.wait && cycle) throw new Error(`"${t.title}" 가 이미 당신의 답을 기다리고 있습니다. wait 없이 보내거나, 이 턴의 답변으로 답하세요`)
        let waiting: Promise<{ reply: string; ok: boolean }> | undefined
        if (action.wait) {
          waiting = new Promise((resolve) => this.replyWaiters.set(requestId, { from: sender.id, to: t.id, resolve }))
        }
        this.send(t.id, { prompt, from, requestId })
        this.log(t, 'write', `"${sender.title}" → "${t.title}" 에 메시지: ${short(prompt)}`)
        if (!waiting) return { sessionId: t.id, queued: running, reply: '답은 상대 턴이 끝나면 이 세션에 "답장"으로 자동 전달됩니다' }
        const timeout = new Promise<null>((ok) => setTimeout(() => ok(null), REPLY_WAIT_MS))
        const got = await Promise.race([waiting, timeout])
        if (got) return { sessionId: t.id, ...got }
        // 시간 초과: 기다리기를 그만두고, 답은 나중에 답장으로 받게 한다
        this.replyWaiters.delete(requestId)
        return { sessionId: t.id, timedOut: true, reply: `${REPLY_WAIT_MS / 60000}분 안에 답이 오지 않았습니다. 답은 상대 턴이 끝나면 이 세션에 "답장"으로 자동 전달됩니다` }
      }
      case 'createSession': {
        const provider = action.provider ?? p.defaultProvider
        if (!PROVIDER_IDS.includes(provider)) throw new Error(`provider 는 ${PROVIDER_IDS.join(' | ')} 중 하나`)
        if (!this.store.provider(provider)?.enabled) throw new Error(`${provider} 연결이 꺼져 있습니다`)
        const prompt = String(action.prompt ?? '').trim()
        if (prompt.length > 20000) throw new Error('prompt 가 너무 깁니다 (20,000자까지)')
        const title = String(action.title ?? '').trim() || short(prompt) || '새 세션'
        const model = String(action.model ?? '')
        let parent: Session | undefined
        if (action.child) {
          if (origin.kind !== 'agent' || !origin.sessionId) throw new Error('child 는 에이전트 세션에서만 쓸 수 있습니다')
          parent = this.targetOf(p.id, origin.sessionId)
          if (!prompt) throw new Error('자식 에이전트에는 prompt 가 필요합니다')
          if (parent.depth + 1 > MAX_DEPTH) throw new Error(`자식 에이전트 깊이 제한(${MAX_DEPTH})을 넘습니다`)
        }
        await this.permissions.check(origin, { ...action, provider, title, prompt }, {
          summary: parent
            ? `"${parent.title}" 의 자식 에이전트 "${title}" 을(를) 만들고 실행합니다 (${provider}${model ? ` · ${model}` : ''})`
            : `새 세션 "${title}" 을(를) 만들고 ${prompt ? '실행합니다' : '둡니다'} (${provider}${model ? ` · ${model}` : ''})`
        })
        const s = parent
          ? this.spawnChild(parent.id, { title, provider, model, prompt, autoReport: true })
          : this.createSession({
              projectId: p.id, title, provider, model, allowDelegation: false,
              skillIds: p.skillIds.filter((id) => this.skillsOf(p.id).some((k) => k.id === id)), assetIds: [], prompt
            })
        this.log(s, 'write', `${origin.label} → 세션 "${s.title}" 생성`)
        return { sessionId: s.id, title: s.title, parentId: s.parentId ?? null }
      }
      case 'stopSession': {
        const t = this.targetOf(p.id, String(action.sessionId))
        if (t.status !== 'running') return { sessionId: t.id, stopped: false, reason: '실행 중이 아닙니다' }
        await this.permissions.check(origin, action, {
          summary: `세션 "${t.title}" 의 실행을 중지합니다`,
          target: { id: t.id, title: t.title, provider: t.provider, status: t.status }
        })
        this.stop(t.id)
        this.log(t, 'write', `${origin.label} → "${t.title}" 중지`)
        return { sessionId: t.id, stopped: true }
      }
      default:
        throw new Error('알 수 없는 동작입니다 (sendMessage | createSession | stopSession)')
    }
  }

  /** 대화 기록과 CLI 세션 연결을 비워 새로 시작 */
  resetSession(sessionId: string): void {
    const s = this.store.session(sessionId)
    if (!s || this.manager.isRunning(sessionId)) return
    this.store.db.messages[sessionId] = []
    s.cliSessionId = undefined
    s.lastOutput = undefined
    s.lastError = undefined
    s.status = 'idle'
    this.touch(s)
  }

  send(sessionId: string, item: QueueItem): void {
    this.manager.send(sessionId, item)
  }

  /** aw_send_message(wait) 로 답을 기다리는 쪽: requestId → 답을 받을 함수 */
  private replyWaiters = new Map<string, { from: string; to: string; resolve: (r: { reply: string; ok: boolean }) => void }>()

  /**
   * 다른 에이전트가 보낸 메시지로 시작한 턴이 끝났다. 기다리는 쪽이 있으면 도구 결과로 바로 주고,
   * 아니면 보낸 세션에 "답장"으로 넣는다 (답장 턴의 결과는 다시 돌려보내지 않는다).
   */
  deliverReply(target: Session, replyTo: { sessionId: string; requestId?: string }, r: TurnOutcome | undefined): void {
    const body = !r ? '(답을 받지 못했습니다)' : r.stopped ? '(상대 세션이 중지되어 답이 없습니다)' : r.ok ? r.text || '(빈 응답)' : `(상대 세션이 실패했습니다: ${r.error ?? '알 수 없는 오류'})${r.text ? `\n\n${r.text}` : ''}`
    const waiter = replyTo.requestId ? this.replyWaiters.get(replyTo.requestId) : undefined
    if (waiter) {
      this.replyWaiters.delete(replyTo.requestId!)
      waiter.resolve({ reply: body, ok: !!r?.ok })
      return
    }
    const sender = this.store.session(replyTo.sessionId)
    if (!sender) return
    this.send(sender.id, { prompt: body, from: { sessionId: target.id, title: target.title, provider: target.provider, reply: true } })
    this.log(sender, 'write', `"${target.title}" → "${sender.title}" 답장`)
  }

  stop(sessionId: string): void {
    this.manager.stop(sessionId)
  }

  messages(sessionId: string): Message[] {
    return this.store.db.messages[sessionId] ?? []
  }

  // ───────────────────────── ChildAgent

  spawnChild(parentId: string, input: SpawnChildInput, batchId?: string): Session {
    const parent = this.store.session(parentId)
    if (!parent) throw new Error('부모 세션을 찾을 수 없습니다')
    const depth = parent.depth + 1
    const prompt =
      `너는 "${parent.title}" 세션의 리드 에이전트가 위임한 하위 에이전트다. ` +
      `아래 작업만 수행하고, 결과를 간결하게 정리해서 답하라.\n\n${input.prompt}`
    return this.createSession(
      {
        projectId: parent.projectId,
        title: input.title,
        provider: input.provider,
        model: input.model,
        allowDelegation: parent.allowDelegation && depth < MAX_DEPTH,
        skillIds: [...parent.skillIds],
        assetIds: [...parent.assetIds],
        prompt
      },
      {
        parentId,
        depth,
        autoReport: input.autoReport,
        pendingReport: input.autoReport,
        batchId: batchId ?? id()
      }
    )
  }

  /** 자식의 마지막 결과를 부모에게 수동으로 전달 */
  reportToParent(childId: string): void {
    const c = this.store.session(childId)
    if (!c?.parentId) return
    c.pendingReport = false
    this.send(c.parentId, this.reportText([c]))
  }

  private reportText(children: Session[]): string {
    const body = children
      .map(
        (c) =>
          `### ${c.title} (${c.provider}) — ${c.lastTurnOk === false ? '실패' : '완료'}\n` +
          clip(c.lastOutput || c.lastError || '(출력 없음)', REPORT_CLIP)
      )
      .join('\n\n')
    return `[하위 에이전트 결과]\n\n${body}`
  }

  private delegateFrom(s: Session, text: string): void {
    if (!s.allowDelegation || s.depth >= MAX_DEPTH) return
    const blocks = [...text.matchAll(/<delegate\b([^>]*)>([\s\S]*?)<\/delegate>/g)].slice(0, MAX_DELEGATES)
    if (!blocks.length) return
    const batchId = id()
    this.log(s, 'delegate', `${s.title} → 하위 에이전트 ${blocks.length}개 위임`)
    for (const [, attrs, body] of blocks) {
      const a: Record<string, string> = {}
      for (const [, k, v] of attrs.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) a[k] = v
      const wanted = a.agent as ProviderId
      const provider = PROVIDER_IDS.includes(wanted) && this.store.provider(wanted)?.enabled ? wanted : s.provider
      this.spawnChild(
        s.id,
        { title: a.title || '하위 작업', provider, model: a.model ?? '', prompt: body.trim(), autoReport: true },
        batchId
      )
    }
  }

  private maybeReport(child: Session): void {
    if (!child.parentId || !child.pendingReport || !child.batchId) return
    const batch = this.store.db.sessions.filter((x) => x.batchId === child.batchId && x.pendingReport)
    if (batch.some((x) => this.manager.isRunning(x.id) || x.queue.length)) return
    for (const x of batch) x.pendingReport = false
    const parent = this.store.session(child.parentId)
    if (parent) {
      this.log(parent, 'report', `하위 결과 ${batch.length}개 → ${parent.title}`)
      this.send(parent.id, this.reportText(batch))
    }
    this.changed()
  }

  // ───────────────────────── MultiAgent

  startMulti(input: NewMultiRunInput): string {
    if (!input.agents.length) throw new Error('에이전트를 하나 이상 선택하세요')
    const runId = id()
    const sessionIds = input.agents.map(
      (a, i) =>
        this.createSession(
          {
            projectId: input.projectId,
            title: `${input.title || '멀티 실행'} · ${i + 1}. ${a.role || a.provider}`,
            provider: a.provider,
            model: a.model,
            allowDelegation: false,
            skillIds: input.skillIds,
            assetIds: input.assetIds
          },
          { multiRunId: runId }
        ).id
    )
    this.store.db.multiRuns.unshift({
      id: runId,
      projectId: input.projectId,
      title: input.title || input.prompt.slice(0, 40),
      prompt: input.prompt,
      mode: input.mode,
      agents: input.agents,
      synthesizer: input.synthesizer,
      sessionIds,
      step: 0,
      status: 'running',
      createdAt: now()
    })
    this.changed()
    if (input.mode === 'parallel') {
      input.agents.forEach((a, i) => this.send(sessionIds[i], this.rolePrompt(a, input.prompt)))
    } else {
      this.send(sessionIds[0], this.rolePrompt(input.agents[0], input.prompt))
    }
    return runId
  }

  stopMulti(runId: string): void {
    const r = this.store.db.multiRuns.find((x) => x.id === runId)
    if (!r) return
    r.status = 'error'
    for (const sid of [...r.sessionIds, r.synthesizerSessionId ?? '']) this.manager.stop(sid)
    this.changed()
  }

  removeMulti(runId: string, withSessions: boolean): void {
    const r = this.store.db.multiRuns.find((x) => x.id === runId)
    if (!r) return
    this.stopMulti(runId)
    if (withSessions) for (const sid of [...r.sessionIds, r.synthesizerSessionId ?? '']) if (sid) this.removeSession(sid)
    this.store.db.multiRuns = this.store.db.multiRuns.filter((x) => x.id !== runId)
    this.changed()
  }

  private rolePrompt(a: MultiAgentSpec, prompt: string): string {
    return a.role.trim() ? `너의 역할: ${a.role.trim()}\n\n${prompt}` : prompt
  }

  private advanceMulti(s: Session, r: TurnResult): void {
    const run = this.store.db.multiRuns.find((x) => x.id === s.multiRunId)
    if (!run || run.status !== 'running') return

    if (run.synthesizerSessionId === s.id) {
      run.status = r.ok ? 'done' : 'error'
      this.log(undefined, 'multi', `멀티 실행 "${run.title}" ${r.ok ? '완료' : '실패'}`, run.projectId)
      return this.changed()
    }

    const outputs = (): string =>
      run.sessionIds
        .map((sid, i) => {
          const x = this.store.session(sid)
          const a = run.agents[i]
          return `### ${i + 1}. ${a?.role || a?.provider} (${x?.provider})\n${clip(x?.lastOutput || '(출력 없음)', REPORT_CLIP)}`
        })
        .join('\n\n')

    const finishAll = (): void => {
      if (run.synthesizerSessionId) return
      if (!run.synthesizer) {
        run.status = 'done'
        this.log(undefined, 'multi', `멀티 실행 "${run.title}" 완료`, run.projectId)
        return this.changed()
      }
      const syn = this.createSession(
        {
          projectId: run.projectId,
          title: `${run.title} · 종합`,
          provider: run.synthesizer.provider,
          model: run.synthesizer.model,
          allowDelegation: false,
          skillIds: [],
          assetIds: []
        },
        { multiRunId: run.id }
      )
      run.synthesizerSessionId = syn.id
      this.changed()
      this.send(
        syn.id,
        `${this.rolePrompt(run.synthesizer, '')}여러 에이전트가 같은 과제에 답했다. 각 답을 비교·검토해서 가장 좋은 최종 결과로 종합하라.\n\n` +
          `## 원래 과제\n${run.prompt}\n\n## 에이전트 답변\n${outputs()}`
      )
    }

    if (run.mode === 'parallel') {
      if (run.sessionIds.some((sid) => this.manager.isRunning(sid))) return
      return finishAll()
    }

    // pipeline: 앞 단계 출력을 다음 단계 입력으로
    if (run.sessionIds[run.step] !== s.id) return
    if (!r.ok) {
      run.status = 'error'
      return this.changed()
    }
    run.step++
    if (run.step >= run.sessionIds.length) return finishAll()
    const prev = run.agents[run.step - 1]
    this.send(
      run.sessionIds[run.step],
      this.rolePrompt(
        run.agents[run.step],
        `## 원래 과제\n${run.prompt}\n\n## 이전 단계 (${prev.role || prev.provider}) 결과\n${clip(r.text || '(출력 없음)', REPORT_CLIP)}\n\n` +
          '위 결과를 이어받아 너의 역할에 맞게 작업하라.'
      )
    )
    this.changed()
  }

  private onTurn(r: TurnResult): void {
    const s = this.store.session(r.sessionId)
    if (!s || r.stopped) return
    if (r.ok) this.delegateFrom(s, r.text)
    this.maybeReport(s)
    if (s.multiRunId) this.advanceMulti(s, r)
  }

  // ───────────────────────── Skills (프로젝트 폴더의 .skills 가 원본)

  /** 이 프로젝트의 스킬 (메모리에 올려 둔 스캔 결과) */
  skillsOf(projectId: string): Skill[] {
    return this.skills.get(projectId) ?? []
  }

  private rescanSkills(p: Project): void {
    this.skills.set(p.id, fs.existsSync(p.path) ? readSkills(p.id, p.path) : [])
    this.changed()
  }

  /** 폴더를 감시하다가 바뀌면 (디바운스 후) onChange. 감시를 못 하면 null */
  private watchDir(dir: string, onChange: (files: string[]) => void): DirWatch {
    const entry: DirWatch = { watcher: null, timer: null }
    const changed = new Set<string>()
    try {
      entry.watcher = fs.watch(dir, { recursive: true }, (_event, file) => {
        // 바뀐 파일(폴더 기준, posix)을 모아 한 번에 알린다
        if (file) changed.add(String(file).split(path.sep).join('/'))
        if (entry.timer) clearTimeout(entry.timer)
        entry.timer = setTimeout(() => {
          const files = [...changed]
          changed.clear()
          onChange(files)
        }, 250)
      })
      entry.watcher.on('error', () => entry.watcher?.close())
    } catch {
      // 감시를 못 해도 앱에서 고친 내용은 즉시 다시 읽는다
    }
    return entry
  }

  /**
   * 프로젝트 폴더의 앱 전용 폴더를 준비하고 감시한다.
   * - .skills: 스킬 (없으면 README 와 dashboard-builder 스킬 생성)
   * - .dashboard: 대시보드 (없으면 기본 dashboard.json 생성)
   */
  private watchSkills(p: Project): void {
    this.unwatchSkills(p.id)
    if (!fs.existsSync(p.path)) {
      this.skills.set(p.id, [])
      return
    }
    try {
      ensureSkillsDir(p.path)
      ensureBuilderSkill(p.path)
      ensureCreateSkill(p.path)
      ensureDashboard(p.path)
    } catch {
      // 읽기 전용 폴더 등 — 없는 채로 진행
    }
    const reload = (): void => {
      const cur = this.store.project(p.id)
      if (cur) this.rescanSkills(cur)
    }
    this.watchers.set(p.id, [
      this.watchDir(skillsRoot(p.path), reload),
      // files: .dashboard 기준 경로 (예: boards/main.json, panels/x.html)
      this.watchDir(path.join(p.path, DASHBOARD_DIR), (files) => this.broadcast('dashboard', { projectId: p.id, files }))
    ])
    this.rescanSkills(p)
  }

  private unwatchSkills(projectId: string): void {
    for (const w of this.watchers.get(projectId) ?? []) {
      w.watcher?.close()
      if (w.timer) clearTimeout(w.timer)
    }
    this.watchers.delete(projectId)
  }

  // ───────────────────────── 대시보드 스크립트

  private scriptRuns = new Map<string, Promise<ScriptResult>>()
  private approvals = new Map<string, Promise<boolean>>()
  /** 이번 실행 동안 거부한 스크립트 내용 (다시 묻지 않음) */
  private deniedScripts = new Set<string>()
  private dialogChain: Promise<unknown> = Promise.resolve()

  listScripts(projectId: string): ScriptInfo[] {
    const p = this.projectOrThrow(projectId)
    return listScripts(p.path, (name, hash) => this.store.db.trustedScripts[`${p.id}:${name}`] === hash)
  }

  /**
   * 대시보드 스크립트 실행. 처음이거나 내용이 바뀌었으면 사용자 승인을 받는다.
   * 같은 스크립트·인자로 실행 중이면 그 결과를 같이 기다린다.
   * @param origin 승인 창에 보여줄 요청 출처 (예: "패널 cost.html", "에이전트(MCP)")
   */
  async runScript(projectId: string, name: string, args: unknown, options: ScriptRunOptions | undefined, origin: string): Promise<ScriptResult> {
    const p = this.projectOrThrow(projectId)
    const abs = scriptPath(p.path, name)
    const rel = path.relative(scriptsRoot(p.path), abs).split(path.sep).join('/')
    const hash = hashFile(abs)
    const trustKey = `${p.id}:${rel}`
    if (this.store.db.trustedScripts[trustKey] !== hash) {
      // 자동 모드: 승인 창 없이 실행한다. 신뢰 기록은 남기지 않아 자동 모드를 끄면 다시 묻는다
      if (this.store.db.settings.autoApprove) this.log(undefined, 'write', `스크립트 ${rel} 자동 허용 (${origin})`, p.id)
      else {
        const ok = await this.approveScript(trustKey, hash, abs, rel, origin)
        if (!ok) throw new Error(`사용자가 스크립트 실행을 거부했습니다: ${rel} (내용이 바뀌거나 앱을 다시 켜면 다시 묻습니다)`)
      }
    }
    const key = `${trustKey}:${JSON.stringify(args ?? {})}`
    const running = this.scriptRuns.get(key)
    if (running) return running
    const job = execScript({ projectPath: p.path, name: rel, args, env: this.apiEnv(p.id), options }).finally(() => this.scriptRuns.delete(key))
    this.scriptRuns.set(key, job)
    return job
  }

  private approveScript(trustKey: string, hash: string, abs: string, rel: string, origin: string): Promise<boolean> {
    if (this.deniedScripts.has(`${trustKey}:${hash}`)) return Promise.resolve(false)
    const pendingKey = `${trustKey}:${hash}`
    const pending = this.approvals.get(pendingKey)
    if (pending) return pending
    // 승인 창은 한 번에 하나씩
    const ask = this.dialogChain.then(async () => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const opts: MessageBoxOptions = {
        type: 'warning',
        title: '대시보드 스크립트 실행 승인',
        message: `"${rel}" 스크립트를 실행할까요?`,
        detail:
          `요청: ${origin}\n실행: ${runtimeLabel(abs)}\n위치: ${abs}\n\n` +
          `이 스크립트는 사용자 권한으로 실행됩니다. 내용을 확인하고 허용하세요. 허용하면 내용이 바뀔 때까지 다시 묻지 않습니다.\n\n` +
          `──── 미리보기 ────\n${scriptPreview(abs)}`,
        buttons: ['실행 허용', '거부', '파일 열어 보기'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      }
      const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
      if (r.response === 2) void shell.openPath(abs)
      const ok = r.response === 0
      if (ok) {
        this.store.db.trustedScripts[trustKey] = hash
        this.store.save()
      } else if (r.response === 1) this.deniedScripts.add(`${trustKey}:${hash}`)
      return ok
    })
    this.dialogChain = ask.catch(() => false)
    this.approvals.set(pendingKey, ask)
    void ask.finally(() => this.approvals.delete(pendingKey))
    return ask
  }

  // ───────────────────────── 대시보드 · Data API

  loadDashboard(projectId: string, board?: string): DashboardLoad {
    return loadDashboard(this.projectOrThrow(projectId).path, board || MAIN_BOARD)
  }

  // ───────────────────────── 패널 파일 (.dashboard/data 만)

  panelReadFile(projectId: string, rel: string, encoding?: FileEncoding): string {
    return readDataFile(this.projectOrThrow(projectId).path, rel, encoding)
  }

  panelListFiles(projectId: string, dir?: string): DataFileEntry[] {
    return listDataFiles(this.projectOrThrow(projectId).path, dir)
  }

  /** 패널이 .dashboard/data 에 저장. 쓰기 동작이라 권한 확인을 거친다 ("항상 허용" 은 패널 단위) */
  async panelSaveFile(origin: WriteOrigin, rel: string, content: unknown, encoding: FileEncoding = 'utf8'): Promise<{ path: string; bytes: number }> {
    const p = this.projectOrThrow(origin.projectId)
    const target = dataPath(p.path, rel)
    const buf = toBuffer(content, encoding)
    const exists = fs.existsSync(target.abs)
    await this.permissions.check(
      origin,
      { type: 'saveFile', path: `${DASHBOARD_DIR}/${PANEL_DATA_DIR}/${target.rel}`, bytes: buf.length, preview: previewOf(buf, encoding), exists },
      { summary: `${DASHBOARD_DIR}/${PANEL_DATA_DIR}/${target.rel} 에 ${exists ? '덮어써서 ' : ''}저장합니다 (${buf.length.toLocaleString()} bytes)` }
    )
    writeDataFile(target.abs, buf)
    return { path: target.rel, bytes: buf.length }
  }

  /**
   * OS 저장 대화상자로 사용자가 고른 곳에 저장. 사용자가 직접 위치를 고르므로 확인 창은 없다.
   * 취소하면 null.
   */
  async panelSaveAs(projectId: string, content: unknown, name: string, encoding: FileEncoding = 'utf8'): Promise<{ path: string; bytes: number } | null> {
    const p = this.projectOrThrow(projectId)
    const buf = toBuffer(content, encoding)
    const base = path.basename(String(name || 'export.json')).replace(/[<>:"|?*\u0000-\u001f]/g, '_') || 'export.json'
    const ext = path.extname(base).slice(1)
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const opts = {
      title: '파일로 저장',
      defaultPath: path.join(p.path, base),
      filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: '모든 파일', extensions: ['*'] }] : undefined
    }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return null
    writeDataFile(r.filePath, buf)
    return { path: r.filePath, bytes: buf.length }
  }

  /** 패널에서 실제로 난 오류 (빌더가 aw_dashboard_validate 로 볼 수 있게). "<projectId>:<src>" → 마지막 오류 */
  private panelErrors = new Map<string, { message: string; at: number }>()

  reportPanelError(projectId: string, src: string, message: string): void {
    const key = `${projectId}:${src.replace(/^\.?\/+/, '')}`
    if (message) this.panelErrors.set(key, { message: message.slice(0, 2000), at: Date.now() })
    else this.panelErrors.delete(key)
  }

  /** 패널 파일이 그 뒤로 바뀌지 않았을 때만 오류를 돌려준다 (고친 뒤의 옛 오류는 무시) */
  panelError(projectId: string, src: string): string | undefined {
    const rel = src.replace(/^\.?\/+/, '')
    const e = this.panelErrors.get(`${projectId}:${rel}`)
    if (!e) return undefined
    try {
      const mtime = fs.statSync(path.join(this.projectOrThrow(projectId).path, DASHBOARD_DIR, rel)).mtimeMs
      if (mtime > e.at) return undefined
    } catch {
      return undefined
    }
    return e.message
  }

  listBoards(projectId: string): BoardInfo[] {
    return listBoards(this.projectOrThrow(projectId).path)
  }

  createBoard(projectId: string, input: NewBoardInput): BoardInfo {
    const b = createBoard(this.projectOrThrow(projectId).path, input)
    this.broadcast('dashboard', { projectId })
    return b
  }

  /** 보드 파일을 휴지통으로 (main 은 지울 수 없음). 패널·스크립트는 다른 보드가 쓸 수 있어 남긴다 */
  async removeBoard(projectId: string, board: string): Promise<void> {
    if (board === MAIN_BOARD) throw new Error('기본 대시보드(main)는 지울 수 없습니다')
    const file = boardPath(this.projectOrThrow(projectId).path, board)
    if (fs.existsSync(file)) await shell.trashItem(file)
    this.broadcast('dashboard', { projectId })
  }

  query(projectId: string | undefined, q: Query): Promise<QueryResult> {
    return runQuery(this, q, projectId)
  }

  apiInfo(): ApiInfo {
    return this.api.info()
  }

  /** 앱이 띄우는 CLI 에 넘기는 환경 변수 — 에이전트가 Data API 와 `aw` 명령을 쓸 수 있게 */
  apiEnv(projectId: string, sessionId?: string): Record<string, string> {
    const { url, token } = this.api.info()
    const env: Record<string, string> = { AGENT_WORKSPACE_API: url, AGENT_WORKSPACE_TOKEN: token, AGENT_WORKSPACE_PROJECT: projectId }
    // 쓰기 동작을 요청할 때 어느 에이전트가 보냈는지 알리는 용도
    if (sessionId) env.AGENT_WORKSPACE_SESSION = sessionId
    if (this.awBin) {
      // Windows 는 'Path' 로 들어 있으므로 같은 키를 덮어쓴다
      const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
      env[key] = `${this.awBin}${path.delimiter}${process.env[key] ?? ''}`
    }
    return env
  }

  private awBin: string | null = null
  private mcpPaths: McpPaths | null = null
  /** 외부 MCP 서버 허브 (installAgentTools 에서 만든다) */
  mcp!: McpHub

  /** aw 명령과 MCP 서버 스크립트를 userData 에 설치하고, API 주소·토큰 파일을 쓴다 (api.start 다음에) */
  installAgentTools(userData: string): void {
    this.mcp = new McpHub(this, userData)
    try {
      this.awBin = installAwCli(userData)
    } catch (e) {
      console.error('aw 명령을 설치하지 못했습니다', e)
    }
    try {
      this.mcpPaths = installMcpServer(userData)
      writeApiFile(this.mcpPaths, this.api.info())
    } catch (e) {
      this.mcpPaths = null
      console.error('MCP 서버를 설치하지 못했습니다', e)
    }
  }

  shutdownAgentTools(): void {
    if (this.mcpPaths) clearApiFile(this.mcpPaths)
    void this.mcp?.closeAll()
  }

  /**
   * 세션 실행 때 붙일 Workspace MCP 연결.
   * claude: --mcp-config 파일 + 도구 자동 허용, codex: -c 설정 덮어쓰기,
   * gemini: 시스템 설정 파일 경로(GEMINI_CLI_SYSTEM_SETTINGS_PATH)
   */
  cliMcp(projectId: string, sessionId: string, p: ProviderConfig): { args: string[]; env: Record<string, string> } {
    if (!this.mcpPaths || p.mcp === false) return { args: [], env: {} }
    try {
      const files = writeCliConfigs(this.mcpPaths, projectId, sessionId)
      if (p.id === 'claude') {
        // 권한이 필요한 도구는 앱 확인 창으로 묻고(--permission-prompt-tool), "항상 허용"한 규칙은 처음부터 허용
        const allowed = [`mcp__${MCP_SERVER_NAME}`, ...(this.store.db.cliRules[projectId] ?? [])]
        const args = ['--mcp-config', files.claude, '--allowedTools', ...allowed, '--permission-prompt-tool', `mcp__${MCP_SERVER_NAME}__aw_permission_prompt`]
        // claude 는 프로젝트 .mcp.json 을 스스로도 읽는다 — 허브가 중계하는 서버는 끄게 해서 같은 도구가 둘로 보이지 않게
        const routed = this.mcp?.projectServerNames(projectId) ?? []
        if (routed.length) {
          const settings = path.join(path.dirname(files.claude), `claude-settings-${sessionId}.json`)
          fs.writeFileSync(settings, JSON.stringify({ disabledMcpjsonServers: routed }, null, 2))
          args.push('--settings', settings)
        }
        return { args, env: {} }
      }
      if (p.id === 'codex') return { args: codexMcpArgs(mcpLaunch(this.mcpPaths, projectId, sessionId)), env: {} }
      return { args: [], env: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: files.gemini } }
    } catch (e) {
      console.error('MCP 설정을 쓰지 못했습니다', e)
      return { args: [], env: {} }
    }
  }

  closeWatchers(): void {
    for (const id of [...this.watchers.keys()]) this.unwatchSkills(id)
  }

  private projectOrThrow(projectId: string): Project {
    const p = this.store.project(projectId)
    if (!p) throw new Error('프로젝트를 찾을 수 없습니다')
    return p
  }

  createSkill(projectId: string, input: SkillInput): Skill {
    const p = this.projectOrThrow(projectId)
    ensureSkillsDir(p.path)
    const dir = newSkillDir(p.path, input.name)
    writeSkill(p.path, dir, input)
    this.rescanSkills(p)
    return this.skillsOf(p.id).find((k) => k.id === dir)!
  }

  updateSkill(projectId: string, skillId: string, patch: Partial<SkillInput>): void {
    const p = this.projectOrThrow(projectId)
    writeSkill(p.path, skillId, patch)
    this.rescanSkills(p)
  }

  /** 스킬 폴더를 휴지통으로 옮기고 세션·프로젝트에서 연결을 뗀다 */
  async removeSkill(projectId: string, skillId: string): Promise<void> {
    const p = this.projectOrThrow(projectId)
    const dir = skillFolder(p.path, skillId)
    if (fs.existsSync(dir)) await shell.trashItem(dir)
    p.skillIds = p.skillIds.filter((x) => x !== skillId)
    for (const s of this.store.db.sessions) if (s.projectId === projectId) s.skillIds = s.skillIds.filter((x) => x !== skillId)
    this.rescanSkills(p)
  }

  openSkillsFolder(projectId: string, skillId?: string): void {
    const p = this.projectOrThrow(projectId)
    ensureSkillsDir(p.path)
    void shell.openPath(skillId ? skillFolder(p.path, skillId) : skillsRoot(p.path))
  }

  /** ~/.claude/skills 와 프로젝트의 .claude/skills 에 있는 스킬 폴더를 .skills 로 복사 */
  importSkills(projectId: string): string[] {
    const p = this.projectOrThrow(projectId)
    ensureSkillsDir(p.path)
    const copied = [
      ...copySkillFolders(p.path, path.join(os.homedir(), '.claude', 'skills')),
      ...copySkillFolders(p.path, path.join(p.path, '.claude', 'skills'))
    ]
    this.rescanSkills(p)
    return copied
  }

  /** 기본 사용 스킬을 Claude Code 가 직접 읽는 .claude/skills 로 복사 (폴더째) */
  exportSkillsToClaude(projectId: string): string[] {
    const p = this.projectOrThrow(projectId)
    const written: string[] = []
    for (const k of this.skillsOf(p.id).filter((k) => p.skillIds.includes(k.id))) {
      const target = path.join(p.path, '.claude', 'skills', k.id)
      fs.cpSync(skillFolder(p.path, k.id), target, { recursive: true, force: true })
      written.push(`.claude/skills/${k.id}`)
    }
    return written
  }

  /**
   * 예전 버전은 스킬을 앱 DB 에 전역으로 저장했다. 각 프로젝트의 .skills 로 옮기고
   * 프로젝트·세션이 가리키던 id 를 폴더 이름으로 바꾼다. 어디서도 안 쓰던 스킬은
   * 마지막으로 연 프로젝트로 옮겨 잃어버리지 않게 한다.
   */
  private migrateLegacySkills(): void {
    const db = this.store.db
    if (!db.skills?.length) return
    const projects = db.projects.filter((p) => fs.existsSync(p.path))
    const placed = new Set<string>()
    const fallback = projects.find((p) => p.id === db.settings.lastProjectId) ?? projects[0]
    for (const p of projects) {
      const sessions = db.sessions.filter((s) => s.projectId === p.id)
      const used = new Set([...p.skillIds, ...sessions.flatMap((s) => s.skillIds)])
      const wanted = db.skills.filter((k) => used.has(k.id) || (p === fallback && !db.projects.some((q) => q.skillIds.includes(k.id))))
      if (!wanted.length) continue
      try {
        ensureSkillsDir(p.path)
      } catch {
        continue
      }
      const map = new Map<string, string>()
      for (const k of wanted) {
        const dir = newSkillDir(p.path, k.name)
        writeSkill(p.path, dir, k)
        map.set(k.id, dir)
        placed.add(k.id)
      }
      const remap = (ids: string[]): string[] => ids.flatMap((x) => (map.has(x) ? [map.get(x)!] : []))
      p.skillIds = remap(p.skillIds)
      for (const s of sessions) s.skillIds = remap(s.skillIds)
    }
    // 폴더가 없는 프로젝트 몫은 남겨 두고 다음 실행 때 다시 시도
    db.skills = db.skills.filter((k) => !placed.has(k.id))
    this.store.save()
  }


  // ───────────────────────── Assets

  assetPath(a: Asset): string | undefined {
    const p = this.store.project(a.projectId)
    return p ? path.join(p.path, ...a.relPath.split('/')) : undefined
  }

  /** 파일을 프로젝트의 .agent-assets 폴더로 복사해 등록한다 (에이전트가 cwd 안에서 읽을 수 있도록) */
  importAssets(projectId: string, files: string[]): Asset[] {
    const p = this.store.project(projectId)
    if (!p) throw new Error('프로젝트를 찾을 수 없습니다')
    const dir = path.join(p.path, ASSET_DIR)
    fs.mkdirSync(dir, { recursive: true })
    const added: Asset[] = []
    for (const src of files) {
      const stat = fs.statSync(src)
      if (!stat.isFile()) continue
      const ext = path.extname(src)
      const base = path.basename(src, ext)
      let name = base + ext
      for (let n = 1; fs.existsSync(path.join(dir, name)); n++) name = `${base}-${n}${ext}`
      fs.copyFileSync(src, path.join(dir, name))
      const a: Asset = {
        id: id(),
        projectId,
        name,
        relPath: `${ASSET_DIR}/${name}`,
        size: stat.size,
        mime: mimeOf(name),
        tags: [],
        note: '',
        createdAt: now()
      }
      this.store.db.assets.push(a)
      added.push(a)
    }
    this.changed()
    return added
  }

  /** .agent-assets 에 직접 넣은 파일도 목록에 반영 */
  rescanAssets(projectId: string): number {
    const p = this.store.project(projectId)
    if (!p) return 0
    const dir = path.join(p.path, ASSET_DIR)
    if (!fs.existsSync(dir)) return 0
    const known = new Set(this.store.db.assets.filter((a) => a.projectId === projectId).map((a) => a.relPath))
    let n = 0
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = `${ASSET_DIR}/${f.name}`
      if (!f.isFile() || known.has(rel)) continue
      const stat = fs.statSync(path.join(dir, f.name))
      this.store.db.assets.push({
        id: id(), projectId, name: f.name, relPath: rel, size: stat.size, mime: mimeOf(f.name), tags: [], note: '', createdAt: now()
      })
      n++
    }
    // 디스크에서 사라진 파일은 목록에서 제거
    this.store.db.assets = this.store.db.assets.filter((a) => {
      if (a.projectId !== projectId) return true
      const abs = this.assetPath(a)
      return !!abs && fs.existsSync(abs)
    })
    this.changed()
    return n
  }

  updateAsset(assetId: string, patch: Partial<Pick<Asset, 'tags' | 'note'>>): void {
    const a = this.store.db.assets.find((x) => x.id === assetId)
    if (!a) return
    Object.assign(a, patch)
    this.changed()
  }

  /** 목록에서 지우고, trash=true 면 파일을 휴지통으로 옮긴다 */
  async removeAsset(assetId: string, trash: boolean): Promise<void> {
    const db = this.store.db
    const a = db.assets.find((x) => x.id === assetId)
    if (!a) return
    const abs = this.assetPath(a)
    if (trash && abs && fs.existsSync(abs)) await shell.trashItem(abs)
    db.assets = db.assets.filter((x) => x.id !== assetId)
    for (const s of db.sessions) s.assetIds = s.assetIds.filter((x) => x !== assetId)
    this.changed()
  }

  readAssetText(assetId: string): string {
    const a = this.store.db.assets.find((x) => x.id === assetId)
    const abs = a && this.assetPath(a)
    if (!abs) throw new Error('에셋을 찾을 수 없습니다')
    const buf = fs.readFileSync(abs)
    const head = buf.subarray(0, 200_000)
    if (head.includes(0)) throw new Error('바이너리 파일은 미리보기를 지원하지 않습니다')
    return head.toString('utf8')
  }
}
