import type { ReactNode } from 'react'
import type { Grant } from '../../../shared/types'
import { WRITE_ACTION_LABEL } from '../../../shared/types'
import type { ViewProps } from '../App'
import { api } from '../api'
import { timeAgo } from '../ui'

const KIND: Record<Grant['originKind'], string> = { panel: '대시보드 패널', agent: '에이전트 세션', api: 'HTTP API' }

export function PermissionsView({ state }: ViewProps): ReactNode {
  const enabled = state.settings.writeActions !== 'deny'
  const projectName = (id: string): string => state.projects.find((p) => p.id === id)?.name ?? '(삭제된 프로젝트)'
  return (
    <div className="bento-page perm-page">
      <section className={`bento pad-bento auto-card ${state.settings.autoApprove ? 'on' : ''}`}>
        <label className="toggle-row">
          <span className="grow">
            <span className="strong">자동 모드 (AutoMode)</span>
            <span className="block-text muted small">
              확인 창이 뜰 요청을 모두 묻지 않고 허용합니다 — claude 의 셸 명령·웹 가져오기·스킬 같은 CLI 도구, "매번 확인"인 MCP 도구, 메시지 보내기·세션 만들기·파일
              저장, 대시보드 스크립트 실행. "차단"한 MCP 도구와 아래 "쓰기 동작 허용"을 끈 경우는 그대로 막힙니다. 활동 로그에는 남습니다.
            </span>
          </span>
          <input
            type="checkbox"
            className="switch danger-switch"
            aria-label="자동 모드"
            checked={!!state.settings.autoApprove}
            onChange={(e) => {
              if (e.target.checked && !confirm('자동 모드를 켤까요?\n에이전트가 셸 명령 실행·파일 쓰기·다른 세션에 메시지 보내기를 묻지 않고 하게 됩니다.')) return
              void api.setSettings({ autoApprove: e.target.checked })
            }}
          />
        </label>
        {state.settings.autoApprove && <div className="auto-warn small">자동 모드가 켜져 있습니다. 믿을 수 있는 작업을 할 때만 켜 두세요.</div>}
      </section>

      <section className="bento pad-bento">
        <h2>쓰기 동작 권한</h2>
        <p className="muted small">
          대시보드 패널(<code>aw.sendMessage</code> 등), 에이전트(MCP <code>aw_send_message</code> 등), 스크립트·외부 도구(HTTP API)가 다른 세션에 메시지를 보내거나 세션을
          만들거나 중지하려면 사용자 확인을 거칩니다. 출처마다 1분에 20번까지만 요청할 수 있고, 에이전트는 자기 자신에게 메시지를 보낼 수 없습니다.
        </p>
        <label className="toggle-row">
          <span className="grow">
            <span className="strong">쓰기 동작 허용</span>
            <span className="block-text muted small">끄면 확인 창 없이 모든 쓰기 요청을 거부합니다 ("항상 허용" 목록도 무시)</span>
          </span>
          <input
            type="checkbox"
            className="switch"
            checked={enabled}
            onChange={(e) => void api.setSettings({ writeActions: e.target.checked ? 'ask' : 'deny' })}
          />
        </label>
      </section>

      <section className="bento pad-bento">
        <div className="row">
          <h2 className="grow">
            항상 허용 <span className="muted count">{state.grants.length}</span>
          </h2>
          {state.grants.length > 0 && (
            <button
              className="sm danger"
              onClick={() => {
                if (confirm('"항상 허용"을 모두 회수할까요?')) for (const g of state.grants) void api.revokeGrant(g.key)
              }}
            >
              모두 회수
            </button>
          )}
        </div>
        {state.grants.length ? (
          <div className="table-wrap">
            <table className="run-table">
              <thead>
                <tr>
                  <th>출처</th>
                  <th>동작</th>
                  <th>프로젝트</th>
                  <th>허용한 때</th>
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {state.grants.map((g) => (
                  <tr key={g.key}>
                    <td>
                      <span className="tag">{KIND[g.originKind]}</span> {g.originLabel}
                    </td>
                    <td>{WRITE_ACTION_LABEL[g.action]}</td>
                    <td>{projectName(g.projectId)}</td>
                    <td>{timeAgo(g.grantedAt)}</td>
                    <td className="num">
                      <button className="sm" onClick={() => void api.revokeGrant(g.key)}>
                        회수
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small">"항상 허용"한 항목이 없습니다. 쓰기 요청이 오면 매번 확인 창이 뜹니다.</p>
        )}
      </section>
      <section className="bento pad-bento">
        <h2>
          CLI 도구 허용 규칙 <span className="muted count">{Object.values(state.cliRules ?? {}).flat().length}</span>
        </h2>
        <p className="muted small">
          claude 세션이 권한이 필요한 자체 도구(WebFetch·Bash·Skill 등)를 쓰려 하면 앱 확인 창으로 묻습니다. "항상 허용"한 규칙은 그 프로젝트의 다음 세션부터
          처음부터 허용됩니다 (<code>Bash(npm *)</code> = npm 으로 시작하는 명령, <code>WebFetch(domain:…)</code> = 그 도메인).
        </p>
        {Object.entries(state.cliRules ?? {}).some(([, rules]) => rules.length) ? (
          <div className="table-wrap">
            <table className="run-table">
              <thead>
                <tr>
                  <th>프로젝트</th>
                  <th>규칙</th>
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {Object.entries(state.cliRules ?? {}).flatMap(([pid, rules]) =>
                  rules.map((r) => (
                    <tr key={pid + r}>
                      <td>{projectName(pid)}</td>
                      <td className="mono">{r}</td>
                      <td className="num">
                        <button className="sm" onClick={() => void api.removeCliRule(pid, r)}>
                          회수
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted small">아직 없습니다.</div>
        )}
      </section>
    </div>
  )
}
