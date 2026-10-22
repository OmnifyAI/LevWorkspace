import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ScriptInfo, ScriptResult, ScriptRunOptions } from '../../shared/dashboard'
import { DASHBOARD_DIR, SCRIPTS_DIR } from '../../shared/dashboard'
import { resolveIn } from '../files'
import { killTree } from '../providers'

const isWin = process.platform === 'win32'
const MAX_OUTPUT = 5 * 1024 * 1024
const DEFAULT_TIMEOUT = 30
const MAX_TIMEOUT = 300

interface Runtime {
  label: string
  command: string
  args: string[]
  env?: Record<string, string>
}

let pythonCache: Runtime | null | undefined

/** 설치된 Python 3 을 찾는다. Windows 의 스토어 바로가기(python.exe)는 실제로 돌려 보고 거른다 */
function findPython(): Runtime | null {
  if (pythonCache !== undefined) return pythonCache
  const candidates: [string, string[]][] = isWin
    ? [['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]]
  for (const [cmd, pre] of candidates) {
    try {
      const r = spawnSync(cmd, [...pre, '--version'], { encoding: 'utf8', timeout: 8000, windowsHide: true })
      if (r.status === 0 && /Python 3/.test(`${r.stdout}${r.stderr}`)) return (pythonCache = { label: 'python', command: cmd, args: pre })
    } catch {
      // 다음 후보
    }
  }
  return (pythonCache = null)
}

/** 확장자 → 실행 방법. JS 는 앱에 들어 있는 Node(Electron)로 돌려 node 설치가 필요 없다 */
function runtimeFor(file: string): Runtime {
  const ext = path.extname(file).toLowerCase()
  switch (ext) {
    case '.py': {
      const py = findPython()
      if (!py) throw new Error('Python 3 을 찾을 수 없습니다 (py / python / python3)')
      return { ...py, args: [...py.args, '-X', 'utf8'], env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } }
    }
    case '.js':
    case '.mjs':
    case '.cjs':
      return { label: 'node (내장)', command: process.execPath, args: [], env: { ELECTRON_RUN_AS_NODE: '1' } }
    case '.ps1':
      return isWin
        ? { label: 'powershell', command: 'powershell', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'] }
        : { label: 'pwsh', command: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-File'] }
    case '.sh':
      return { label: 'bash', command: 'bash', args: [] }
    case '.rb':
      return { label: 'ruby', command: 'ruby', args: [] }
    case '.php':
      return { label: 'php', command: 'php', args: [] }
    default:
      throw new Error(`지원하지 않는 스크립트 형식입니다: ${ext || '(확장자 없음)'} — .py .js .mjs .ps1 .sh .rb .php`)
  }
}

function hasCommand(cmd: string, args: string[]): boolean {
  try {
    return spawnSync(cmd, args, { timeout: 8000, windowsHide: true }).status === 0
  } catch {
    return false
  }
}

let runtimeCache: Record<string, boolean> | undefined

/** 이 PC 에서 쓸 수 있는 스크립트 런타임 (에이전트가 언어를 고를 때 참고). node 는 앱 내장이라 늘 true */
export function availableRuntimes(): Record<string, boolean> {
  if (runtimeCache) return runtimeCache
  runtimeCache = {
    node: true,
    python: !!findPython(),
    powershell: isWin ? true : hasCommand('pwsh', ['-NoProfile', '-Command', 'exit 0']),
    bash: hasCommand('bash', ['-c', 'exit 0']),
    ruby: hasCommand('ruby', ['-v']),
    php: hasCommand('php', ['-v'])
  }
  return runtimeCache
}

const RUNTIME_LABEL: Record<string, string> = {
  '.py': 'python', '.js': 'node', '.mjs': 'node', '.cjs': 'node', '.ps1': 'powershell', '.sh': 'bash', '.rb': 'ruby', '.php': 'php'
}

export function scriptsRoot(projectPath: string): string {
  return path.join(projectPath, DASHBOARD_DIR, SCRIPTS_DIR)
}

/** 스크립트 이름 → 절대 경로. scripts 폴더 밖은 거부 */
export function scriptPath(projectPath: string, name: string): string {
  const root = scriptsRoot(projectPath)
  const abs = resolveIn(root, name.replace(/^\.?[\\/]+/, '').replace(new RegExp(`^${DASHBOARD_DIR}[\\\\/]${SCRIPTS_DIR}[\\\\/]`), ''))
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`스크립트가 없습니다: ${DASHBOARD_DIR}/${SCRIPTS_DIR}/${name}`)
  return abs
}

export function hashFile(abs: string): string {
  return createHash('sha256').update(fs.readFileSync(abs)).digest('hex')
}

export function listScripts(projectPath: string, isTrusted: (name: string, hash: string) => boolean): ScriptInfo[] {
  const root = scriptsRoot(projectPath)
  if (!fs.existsSync(root)) return []
  const out: ScriptInfo[] = []
  const walk = (rel: string): void => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && e.name !== '__pycache__' && e.name !== 'node_modules') walk(r)
        continue
      }
      const ext = path.extname(e.name).toLowerCase()
      if (!RUNTIME_LABEL[ext]) continue
      const abs = path.join(root, r)
      out.push({ name: r, runtime: RUNTIME_LABEL[ext], trusted: isTrusted(r, hashFile(abs)), size: fs.statSync(abs).size })
    }
  }
  walk('')
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export interface RunRequest {
  projectPath: string
  name: string
  args: unknown
  env: Record<string, string>
  options?: ScriptRunOptions
}

