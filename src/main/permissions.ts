import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { Grant, PermissionDecision, PermissionRequest, WriteAction, WriteOrigin } from '../shared/types'
import { WRITE_ACTION_LABEL } from '../shared/types'
import type { Workspace } from './workspace'

/** 출처 하나가 1분에 요청할 수 있는 쓰기 동작 수 (허용 여부와 무관) */
const RATE_LIMIT = 20
const RATE_WINDOW = 60_000
/** 이 시간 안에 응답이 없으면 거부 */
const REQUEST_TTL = 10 * 60_000

interface Pending {
  req: PermissionRequest
  resolve: (d: PermissionDecision) => void
  timer: NodeJS.Timeout
}

/**
 * 쓰기 동작 권한. 요청을 렌더러의 확인 창으로 보내고 결정을 기다린다.
 * "항상 허용"은 (출처, 동작) 단위로 저장하고 권한 화면에서 회수할 수 있다.
 */
export class PermissionBroker {
  private pending = new Map<string, Pending>()
  private hits = new Map<string, number[]>()

  constructor(private ws: Workspace) {}

  list(): PermissionRequest[] {
    return [...this.pending.values()].map((p) => p.req)
  }

  grants(): Grant[] {
    return Object.values(this.ws.store.db.grants).sort((a, b) => b.grantedAt - a.grantedAt)
  }

  static grantKey(origin: WriteOrigin, action: WriteAction): string {
    return `${origin.key}:${action.type}`
  }

  /** 허용되면 그냥 돌아오고, 거부·제한이면 예외 */
  async check(origin: WriteOrigin, action: WriteAction, info: Pick<PermissionRequest, 'summary' | 'target'>): Promise<'granted' | 'once' | 'always'> {
    const db = this.ws.store.db
    if (db.settings.writeActions === 'deny') throw new Error('쓰기 동작이 꺼져 있습니다 (권한 화면에서 켤 수 있습니다)')
    // 자동 모드: CLI 도구는 횟수 제한 없이 바로 허용 (셸 명령을 연달아 쓰는 게 보통이라)
    if (db.settings.autoApprove && action.type === 'cliTool') return 'once'

    // 횟수 제한 — 무한 루프·폭주 방지
    const now = Date.now()
    const recent = (this.hits.get(origin.key) ?? []).filter((t) => now - t < RATE_WINDOW)
    if (recent.length >= RATE_LIMIT) throw new Error(`요청이 너무 많습니다 (1분에 ${RATE_LIMIT}번까지)`)
    recent.push(now)
    this.hits.set(origin.key, recent)

    // 자동 모드: 나머지(쓰기 동작·MCP 확인 도구)는 횟수 제한을 거친 뒤 바로 허용 — 에이전트끼리 무한히 주고받는 것은 막는다
    if (db.settings.autoApprove) return 'once'

    const key = PermissionBroker.grantKey(origin, action)
    // MCP 도구의 "항상 허용"은 출처별 기록이 아니라 그 도구의 정책(허브)으로 남긴다
    const mcp = action.type === 'mcpTool' || action.type === 'cliTool'
    if (!mcp && db.grants[key]) return 'granted'

    if (!BrowserWindow.getAllWindows().length) throw new Error('확인할 앱 창이 없어 거부되었습니다')
    const req: PermissionRequest = { id: randomUUID(), at: now, origin, action, ...info, expiresAt: now + REQUEST_TTL }
    const decision = await new Promise<PermissionDecision>((resolve) => {
      const timer = setTimeout(() => this.respond(req.id, 'deny'), REQUEST_TTL)
      this.pending.set(req.id, { req, resolve, timer })
      this.ws.broadcast('permission', { type: 'request', request: req })
      // 창을 앞으로 가져와 사용자가 놓치지 않게
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isFocused()) win.flashFrame(true)
    })
    if (decision === 'deny') throw new Error(`사용자가 거부했습니다: ${WRITE_ACTION_LABEL[action.type]}`)
    if (decision === 'always' && !mcp) {
      db.grants[key] = {
        key, originKey: origin.key, originLabel: origin.label, originKind: origin.kind,
        action: action.type, projectId: origin.projectId, grantedAt: Date.now()
      }
      this.ws.changed()
    }
    return decision
  }

  respond(id: string, decision: PermissionDecision): void {
    const p = this.pending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(id)
    this.ws.broadcast('permission', { type: 'resolved', id })
    BrowserWindow.getAllWindows()[0]?.flashFrame(false)
    p.resolve(decision)
  }

  revoke(key: string): void {
    delete this.ws.store.db.grants[key]
    this.ws.changed()
  }

  /** 세션이 지워지면 그 세션 출처의 허용도 지운다 */
  forgetOrigin(originKey: string): void {
    for (const [k, g] of Object.entries(this.ws.store.db.grants)) if (g.originKey === originKey) delete this.ws.store.db.grants[k]
  }

  denyAll(): void {
    for (const id of [...this.pending.keys()]) this.respond(id, 'deny')
  }
}
