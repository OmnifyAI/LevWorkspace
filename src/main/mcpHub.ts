import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { randomUUID } from 'node:crypto'
import {
  MCP_PROJECT_FILE,
  type McpCallRecord,
  type McpDefaultPolicy,
  type McpPolicy,
  type McpScope,
  type McpServerConfig,
  type McpServerInfo,
  type McpStatus,
  type McpSecretList,
  type McpToolInfo,
  type WriteOrigin
} from '../shared/types'
import { McpOAuthProvider, startCallback } from './mcpOAuth'
import { SECRET_NAME_RE, SecretStore } from './secrets'
import type { Workspace } from './workspace'

const CONNECT_TIMEOUT = 60_000
const CALL_TIMEOUT = 10 * 60_000
const MAX_TEXT = 100_000
/** CLI 쪽 전체 이름(mcp__agent_workspace__…)이 64자를 넘지 않게 */
const MAX_EXPOSED = 40

interface Entry {
  key: string
  name: string
  scope: McpScope
  projectId?: string
  source: string
  config: McpServerConfig
  hash: string
}

interface Conn {
  hash: string
  /** 비밀값까지 펼친 설정의 해시 — 비밀값이 바뀌면 다시 연결 */
  run: string
  status: McpStatus
  error?: string
  client?: Client
  transport?: Transport
  /** 정책은 그때그때 계산하므로 여기엔 서버가 준 정보만 */
  tools: BaseTool[]
  /** 서버가 준 도구 정의 그대로 (inputSchema 등) */
  raw: Record<string, unknown>[]
  log: string[]
  connecting?: Promise<void>
}

type BaseTool = Omit<McpToolInfo, 'policy' | 'override'>

const MAX_CALLS = 5000

/** 중계기(workspace-mcp)가 CLI 에 넘길 도구 정의 */
export interface ExposedTool {
  name: string
  description?: string
  inputSchema: unknown
  annotations?: unknown
}

const transportOf = (c: McpServerConfig): 'stdio' | 'http' | 'sse' => ('url' in c ? c.type : 'stdio')

/** Authorization 헤더를 직접 넣는 원격 서버 (토큰 방식 — OAuth 로그인 대상이 아님) */
const headerAuth = (c: McpServerConfig): boolean => 'url' in c && Object.keys(c.headers ?? {}).some((k) => k.toLowerCase() === 'authorization')

const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g

type Lookup = (name: string) => string | undefined

/** ${VAR} / ${VAR:-기본값} 치환 (claude .mcp.json 과 같은 규칙) */
function expand(s: string, lookup: Lookup): string {
  return s.replace(VAR_RE, (_, name: string, def?: string) => lookup(name) ?? def ?? '')
}

function expandConfig(c: McpServerConfig, lookup: Lookup): McpServerConfig {
  const x = (v: string): string => expand(String(v), lookup)
  const map = (o?: Record<string, string>): Record<string, string> | undefined => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, x(v)]))
  if ('url' in c) return { ...c, url: x(c.url), headers: map(c.headers) }
  return { ...c, command: x(c.command), args: c.args?.map(x), env: map(c.env), cwd: c.cwd && x(c.cwd) }
}

/** 설정에 나오는 변수: 이름과 기본값이 있는지 */
function varsOf(c: McpServerConfig): { name: string; hasDefault: boolean }[] {
  const out = new Map<string, boolean>()
  for (const m of JSON.stringify(c).matchAll(VAR_RE)) out.set(m[1], (out.get(m[1]) ?? false) || m[2] !== undefined)
  return [...out].map(([name, hasDefault]) => ({ name, hasDefault }))
}

