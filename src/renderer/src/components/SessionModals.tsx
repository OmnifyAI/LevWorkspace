import { useState, type ReactNode } from 'react'
import type { AppState, Project, ProviderId, Session } from '../../../shared/types'
import { api, errorText } from '../api'
import { reloadMessages } from '../state'
import { Field, Modal, MultiPick, ProviderSelect, timeAgo } from '../ui'
import { ACCESS_HINT, ACCESS_LABEL, accessArgs, type AccessPreset, type AccessSettings } from '../../../shared/access'

/** codex·gemini 권한 프리셋 + 네트워크·웹 토글. claude 는 앱 확인 창으로 묻는다는 안내만 */
export function AccessFields(props: { provider: ProviderId; value: AccessSettings | undefined; onChange: (v: AccessSettings) => void }): ReactNode {
  const { provider } = props
  const v = props.value ?? {}
  if (provider === 'claude') {
    return (
      <p className="field-hint">
        권한: claude 는 권한이 필요한 도구(WebFetch·Bash·Skill 등)를 쓸 때 앱 확인 창으로 묻습니다. "항상 허용"한 규칙은 권한 화면에서 봅니다.
      </p>
    )
  }
  const set = (patch: AccessSettings): void => props.onChange({ ...v, ...patch })
  const args = accessArgs(provider, v)
  return (
    <div className="access-fields">
      <Field label="권한" hint={v.preset ? ACCESS_HINT[provider][v.preset] : 'CLI 연결 화면·세션 추가 인자의 설정을 그대로 씁니다'}>
        <div className="seg" role="radiogroup" aria-label="권한 프리셋">
          {([undefined, 'read', 'edit', 'full'] as (AccessPreset | undefined)[]).map((p) => (
            <button
              key={p ?? 'cli'}
              type="button"
              role="radio"
              aria-checked={v.preset === p}
              className={`seg-btn ${v.preset === p ? 'on' : ''} ${p === 'full' ? 'danger-seg' : ''}`}
              onClick={() => set({ preset: p })}
            >
              {p ? ACCESS_LABEL[p] : 'CLI 설정 그대로'}
            </button>
          ))}
        </div>
      </Field>
      {v.preset && (
        <div className="access-toggles">
          {provider === 'codex' && (
            <label className={`check small ${v.preset !== 'edit' ? 'muted' : ''}`} title={v.preset === 'edit' ? '' : v.preset === 'read' ? '읽기 전용은 네트워크도 막힙니다' : '전체 허용은 네트워크도 허용됩니다'}>
              <input type="checkbox" disabled={v.preset !== 'edit'} checked={v.preset === 'full' || (v.preset === 'edit' && !!v.network)} onChange={(e) => set({ network: e.target.checked })} />
              셸 명령의 네트워크 허용 (npm install 등)
            </label>
          )}
          <label className={`check small ${provider === 'gemini' && v.preset === 'full' ? 'muted' : ''}`}>
            <input
              type="checkbox"
              disabled={provider === 'gemini' && v.preset === 'full'}
              checked={provider === 'codex' ? v.web !== false : !!v.web || v.preset === 'full'}
              onChange={(e) => set({ web: e.target.checked })}
            />
            {provider === 'codex' ? '웹 검색 허용 (codex 기본값: 켜짐)' : '웹 가져오기·검색 허용 (web_fetch, google_web_search)'}
          </label>
          <code className="access-args" title="실행할 때 붙는 옵션">
            {args.join(' ')}
          </code>
        </div>
      )}
    </div>
  )
}

