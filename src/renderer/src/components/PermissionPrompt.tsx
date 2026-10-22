import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppState, PermissionDecision, PermissionRequest, WriteOrigin } from '../../../shared/types'
import { WRITE_ACTION_LABEL } from '../../../shared/types'
import { api } from '../api'
import { ProviderBadge, StatusDot } from '../ui'

const ORIGIN_KIND: Record<WriteOrigin['kind'], string> = { panel: '대시보드 패널', agent: '에이전트', api: 'HTTP API' }

/**
 * 쓰기 동작 확인 창. 메인 프로세스가 보낸 요청을 하나씩 보여주고 결정을 돌려준다.
 * 배경을 눌러도 닫히지 않고, Esc 는 거부다.
 */
export function PermissionPrompt({ state }: { state: AppState }): ReactNode {
  const [queue, setQueue] = useState<PermissionRequest[]>([])
  const [now, setNow] = useState(Date.now())
  const denyRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void api.pendingPermissions().then(setQueue)
    return api.on('permission', (m: { type: 'request'; request: PermissionRequest } | { type: 'resolved'; id: string }) => {
      if (m.type === 'request') setQueue((q) => (q.some((x) => x.id === m.request.id) ? q : [...q, m.request]))
      else setQueue((q) => q.filter((x) => x.id !== m.id))
    })
  }, [])

  const req = queue[0]

  useEffect(() => {
    if (!req) return
    denyRef.current?.focus()
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [req?.id])

  if (!req) return null

  const decide = (d: PermissionDecision): void => {
    setQueue((q) => q.filter((x) => x.id !== req.id))
    void api.respondPermission(req.id, d)
  }
  const a = req.action
  const project = state.projects.find((p) => p.id === req.origin.projectId)
  const prompt = a.type === 'sendMessage' || a.type === 'createSession' ? a.prompt : undefined
  // 메인 프로세스와 시계가 조금 다를 수 있어 반올림
  // now 는 주기적으로만 갱신되므로 요청 시각보다 늦을 수 없게 맞춘다
  const left = Math.max(1, Math.ceil((req.expiresAt - Math.max(now, req.at)) / 60000))

  return (
    <div className="modal-backdrop perm-backdrop" role="presentation">
      <div
        className="modal perm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="perm-title"
        aria-describedby="perm-summary"
        onKeyDown={(e) => {
          if (e.key === 'Escape') decide('deny')
        }}
      >
        <div className="modal-head">
          <h3 id="perm-title">권한 확인 · {WRITE_ACTION_LABEL[a.type]}</h3>
          {queue.length > 1 && <span className="pill">대기 {queue.length - 1}</span>}
        </div>
        <div className="modal-body">
          <div className="perm-origin">
            <span className="tag">{ORIGIN_KIND[req.origin.kind]}</span>
            <span className="strong ellipsis">{req.origin.label}</span>
            {project && <span className="muted small ellipsis">· {project.name}</span>}
          </div>
          <p id="perm-summary" className="perm-summary">
            {req.summary}
          </p>

          {req.target && (
            <div className="perm-target">
              <StatusDot status={req.target.status} />
              <span className="ellipsis grow">{req.target.title}</span>
              <ProviderBadge id={req.target.provider} />
            </div>
          )}

          {a.type === 'createSession' && (
            <div className="kv small">
              <span>제목</span>
              <span>{a.title || '—'}</span>
              <span>CLI</span>
              <span>
                {a.provider ?? '프로젝트 기본'}
                {a.model ? ` · ${a.model}` : ''}
              </span>
              {a.child && (
                <>
                  <span>종류</span>
                  <span>자식 에이전트 (끝나면 요청한 세션에 결과 보고)</span>
                </>
              )}
            </div>
          )}

          {a.type === 'saveFile' && (
            <>
              <div className="kv small">
                <span>파일</span>
                <span className="mono">{a.path}</span>
                <span>크기</span>
                <span>{a.bytes.toLocaleString()} bytes</span>
                {a.exists && (
                  <>
                    <span>주의</span>
                    <span className="warn-text">이미 있는 파일을 덮어씁니다</span>
                  </>
                )}
              </div>
              <div className="field">
                <span className="field-label">내용 미리보기</span>
                <pre className="perm-prompt">{a.preview}</pre>
              </div>
            </>
          )}

          {a.type === 'cliTool' && (
            <>
              <div className="kv small">
                <span>도구</span>
                <span className="mono">{a.tool}</span>
                <span>항상 허용 시</span>
                <span className="mono">{a.rule}</span>
              </div>
              <div className="field">
                <span className="field-label">{typeof (a.input as { command?: unknown })?.command === 'string' ? '명령' : '입력'}</span>
                <pre className="perm-prompt">
                  {typeof (a.input as { command?: unknown })?.command === 'string'
                    ? String((a.input as { command: string }).command)
                    : JSON.stringify(a.input ?? {}, null, 2)}
                </pre>
              </div>
            </>
          )}

          {a.type === 'mcpTool' && (
            <>
              <div className="kv small">
                <span>서버</span>
                <span className="mono">{a.server}</span>
                <span>도구</span>
                <span className="mono">{a.tool}</span>
              </div>
              <div className="field">
                <span className="field-label">인자</span>
                <pre className="perm-prompt">{JSON.stringify(a.args ?? {}, null, 2)}</pre>
              </div>
            </>
          )}

          {prompt && (
            <div className="field">
              <span className="field-label">보낼 내용 ({prompt.length.toLocaleString()}자)</span>
              <pre className="perm-prompt">{prompt}</pre>
            </div>
          )}

          <p className="field-hint">
            {a.type === 'mcpTool' ? (
              <>"항상 허용"을 고르면 이 도구는 모든 세션에서 다시 묻지 않습니다 (MCP 서버 화면에서 바꿀 수 있습니다).</>
            ) : a.type === 'cliTool' ? (
              <>"항상 허용"을 고르면 이 프로젝트에서 「{a.rule}」 는 다시 묻지 않습니다 (권한 화면에서 회수할 수 있습니다).</>
            ) : (
              <>"항상 허용"을 고르면 이 출처의 「{WRITE_ACTION_LABEL[a.type]}」 요청은 다시 묻지 않습니다. 권한 화면에서 언제든 회수할 수 있습니다.</>
            )}{' '}
            약 {left}분 안에 고르지 않으면 거부됩니다.
          </p>
        </div>
        <div className="modal-foot">
          <button ref={denyRef} onClick={() => decide('deny')}>
            거부
          </button>
          <button onClick={() => decide('always')}>항상 허용</button>
          <button className="primary" onClick={() => decide('once')}>
            이번만 허용
          </button>
        </div>
      </div>
    </div>
  )
}