/** 설정 파일의 서버 목록. 형식이 틀린 항목은 건너뛴다 */
function readServers(file: string): Record<string, McpServerConfig> {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
  const servers = (raw as { mcpServers?: unknown })?.mcpServers
  if (!servers || typeof servers !== 'object') return {}
  const out: Record<string, McpServerConfig> = {}
  for (const [name, c] of Object.entries(servers as Record<string, Record<string, unknown>>)) {
    if (!c || typeof c !== 'object' || !/^[A-Za-z0-9_.-]{1,40}$/.test(name)) continue
    const url = typeof c.url === 'string' ? c.url : typeof c.httpUrl === 'string' ? c.httpUrl : undefined
    if (url) out[name] = { type: c.type === 'sse' && typeof c.httpUrl !== 'string' ? 'sse' : 'http', url, headers: c.headers as Record<string, string> | undefined }
    else if (typeof c.command === 'string')
      out[name] = {
        command: c.command,
        args: Array.isArray(c.args) ? c.args.map(String) : undefined,
        env: c.env as Record<string, string> | undefined,
        cwd: typeof c.cwd === 'string' ? c.cwd : undefined
      }
  }
  return out
}

const sha = (c: McpServerConfig): string => createHash('sha256').update(JSON.stringify(c)).digest('hex')

/** <서버>__<도구> — CLI 도구 이름 규칙([A-Za-z0-9_-])에 맞추고 길이를 줄인다 */
function exposedName(server: string, tool: string): string {
  const clean = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '_')
  const full = `${clean(server)}__${clean(tool)}`
  if (full.length <= MAX_EXPOSED) return full
  const tag = createHash('sha1').update(full).digest('hex').slice(0, 6)
  return `${full.slice(0, MAX_EXPOSED - 7)}_${tag}`
}

/**
 * 외부 MCP 서버 허브. 서버는 앱이 한 번 연결해 모든 세션이 같이 쓰고, CLI 는 agent_workspace 중계기를 통해
 * <서버>__<도구> 로 부른다. 프로젝트 .mcp.json 의 서버는 승인(설정 sha256)을 받아야 실행한다.
 */
export class McpHub {
  private conns = new Map<string, Conn>()
  /** 노출 이름 → 서버 key·원래 도구 이름 (프로젝트별) */
  private routes = new Map<string, Map<string, { key: string; tool: string }>>()
  readonly globalFile: string
  readonly secrets: SecretStore
  private oauth = new Map<string, McpOAuthProvider>()
  /** 진행 중인 로그인 취소 함수 */
  private logins = new Map<string, () => void>()

  constructor(
    private ws: Workspace,
    userData: string
  ) {
    this.globalFile = path.join(userData, 'mcp', 'servers.json')
    this.secrets = new SecretStore(path.join(userData, 'mcp', 'secrets.json'))
  }

  /** 비밀값 → 앱 환경 변수 순 */
  private lookup: Lookup = (name) => this.secrets.get(name) ?? process.env[name]

  private provider(key: string): McpOAuthProvider {
    let p = this.oauth.get(key)
    if (!p) this.oauth.set(key, (p = new McpOAuthProvider(this.secrets, key)))
    return p
  }

  private runHash(e: Entry): string {
    return sha(expandConfig(e.config, this.lookup))
  }

  /** 기본값 없이 쓰였는데 비밀값·환경 변수 어디에도 없는 변수 */
  private missing(e: Entry): string[] {
    return varsOf(e.config)
      .filter((v) => !v.hasDefault && this.lookup(v.name) === undefined)
      .map((v) => v.name)
  }

  // ───────────── 비밀값 (값은 렌더러로 보내지 않는다)

  secretList(): McpSecretList {
    const all = [
      ...this.entries(),
      ...this.ws.store.db.projects.flatMap((p) => this.entries(p.id).filter((e) => e.scope === 'project'))
    ]
    const used = new Map<string, string[]>()
    const noDefault = new Set<string>()
    for (const e of all) {
      for (const v of varsOf(e.config)) {
        used.set(v.name, [...(used.get(v.name) ?? []), e.name])
        if (!v.hasDefault) noDefault.add(v.name)
      }
    }
    const names = new Set([...this.secrets.names(), ...[...used.keys()].filter((n) => !this.secrets.get(n) && process.env[n] === undefined)])
    return {
      available: this.secrets.available(),
      items: [...names].sort().map((name) => ({
        name,
        stored: this.secrets.names().includes(name),
        fromEnv: !this.secrets.names().includes(name) && process.env[name] !== undefined,
        hasDefault: used.has(name) && !noDefault.has(name),
        usedBy: [...new Set(used.get(name) ?? [])]
      }))
    }
  }

