import type { AccessSettings } from './access'
export type ProviderId = 'claude' | 'codex' | 'gemini'

export const PROVIDER_IDS: ProviderId[] = ['claude', 'codex', 'gemini']

export const INSTALL_HINTS: Record<ProviderId, string> = {
  claude: 'npm install -g @anthropic-ai/claude-code',
  codex: 'npm install -g @openai/codex',
  gemini: 'npm install -g @google/gemini-cli'
}

/** 권한/자동 승인 관련으로 자주 쓰는 추가 인자 예시 */
export const EXTRA_ARG_HINTS: Record<ProviderId, string> = {
  claude: '--permission-mode acceptEdits',
  codex: '--sandbox workspace-write',
  gemini: '--approval-mode auto_edit'
}

/** /model 자동완성 후보. 'default' 는 CLI 기본값으로 되돌린다. 목록 밖의 이름도 입력할 수 있다. */
export const MODEL_HINTS: Record<ProviderId, string[]> = {
  claude: [
    'opus',
    'sonnet',
    'haiku',
    'claude-fable-5-1',
    'claude-opus-5-5',
    'claude-sonnet-5-5',
    'claude-haiku-5-5',
    'claude-opus-5',
    'claude-sonnet-5',
    'claude-opus-4-8',
    'claude-sonnet-4-6',
    'claude-haiku-4-5'
  ],
  codex: [],
  gemini: []
}

export interface ProviderConfig {
  id: ProviderId
  label: string
  /** 실행 파일 이름 또는 전체 경로 */
  command: string
  /** 기본 모델 (빈 문자열이면 CLI 기본값) */
  model: string
  /** 매 실행마다 덧붙일 인자 (예: --permission-mode acceptEdits) */
  extraArgs: string
  enabled: boolean
  /** 앱이 띄우는 세션에 Workspace MCP 서버를 자동 연결 */
  mcp: boolean
}

export interface ProviderStatus {
  id: ProviderId
  available: boolean
  version?: string
  error?: string
  checkedAt: number
}

export interface Project {
  id: string
  name: string
  /** 에이전트가 작업하는 디렉터리 (cwd) */
  path: string
  description: string
  defaultProvider: ProviderId
  /** 새 세션에 기본으로 넣는 스킬 (.skills 아래 폴더 이름) */
  skillIds: string[]
  createdAt: number
  updatedAt: number
}

export type SessionStatus = 'idle' | 'running' | 'error'

export interface Session {
  id: string
  projectId: string
  title: string
  provider: ProviderId
  model: string
  status: SessionStatus
  /** CLI가 돌려준 세션 id (resume 용) */
  cliSessionId?: string
  /** ChildAgent: 부모 세션 */
  parentId?: string
  depth: number
  /** 자식 결과를 부모에게 자동 보고 */
  autoReport: boolean
  /** 같은 턴에 생성된 자식 묶음 — 모두 끝나면 한 번에 보고 */
  batchId?: string
  pendingReport?: boolean
  /** 에이전트가 <delegate> 블록으로 자식 에이전트를 만들 수 있음 */
  allowDelegation: boolean
  multiRunId?: string
  skillIds: string[]
  assetIds: string[]
  /** 실행 중에 들어온 프롬프트 대기열 */
  queue: QueueItem[]
  lastOutput?: string
  lastTurnOk?: boolean
  lastError?: string
  costUsd?: number
  /** 이 세션에만 덧붙이는 CLI 인자 (CLI 연결 설정의 추가 인자 뒤에 붙음) */
  extraArgs?: string
  /** codex·gemini 권한 프리셋 (없으면 CLI 설정 그대로) */
  access?: AccessSettings
  /** 현재 턴 시작 시각과 진행 중인 단계 (대시보드 표시용) */
  runStartedAt?: number
  currentStep?: string
  /** CLI 가 실제로 쓰고 있다고 알려 준 모델 (claude/gemini init 이벤트) */
  cliModel?: string
  createdAt: number
  updatedAt: number
}

export type MessageRole = 'user' | 'assistant' | 'tool' | 'system' | 'error'

export interface Message {
  id: string
  sessionId: string
  role: MessageRole
  content: string
  title?: string
  /** 다른 에이전트가 보낸 메시지·답장 (role: 'user') */
  from?: MessageFrom
  createdAt: number
}

/** 에이전트 간 메시지의 보낸 쪽 */
export interface MessageFrom {
  sessionId: string
  title: string
  provider: ProviderId
  /** 내가 보낸 메시지에 대한 자동 답장 */
  reply?: boolean
}

