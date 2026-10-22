import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { McpDefaultPolicy, McpPolicy, McpSecretList, McpServerConfig, McpServerInfo, McpStatus } from '../../../shared/types'
import { MCP_POLICY_LABEL, MCP_PROJECT_FILE } from '../../../shared/types'
import type { ViewProps } from '../App'
import { api, errorText } from '../api'
import { Field, Modal } from '../ui'

const STATUS: Record<McpStatus, { label: string; cls: string }> = {
  connected: { label: '연결됨', cls: 'ok' },
  connecting: { label: '연결 중', cls: 'warn' },
  idle: { label: '대기', cls: '' },
  error: { label: '오류', cls: 'bad' },
  unapproved: { label: '승인 필요', cls: 'warn' },
  needsAuth: { label: '로그인 필요', cls: 'warn' },
  disabled: { label: '꺼짐', cls: '' }
}

/** 서버가 실제로 실행하는 것 (승인 전에 보여 줄 내용) */
function describe(c: McpServerConfig): string {
  if ('url' in c) return `${c.type.toUpperCase()} ${c.url}${c.headers && Object.keys(c.headers).length ? `  (헤더: ${Object.keys(c.headers).join(', ')})` : ''}`
  const env = c.env && Object.keys(c.env).length ? `  (환경 변수: ${Object.keys(c.env).join(', ')})` : ''
  return [c.command, ...(c.args ?? [])].map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ') + env
}

type Remote = Extract<McpServerConfig, { url: string }>

/** 붙여 넣은 JSON 을 서버 설정 하나로. 이름이 들어 있으면 함께 돌려준다 */
export function parseServerConfig(text: string): { name?: string; cfg: McpServerConfig } {
  let t = text.trim()
  if (t.startsWith('"')) t = `{${t}}`
  let j: Record<string, unknown>
  try {
    j = JSON.parse(t)
  } catch {
    throw new Error('JSON 형식이 아닙니다')
  }
  let name: string | undefined
  if (j && typeof j.mcpServers === 'object') j = j.mcpServers as Record<string, unknown>
  const isServer = (o: Record<string, unknown>): boolean => 'command' in o || 'url' in o || 'httpUrl' in o
  if (!isServer(j)) {
    const keys = Object.keys(j)
    if (keys.length !== 1 || typeof j[keys[0]] !== 'object') throw new Error('서버 하나의 설정(command 또는 url)을 넣으세요')
    name = keys[0]
    j = j[keys[0]] as Record<string, unknown>
  }
  if (typeof j.httpUrl === 'string') return { name, cfg: { type: 'http', url: j.httpUrl, headers: j.headers as Record<string, string> | undefined } }
  if (typeof j.url === 'string') return { name, cfg: { type: j.type === 'sse' ? 'sse' : 'http', url: j.url, headers: j.headers as Record<string, string> | undefined } }
  if (typeof j.command === 'string') return { name, cfg: j as McpServerConfig }
  throw new Error('command 또는 url 이 필요합니다')
}

/** Authorization 헤더에 토큰이 그대로 적혀 있으면 [헤더 이름, 토큰] */
function literalToken(cfg: McpServerConfig): [string, string] | null {
  if (!('url' in cfg)) return null
  const entry = Object.entries(cfg.headers ?? {}).find(([k]) => k.toLowerCase() === 'authorization')
  if (!entry || entry[1].includes('${')) return null
  const token = entry[1].replace(/^Bearer\s+/i, '')
  return token ? [entry[0], token] : null
}

const POLICY_SHORT: Record<McpPolicy, string> = { allow: '자동 허용', ask: '확인', deny: '차단' }

const EXAMPLE = `{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-everything"]
}`

/**
 * 외부 MCP 서버. 앱이 직접 연결해 두고, 앱이 띄우는 claude·codex·gemini 세션은 agent_workspace 서버를 거쳐
 * <서버>__<도구> 로 쓴다. 프로젝트 .mcp.json 의 서버는 승인해야 실행된다.
 */