  setSecret(name: string, value: string): void {
    if (!SECRET_NAME_RE.test(name)) throw new Error('이름은 영문·숫자·_ 로 (숫자로 시작하지 않게) 64자 이내')
    if (!value) throw new Error('값이 비어 있습니다')
    this.secrets.set(name, value)
    this.dropUsing(name)
  }

  removeSecret(name: string): void {
    this.secrets.delete(name)
    this.dropUsing(name)
  }

  /** 이 변수를 쓰는 서버 연결을 끊는다 — 다음에 쓸 때 새 값으로 다시 연결된다 */
  private dropUsing(name: string): void {
    for (const key of [...this.conns.keys()]) {
      const e = this.findEntry(key)
      if (!e || varsOf(e.config).some((v) => v.name === name)) void this.close(key)
    }
    this.changed()
  }

  private findEntry(key: string): Entry | undefined {
    const pid = key.startsWith('project:') ? key.split(':')[1] : undefined
    return this.entries(pid).find((x) => x.key === key)
  }

  // ───────────── OAuth

  /** 원격 서버 로그인: 루프백 콜백을 열고 브라우저로 인증 → 코드 교환 → 토큰 저장 → 다시 연결 */
  async login(key: string, projectId?: string): Promise<void> {
    const e = this.entry(key, projectId)
    if (!('url' in e.config)) throw new Error('원격(http·sse) 서버만 로그인할 수 있습니다')
    if (headerAuth(e.config)) throw new Error('이 서버는 Authorization 헤더의 토큰으로 인증합니다 (OAuth 로그인 대상이 아님)')
    if (!this.approved(e)) throw new Error('먼저 서버를 승인하세요')
    const provider = this.provider(key)
    if (provider.interactive) throw new Error('이미 로그인 중입니다 — 브라우저 창을 확인하세요')
    const cb = await startCallback()
    this.logins.set(key, cb.cancel)
    provider.interactive = { redirectUrl: cb.redirectUrl, state: cb.state }
    this.changed()
    try {
      await this.close(key)
      const cfg = expandConfig(e.config, this.lookup) as Extract<McpServerConfig, { url: string }>
      const transport = this.remote(cfg, provider)
      const client = new Client({ name: 'agent-workspace', version: '0.1.0' })
      try {
        await client.connect(transport, { timeout: CONNECT_TIMEOUT })
      } catch (err) {
        // 인증 주소로 보내지 않았다면 인증 문제가 아니다
        if (!provider.interactive.authUrl) throw err
        this.changed()
        const code = await cb.code
        await transport.finishAuth(code)
      } finally {
        await client.close().catch(() => undefined)
      }
    } finally {
      cb.close()
      this.logins.delete(key)
      provider.interactive = null
      this.changed()
    }
    await this.ensure(e)
  }

  isPendingAuthUrl(url: string): boolean {
    return [...this.oauth.values()].some((p) => p.interactive?.authUrl === url)
  }

  /** 로그인 취소 (진행 중인 콜백을 닫는다) */
  cancelLogin(key: string): void {
    this.logins.get(key)?.()
  }

  async logout(key: string): Promise<void> {
    this.provider(key).logout()
    await this.close(key)
  }

  private remote(cfg: Extract<McpServerConfig, { url: string }>, provider: McpOAuthProvider | undefined): SSEClientTransport | StreamableHTTPClientTransport {
    const opts = { requestInit: { headers: cfg.headers ?? {} }, authProvider: provider }
    return cfg.type === 'sse' ? new SSEClientTransport(new URL(cfg.url), opts) : new StreamableHTTPClientTransport(new URL(cfg.url), opts)
  }

  // ───────────── 설정