/** 대기열 항목: 사용자 입력(문자열) 또는 다른 에이전트가 보낸 메시지 */
export type QueueItem = string | { prompt: string; from: MessageFrom; requestId?: string }

export const SKILLS_DIR = '.skills'

/**
 * 프로젝트 폴더의 .skills/<id>/SKILL.md 하나. 파일이 원본이고 앱은 읽어서 보여준다.
 * id 는 폴더 이름이라 프로젝트 안에서만 고유하다 — 항상 projectId 와 함께 찾는다.
 */
export interface Skill {
  id: string
  projectId: string
  name: string
  description: string
  content: string
  /** 프로젝트 기준 SKILL.md 경로 (posix) */
  relPath: string
  /** 스킬 폴더 안의 다른 파일 (참고 자료, 스크립트 등) — 스킬 폴더 기준 경로 */
  extraFiles: string[]
  /** SKILL.md 수정 시각 */
  updatedAt: number
}

export interface Asset {
  id: string
  projectId: string
  name: string
  /** 프로젝트 경로 기준 상대 경로 (posix 구분자) */
  relPath: string
  size: number
  mime: string
  tags: string[]
  note: string
  createdAt: number
}

export type MultiMode = 'parallel' | 'pipeline'

export interface MultiAgentSpec {
  provider: ProviderId
  model: string
  role: string
}

export interface MultiRun {
  id: string
  projectId: string
  title: string
  prompt: string
  mode: MultiMode
  agents: MultiAgentSpec[]
  sessionIds: string[]
  synthesizer?: MultiAgentSpec
  synthesizerSessionId?: string
  /** pipeline 모드에서 현재 단계 */
  step: number
  status: 'running' | 'done' | 'error'
  createdAt: number
}

export interface Settings {
  lastProjectId?: string
  /** 좌/우 패널 폭 (px) */
  leftWidth?: number
  rightWidth?: number
  /** 에이전트 목록 사이드바 폭 (px) */
  agentsWidth?: number
  /** 왼쪽 내비게이션을 아이콘만 보이게 접음 */
  navCollapsed?: boolean
  /** 에이전트 목록 사이드바를 숨김 */
  agentsHidden?: boolean
  /** 프로젝트 id → 즐겨찾기한 보드 id (왼쪽 내비에 바로가기로) */
  favoriteBoards?: Record<string, string[]>
  /** 패널·에이전트의 쓰기 동작: ask = 매번 확인(기본), deny = 모두 거부 */
  writeActions?: 'ask' | 'deny'
  /** 자동 모드: 확인 창이 뜰 요청(CLI 도구·MCP 확인 도구·쓰기 동작)을 모두 묻지 않고 허용. 차단 정책·쓰기 끔은 그대로 */
  autoApprove?: boolean
}

/** CLI 가 시작할 때 알려 준 정보 — 채팅 입력창의 / 명령 자동완성에 쓴다 */
export interface CliInfo {
  model?: string
  /** 슬래시 명령 이름 (앞의 / 없이) */
  commands: string[]
  /** commands 중 스킬인 것 */
  skills: string[]
  at: number
}

export interface AppState {
  projects: Project[]
  sessions: Session[]
  skills: Skill[]
  assets: Asset[]
  multiRuns: MultiRun[]
  providers: ProviderConfig[]
  providerStatus: Partial<Record<ProviderId, ProviderStatus>>
  settings: Settings
  activity: ActivityItem[]
  grants: Grant[]
  cliInfo: Partial<Record<ProviderId, CliInfo>>
  /** 프로젝트별로 "항상 허용"한 claude 도구 규칙 (claude 권한 문법: Bash(npm *), WebFetch(domain:x), 도구 이름) */
  cliRules: Record<string, string[]>
}

/** 끝난 턴 하나의 기록 (비용 추이·성공률 집계용) */
export interface TurnRecord {
  id: string
  at: number
  projectId: string
  sessionId: string
  provider: ProviderId
  model: string
  ok: boolean
  costUsd: number
  durationMs: number
}

export type ActivityKind = 'start' | 'done' | 'error' | 'stopped' | 'delegate' | 'report' | 'multi' | 'write' | 'mcp'

// ───────────────────────── 쓰기 동작과 권한

