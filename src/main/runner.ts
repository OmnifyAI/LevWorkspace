import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import readline from 'node:readline'
import type { ChildProcess } from 'node:child_process'
import type { Message, MessageFrom, QueueItem, Session } from '../shared/types'
import { buildCommand, commandExists, killTree, notFoundMessage, parseLine, spawnCli } from './providers'
import type { Workspace } from './workspace'

export interface TurnResult {
  sessionId: string
  ok: boolean
  stopped: boolean
  text: string
}

interface Turn {
  /** 다른 에이전트가 보낸 메시지로 시작한 턴: 끝나면 결과를 이쪽으로 */
  replyTo?: { sessionId: string; requestId?: string }
  result?: TurnOutcome
  startedAt: number
  costUsd: number
  parts: string[]
  /** 스트리밍 텍스트를 이어 붙일 현재 assistant 메시지 */
  current: Message | null
  stderr: string
  failed: boolean
}

export const MAX_DEPTH = 2

const DELEGATION_GUIDE = `## 하위 에이전트 위임
이 워크스페이스에서는 분리 가능한 하위 작업을 다른 에이전트에게 맡길 수 있다.
위임하려면 최종 답변에 아래 형식의 블록을 그대로 적는다 (한 턴에 최대 5개):

<delegate agent="claude|codex|gemini" title="짧은 제목">
하위 에이전트에게 줄 구체적인 지시
</delegate>

하위 에이전트는 같은 프로젝트 디렉터리에서 실행되며, 모두 끝나면 결과가 새 메시지로 자동 전달된다.
작업이 명확히 나뉠 때만 위임한다.`

/** 세션별 CLI 프로세스를 띄우고 출력을 메시지로 바꾼다. 턴이 끝나면 'turn' 이벤트를 낸다. */
/** 끝난 턴의 요약 (답장 전달용) */
export interface TurnOutcome {
  ok: boolean
  stopped: boolean
  text: string
  error?: string
}

/** CLI 에 넘길 에이전트 메시지 머리말 — 사용자가 아니라 다른 에이전트가 보냈음을 알린다 */
function agentHeader(from: MessageFrom, s: Session): string {
  if (from.reply) {
    return `[에이전트 "${from.title}" (세션 ${from.sessionId}) 의 답장 — 네가 aw_send_message 로 보낸 메시지에 대한 응답이다. 사용자가 쓴 글이 아니다.]\n\n`
  }
  return (
    `[에이전트 "${from.title}" (세션 ${from.sessionId}, ${from.provider}) 가 aw_send_message 로 보낸 메시지다. 사용자가 쓴 글이 아니다. ` +
    `이 턴의 최종 답변이 그대로 "${from.title}" 에게 자동으로 전달되니, 답하려고 aw_send_message 를 다시 쓰지 말고 답만 써라. (너는 "${s.title}")]\n\n`
  )
}

/**
 * Windows PowerShell 5.1 은 인코딩을 안 주면 파일을 시스템 코드페이지(한국어 Windows 는 CP949)로 읽고 쓴다.
 * 그러면 UTF-8 파일의 한글이 깨져 에이전트가 깨진 내용을 보고 고치게 된다 — 첫 턴에 알려 준다.
 */
const WINDOWS_NOTE = [
  '# 환경 (Windows)',
  '셸이 Windows PowerShell 5.1 이면 PowerShell 명령(Get-Content, Select-String 등)이 출력하는 한글은 콘솔 코드페이지(CP949)로 바뀌어 깨진다. 파일은 UTF-8 이다.',
  '- 파일 내용 보기: `cmd /c type 경로` (바이트를 그대로 내보내 한글이 안 깨진다). 일부만·검색: `cmd /c findstr /n "찾을말" 경로` 또는 `node -e` 로 읽어 출력.',
  '- 위 명령의 출력을 PowerShell cmdlet 으로 파이프(`| Select-Object` 등)하지 않는다 — 다시 깨진다.',
  '- 파일 쓰기: 패치·편집 도구를 쓰거나 `Set-Content -Encoding UTF8`. 깨져 보이는 글자를 그대로 파일에 다시 쓰지 않는다.'
].join('\n')

export class AgentManager extends EventEmitter {
  private procs = new Map<string, ChildProcess>()
  private stopped = new Set<string>()

  constructor(private ws: Workspace) {
    super()
  }

  isRunning(sessionId: string): boolean {
    return this.procs.has(sessionId)
  }

  /** item 이 객체면 다른 에이전트가 보낸 메시지 — 이 턴의 답이 보낸 쪽으로 돌아간다 */
  send(sessionId: string, item: QueueItem): void {
    const s = this.ws.store.session(sessionId)
    if (!s) throw new Error('세션을 찾을 수 없습니다')
    if (this.procs.has(sessionId)) {
      s.queue.push(item)
      this.ws.touch(s)
      return
    }
    this.run(s, item)
  }

