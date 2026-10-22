import { randomBytes, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import type { ApiInfo, DashboardSpec, Query } from '../../shared/dashboard'
import { DASHBOARD_DIR } from '../../shared/dashboard'
import type { ProviderId } from '../../shared/types'
import type { Workspace } from '../workspace'
import { validateSpec } from './dashboard'
import { runQuery } from './query'
import { availableRuntimes } from './scripts'
import { schema } from './sources'

const MAX_BODY = 1024 * 1024

/**
 * Workspace Data API — 127.0.0.1 에서만 열리고, 앱을 켤 때마다 새 토큰을 만든다.
 * 지금은 읽기 전용 (쿼리·스키마·대시보드 검증). 쓰기 동작은 권한 확인 UI 와 함께 추가한다.
 */
export class DataServer {
  readonly token = randomBytes(24).toString('hex')
  private server: http.Server | null = null
  private port = 0

  constructor(private ws: Workspace) {}

  info(): ApiInfo {
    return { url: `http://127.0.0.1:${this.port}`, token: this.token }
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => void this.handle(req, res))
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        this.port = (server.address() as AddressInfo).port
        this.server = server
        resolve()
      })
    })
  }

  stop(): void {
    this.server?.close()
  }

  private authorized(req: http.IncomingMessage): boolean {
    const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? '')
    if (!m) return false
    const a = Buffer.from(m[1])
    const b = Buffer.from(this.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private body(req: http.IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let size = 0
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_BODY) {
          reject(new Error('요청 본문이 너무 큽니다'))
          req.destroy()
        } else chunks.push(c)
      })
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8').trim()
        if (!text) return resolve(undefined)
        try {
          resolve(JSON.parse(text))
        } catch {
          reject(new Error('본문이 올바른 JSON 이 아닙니다'))
        }
      })
      req.on('error', reject)
    })
  }

  private send(res: http.ServerResponse, status: number, data: unknown): void {
    // 브라우저에서 읽지 못하도록 CORS 헤더는 주지 않는다
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(data, null, 2))
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (!this.authorized(req)) return this.send(res, 401, { error: 'Authorization: Bearer <AGENT_WORKSPACE_TOKEN> 헤더가 필요합니다' })
    const project = url.searchParams.get('project') ?? undefined
    const board = url.searchParams.get('board') ?? undefined
    const route = `${req.method} ${url.pathname.replace(/\/+$/, '')}`
    try {
      // ── 쓰기 동작 (사용자 확인을 거친다)
      if (req.method === 'POST') {
        const sessionHeader = req.headers['x-aw-session']
        const origin = () => this.ws.apiOrigin(this.need(project), typeof sessionHeader === 'string' ? sessionHeader : undefined)
        const msg = /^\/api\/sessions\/([^/]+)\/(messages|stop)$/.exec(url.pathname)
        if (msg) {
          const b = ((await this.body(req)) ?? {}) as { prompt?: string; wait?: boolean }
          const sessionId = decodeURIComponent(msg[1])
          const action =
            msg[2] === 'messages' ? ({ type: 'sendMessage', sessionId, prompt: String(b.prompt ?? ''), wait: !!b.wait } as const) : ({ type: 'stopSession', sessionId } as const)
          return this.send(res, 200, await this.ws.writeAction(origin(), action))
        }
        if (url.pathname.replace(/\/+$/, '') === '/api/sessions') {
          const b = ((await this.body(req)) ?? {}) as Record<string, unknown>
          return this.send(
            res,
            200,
            await this.ws.writeAction(origin(), {
              type: 'createSession',
              title: b.title as string | undefined,
              prompt: b.prompt as string | undefined,
              provider: b.provider as ProviderId | undefined,
              model: b.model as string | undefined,
              child: !!b.child
            })
          )
        }
      }
      switch (route) {
        case 'GET /api':
        case 'GET /api/health':
          return this.send(res, 200, {
            ok: true,
            endpoints: [
              'GET /api/schema', 'GET /api/projects', 'POST /api/query', 'GET /api/boards?project=', 'GET /api/dashboard?project=&board=', 'POST /api/dashboard/validate?project=&board=',
              'GET /api/scripts?project=', 'POST /api/scripts/run?project=',
              'POST /api/sessions?project= (사용자 확인)', 'POST /api/sessions/:id/messages?project= (사용자 확인)', 'POST /api/sessions/:id/stop?project= (사용자 확인)'
            ]
          })
        case 'GET /api/schema':
          return this.send(res, 200, { sources: schema() })
        case 'GET /api/projects':
          return this.send(res, 200, {
            projects: this.ws.store.db.projects.map((p) => ({ id: p.id, name: p.name, path: p.path, defaultProvider: p.defaultProvider }))
          })
        case 'POST /api/query': {
          const q = (await this.body(req)) as Query
          return this.send(res, 200, await runQuery(this.ws, q, project ?? this.defaultProject()))
        }
        case 'GET /api/scripts':
          return this.send(res, 200, {
            scripts: this.ws.listScripts(this.need(project)),
            // 새 스크립트는 true 인 런타임으로 쓴다 (node 는 앱 내장이라 항상 가능)
            runtimes: availableRuntimes()
          })
        case 'POST /api/scripts/run': {
          const b = ((await this.body(req)) ?? {}) as { script?: string; args?: unknown; timeout?: number }
          if (!b.script) throw new Error('본문에 script 가 필요합니다: {"script":"x.py","args":{}}')
          const r = await this.ws.runScript(this.need(project), b.script, b.args, { timeout: b.timeout }, '에이전트 (Data API)')
          return this.send(res, 200, r)
        }
        case 'POST /api/cli-permission': {
          const pid = this.need(project)
          const sid = req.headers['x-aw-session']
          const b = ((await this.body(req)) ?? {}) as { tool_name?: string; input?: unknown }
          if (!b.tool_name) throw new Error('본문에 tool_name 이 필요합니다')
          return this.send(res, 200, await this.ws.cliPermission(this.ws.apiOrigin(pid, typeof sid === 'string' ? sid : undefined), b.tool_name, b.input))
        }
        case 'GET /api/mcp/tools':
          return this.send(res, 200, { tools: await this.ws.mcp.tools(this.need(project)) })
        case 'POST /api/mcp/call': {
          const b = ((await this.body(req)) ?? {}) as { name?: string; arguments?: unknown }
          if (!b.name) throw new Error('본문에 name 이 필요합니다')
          const pid = this.need(project)
          const sid = req.headers['x-aw-session']
          return this.send(res, 200, await this.ws.mcp.call(pid, b.name, b.arguments, this.ws.apiOrigin(pid, typeof sid === 'string' ? sid : undefined)))
        }
        case 'GET /api/boards':
          return this.send(res, 200, { boards: this.ws.listBoards(this.need(project)) })
        case 'GET /api/dashboard':
          return this.send(res, 200, this.ws.loadDashboard(this.need(project), board))
        case 'POST /api/dashboard/validate': {
          const pid = this.need(project)
          const body = (await this.body(req)) as DashboardSpec | undefined
          const spec = body ?? this.ws.loadDashboard(pid, board).spec
          const issues = body ? validateSpec(body) : this.ws.loadDashboard(pid, board).issues
          const results = await Promise.all(
            (spec?.widgets ?? []).map(async (w) => {
              if (w.type === 'html') {
                const p = this.ws.store.project(pid)!
                const ok = fs.existsSync(path.join(p.path, DASHBOARD_DIR, w.src))
                if (!ok) return { widget: w.id, error: `패널 파일이 없습니다: ${DASHBOARD_DIR}/${w.src}` }
                // 앱에서 패널을 연 뒤 실제로 난 오류 (파일이 그 뒤로 안 바뀌었을 때만)
                const runtimeError = this.ws.panelError(pid, w.src)
                return runtimeError ? { widget: w.id, panel: w.src, error: `패널 실행 오류: ${runtimeError}` } : { widget: w.id, panel: w.src }
              }
              if (!w.query) return { widget: w.id, rows: 0 }
              try {
                const r = await runQuery(this.ws, w.query, pid)
                return { widget: w.id, rows: r.rows.length }
              } catch (e) {
                return { widget: w.id, error: (e as Error).message }
              }
            })
          )
          return this.send(res, 200, { ok: !issues.length && results.every((r) => !('error' in r)), issues, results })
        }
        default:
          return this.send(res, 404, { error: `없는 경로: ${route}` })
      }
    } catch (e) {
      return this.send(res, 400, { error: (e as Error).message })
    }
  }

  private defaultProject(): string | undefined {
    return this.ws.store.db.settings.lastProjectId ?? this.ws.store.db.projects[0]?.id
  }

  private need(project: string | undefined): string {
    const pid = project ?? this.defaultProject()
    if (!pid || !this.ws.store.project(pid)) throw new Error('project 쿼리 파라미터가 필요합니다 (GET /api/projects)')
    return pid
  }
}