/** 패널·에이전트·외부 도구가 요청할 수 있는 쓰기 동작 */
export type WriteAction =
  | { type: 'sendMessage'; sessionId: string; prompt: string; wait?: boolean }
  | {
      type: 'createSession'
      title?: string
      prompt?: string
      provider?: ProviderId
      model?: string
      /** 요청한 에이전트 세션의 자식 에이전트로 만든다 (에이전트 출처만) */
      child?: boolean
    }
  | { type: 'stopSession'; sessionId: string }
  /** 에이전트가 앱이 중계하는 외부 MCP 도구를 부른다 (정책이 "확인"일 때만 묻는다) */
  | { type: 'mcpTool'; serverKey: string; server: string; tool: string; args: unknown }
  /** claude CLI 자체 도구(WebFetch·Bash·Skill 등)의 권한 질문 — --permission-prompt-tool 로 앱에 온다 */
  | { type: 'cliTool'; tool: string; input: unknown; rule: string }
  /** 패널이 .dashboard/data 안에 파일을 쓴다 (내용은 확인 창에 미리보기만) */
  | { type: 'saveFile'; path: string; bytes: number; preview: string; exists: boolean }

export type WriteActionType = WriteAction['type']

export const WRITE_ACTION_LABEL: Record<WriteActionType, string> = {
  sendMessage: '메시지 보내기',
  createSession: '세션 만들기',
  stopSession: '세션 중지',
  saveFile: '파일 저장',
  mcpTool: 'MCP 도구 실행',
  cliTool: 'CLI 도구 사용'
}

/** 요청한 쪽. key 가 같으면 같은 출처로 보고 "항상 허용"을 공유한다 */
export interface WriteOrigin {
  kind: 'panel' | 'agent' | 'api'
  key: string
  label: string
  projectId: string
  /** agent: 요청한 세션 */
  sessionId?: string
}

export interface PermissionRequest {
  id: string
  at: number
  origin: WriteOrigin
  action: WriteAction
  /** 한 줄 설명 */
  summary: string
  /** 대상 세션 (메시지 보내기·중지) */
  target?: { id: string; title: string; provider: ProviderId; status: SessionStatus }
  /** 이 요청이 거부되는 시각 */
  expiresAt: number
}

export type PermissionDecision = 'deny' | 'once' | 'always'

/** "항상 허용" 기록 */
export interface Grant {
  key: string
  originKey: string
  originLabel: string
  originKind: WriteOrigin['kind']
  action: WriteActionType
  projectId: string
  grantedAt: number
}

/** 대시보드 '최근 활동'에 쓰는 이벤트 기록 */
export interface ActivityItem {
  id: string
  at: number
  projectId: string
  sessionId?: string
  kind: ActivityKind
  text: string
}

export interface FsEntry {
  name: string
  /** 프로젝트 기준 상대 경로 (posix 구분자) */
  rel: string
  dir: boolean
}

/** git status 의 한 줄. M 수정, A 추가, D 삭제, R 이름변경, U 추적 안 됨 */
export interface GitChange {
  rel: string
  code: 'M' | 'A' | 'D' | 'R' | 'U'
}

export type FilePreview =
  | { kind: 'text'; size: number; content: string; truncated: boolean }
  | { kind: 'image'; size: number; mime: string }
  | { kind: 'binary'; size: number; mime: string }

export interface NewProjectInput {
  name: string
  path: string
  description: string
  defaultProvider: ProviderId
}

export interface NewSessionInput {
  projectId: string
  title: string
  provider: ProviderId
  model: string
  allowDelegation: boolean
  skillIds: string[]
  assetIds: string[]
  prompt?: string
  extraArgs?: string
  access?: AccessSettings
}

/** 대시보드 빌더 세션에 주는 권한 — 파일 편집과 Data API 호출(curl)을 자동 승인 */
export const BUILDER_ARGS: Record<ProviderId, string> = {
  claude: '--permission-mode acceptEdits --allowedTools "Bash(aw:*)" "PowerShell(aw:*)" "Bash(curl:*)"',
  // codex 0.16x: --full-auto 가 없어졌다. 작업 폴더 쓰기 + 묻지 않음 + aw·curl 이 로컬 API 에 닿도록 네트워크
  codex: '--sandbox workspace-write -c approval_policy=never -c sandbox_workspace_write.network_access=true',
  gemini: '--approval-mode auto_edit'
}

export interface SpawnChildInput {
  title: string
  provider: ProviderId
  model: string
  prompt: string
  autoReport: boolean
}

export interface NewMultiRunInput {
  projectId: string
  title: string
  prompt: string
  mode: MultiMode
  agents: MultiAgentSpec[]
  synthesizer?: MultiAgentSpec
  skillIds: string[]
  assetIds: string[]
}

export interface SkillInput {
  name: string
  description: string
  content: string
}