  stop(sessionId: string): void {
    const s = this.ws.store.session(sessionId)
    if (s) s.queue = []
    const child = this.procs.get(sessionId)
    if (!child) return
    this.stopped.add(sessionId)
    killTree(child)
  }

  stopAll(): void {
    for (const id of [...this.procs.keys()]) this.stop(id)
  }

  private buildPrompt(s: Session, prompt: string): string {
    const { store } = this.ws
    const first = !s.cliSessionId && !store.messages(s.id).some((m) => m.role === 'user')
    const pre: string[] = []
    if (first) {
      const own = this.ws.skillsOf(s.projectId)
      const skills = s.skillIds.map((id) => own.find((k) => k.id === id)).filter((k) => !!k)
      if (skills.length) {
        pre.push(
          '# Skills\n이 세션에는 다음 스킬(지침)이 적용된다. 원본은 작업 디렉터리의 .skills 폴더에 있다.\n\n' +
            skills
              .map((k) => {
                const extra = k.extraFiles.length
                  ? `\n\n(참고 파일 — 필요하면 읽을 것: ${k.extraFiles.map((f) => `.skills/${k.id}/${f}`).join(', ')})`
                  : ''
                return `## ${k.name}\n${k.description}\n\n${k.content}${extra}`
              })
              .join('\n\n')
        )
      }
      if (s.allowDelegation && s.depth < MAX_DEPTH) pre.push(DELEGATION_GUIDE)
      if (process.platform === 'win32') pre.push(WINDOWS_NOTE)
    }
    const assets = s.assetIds.map((id) => store.db.assets.find((a) => a.id === id)).filter((a) => !!a)
    if (assets.length) {
      pre.push(
        '# 첨부 파일 (작업 디렉터리 기준 경로)\n' +
          assets.map((a) => `- ${a.relPath}${a.note ? ` — ${a.note}` : ''}`).join('\n')
      )
    }
    return pre.length ? `${pre.join('\n\n')}\n\n# 요청\n${prompt}` : prompt
  }

  private run(s: Session, item: QueueItem): void {
    const { store } = this.ws
    const project = store.project(s.projectId)
    const provider = store.provider(s.provider)
    const prompt = typeof item === 'string' ? item : item.prompt
    const from = typeof item === 'string' ? undefined : item.from
    const full = this.buildPrompt(s, from ? agentHeader(from, s) + prompt : prompt)
    this.ws.addMessage(s.id, { role: 'user', content: prompt, from })

    const fail = (msg: string): void => {
      this.ws.addMessage(s.id, { role: 'error', content: msg })
      s.status = 'error'
      s.lastError = msg
      s.lastTurnOk = false
      this.ws.touch(s)
      this.emit('turn', { sessionId: s.id, ok: false, stopped: false, text: '' } satisfies TurnResult)
    }
    if (!project) return fail('프로젝트를 찾을 수 없습니다')
    if (!provider) return fail(`알 수 없는 CLI: ${s.provider}`)
    if (!provider.enabled) return fail(`${provider.label} 연결이 꺼져 있습니다 (CLI 연결 설정)`)
    if (!fs.existsSync(project.path)) return fail(`작업 디렉터리가 없습니다: ${project.path}`)
    if (!commandExists(provider.command)) return fail(notFoundMessage(provider.command))

    const mcp = this.ws.cliMcp(project.id, s.id, provider)
    const { command, args } = buildCommand(provider, s, mcp.args)
    let child: ChildProcess
    try {
      child = spawnCli(command, args, { cwd: project.path, stdio: ['pipe', 'pipe', 'pipe'], env: { ...this.ws.apiEnv(project.id, s.id), ...mcp.env } })
    } catch (e) {
      return fail(`${command} 실행 실패: ${(e as Error).message}`)
    }

    s.status = 'running'
    s.lastError = undefined
    s.runStartedAt = Date.now()
    s.currentStep = '시작 중'
    this.ws.touch(s)
    this.ws.log(s, 'start', `${s.title} 실행 시작`)
    this.procs.set(s.id, child)

    const turn: Turn = { startedAt: Date.now(), costUsd: 0, parts: [], current: null, stderr: '', failed: false }
    if (typeof item !== 'string' && !item.from.reply) turn.replyTo = { sessionId: item.from.sessionId, requestId: item.requestId }
    child.stdin?.on('error', () => {})
    child.stdin?.end(full)
    readline.createInterface({ input: child.stdout! }).on('line', (line) => this.handleLine(s, line, turn))
    child.stderr?.on('data', (d) => {
      turn.stderr = (turn.stderr + d).slice(-8000)
    })
    child.on('error', (e) => {
      turn.failed = true
      this.ws.addMessage(s.id, { role: 'error', content: `${command} 실행 실패: ${e.message}` })
      this.finish(s.id, -1, turn)
    })
    child.on('close', (code) => this.finish(s.id, code ?? -1, turn))
  }

