import { useState, type ReactNode } from 'react'
import type { ProviderConfig, ProviderStatus } from '../../../shared/types'
import { EXTRA_ARG_HINTS, INSTALL_HINTS } from '../../../shared/types'
import type { ViewProps } from '../App'
import { api } from '../api'
import { Field, PROVIDER_COLORS, timeAgo } from '../ui'

export function CliView({ state }: ViewProps): ReactNode {
  const [checking, setChecking] = useState(false)
  return (
    <div className="page scroll">
      <div className="page-head">
        <h2>CLI 연결</h2>
        <div className="grow" />
        <button
          disabled={checking}
          onClick={async () => {
            setChecking(true)
            await api.detect()
            setChecking(false)
          }}
        >
          {checking ? '확인 중…' : '⟳ 모두 다시 확인'}
        </button>
      </div>
      <p className="muted">
        각 CLI 는 비대화형(headless) 모드로 실행되어 JSON 스트림으로 출력을 받습니다. 로그인/API 키 설정은 각 CLI 에서 먼저 해 두어야 합니다 (터미널에서 한 번 실행해
        로그인).
      </p>
      <div className="cli-cards">
        {state.providers.map((p) => (
          <ProviderCard key={p.id} p={p} status={state.providerStatus[p.id]} />
        ))}
      </div>
    </div>
  )
}

function ProviderCard({ p, status }: { p: ProviderConfig; status?: ProviderStatus }): ReactNode {
  const save = (patch: Partial<ProviderConfig>): void => void api.updateProvider(p.id, patch)
  return (
    <div className="card cli-card" style={{ borderTopColor: PROVIDER_COLORS[p.id] }}>
      <div className="card-head">
        <h3>{p.label}</h3>
        <label className="check">
          <input type="checkbox" checked={p.enabled} onChange={(e) => save({ enabled: e.target.checked })} /> 사용
        </label>
      </div>
      <div className={`cli-state ${!status ? '' : status.available ? 'ok' : 'bad'}`}>
        {!status ? '확인 중…' : status.available ? `✓ 연결됨 — ${status.version}` : `✕ 찾을 수 없음 — ${status.error ?? ''}`}
        {status && <span className="muted small"> · {timeAgo(status.checkedAt)}</span>}
      </div>
      {status && !status.available && (
        <div className="hint-box small">
          설치: <code>{INSTALL_HINTS[p.id]}</code>
        </div>
      )}
      <Field label="실행 명령" hint="PATH 에 없으면 전체 경로를 입력하세요">
        <div className="row">
          <input className="mono grow" defaultValue={p.command} onBlur={(e) => e.target.value.trim() && save({ command: e.target.value.trim() })} />
          <button onClick={() => void api.detect(p.id)}>확인</button>
        </div>
      </Field>
      <label className="toggle-row">
        <span className="grow">
          <span className="strong">Workspace MCP 연결</span>
          <span className="block-text muted small">
            앱이 띄우는 세션에 <code>agent_workspace</code> MCP 서버(aw_query 등 세션·비용·활동·대시보드 조회 도구)를 자동으로 붙입니다
          </span>
        </span>
        <input type="checkbox" className="switch" checked={p.mcp !== false} onChange={(e) => save({ mcp: e.target.checked })} />
      </label>
      <Field label="기본 모델" hint="비우면 CLI 기본값. 세션별로 덮어쓸 수 있습니다">
        <input className="mono" defaultValue={p.model} onBlur={(e) => save({ model: e.target.value.trim() })} />
      </Field>
      <Field
        label="추가 인자"
        hint={
          <>
            파일 수정 같은 도구 사용을 자동 승인하려면 예: <code>{EXTRA_ARG_HINTS[p.id]}</code>
          </>
        }
      >
        <input className="mono" defaultValue={p.extraArgs} onBlur={(e) => save({ extraArgs: e.target.value.trim() })} />
      </Field>
    </div>
  )
}