/** 스크립트 하나를 실행한다. 인자는 stdin(JSON)과 AW_SCRIPT_ARGS 로 넘기고, stdout 을 JSON 으로 읽는다 */
export function execScript(req: RunRequest): Promise<ScriptResult> {
  const abs = scriptPath(req.projectPath, req.name)
  const rt = runtimeFor(abs)
  const argsJson = JSON.stringify(req.args ?? {})
  const timeout = Math.min(Math.max(Number(req.options?.timeout) || DEFAULT_TIMEOUT, 1), MAX_TIMEOUT) * 1000
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(rt.command, [...rt.args, abs], {
      cwd: req.projectPath,
      env: { ...process.env, ...req.env, ...rt.env, AW_SCRIPT_ARGS: argsJson, AW_SCRIPT_NAME: req.name },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let out = Buffer.alloc(0)
    let err = ''
    let done = false
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      killTree(child)
      finish(() => reject(new Error(`시간 초과 (${timeout / 1000}초) — 옵션 timeout 으로 늘릴 수 있습니다`)))
    }, timeout)
    child.stdin.on('error', () => {})
    child.stdin.end(argsJson)
    child.stdout.on('data', (d: Buffer) => {
      out = Buffer.concat([out, d])
      if (out.length > MAX_OUTPUT) {
        killTree(child)
        finish(() => reject(new Error('출력이 5MB 를 넘었습니다')))
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      err = (err + d.toString('utf8')).slice(-8000)
    })
    child.on('error', (e) => finish(() => reject(new Error(`${rt.label} 실행 실패: ${e.message}`))))
    child.on('close', (code) =>
      finish(() => {
        const text = out.toString('utf8').trim()
        if (code !== 0) {
          const tail = err.trim().split(/\r?\n/).slice(-12).join('\n')
          return reject(new Error(`종료 코드 ${code}${tail ? `\n${tail}` : ''}`))
        }
        let data: unknown
        try {
          data = text ? JSON.parse(text) : null
        } catch {
          data = { text }
        }
        resolve({ data, durationMs: Date.now() - started, stderr: err.trim() })
      })
    )
  })
}

/** 미리보기용 앞부분 */
export function scriptPreview(abs: string, lines = 40): string {
  const text = fs.readFileSync(abs, 'utf8').split(/\r?\n/)
  return text.slice(0, lines).join('\n') + (text.length > lines ? `\n… (${text.length - lines}줄 더)` : '')
}

export function runtimeLabel(abs: string): string {
  try {
    return runtimeFor(abs).label
  } catch (e) {
    return (e as Error).message
  }
}