  private entries(projectId?: string): Entry[] {
    const out: Entry[] = []
    for (const [name, config] of Object.entries(readServers(this.globalFile))) {
      out.push({ key: `global:${name}`, name, scope: 'global', source: this.globalFile, config, hash: sha(config) })
    }
    const p = projectId ? this.ws.store.project(projectId) : undefined
    if (p) {
      const file = path.join(p.path, MCP_PROJECT_FILE)
      for (const [name, config] of Object.entries(readServers(file))) {
        out.push({ key: `project:${p.id}:${name}`, name, scope: 'project', projectId: p.id, source: file, config, hash: sha(config) })
      }
    }
    return out
  }

  private entry(key: string, projectId?: string): Entry {
    const e = this.entries(projectId ?? key.split(':')[1]).find((x) => x.key === key)
    if (!e) throw new Error(`MCP 서버 설정이 없습니다: ${key}`)
    return e
  }

  /** 프로젝트 .mcp.json 의 서버 이름 (CLI 가 직접 읽지 않게 끌 때 쓴다) */
  projectServerNames(projectId: string): string[] {
    return this.entries(projectId).filter((e) => e.scope === 'project').map((e) => e.name)
  }

  private approved(e: Entry): boolean {
    return this.ws.store.db.trustedMcp[e.key] === e.hash
  }

  private enabled(e: Entry): boolean {
    return !this.ws.store.db.mcpDisabled.includes(e.key)
  }

  // ───────────── 정책

  private policies(key: string): Record<string, McpDefaultPolicy> {
    return this.ws.store.db.mcpPolicy[key] ?? {}
  }

  /** 서버 기본값 → 도구별 지정 순으로. auto 는 읽기 전용 주석이 있으면 허용, 아니면 확인 */
  private policyOf(key: string, t: BaseTool): { policy: McpPolicy; override?: McpPolicy } {
    const p = this.policies(key)
    const override = p[t.name] && p[t.name] !== 'auto' ? (p[t.name] as McpPolicy) : undefined
    const def = p['*'] ?? 'auto'
    const policy = override ?? (def !== 'auto' ? def : t.readOnly ? 'allow' : 'ask')
    return { policy, override }
  }

  /** tool = '*' 이면 서버 기본값. value = null 이면 지정 해제 */
  setPolicy(key: string, tool: string, value: McpDefaultPolicy | null): void {
    const db = this.ws.store.db
    const p = { ...(db.mcpPolicy[key] ?? {}) }
    if (value === null || (tool !== '*' && value === 'auto')) delete p[tool]
    else p[tool] = value
    db.mcpPolicy[key] = p
    this.ws.store.save()
    this.changed()
  }

  private withPolicy(key: string, tools: BaseTool[]): McpToolInfo[] {
    return tools.map((t) => ({ ...t, ...this.policyOf(key, t) }))
  }

  /** 화면용 목록 (연결은 하지 않는다) */
  list(projectId?: string): McpServerInfo[] {
    return this.entries(projectId).map((e) => {
      const c = this.conns.get(e.key)
      const live = c && c.hash === e.hash ? c : undefined
      const status: McpStatus = !this.enabled(e) ? 'disabled' : !this.approved(e) ? 'unapproved' : (live?.status ?? 'idle')
      return {
        key: e.key,
        name: e.name,
        scope: e.scope,
        projectId: e.projectId,
        source: e.source,
        config: e.config,
        transport: transportOf(e.config),
        status,
        error: live?.error,
        log: live?.log.slice(-15).join('\n') || undefined,
        tools: this.withPolicy(e.key, live?.tools ?? []),
        defaultPolicy: this.policies(e.key)['*'] ?? 'auto',
        missing: this.missing(e),
        auth:
          'url' in e.config && !headerAuth(e.config)
            ? {
                loggedIn: this.provider(e.key).hasTokens(),
                pending: !!this.provider(e.key).interactive,
                authUrl: this.provider(e.key).interactive?.authUrl
              }
            : undefined
      }
    })
  }

  private changed(): void {
    this.ws.broadcast('mcp', null)
  }