// ───────────────────────── 외부 MCP 서버 (앱이 중계)

/** 프로젝트 MCP 설정 파일 (claude 의 .mcp.json 과 같은 형식) */
export const MCP_PROJECT_FILE = '.mcp.json'

/** .mcp.json 의 서버 하나: stdio(command) 또는 원격(url) */
export type McpServerConfig =
  | { command: string; args?: string[]; env?: Record<string, string>; cwd?: string; type?: 'stdio' }
  | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }

export type McpScope = 'global' | 'project'
export type McpStatus = 'disabled' | 'unapproved' | 'idle' | 'connecting' | 'connected' | 'needsAuth' | 'error'

/** 외부 MCP 도구 정책: 자동 허용 / 매번 확인 / 차단(CLI 에 보이지도 않음) */
export type McpPolicy = 'allow' | 'ask' | 'deny'
/** 서버 기본값. auto = 도구 주석으로 정함 (readOnlyHint → 허용, 그 밖 → 확인) */
export type McpDefaultPolicy = McpPolicy | 'auto'

export const MCP_POLICY_LABEL: Record<McpDefaultPolicy, string> = { auto: '자동 (주석 기준)', allow: '자동 허용', ask: '매번 확인', deny: '차단' }

/** 외부 MCP 도구 호출 기록 (mcpCalls 데이터 소스) */
export interface McpCallRecord {
  id: string
  at: number
  projectId: string
  sessionId?: string
  server: string
  tool: string
  /** allow = 정책상 자동, once/always = 확인 창에서 허용, deny = 거부·차단 */
  decision: 'allow' | 'once' | 'always' | 'deny'
  ok: boolean
  durationMs: number
  error?: string
}

export interface McpToolInfo {
  /** 서버가 쓰는 원래 이름 */
  name: string
  /** CLI 에 보이는 이름 (<서버>__<도구>) */
  exposed: string
  description?: string
  readOnly?: boolean
  destructive?: boolean
  /** 실제로 적용되는 정책 */
  policy: McpPolicy
  /** 이 도구에 직접 정한 정책 (없으면 서버 기본값을 따른다) */
  override?: McpPolicy
}

export interface McpServerInfo {
  /** global:<이름> 또는 project:<projectId>:<이름> */
  key: string
  name: string
  scope: McpScope
  projectId?: string
  /** 설정이 들어 있는 파일 */
  source: string
  config: McpServerConfig
  transport: 'stdio' | 'http' | 'sse'
  status: McpStatus
  error?: string
  /** stdio 서버의 마지막 stderr 몇 줄 */
  log?: string
  defaultPolicy: McpDefaultPolicy
  tools: McpToolInfo[]
  /** 기본값 없이 쓰였는데 비밀값·환경 변수에 없는 ${VAR} */
  missing: string[]
  /** 원격 서버의 OAuth 상태 */
  auth?: { loggedIn: boolean; pending: boolean; authUrl?: string }
}

/** 비밀값 목록 (값은 보내지 않는다) */
export interface McpSecretList {
  /** OS 키 저장소를 쓸 수 있는지 */
  available: boolean
  items: { name: string; stored: boolean; fromEnv: boolean; /** 모든 사용처에 :-기본값 이 있다 */ hasDefault: boolean; usedBy: string[] }[]
}

// ───────────────────────── Git

/** 작업 폴더의 파일 하나 (porcelain v2: index·work 는 X·Y 글자, '.' = 변경 없음) */
export interface GitFileChange {
  rel: string
  /** 이름 변경의 원래 경로 */
  orig?: string
  index: string
  work: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  conflict: boolean
}

export interface GitRepoStatus {
  isRepo: boolean
  branch?: string
  detached?: boolean
  upstream?: string
  ahead: number
  behind: number
  files: GitFileChange[]
  /** 첫 커밋 전이면 false */
  hasCommits: boolean
  remotes: string[]
}

export interface GitCommit {
  hash: string
  short: string
  parents: string[]
  author: string
  email: string
  /** ms */
  date: number
  subject: string
  /** 브랜치·태그 이름 (HEAD 는 "→ 이름") */
  refs: string[]
}

export interface GitCommitDetail extends GitCommit {
  body: string
  files: { rel: string; orig?: string; code: string; adds?: number; dels?: number }[]
}

export interface GitBranch {
  name: string
  remote: boolean
  current: boolean
  upstream?: string
  ahead: number
  behind: number
  /** 추적하던 원격 브랜치가 사라짐 */
  gone: boolean
  date: number
  subject: string
}
