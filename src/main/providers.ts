import { spawn, type ChildProcess, type SpawnOptions, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ProviderConfig, ProviderId, ProviderStatus, Session } from '../shared/types'
import { accessArgs, stripAccessArgs } from '../shared/access'

const isWin = process.platform === 'win32'

/** 따옴표를 존중하는 간단한 인자 분리기 */
export function splitArgs(input: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input))) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

function quoteWin(arg: string): string {
  return /[\s"&|<>^()%!]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
}

/**
 * CLI 실행. Windows 에서는 npm 으로 설치된 .cmd shim 도 실행되도록 셸을 거친다.
 * 프롬프트는 항상 stdin 으로 넘기므로 셸 인자에는 단순한 값만 들어간다.
 */
export function spawnCli(command: string, args: string[], opts: SpawnOptions): ChildProcess {
  const env = { ...process.env, ...opts.env }
  // Claude Code 안에서 앱을 띄운 경우 중첩 실행 감지를 피한다
  delete env.CLAUDECODE
  if (isWin) {
    return spawn([command, ...args].map(quoteWin).join(' '), [], { ...opts, env, shell: true, windowsHide: true })
  }
  return spawn(command, args, { ...opts, env })
}

/**
 * 명령이 실제로 있는지 PATH(+PATHEXT)에서 직접 찾는다. 셸에 맡기면 cmd.exe 의 오류 문구가
 * OEM 코드페이지(CP949 등)로 나와 깨지므로, 실행 전에 확인해 읽을 수 있는 안내를 낸다.
 */
export function commandExists(command: string): boolean {
  if (findCommand(command)) return true
  // 앱이 켜진 뒤에 설치한 CLI: 레지스트리의 PATH 를 다시 읽고 한 번 더 찾는다
  return refreshWindowsPath() && findCommand(command)
}

let lastPathRefresh = 0

/**
 * Windows: 사용자·시스템 PATH 를 레지스트리에서 다시 읽어 지금 프로세스의 PATH 에 합친다.
 * 앱을 켠 뒤(또는 PATH 가 오래된 셸에서 켠 뒤) 설치한 CLI 도 찾을 수 있게. 몇 초에 한 번만.
 */
export function refreshWindowsPath(): boolean {
  if (!isWin || Date.now() - lastPathRefresh < 3000) return false
  lastPathRefresh = Date.now()
  const read = (key: string): string[] => {
    try {
      const out = execFileSync('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true })
      const m = /Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(out)
      return m ? m[1].trim().replace(/%([^%]+)%/g, (_, v: string) => process.env[v] ?? `%${v}%`).split(';').filter(Boolean) : []
    } catch {
      return []
    }
  }
  const current = (process.env.PATH ?? '').split(';').filter(Boolean)
  const seen = new Set(current.map((d) => d.toLowerCase().replace(/[\\/]+$/, '')))
  const added = [...read('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'), ...read('HKCU\\Environment')].filter((d) => {
    const k = d.toLowerCase().replace(/[\\/]+$/, '')
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  if (!added.length) return false
  process.env.PATH = [...current, ...added].join(';')
  return true
}

function findCommand(command: string): boolean {
  const exts = isWin ? ['', ...(process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')] : ['']
  const candidates = path.isAbsolute(command) || /[\\/]/.test(command)
    ? [command]
    : (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, command))
  return candidates.some((base) => exts.some((ext) => fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()))
}

export const notFoundMessage = (command: string): string => `'${command}' 명령을 찾을 수 없습니다 (PATH 또는 실행 명령 경로 확인)`

export function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return
  if (isWin) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  } else {
    child.kill('SIGTERM')
  }
}

/**
 * @param mcpArgs Workspace MCP 서버 연결 인자 (claude: --mcp-config …, codex: -c mcp_servers…)
 */
export function buildCommand(p: ProviderConfig, s: Session, mcpArgs: string[] = []): { command: string; args: string[] } {
  // 권한 프리셋이 있으면 겹치는 인자를 빼고 프리셋 옵션을 붙인다 (codex·gemini)
  const access = accessArgs(p.id, s.access)
  let extra = splitArgs(`${p.extraArgs} ${s.extraArgs ?? ''}`)
  // codex 0.16x 에서 없어진 --full-auto 는 같은 뜻의 옵션으로 바꿔 넘긴다 (예전 설정·빌더 세션 호환)
  if (p.id === 'codex') extra = extra.flatMap((a) => (a === '--full-auto' ? ['--sandbox', 'workspace-write', '-c', 'approval_policy=never'] : [a]))
  if (access.length) extra = [...stripAccessArgs(p.id, extra), ...access]
  const model = s.model || p.model
  const args: string[] = []
  switch (p.id) {
    case 'claude':
      args.push('-p', '--output-format', 'stream-json', '--verbose')
      if (model) args.push('--model', model)
      if (s.cliSessionId) args.push('--resume', s.cliSessionId)
      args.push(...mcpArgs, ...extra)
      break
    case 'codex':
      args.push('exec', '--json', '--skip-git-repo-check')
      if (model) args.push('-m', model)
      args.push(...mcpArgs, ...extra)
      if (s.cliSessionId) args.push('resume', s.cliSessionId)
      args.push('-') // stdin 에서 프롬프트 읽기
      break
    case 'gemini':
      args.push('--output-format', 'stream-json')
      if (model) args.push('-m', model)
      if (s.cliSessionId) args.push('--resume', s.cliSessionId)
      args.push(...mcpArgs, ...extra)
      break
  }
  return { command: p.command, args }
}

export interface ParsedEvent {
  kind: 'session' | 'init' | 'text' | 'tool' | 'result' | 'error' | 'raw'
  text?: string
  title?: string
  /** 직전 text 에 이어 붙임 (토큰 스트리밍) */
  delta?: boolean
  sessionId?: string
  costUsd?: number
  /** init: CLI 가 알려 준 모델·슬래시 명령·스킬 */
  model?: string
  commands?: string[]
  skills?: string[]
}

const clip = (s: string, n = 4000): string => (s.length > n ? s.slice(0, n) + `\n… (${s.length - n}자 생략)` : s)

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) {
    return v
      .map((x) => (x && typeof x === 'object' && 'text' in x ? String((x as { text: unknown }).text) : stringify(x)))
      .join('\n')
  }
  return JSON.stringify(v, null, 2)
}

type Json = Record<string, any>

function parseClaude(o: Json): ParsedEvent[] {
  const out: ParsedEvent[] = []
  switch (o.type) {
    case 'system':
      if (o.session_id) out.push({ kind: 'session', sessionId: o.session_id })
      if (o.subtype === 'init') {
        const names = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
        out.push({ kind: 'init', model: o.model, commands: names(o.slash_commands), skills: names(o.skills) })
      }
      break
    case 'assistant':
      for (const c of o.message?.content ?? []) {
        if (c.type === 'text' && c.text) out.push({ kind: 'text', text: c.text })
        else if (c.type === 'tool_use') out.push({ kind: 'tool', title: `🔧 ${c.name}`, text: clip(stringify(c.input)) })
      }
      break
    case 'user':
      for (const c of o.message?.content ?? []) {
        if (c.type === 'tool_result') {
          out.push({ kind: 'tool', title: c.is_error ? '⚠ 도구 결과 (오류)' : '↳ 도구 결과', text: clip(stringify(c.content)) })
        }
      }
      break
    case 'result':
      out.push({ kind: 'result', sessionId: o.session_id, costUsd: o.total_cost_usd, text: o.result })
      if (o.is_error) out.push({ kind: 'error', text: String(o.result ?? o.subtype ?? 'error') })
      break
  }
  return out
}

function parseCodex(o: Json): ParsedEvent[] {
  // 신규 형식 (thread/item 이벤트)
  if (o.type === 'thread.started') return [{ kind: 'session', sessionId: o.thread_id }]
  if (o.type === 'item.completed' && o.item) {
    const it = o.item
    switch (it.type) {
      case 'agent_message':
        return [{ kind: 'text', text: it.text }]
      case 'reasoning':
        return [{ kind: 'tool', title: '💭 추론', text: clip(it.text ?? '') }]
      case 'command_execution':
        return [{ kind: 'tool', title: `$ ${it.command}`, text: clip(it.aggregated_output ?? '') }]
      case 'file_change':
        return [{ kind: 'tool', title: '📝 파일 변경', text: clip(stringify(it.changes)) }]
      case 'mcp_tool_call':
        if (it.status === 'failed' || it.error)
          return [{ kind: 'tool', title: `⚠ ${it.server}.${it.tool} 실패`, text: clip(String(it.error?.message ?? stringify(it.error ?? ''))) }]
        return [{ kind: 'tool', title: `🔧 ${it.server}.${it.tool}`, text: clip(stringify(it.arguments ?? '')) }]
      case 'web_search':
        return [{ kind: 'tool', title: `🔎 웹 검색: ${it.query ?? it.action?.query ?? ''}`, text: clip(stringify(it.action ?? '')) }]
      case 'todo_list':
        return [{ kind: 'tool', title: '☑ 할 일', text: clip(stringify(it.items ?? '')) }]
      case 'error':
        return [{ kind: 'error', text: it.message }]
    }
    return []
  }
  if (o.type === 'turn.failed') return [{ kind: 'error', text: o.error?.message ?? 'turn failed' }]
  if (o.type === 'error') return [{ kind: 'error', text: o.message ?? 'error' }]
  // 구 형식 ({ msg: { type } })
  const m = o.msg
  if (m?.type === 'session_configured') return [{ kind: 'session', sessionId: m.session_id }]
  if (m?.type === 'agent_message') return [{ kind: 'text', text: m.message }]
  if (m?.type === 'exec_command_begin') return [{ kind: 'tool', title: `$ ${stringify(m.command)}` }]
  if (m?.type === 'error') return [{ kind: 'error', text: m.message }]
  return []
}

function parseGemini(o: Json): ParsedEvent[] {
  switch (o.type) {
    case 'init':
      return [{ kind: 'session', sessionId: o.session_id }, ...(o.model ? [{ kind: 'init' as const, model: o.model }] : [])]
    case 'message':
      if (o.role === 'assistant' && o.content) return [{ kind: 'text', text: o.content, delta: !!o.delta }]
      return []
    case 'tool_use':
      return [{ kind: 'tool', title: `🔧 ${o.tool_name}`, text: clip(stringify(o.parameters ?? '')) }]
    case 'tool_result':
      return [{ kind: 'tool', title: o.status === 'error' ? '⚠ 도구 결과 (오류)' : '↳ 도구 결과', text: clip(stringify(o.output ?? o.error ?? '')) }]
    case 'error':
      return [{ kind: 'error', text: o.message ?? stringify(o) }]
    case 'result':
      if (o.status === 'error') return [{ kind: 'error', text: o.error?.message ?? 'error' }]
      return [{ kind: 'result' }]
  }
  return []
}

/** CLI 출력 한 줄을 이벤트로 변환. JSON 이 아니면 그대로 텍스트로 취급한다. */
export function parseLine(id: ProviderId, line: string): ParsedEvent[] {
  const t = line.trim()
  if (!t) return []
  let o: Json
  try {
    o = JSON.parse(t)
  } catch {
    return [{ kind: 'raw', text: line }]
  }
  if (!o || typeof o !== 'object') return [{ kind: 'raw', text: line }]
  if (id === 'claude') return parseClaude(o)
  if (id === 'codex') return parseCodex(o)
  return parseGemini(o)
}

export function detectProvider(p: ProviderConfig): Promise<ProviderStatus> {
  return new Promise((resolve) => {
    const done = (r: Omit<ProviderStatus, 'id' | 'checkedAt'>): void =>
      resolve({ id: p.id, checkedAt: Date.now(), ...r })
    if (!commandExists(p.command)) return done({ available: false, error: notFoundMessage(p.command) })
    let out = ''
    let child: ChildProcess
    try {
      child = spawnCli(p.command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return done({ available: false, error: (e as Error).message })
    }
    const timer = setTimeout(() => {
      killTree(child)
      done({ available: false, error: '시간 초과 (15초)' })
    }, 15000)
    child.stdout?.on('data', (d) => (out += d))
    child.stderr?.on('data', (d) => (out += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      done({ available: false, error: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const first = out.trim().split(/\r?\n/)[0] ?? ''
      if (code === 0) done({ available: true, version: first })
      else done({ available: false, error: first || `exit code ${code}` })
    })
  })
}
