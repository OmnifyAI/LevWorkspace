import type {
  AppState,
  Asset,
  FilePreview,
  FsEntry,
  GitBranch,
  GitChange,
  GitCommit,
  GitCommitDetail,
  GitFileChange,
  GitRepoStatus,
  McpDefaultPolicy,
  McpSecretList,
  McpServerConfig,
  McpServerInfo,
  Message,
  NewMultiRunInput,
  PermissionDecision,
  PermissionRequest,
  WriteAction,
  NewProjectInput,
  NewSessionInput,
  Project,
  ProviderConfig,
  ProviderId,
  Session,
  Skill,
  SkillInput,
  SpawnChildInput
} from '../../shared/types'
import type { ApiInfo, BoardInfo, DataFileEntry, FileEncoding, DashboardLoad, NewBoardInput, Query, QueryResult, ScriptInfo, ScriptResult, ScriptRunOptions, SourceSchema } from '../../shared/dashboard'

interface Bridge {
  invoke(channel: string, ...args: unknown[]): Promise<any>
  on(channel: string, cb: (payload: any) => void): () => void
  pathForFile(file: File): string
  platform: string
}

declare global {
  interface Window {
    api: Bridge
  }
}

const bridge = window.api
const call = <T = void>(channel: string, ...args: unknown[]): Promise<T> => bridge.invoke(channel, ...args)