  private handleLine(s: Session, line: string, turn: Turn): void {
    for (const ev of parseLine(s.provider, line)) {
      switch (ev.kind) {
        case 'session':
          if (ev.sessionId && ev.sessionId !== s.cliSessionId) {
            s.cliSessionId = ev.sessionId
            this.ws.touch(s)
          }
          break
        case 'init':
          if (ev.model && ev.model !== s.cliModel) {
            s.cliModel = ev.model
            this.ws.touch(s)
          }
          this.ws.setCliInfo(s.provider, ev)
          break
        case 'text':
        case 'raw': {
          const text = ev.text ?? ''
          const append = (ev.delta || ev.kind === 'raw') && turn.current
          if (s.currentStep !== '응답 작성 중') {
            s.currentStep = '응답 작성 중'
            this.ws.touch(s)
          }
          if (append && turn.current) {
            const sep = ev.kind === 'raw' ? '\n' : ''
            turn.current.content += sep + text
            turn.parts[turn.parts.length - 1] += sep + text
            this.ws.updateMessage(turn.current)
          } else {
            turn.current = this.ws.addMessage(s.id, { role: 'assistant', content: text })
            turn.parts.push(text)
          }
          break
        }
        case 'tool':
          turn.current = null
          s.currentStep = ev.title
          this.ws.touch(s)
          this.ws.addMessage(s.id, { role: 'tool', title: ev.title, content: ev.text ?? '' })
          break
        case 'result':
          if (ev.sessionId) s.cliSessionId = ev.sessionId
          if (typeof ev.costUsd === 'number') {
            s.costUsd = (s.costUsd ?? 0) + ev.costUsd
            turn.costUsd += ev.costUsd
          }
          if (ev.text && turn.parts.length === 0) {
            this.ws.addMessage(s.id, { role: 'assistant', content: ev.text })
            turn.parts.push(ev.text)
          }
          this.ws.touch(s)
          break
        case 'error':
          turn.failed = true
          turn.current = null
          this.ws.addMessage(s.id, { role: 'error', content: ev.text ?? 'error' })
          break
      }
    }
  }

  private finish(sessionId: string, code: number, turn: Turn): void {
    this.finishTurn(sessionId, code, turn)
    // 다른 에이전트가 보낸 메시지로 시작한 턴이면 결과를 보낸 쪽으로 (답장에는 다시 답장하지 않는다)
    const s = this.ws.store.session(sessionId)
    if (s && turn.replyTo) this.ws.deliverReply(s, turn.replyTo, turn.result)
  }

  private finishTurn(sessionId: string, code: number, turn: Turn): void {
    if (!this.procs.has(sessionId)) return // error + close 중복 방지
    this.procs.delete(sessionId)
    const wasStopped = this.stopped.delete(sessionId)
    const s = this.ws.store.session(sessionId)
    if (!s) return // 실행 중 삭제됨

    const ok = !wasStopped && code === 0 && !turn.failed
    if (wasStopped) {
      this.ws.addMessage(s.id, { role: 'system', content: '사용자가 중지했습니다' })
    } else if (code !== 0 && code !== -1) {
      const tail = turn.stderr.trim().split(/\r?\n/).slice(-15).join('\n')
      this.ws.addMessage(s.id, { role: 'error', content: `프로세스가 코드 ${code} 로 종료됨${tail ? `\n\n${tail}` : ''}` })
    }
    const text = turn.parts.join('\n\n').trim()
    turn.result = { ok, stopped: wasStopped, text, error: ok ? undefined : (s.lastError ?? turn.stderr.trim().split(/\r?\n/).pop()) }
    s.status = ok || wasStopped ? 'idle' : 'error'
    s.lastTurnOk = ok
    if (!ok && !wasStopped) s.lastError = turn.stderr.trim().split(/\r?\n/).pop() || `exit ${code}`
    if (text) s.lastOutput = text
    s.runStartedAt = undefined
    s.currentStep = undefined
    this.ws.recordTurn(s, { ok, costUsd: turn.costUsd, durationMs: Date.now() - turn.startedAt })
    this.ws.touch(s)
    if (wasStopped) this.ws.log(s, 'stopped', `${s.title} 중지됨`)
    else this.ws.log(s, ok ? 'done' : 'error', ok ? `${s.title} 완료` : `${s.title} 실패 — ${s.lastError ?? ''}`)

    // 대기열을 먼저 처리해야 리스너가 같은 세션에 보낸 프롬프트가 큐로 들어간다
    const next = !wasStopped ? s.queue.shift() : undefined
    if (next !== undefined) this.run(s, next)
    this.emit('turn', { sessionId, ok, stopped: wasStopped, text } satisfies TurnResult)
  }
}