export function McpView({ project, openFile }: ViewProps): ReactNode {
  const [servers, setServers] = useState<McpServerInfo[]>([])
  const [adding, setAdding] = useState<{ name: string; json: string } | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [secrets, setSecrets] = useState<McpSecretList | null>(null)

  const load = useCallback(() => {
    void api.listMcp(project?.id).then(setServers, (e) => setError(errorText(e)))
    void api.mcpSecrets().then(setSecrets, () => setSecrets(null))
  }, [project?.id])
  useEffect(() => {
    load()
    return api.on('mcp', load)
  }, [load])

  const act = (p: Promise<unknown>): void => {
    setError('')
    void p.then(load, (e) => setError(errorText(e)))
  }

  const groups: { scope: McpServerInfo['scope']; title: string; hint: ReactNode }[] = [
    {
      scope: 'project',
      title: '프로젝트 서버',
      hint: (
        <>
          <code>{MCP_PROJECT_FILE}</code> (claude 와 같은 형식). 처음 쓸 때와 내용이 바뀔 때 승인해야 실행됩니다.
        </>
      )
    },
    { scope: 'global', title: '전역 서버', hint: '모든 프로젝트에서 씁니다. 여기서 추가하면 바로 승인됩니다.' }
  ]

  return (
    <div className="page scroll mcp-page">
      <div className="page-head">
        <h2>MCP 서버</h2>
        {project && (
          <button className="sm" onClick={() => act(api.initProjectMcpFile(project.id).then((rel) => openFile(rel)))}>
            {MCP_PROJECT_FILE} 열기
          </button>
        )}
        <button className="sm" onClick={() => act(api.openGlobalMcpFile())}>
          전역 설정 파일
        </button>
        {project && (
          <button className="sm" title="승인·켜진 서버에 모두 연결" onClick={() => act(api.connectMcp(project.id).then(setServers))}>
            모두 연결
          </button>
        )}
        <button className="primary sm" onClick={() => setAdding({ name: '', json: EXAMPLE })}>
          + 전역 서버
        </button>
      </div>
      <p className="muted small mcp-intro">
        도구마다 자동 허용 · 매번 확인 · 차단을 정할 수 있습니다 (기본: 읽기 전용 주석이 있는 도구만 자동 허용). 차단한 도구는 세션에 보이지 않습니다.
        여기 등록한 서버는 앱이 연결해 두고, 앱이 띄우는 claude·codex·gemini 세션에 <code>agent_workspace</code> 를 통해 <code>&lt;서버&gt;__&lt;도구&gt;</code> 이름으로
        제공됩니다. CLI 마다 따로 설정할 필요가 없고, 비밀값은 CLI 에 넘어가지 않습니다. <code>{'${VAR}'}</code> 는 아래 비밀값 → 앱 환경 변수 순으로 채워지고, OAuth 가 필요한 원격 서버는 카드의 "로그인"으로 연결합니다.
      </p>
      {error && <div className="error-box">{error}</div>}

      {groups.map((g) => {
        const list = servers.filter((s) => s.scope === g.scope)
        if (g.scope === 'project' && !project) return null
        return (
          <section key={g.scope} className="mcp-group">
            <div className="mcp-group-head">
              <h3>
                {g.title} <span className="muted count">{list.length}</span>
              </h3>
              <span className="muted small">{g.hint}</span>
            </div>
            {list.length ? (
              <div className="mcp-grid">
                {list.map((s) => {
                  const st = STATUS[s.status]
                  const expanded = open === s.key
                  return (
                    <article key={s.key} className={`bento mcp-card st-${s.status}`}>
                      <div className="mcp-card-head">
                        <span className={`mcp-dot ${st.cls}`} aria-hidden="true" />
                        <span className="strong ellipsis grow">{s.name}</span>
                        <span className="tag">{s.transport}</span>
                        <span className={`mcp-status ${st.cls}`}>{st.label}</span>
                        <input
                          type="checkbox"
                          className="switch"
                          aria-label={`${s.name} 켜기`}
                          checked={s.status !== 'disabled'}
                          onChange={(e) => act(api.setMcpEnabled(s.key, e.target.checked))}
                        />
                      </div>
                      <code className="mcp-cmd" title={describe(s.config)}>
                        {describe(s.config)}
                      </code>

                      {s.status === 'unapproved' && (
                        <div className="mcp-approve">
                          <span className="small">
                            이 서버는 위 명령을 이 PC 에서 실행합니다. 믿을 수 있는 설정인지 확인한 뒤 승인하세요.
                          </span>
                          <button className="primary sm" onClick={() => act(api.approveMcp(s.key, s.projectId))}>
                            승인하고 연결
                          </button>
                        </div>
                      )}
                      {s.missing.length > 0 && (
                        <div className="mcp-approve">
                          <span className="small">
                            비밀값이 없습니다: <code>{s.missing.join(', ')}</code> — 아래 "비밀값"에 추가하면 연결됩니다.
                          </span>
                        </div>
                      )}
                      {s.auth && s.status !== 'unapproved' && s.status !== 'disabled' && (
                        <div className="mcp-auth small">
                          {s.auth.pending ? (
                            <>
                              <span className="grow">브라우저에서 로그인하는 중… (5분 안에)</span>
                              {s.auth.authUrl && (
                                <button className="link small" onClick={() => act(api.mcpOpenUrl(s.auth!.authUrl!))}>
                                  다시 열기
                                </button>
                              )}
                              <button className="sm" onClick={() => act(api.mcpCancelLogin(s.key))}>
                                취소
                              </button>
                            </>
                          ) : s.auth.loggedIn ? (
                            <>
                              <span className="grow muted">OAuth 로그인됨 (토큰은 암호화해 보관)</span>
                              <button className="sm" onClick={() => confirm(`${s.name} 로그아웃할까요?`) && act(api.mcpLogout(s.key))}>
                                로그아웃
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="grow muted">{s.status === 'needsAuth' ? '이 서버는 로그인이 필요합니다.' : '로그인이 필요한 서버면 여기서 로그인하세요.'}</span>
                              <button className={s.status === 'needsAuth' ? 'primary sm' : 'sm'} onClick={() => act(api.mcpLogin(s.key, s.projectId))}>
                                로그인
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {s.error && s.status !== 'needsAuth' && <div className="error-box small">{s.error}</div>}

                      <label className="mcp-policy-row small">
                        <span className="muted grow">도구 기본 정책</span>
                        <select
                          value={s.defaultPolicy}
                          onChange={(e) => act(api.setMcpPolicy(s.key, '*', e.target.value as McpDefaultPolicy))}
                        >
                          {(Object.keys(MCP_POLICY_LABEL) as McpDefaultPolicy[]).map((p) => (
                            <option key={p} value={p}>
                              {MCP_POLICY_LABEL[p]}
                            </option>
                          ))}
                        </select>
                      </label>
                      {s.tools.length > 0 && (
                        <div className="mcp-policy-sum small muted">
                          {(['allow', 'ask', 'deny'] as McpPolicy[]).map((p) => {
                            const n = s.tools.filter((t) => t.policy === p).length
                            return n ? (
                              <span key={p} className={`mcp-pol pol-${p}`}>
                                {POLICY_SHORT[p]} {n}
                              </span>
                            ) : null
                          })}
                        </div>
                      )}

                      <div className="mcp-card-foot">
                        <button className="link small" disabled={!s.tools.length} onClick={() => setOpen(expanded ? null : s.key)}>
                          도구 {s.tools.length}개 {s.tools.length ? (expanded ? '접기' : '보기') : ''}
                        </button>
                        <span className="grow" />
                        {(s.status === 'idle' || s.status === 'error' || s.status === 'connected') && (
                          <button className="sm" onClick={() => act(api.reconnectMcp(s.key, s.projectId))}>
                            {s.status === 'idle' ? '연결' : '다시 연결'}
                          </button>
                        )}
                        {s.scope === 'global' && (
                          <button
                            className="sm danger"
                            onClick={() => confirm(`전역 서버 "${s.name}" 를 지울까요?`) && act(api.removeGlobalMcp(s.name))}
                          >
                            삭제
                          </button>
                        )}
                      </div>

                      {expanded && (
                        <ul className="mcp-tools">
                          {s.tools.map((t) => (
                            <li key={t.name}>
                              <span className="mono small grow ellipsis">{t.exposed}</span>
                              {t.readOnly && <span className="tag">읽기</span>}
                              {t.destructive && <span className="tag warn-tag">변경</span>}
                              <select
                                className={`mcp-tool-policy pol-${t.policy}`}
                                aria-label={`${t.name} 정책`}
                                value={t.override ?? ''}
                                onChange={(e) => act(api.setMcpPolicy(s.key, t.name, (e.target.value || null) as McpPolicy | null))}
                              >
                                <option value="">기본 ({POLICY_SHORT[t.policy]})</option>
                                <option value="allow">자동 허용</option>
                                <option value="ask">확인</option>
                                <option value="deny">차단</option>
                              </select>
                              {t.description && <span className="muted small block-text">{t.description}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      {s.log && (s.status === 'error' || expanded) && (
                        <details className="mcp-log">
                          <summary className="muted small">서버 로그</summary>
                          <pre>{s.log}</pre>
                        </details>
                      )}
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="bento mcp-empty muted small">
                {g.scope === 'project' ? (
                  <>
                    아직 없습니다. <button className="link" onClick={() => act(api.initProjectMcpFile(project!.id).then((rel) => openFile(rel)))}>{MCP_PROJECT_FILE}</button> 의{' '}
                    <code>mcpServers</code> 에 서버를 추가하세요.
                  </>
                ) : (
                  '아직 없습니다. "+ 전역 서버" 로 추가하세요.'
                )}
              </div>
            )}
          </section>
        )
      })}

      <SecretsSection secrets={secrets} onAct={act} />

      {adding && (
        <AddServerModal
          value={adding}
          onChange={setAdding}
          onClose={() => setAdding(null)}
          onSave={async (moveToken) => {
            const { cfg } = parseServerConfig(adding.json)
            const name = adding.name.trim()
            const lit = literalToken(cfg)
            if (moveToken && lit && 'url' in cfg) {
              // 토큰은 암호화 저장소로, 설정 파일에는 ${이름} 만
              const secret = `${name.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_TOKEN`
              await api.setMcpSecret(secret, lit[1])
              const bearer = /^Bearer\s/i.test((cfg as Remote).headers![lit[0]])
              ;(cfg as Remote).headers = { ...(cfg as Remote).headers, [lit[0]]: `${bearer ? 'Bearer ' : ''}\${${secret}}` }
            }
            await api.saveGlobalMcp(name, cfg)
            setAdding(null)
            load()
          }}
        />
      )}
    </div>
  )
}

/** 비밀값: 이름만 보이고 값은 다시 볼 수 없다 (바꾸기만) */
function SecretsSection({ secrets, onAct }: { secrets: McpSecretList | null; onAct: (p: Promise<unknown>) => void }): ReactNode {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  if (!secrets) return null
  const save = (n: string, v: string): void => {
    onAct(
      api.setMcpSecret(n.trim(), v).then(() => {
        setName('')
        setValue('')
      })
    )
  }
  return (
    <section className="mcp-group">
      <div className="mcp-group-head">
        <h3>
          비밀값 <span className="muted count">{secrets.items.filter((i) => i.stored).length}</span>
        </h3>
        <span className="muted small">
          설정의 <code>{'${이름}'}</code> 자리에 들어갑니다. OS 키 저장소로 암호화해 앱에만 두고, 화면·CLI·프로젝트 폴더에는 값이 나가지 않습니다.
        </span>
      </div>
      <div className="bento mcp-secrets">
        {!secrets.available && <div className="error-box small">이 PC 에서는 OS 키 저장소를 쓸 수 없어 비밀값을 저장할 수 없습니다. 앱 환경 변수만 쓸 수 있습니다.</div>}
        {secrets.items.length > 0 && (
          <ul className="mcp-secret-list">
            {secrets.items.map((i) => (
              <li key={i.name}>
                <code className="strong">{i.name}</code>
                {i.stored ? <span className="mcp-pol pol-allow">저장됨</span> : i.fromEnv ? <span className="mcp-pol">환경 변수</span> : i.hasDefault ? <span className="mcp-pol">기본값 사용</span> : <span className="mcp-pol pol-ask">없음</span>}
                <span className="muted small grow ellipsis">{i.usedBy.length ? `사용: ${i.usedBy.join(', ')}` : '쓰는 서버 없음'}</span>
                <button
                  className="sm"
                  disabled={!secrets.available}
                  onClick={() => {
                    setName(i.name)
                    setValue('')
                  }}
                >
                  {i.stored ? '바꾸기' : '넣기'}
                </button>
                {i.stored && (
                  <button className="sm danger" onClick={() => confirm(`비밀값 ${i.name} 를 지울까요?`) && onAct(api.removeMcpSecret(i.name))}>
                    삭제
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          className="mcp-secret-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && value) save(name, value)
          }}
        >
          <input className="mono" aria-label="비밀값 이름" placeholder="GITHUB_TOKEN" value={name} onChange={(e) => setName(e.target.value)} disabled={!secrets.available} />
          <input
            type="password"
            aria-label="비밀값"
            placeholder="값 (저장 후에는 다시 볼 수 없습니다)"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!secrets.available}
          />
          <button className="primary sm" type="submit" disabled={!secrets.available || !name.trim() || !value}>
            저장
          </button>
        </form>
      </div>
    </section>
  )
}

function AddServerModal(props: {
  value: { name: string; json: string }
  onChange: (v: { name: string; json: string }) => void
  onClose: () => void
  onSave: (moveToken: boolean) => Promise<void>
}): ReactNode {
  const [error, setError] = useState('')
  const [moveToken, setMoveToken] = useState(true)
  const { value: v } = props
  // 붙여 넣은 내용 미리 해석: 이름 채우기, 토큰이 그대로 있는지
  let parsed: { name?: string; cfg: McpServerConfig } | null = null
  let parseError = ''
  try {
    parsed = parseServerConfig(v.json)
  } catch (e) {
    parseError = (e as Error).message
  }
  const lit = parsed ? literalToken(parsed.cfg) : null
  const secretName = `${(v.name.trim() || 'SERVER').toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_TOKEN`
  return (
    <Modal
      title="전역 MCP 서버 추가"
      wide
      onClose={props.onClose}
      footer={
        <>
          <button onClick={props.onClose}>취소</button>
          <button className="primary" disabled={!v.name.trim() || !parsed} onClick={() => props.onSave(moveToken).catch((e) => setError(errorText(e)))}>
            추가하고 연결
          </button>
        </>
      }
    >
      <Field label="이름" hint="도구 이름 앞에 붙습니다 (예: github → github__create_issue)">
        <input autoFocus className="mono" value={v.name} placeholder="github" onChange={(e) => props.onChange({ ...v, name: e.target.value })} />
      </Field>
      <Field
        label="설정 (JSON)"
        hint={
          <>
            stdio: <code>{'{"command": "npx", "args": [...], "env": {...}}'}</code> · 원격: <code>{'{"type": "http", "url": "https://…", "headers": {...}}'}</code>
          </>
        }
      >
        <textarea
          className="mono"
          rows={9}
          value={v.json}
          onChange={(e) => {
            const json = e.target.value
            let name = v.name
            try {
              name = name || parseServerConfig(json).name || ''
            } catch {
              // 아직 입력 중
            }
            props.onChange({ name, json })
          }}
        />
      </Field>
      <p className="field-hint">claude·gemini 설정에서 <code>"mcpServers": {'{ … }'}</code> 를 통째로 붙여 넣어도 됩니다 (<code>httpUrl</code> 도 인식).</p>
      {parsed && 'url' in parsed.cfg && (
        <div className="muted small">
          원격 서버 · <span className="mono">{parsed.cfg.url}</span>
        </div>
      )}
      {lit && (
        <label className="check">
          <input type="checkbox" checked={moveToken} onChange={(e) => setMoveToken(e.target.checked)} />
          <span>
            헤더의 토큰을 비밀값 <code>{secretName}</code> 로 옮겨 암호화 저장 (권장 — 설정 파일에는 <code>{`\${${secretName}}`}</code> 만 남습니다)
          </span>
        </label>
      )}
      {v.json.trim() && parseError && <div className="muted small">{parseError}</div>}
      {error && <div className="error-box">{error}</div>}
    </Modal>
  )
}