  approve(key: string, projectId?: string): void {
    const e = this.entry(key, projectId)
    this.ws.store.db.trustedMcp[key] = e.hash
    this.ws.store.save()
    this.changed()
    void this.ensure(e).catch(() => undefined)
  }

  setEnabled(key: string, on: boolean): void {
    const db = this.ws.store.db
    db.mcpDisabled = db.mcpDisabled.filter((k) => k !== key)
    if (!on) {
      db.mcpDisabled.push(key)
      void this.close(key)
    }
    this.ws.store.save()
    this.changed()
  }

  async reconnect(key: string, projectId?: string): Promise<void> {
    await this.close(key)
    await this.ensure(this.entry(key, projectId)).catch(() => undefined)
  }

  /** 전역 서버 추가·바꾸기. 앱 화면에서 사용자가 직접 넣은 것이라 바로 승인한다 */
  saveGlobal(name: string, config: McpServerConfig): void {
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(name)) throw new Error('이름은 영문·숫자·_ . - 로 40자 이내')
    let raw: { mcpServers?: Record<string, unknown> } = {}
    try {
      raw = JSON.parse(fs.readFileSync(this.globalFile, 'utf8'))
    } catch {
      // 새 파일
    }
    raw.mcpServers = { ...(raw.mcpServers ?? {}), [name]: config }
    fs.mkdirSync(path.dirname(this.globalFile), { recursive: true })
    fs.writeFileSync(this.globalFile, JSON.stringify(raw, null, 2))
    const e = this.entry(`global:${name}`)
    this.ws.store.db.trustedMcp[e.key] = e.hash
    this.ws.store.save()
    void this.reconnect(e.key)
    this.changed()
  }

  /** 전역 설정 파일을 직접 열 수 있게 빈 틀을 만든다 */
  saveGlobalIfMissing(): void {
    if (fs.existsSync(this.globalFile)) return
    fs.mkdirSync(path.dirname(this.globalFile), { recursive: true })
    fs.writeFileSync(this.globalFile, JSON.stringify({ mcpServers: {} }, null, 2) + '\n')
  }

  removeGlobal(name: string): void {
    let raw: { mcpServers?: Record<string, unknown> } = {}
    try {
      raw = JSON.parse(fs.readFileSync(this.globalFile, 'utf8'))
    } catch {
      return
    }
    delete raw.mcpServers?.[name]
    fs.writeFileSync(this.globalFile, JSON.stringify(raw, null, 2))
    const key = `global:${name}`
    delete this.ws.store.db.trustedMcp[key]
    this.ws.store.save()
    void this.close(key)
    this.changed()
  }

  /** 프로젝트에 .mcp.json 이 없으면 빈 틀을 만든다. 상대 경로를 돌려준다 */
  initProjectFile(projectId: string): string {
    const p = this.ws.store.project(projectId)
    if (!p) throw new Error('프로젝트가 없습니다')
    const file = path.join(p.path, MCP_PROJECT_FILE)
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ mcpServers: {} }, null, 2) + '\n')
    return MCP_PROJECT_FILE
  }

  // ───────────── 연결

  private async close(key: string): Promise<void> {
    const c = this.conns.get(key)
    this.conns.delete(key)
    if (c?.client) await c.client.close().catch(() => undefined)
    this.changed()
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.conns.keys()].map((k) => this.close(k)))
  }

  /** 승인·켜짐 상태의 서버에 연결해 도구 목록을 받는다. 설정이 바뀌었으면 다시 연결 */
  private async ensure(e: Entry): Promise<Conn> {
    let c = this.conns.get(e.key)
    const run = this.runHash(e)
    if (c && (c.hash !== e.hash || c.run !== run)) {
      await this.close(e.key)
      c = undefined
    }
    if (c?.status === 'connected') return c
    if (c?.connecting) {
      await c.connecting
      return c
    }
    const conn: Conn = c ?? { hash: e.hash, run, status: 'connecting', tools: [], raw: [], log: [] }
    conn.status = 'connecting'
    conn.error = undefined
    this.conns.set(e.key, conn)
    this.changed()
    conn.connecting = this.open(e, conn).finally(() => {
      conn.connecting = undefined
      this.changed()
    })
    await conn.connecting
    return conn
  }

  private async open(e: Entry, conn: Conn): Promise<void> {
    const missing = this.missing(e)
    if (missing.length) {
      conn.status = 'error'
      conn.error = `비밀값이 없습니다: ${missing.join(', ')} (MCP 서버 화면의 비밀값에 추가하세요)`
      throw new Error(conn.error)
    }
    const cfg = expandConfig(e.config, this.lookup)
    let transport: Transport
    const provider = 'url' in cfg && !headerAuth(e.config) ? this.provider(e.key) : undefined
    if ('url' in cfg) {
      transport = this.remote(cfg, provider)
    } else {
      const project = e.projectId ? this.ws.store.project(e.projectId) : undefined
      const stdio = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args ?? [],
        env: { ...getDefaultEnvironment(), ...(cfg.env ?? {}) },
        cwd: cfg.cwd ? path.resolve(project?.path ?? os.homedir(), cfg.cwd) : (project?.path ?? os.homedir()),
        stderr: 'pipe'
      })
      stdio.stderr?.on('data', (d: Buffer) => {
        conn.log.push(...d.toString('utf8').split(/\r?\n/).filter(Boolean))
        if (conn.log.length > 200) conn.log.splice(0, conn.log.length - 200)
      })
      transport = stdio
    }
    const client = new Client({ name: 'agent-workspace', version: '0.1.0' })
    client.onclose = () => {
      if (this.conns.get(e.key) === conn && conn.status === 'connected') {
        conn.status = 'error'
        conn.error = '연결이 끊겼습니다'
        conn.client = undefined
        this.changed()
      }
    }
    try {
      await client.connect(transport, { timeout: CONNECT_TIMEOUT })
      const tools: Record<string, unknown>[] = []
      let cursor: string | undefined
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: CONNECT_TIMEOUT })
        tools.push(...(page.tools as unknown as Record<string, unknown>[]))
        cursor = page.nextCursor
      } while (cursor)
      conn.client = client
      conn.transport = transport
      conn.raw = tools
      conn.tools = tools.map((t) => {
        const a = (t.annotations ?? {}) as { readOnlyHint?: boolean; destructiveHint?: boolean }
        return {
          name: String(t.name),
          exposed: exposedName(e.name, String(t.name)),
          description: typeof t.description === 'string' ? t.description : undefined,
          readOnly: a.readOnlyHint,
          destructive: a.destructiveHint
        }
      })
      conn.status = 'connected'
    } catch (err) {
      await client.close().catch(() => undefined)
      const unauthorized = provider?.needsAuth || (err as Error).name === 'UnauthorizedError' || /unauthori[sz]ed|401/i.test(String((err as Error).message))
      conn.status = unauthorized && provider ? 'needsAuth' : 'error'
      conn.error =
        conn.status === 'needsAuth'
          ? '로그인이 필요합니다'
          : unauthorized && headerAuth(e.config)
            ? '인증 실패 (401): Authorization 헤더의 토큰을 확인하세요 (비밀값이 맞는지, 만료되지 않았는지)'
            : (err as Error).message || String(err)
      conn.client = undefined
      throw err
    }
  }

  // ───────────── 중계기용

  /** 이 프로젝트에서 쓸 수 있는 외부 도구 (승인·켜짐 서버 모두 연결 시도, 실패한 서버는 빼고) */
  async tools(projectId: string): Promise<ExposedTool[]> {
    const routes = new Map<string, { key: string; tool: string }>()
    const out: ExposedTool[] = []
    const live = this.entries(projectId).filter((e) => this.enabled(e) && this.approved(e))
    const conns = await Promise.all(live.map((e) => this.ensure(e).then((c) => [e, c] as const, () => null)))
    for (const pair of conns) {
      if (!pair) continue
      const [e, c] = pair
      c.raw.forEach((t, i) => {
        const info = c.tools[i]
        if (routes.has(info.exposed) || this.policyOf(e.key, info).policy === 'deny') return
        routes.set(info.exposed, { key: e.key, tool: info.name })
        out.push({
          name: info.exposed,
          description: `[${e.name} · 외부 MCP] ${info.description ?? ''}`.trim(),
          inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
          annotations: t.annotations
        })
      })
    }
    this.routes.set(projectId, routes)
    return out
  }

  /** 외부 도구 호출. 정책(허용/확인/차단)을 거쳐 결과(CallToolResult)를 그대로 돌려준다 */
  async call(projectId: string, exposed: string, args: unknown, origin: WriteOrigin): Promise<unknown> {
    let route = this.routes.get(projectId)?.get(exposed)
    if (!route) {
      await this.tools(projectId)
      route = this.routes.get(projectId)?.get(exposed)
    }
    if (!route) throw new Error(`알 수 없거나 차단된 외부 MCP 도구: ${exposed}`)
    const e = this.entry(route.key, projectId)
    if (!this.enabled(e) || !this.approved(e)) throw new Error(`${e.name} 서버가 꺼져 있거나 승인되지 않았습니다`)
    const c = await this.ensure(e)
    if (!c.client) throw new Error(`${e.name} 서버에 연결하지 못했습니다: ${c.error ?? ''}`)
    const info = c.tools.find((t) => t.name === route.tool)
    const started = Date.now()
    const session = origin.sessionId ? this.ws.store.session(origin.sessionId) : undefined
    const record = (decision: McpCallRecord['decision'], ok: boolean, error?: string): void => {
      const list = this.ws.store.db.mcpCalls
      list.push({ id: randomUUID(), at: Date.now(), projectId, sessionId: origin.sessionId, server: e.name, tool: route.tool, decision, ok, durationMs: Date.now() - started, error })
      if (list.length > MAX_CALLS) list.splice(0, list.length - MAX_CALLS)
      const what = `MCP ${e.name}.${route.tool}`
      this.ws.log(session, 'mcp', ok ? what : `${what} ${decision === 'deny' ? '거부' : '실패'}${error ? `: ${error.slice(0, 120)}` : ''}`, projectId)
    }

    // 정책
    const { policy } = info ? this.policyOf(e.key, info) : { policy: 'ask' as McpPolicy }
    let decision: McpCallRecord['decision'] = 'allow'
    if (policy === 'deny') {
      record('deny', false, '정책상 차단')
      throw new Error(`${e.name}.${route.tool} 은(는) 차단된 도구입니다 (MCP 서버 화면에서 바꿀 수 있습니다)`)
    }
    if (policy === 'ask') {
      try {
        const d = await this.ws.permissions.check(
          origin,
          { type: 'mcpTool', serverKey: e.key, server: e.name, tool: route.tool, args },
          { summary: `${e.name} 서버의 ${route.tool} 도구 실행${info?.destructive ? ' (변경·삭제할 수 있는 도구)' : ''}` }
        )
        decision = d === 'always' ? 'always' : 'once'
        if (d === 'always') this.setPolicy(e.key, route.tool, 'allow')
      } catch (err) {
        record('deny', false, (err as Error).message)
        throw err
      }
    }

    try {
      const result = (await c.client.callTool({ name: route.tool, arguments: (args ?? {}) as Record<string, unknown> }, undefined, {
        timeout: CALL_TIMEOUT,
        resetTimeoutOnProgress: true
      })) as { content?: { type: string; text?: string }[]; isError?: boolean }
      for (const part of result.content ?? []) {
        if (part.type === 'text' && part.text && part.text.length > MAX_TEXT) part.text = part.text.slice(0, MAX_TEXT) + '\n…(잘림)'
      }
      const errText = result.isError ? result.content?.find((p) => p.type === 'text')?.text : undefined
      record(decision, !result.isError, errText)
      return result
    } catch (err) {
      record(decision, false, (err as Error).message)
      throw err
    }
  }
}