export const api = {
  on: bridge.on,
  pathForFile: bridge.pathForFile,
  platform: bridge.platform,

  getState: () => call<AppState>('state:get'),
  setSettings: (patch: Partial<AppState['settings']>) => call('settings:set', patch),
  pickFolder: () => call<{ path: string; name: string } | null>('dialog:pickFolder'),
  pickFiles: () => call<string[]>('dialog:pickFiles'),

  createProject: (input: NewProjectInput) => call<Project>('project:create', input),
  updateProject: (id: string, patch: Partial<Project>) => call('project:update', id, patch),
  removeProject: (id: string) => call('project:remove', id),
  openProject: (id: string) => call('project:open', id),

  updateProvider: (id: ProviderId, patch: Partial<ProviderConfig>) => call('provider:update', id, patch),
  detect: (id?: ProviderId) => call('provider:detect', id),

  createSession: (input: NewSessionInput) => call<Session>('session:create', input),
  updateSession: (id: string, patch: Partial<Session>) => call('session:update', id, patch),
  removeSession: (id: string) => call('session:remove', id),
  resetSession: (id: string) => call('session:reset', id),
  send: (id: string, prompt: string) => call('session:send', id, prompt),
  stop: (id: string) => call('session:stop', id),
  messages: (id: string) => call<Message[]>('session:messages', id),
  spawnChild: (parentId: string, input: SpawnChildInput) => call<Session>('session:spawnChild', parentId, input),
  reportToParent: (childId: string) => call('session:report', childId),

  startMulti: (input: NewMultiRunInput) => call<string>('multi:start', input),
  stopMulti: (id: string) => call('multi:stop', id),
  removeMulti: (id: string, withSessions: boolean) => call('multi:remove', id, withSessions),

  createSkill: (projectId: string, input: SkillInput) => call<Skill>('skill:create', projectId, input),
  updateSkill: (projectId: string, id: string, patch: Partial<SkillInput>) => call('skill:update', projectId, id, patch),
  removeSkill: (projectId: string, id: string) => call('skill:remove', projectId, id),
  openSkillsFolder: (projectId: string, id?: string) => call('skill:openFolder', projectId, id),
  importSkills: (projectId: string) => call<string[]>('skill:import', projectId),
  exportSkillsToClaude: (projectId: string) => call<string[]>('skill:exportClaude', projectId),

  importAssets: (projectId: string, files: string[]) => call<Asset[]>('asset:import', projectId, files),
  rescanAssets: (projectId: string) => call<number>('asset:rescan', projectId),
  updateAsset: (id: string, patch: Partial<Pick<Asset, 'tags' | 'note'>>) => call('asset:update', id, patch),
  removeAsset: (id: string, trash: boolean) => call('asset:remove', id, trash),
  readAssetText: (id: string) => call<string>('asset:readText', id),
  revealAsset: (id: string) => call('asset:reveal', id),

  listDir: (projectId: string, rel: string) => call<FsEntry[]>('fs:list', projectId, rel),
  readFile: (projectId: string, rel: string) => call<FilePreview>('fs:read', projectId, rel),
  revealFile: (projectId: string, rel: string) => call('fs:reveal', projectId, rel),
  gitStatus: (projectId: string) => call<GitChange[] | null>('git:status', projectId),
  gitDiff: (projectId: string, rel: string) => call<string>('git:diff', projectId, rel),
  attachFile: (sessionId: string, rel: string) => call('session:attachFile', sessionId, rel),
  // Git 화면
  gitRepo: (projectId: string) => call<GitRepoStatus>('git:repo', projectId),
  gitLog: (projectId: string, opts: { limit?: number; skip?: number; all?: boolean; path?: string }) => call<GitCommit[]>('git:log', projectId, opts),
  gitCommitDetail: (projectId: string, hash: string) => call<GitCommitDetail>('git:commitDetail', projectId, hash),
  gitCommitFileDiff: (projectId: string, hash: string, rel: string) => call<string>('git:commitFileDiff', projectId, hash, rel),
  gitWorkDiff: (projectId: string, rel: string, staged: boolean) => call<string>('git:workDiff', projectId, rel, staged),
  gitBranches: (projectId: string) => call<GitBranch[]>('git:branches', projectId),
  gitStage: (projectId: string, rels: string[] | 'all') => call('git:stage', projectId, rels),
  gitUnstage: (projectId: string, rels: string[] | 'all', hasCommits: boolean) => call('git:unstage', projectId, rels, hasCommits),
  gitDiscard: (projectId: string, files: GitFileChange[]) => call('git:discard', projectId, files),
  gitCommit: (projectId: string, message: string, opts?: { amend?: boolean }) => call<string>('git:commit', projectId, message, opts),
  gitSwitch: (projectId: string, name: string) => call('git:switch', projectId, name),
  gitCreateBranch: (projectId: string, name: string, from?: string) => call('git:createBranch', projectId, name, from),
  gitDeleteBranch: (projectId: string, name: string) => call('git:deleteBranch', projectId, name),
  gitFetch: (projectId: string) => call('git:fetch', projectId),
  gitPull: (projectId: string) => call<string>('git:pull', projectId),
  gitPush: (projectId: string) => call<string>('git:push', projectId),
  gitInit: (projectId: string) => call('git:init', projectId),

  getDashboard: (projectId: string, board: string) => call<DashboardLoad>('dashboard:get', projectId, board),
  listBoards: (projectId: string) => call<BoardInfo[]>('board:list', projectId),
  createBoard: (projectId: string, input: NewBoardInput) => call<BoardInfo>('board:create', projectId, input),
  removeBoard: (projectId: string, board: string) => call('board:remove', projectId, board),
  query: (projectId: string, q: Query) => call<QueryResult>('data:query', projectId, q),
  schema: () => call<SourceSchema[]>('data:schema'),
  apiInfo: () => call<ApiInfo>('api:info'),
  panelReadFile: (projectId: string, rel: string, encoding?: FileEncoding) => call<string>('panel:fileRead', projectId, rel, encoding),
  panelListFiles: (projectId: string, dir: string) => call<DataFileEntry[]>('panel:fileList', projectId, dir),
  panelSaveFile: (projectId: string, src: string, rel: string, content: unknown, encoding?: FileEncoding) =>
    call<{ path: string; bytes: number }>('panel:fileSave', projectId, src, rel, content, encoding),
  panelSaveAs: (projectId: string, content: unknown, name: string, encoding?: FileEncoding) =>
    call<{ path: string; bytes: number } | null>('panel:saveAs', projectId, content, name, encoding),
  reportPanelError: (projectId: string, src: string, message: string) => call('panel:error', projectId, src, message),
  writeFromPanel: (projectId: string, src: string, action: WriteAction) => call<Record<string, unknown>>('write:panel', projectId, src, action),
  pendingPermissions: () => call<PermissionRequest[]>('permission:list'),
  respondPermission: (id: string, decision: PermissionDecision) => call('permission:respond', id, decision),
  revokeGrant: (key: string) => call('permission:revoke', key),
  removeCliRule: (projectId: string, rule: string) => call('cliRule:remove', projectId, rule),
  listMcp: (projectId?: string) => call<McpServerInfo[]>('mcp:list', projectId),
  connectMcp: (projectId: string) => call<McpServerInfo[]>('mcp:connect', projectId),
  approveMcp: (key: string, projectId?: string) => call('mcp:approve', key, projectId),
  setMcpEnabled: (key: string, on: boolean) => call('mcp:setEnabled', key, on),
  reconnectMcp: (key: string, projectId?: string) => call('mcp:reconnect', key, projectId),
  setMcpPolicy: (key: string, tool: string, value: McpDefaultPolicy | null) => call('mcp:setPolicy', key, tool, value),
  mcpSecrets: () => call<McpSecretList>('mcp:secrets'),
  setMcpSecret: (name: string, value: string) => call('mcp:setSecret', name, value),
  removeMcpSecret: (name: string) => call('mcp:removeSecret', name),
  mcpLogin: (key: string, projectId?: string) => call('mcp:login', key, projectId),
  mcpCancelLogin: (key: string) => call('mcp:cancelLogin', key),
  mcpLogout: (key: string) => call('mcp:logout', key),
  mcpOpenUrl: (url: string) => call('mcp:openUrl', url),
  saveGlobalMcp: (name: string, config: McpServerConfig) => call('mcp:saveGlobal', name, config),
  removeGlobalMcp: (name: string) => call('mcp:removeGlobal', name),
  initProjectMcpFile: (projectId: string) => call<string>('mcp:initProjectFile', projectId),
  openGlobalMcpFile: () => call('mcp:openGlobalFile'),
  listScripts: (projectId: string) => call<ScriptInfo[]>('script:list', projectId),
  runScript: (projectId: string, name: string, args: unknown, options: ScriptRunOptions | undefined, origin: string) =>
    call<ScriptResult>('script:run', projectId, name, args, options, origin)
}

/** 프로젝트 파일을 <img> 로 띄우기 위한 주소 */
export const fileUrl = (projectId: string, rel: string): string =>
  `ws-file://${projectId}/${rel.split('/').map(encodeURIComponent).join('/')}`

/** IPC 에러 메시지에서 Electron 접두어를 떼어낸다 */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