export function NewSessionModal(props: { state: AppState; project: Project; onClose: () => void; onCreated: (s: Session) => void }): ReactNode {
  const { state, project } = props
  const [title, setTitle] = useState('')
  const [provider, setProvider] = useState<ProviderId>(project.defaultProvider)
  const [allowDelegation, setAllowDelegation] = useState(false)
  const [access, setAccess] = useState<AccessSettings>({})
  const [skillIds, setSkillIds] = useState<string[]>(project.skillIds)
  const [assetIds, setAssetIds] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const assets = state.assets.filter((a) => a.projectId === project.id)

  const create = async (): Promise<void> => {
    try {
      const s = await api.createSession({
        projectId: project.id,
        title: title || prompt.slice(0, 40) || '새 세션',
        provider,
        model: '',
        allowDelegation,
        access: access.preset ? access : undefined,
        skillIds,
        assetIds,
        prompt
      })
      props.onCreated(s)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Modal
      title="새 세션"
      wide
      onClose={props.onClose}
      footer={
        <>
          <button onClick={props.onClose}>취소</button>
          <button className="primary" onClick={() => void create()}>
            {prompt.trim() ? '만들고 실행' : '만들기'}
          </button>
        </>
      }
    >
      <div className="grid2">
        <Field label="제목">
          <input autoFocus value={title} placeholder="비우면 프롬프트 앞부분" onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="CLI" hint="모델은 채팅창에서 /model">
          <ProviderSelect state={state} value={provider} onChange={setProvider} />
        </Field>
      </div>
      <AccessFields provider={provider} value={access} onChange={setAccess} />
      <Field label="첫 프롬프트 (선택)">
        <textarea rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={allowDelegation} onChange={(e) => setAllowDelegation(e.target.checked)} />
        자식 에이전트 위임 허용 (리드 에이전트 모드)
      </label>
      <div className="grid2">
        <Field label="스킬">
          <MultiPick items={state.skills.filter((k) => k.projectId === project.id).map((k) => ({ id: k.id, label: k.name }))} value={skillIds} onChange={setSkillIds} empty="이 프로젝트의 .skills 에 스킬이 없습니다" />
        </Field>
        <Field label="첨부 에셋">
          <MultiPick items={assets.map((a) => ({ id: a.id, label: a.name }))} value={assetIds} onChange={setAssetIds} empty="에셋 없음" />
        </Field>
      </div>
      {error && <div className="error-box">{error}</div>}
    </Modal>
  )
}

export function SpawnChildModal(props: { state: AppState; parent: Session; onClose: () => void; onCreated: (s: Session) => void }): ReactNode {
  const { state, parent } = props
  const [title, setTitle] = useState('')
  const [provider, setProvider] = useState<ProviderId>(parent.provider)
  const [prompt, setPrompt] = useState('')
  const [autoReport, setAutoReport] = useState(true)
  const [error, setError] = useState('')

  const create = async (): Promise<void> => {
    try {
      props.onCreated(await api.spawnChild(parent.id, { title: title || prompt.slice(0, 40), provider, model: '', prompt, autoReport }))
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Modal
      title={`자식 에이전트 — ${parent.title}`}
      onClose={props.onClose}
      footer={
        <>
          <button onClick={props.onClose}>취소</button>
          <button className="primary" disabled={!prompt.trim()} onClick={() => void create()}>
            생성하고 실행
          </button>
        </>
      }
    >
      <Field label="제목">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="CLI" hint="모델은 채팅창에서 /model">
        <ProviderSelect state={state} value={provider} onChange={setProvider} />
      </Field>
      <Field label="하위 작업 지시">
        <textarea rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={autoReport} onChange={(e) => setAutoReport(e.target.checked)} />
        끝나면 결과를 부모 세션에 자동 보고
      </label>
      <p className="field-hint">부모의 스킬과 첨부 에셋을 물려받고, 같은 프로젝트 디렉터리에서 실행됩니다.</p>
      {error && <div className="error-box">{error}</div>}
    </Modal>
  )
}

export function SessionSettingsModal({ state, session: s, onClose }: { state: AppState; session: Session; onClose: () => void }): ReactNode {
  const assets = state.assets.filter((a) => a.projectId === s.projectId)
  const running = s.status === 'running'
  return (
    <Modal title={`세션 설정 — ${s.title}`} onClose={onClose} wide>
      <div className="grid2">
        <Field label="제목">
          <input defaultValue={s.title} onBlur={(e) => e.target.value.trim() && void api.updateSession(s.id, { title: e.target.value.trim() })} />
        </Field>
        <Field label="CLI" hint="바꾸면 새 CLI 세션으로 시작 · 모델은 채팅창에서 /model">
          <ProviderSelect state={state} value={s.provider} onChange={(v) => void api.updateSession(s.id, { provider: v })} />
        </Field>
      </div>
      <AccessFields
        provider={s.provider}
        value={s.access}
        onChange={(v) => void api.updateSession(s.id, { access: v.preset ? v : undefined })}
      />
      <label className="check">
        <input type="checkbox" checked={s.allowDelegation} onChange={(e) => void api.updateSession(s.id, { allowDelegation: e.target.checked })} />
        자식 에이전트 위임 허용
      </label>
      <p className="field-hint">
        에이전트가 &lt;delegate&gt; 블록을 쓰면 자식 세션이 자동 생성되고, 모두 끝나면 결과가 이 세션으로 돌아옵니다. (새 대화의 첫 턴에 안내가 들어갑니다)
      </p>
      {s.parentId && (
        <label className="check">
          <input
            type="checkbox"
            checked={s.autoReport}
            onChange={(e) => void api.updateSession(s.id, { autoReport: e.target.checked, pendingReport: e.target.checked })}
          />
          끝나면 부모에게 자동 보고
        </label>
      )}
      <div className="grid2">
        <Field label="스킬" hint="새 대화의 첫 프롬프트에 포함">
          <MultiPick
            items={state.skills.filter((k) => k.projectId === s.projectId).map((k) => ({ id: k.id, label: k.name }))}
            value={s.skillIds}
            onChange={(v) => void api.updateSession(s.id, { skillIds: v })}
            empty="이 프로젝트의 .skills 에 스킬이 없습니다"
          />
        </Field>
        <Field label="첨부 파일" hint="매 프롬프트에 경로가 함께 전달됩니다">
          <MultiPick
            items={assets.map((a) => ({ id: a.id, label: a.relPath }))}
            value={s.assetIds}
            onChange={(v) => void api.updateSession(s.id, { assetIds: v })}
            empty="첨부할 파일이 없습니다"
          />
        </Field>
      </div>
      <div className="row">
        <span className="muted small grow">
          생성 {timeAgo(s.createdAt)} · 갱신 {timeAgo(s.updatedAt)}
          {s.cliSessionId && <> · CLI 세션 <span className="mono">{s.cliSessionId.slice(0, 8)}</span></>}
        </span>
        <button
          disabled={running}
          onClick={async () => {
            if (!confirm('대화 기록을 지우고 새 CLI 세션으로 시작할까요?')) return
            await api.resetSession(s.id)
            reloadMessages(s.id)
          }}
        >
          대화 초기화
        </button>
        <button
          className="danger"
          onClick={() => {
            const n = state.sessions.filter((x) => x.parentId === s.id).length
            if (confirm(`"${s.title}" 세션을 삭제할까요?${n ? `\n자식 세션 ${n}개도 함께 삭제됩니다.` : ''}`)) {
              void api.removeSession(s.id)
              onClose()
            }
          }}
        >
          세션 삭제
        </button>
      </div>
    </Modal>
  )
}
