import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type {
  ActivityItem,
  Asset,
  CliInfo,
  Grant,
  McpCallRecord,
  McpDefaultPolicy,
  Message,
  MultiRun,
  Project,
  ProviderConfig,
  ProviderId,
  Session,
  Settings,
  TurnRecord
} from '../shared/types'

export interface LegacySkill {
  id: string
  name: string
  description: string
  content: string
}

export interface DB {
  version: 1
  projects: Project[]
  sessions: Session[]
  /** 예전 버전의 전역 스킬. 시작할 때 각 프로젝트의 .skills 로 옮기고 비운다 */
  skills: LegacySkill[]
  assets: Asset[]
  multiRuns: MultiRun[]
  providers: ProviderConfig[]
  settings: Settings
  activity: ActivityItem[]
  /** 끝난 턴 기록 (최근 5000개) */
  turns: TurnRecord[]
  /** 실행을 승인한 대시보드 스크립트: "<projectId>:<이름>" → 내용 sha256 */
  trustedScripts: Record<string, string>
  /** 승인한 외부 MCP 서버: 서버 key → 설정 sha256 */
  trustedMcp: Record<string, string>
  /** 꺼 둔 외부 MCP 서버 key */
  mcpDisabled: string[]
  /** 외부 MCP 도구 정책: 서버 key → 도구 이름('*' = 서버 기본값) → 정책 */
  mcpPolicy: Record<string, Record<string, McpDefaultPolicy>>
  /** 외부 MCP 도구 호출 기록 (최근 5000개) */
  mcpCalls: McpCallRecord[]
  /** 쓰기 동작 "항상 허용": "<출처 key>:<동작>" → 기록 */
  grants: Record<string, Grant>
  /** 프로젝트 id → "항상 허용"한 claude 도구 규칙 */
  cliRules: Record<string, string[]>
  /** CLI 별 마지막으로 받은 시작 정보 (슬래시 명령 목록 등) */
  cliInfo: Partial<Record<ProviderId, CliInfo>>
  messages: Record<string, Message[]>
}

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: 'claude', label: 'Claude Code', command: 'claude', model: '', extraArgs: '', enabled: true, mcp: true },
  { id: 'codex', label: 'OpenAI Codex', command: 'codex', model: '', extraArgs: '', enabled: true, mcp: true },
  { id: 'gemini', label: 'Gemini CLI', command: 'gemini', model: '', extraArgs: '', enabled: true, mcp: true }
]

function emptyDB(): DB {
  return {
    version: 1,
    projects: [],
    sessions: [],
    skills: [],
    assets: [],
    multiRuns: [],
    providers: DEFAULT_PROVIDERS.map((p) => ({ ...p })),
    settings: {},
    activity: [],
    turns: [],
    trustedScripts: {},
    trustedMcp: {},
    mcpDisabled: [],
    mcpPolicy: {},
    mcpCalls: [],
    grants: {},
    cliRules: {},
    cliInfo: {},
    messages: {}
  }
}

/** 단일 JSON 파일 저장소. 변경은 디바운스되어 원자적으로 기록된다. */
export class Store {
  db: DB
  readonly dataDir: string
  private file: string
  private timer: NodeJS.Timeout | null = null

  constructor() {
    this.dataDir = path.join(app.getPath('userData'), 'data')
    fs.mkdirSync(this.dataDir, { recursive: true })
    this.file = path.join(this.dataDir, 'workspace.json')
    this.db = this.load()
  }

  private load(): DB {
    const db = emptyDB()
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<DB>
      Object.assign(db, raw)
      // 새 버전에서 추가된 provider 가 빠지지 않도록 기본값과 병합
      db.providers = DEFAULT_PROVIDERS.map((d) => ({
        ...d,
        ...(raw.providers ?? []).find((p) => p.id === d.id)
      }))
    } catch {
      // 첫 실행이거나 손상된 파일 — 빈 DB로 시작
    }
    // 앱이 꺼질 때 실행 중이던 프로세스는 이미 없다
    for (const s of db.sessions) {
      if (s.status === 'running') s.status = 'idle'
      s.queue = []
      s.runStartedAt = undefined
      s.currentStep = undefined
    }
    for (const r of db.multiRuns) if (r.status === 'running') r.status = 'error'
    return db
  }

  save(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 300)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.db))
    fs.renameSync(tmp, this.file)
  }

  project(id: string): Project | undefined {
    return this.db.projects.find((p) => p.id === id)
  }

  session(id: string): Session | undefined {
    return this.db.sessions.find((s) => s.id === id)
  }

  provider(id: ProviderId): ProviderConfig | undefined {
    return this.db.providers.find((p) => p.id === id)
  }

  messages(sessionId: string): Message[] {
    return (this.db.messages[sessionId] ??= [])
  }
}
