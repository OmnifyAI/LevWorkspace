import { useState, type ReactNode } from 'react'
import type { AppState, MultiAgentSpec, MultiMode, MultiRun, Project, Session } from '../../../shared/types'
import { PROVIDER_IDS } from '../../../shared/types'
import type { ViewProps } from '../App'
import { api, errorText } from '../api'
import { MessageList } from '../components/Chat'
import { useMessages } from '../state'
import { Empty, Field, MultiPick, ProviderBadge, ProviderSelect, StatusDot, timeAgo } from '../ui'

const STATUS_LABEL: Record<MultiRun['status'], string> = { running: '실행 중', done: '완료', error: '중단/오류' }

export function MultiView({ state, project, focus, go }: ViewProps): ReactNode {
  const p = project!
  const runs = state.multiRuns.filter((r) => r.projectId === p.id)
  const [selectedId, setSelectedId] = useState<string | undefined>(focus.runId)
  const [creating, setCreating] = useState(!runs.length)
  const selected = runs.find((r) => r.id === selectedId) ?? runs[0]

  return (
    <div className="split">
      <aside className="side">
        <div className="side-head">
          <button className="primary block" onClick={() => setCreating(true)}>
            + 새 멀티 실행
          </button>
        </div>
        <div className="tree">
          {runs.map((r) => (
            <button
              key={r.id}
              className={`tree-item run-item ${!creating && selected?.id === r.id ? 'active' : ''}`}
              onClick={() => {
                setSelectedId(r.id)
                setCreating(false)
              }}
            >
              <span className={`dot dot-${r.status === 'running' ? 'running' : r.status === 'error' ? 'error' : 'idle'}`} />
              <span className="grow ellipsis">{r.title}</span>
              <span className="tag">{r.mode === 'parallel' ? '병렬' : '파이프'}</span>
            </button>
          ))}
          {!runs.length && <div className="muted small pad">실행 기록이 없습니다</div>}
        </div>
      </aside>
      {creating ? (
        <NewRunForm
          state={state}
          project={p}
          onCancel={runs.length ? () => setCreating(false) : undefined}
          onStarted={(id) => {
            setSelectedId(id)
            setCreating(false)
          }}
        />
      ) : selected ? (
        <RunBoard state={state} run={selected} go={go} />
      ) : (
        <Empty title="멀티 실행을 선택하세요" />
      )}
    </div>
  )
}

function NewRunForm(props: { state: AppState; project: Project; onCancel?: () => void; onStarted: (id: string) => void }): ReactNode {
  const { state, project } = props
  const enabled = PROVIDER_IDS.filter((id) => state.providers.find((p) => p.id === id)?.enabled)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<MultiMode>('parallel')
  const [agents, setAgents] = useState<MultiAgentSpec[]>(
    (enabled.length ? enabled : PROVIDER_IDS).map((provider) => ({ provider, model: '', role: '' }))
  )
  const [useSynth, setUseSynth] = useState(false)
  const [synth, setSynth] = useState<MultiAgentSpec>({ provider: project.defaultProvider, model: '', role: '심사자' })
  const [skillIds, setSkillIds] = useState<string[]>(project.skillIds)
  const [assetIds, setAssetIds] = useState<string[]>([])
  const [error, setError] = useState('')

  const patch = (i: number, v: Partial<MultiAgentSpec>): void => setAgents(agents.map((a, j) => (j === i ? { ...a, ...v } : a)))
  const move = (i: number, d: number): void => {
    const j = i + d
    if (j < 0 || j >= agents.length) return
    const next = agents.slice()
    ;[next[i], next[j]] = [next[j], next[i]]
    setAgents(next)
  }

  const start = async (): Promise<void> => {
    try {
      const id = await api.startMulti({
        projectId: project.id,
        title,
        prompt,
        mode,
        agents,
        synthesizer: useSynth ? synth : undefined,
        skillIds,
        assetIds
      })
      props.onStarted(id)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="page scroll">
      <div className="page-head">
        <h2>새 멀티 에이전트 실행</h2>
        {props.onCancel && <button onClick={props.onCancel}>취소</button>}
      </div>
      <div className="mode-cards">
        <button className={`mode-card ${mode === 'parallel' ? 'active' : ''}`} onClick={() => setMode('parallel')}>
          <b>병렬 (Broadcast)</b>
          <span className="muted small">같은 과제를 모든 에이전트에게 동시에 보내 결과를 나란히 비교</span>
        </button>
        <button className={`mode-card ${mode === 'pipeline' ? 'active' : ''}`} onClick={() => setMode('pipeline')}>
          <b>파이프라인 (Sequential)</b>
          <span className="muted small">앞 에이전트의 결과를 다음 에이전트가 이어받음 (예: 설계 → 구현 → 리뷰)</span>
        </button>
      </div>
      <Field label="제목">
        <input value={title} placeholder="비우면 과제 앞부분" onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="과제">
        <textarea rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Field>

      <Field label={mode === 'pipeline' ? '에이전트 (위에서부터 순서대로)' : '에이전트'}>
        <div className="agent-rows">
          {agents.map((a, i) => (
            <div key={i} className="agent-edit-row">
              <span className="muted mono">{i + 1}</span>
              <ProviderSelect state={state} value={a.provider} onChange={(v) => patch(i, { provider: v })} />
              <input className="mono" style={{ width: 150 }} placeholder="모델 (기본값)" value={a.model} onChange={(e) => patch(i, { model: e.target.value })} />
              <input className="grow" placeholder="역할 (예: 설계자, 구현자, 리뷰어)" value={a.role} onChange={(e) => patch(i, { role: e.target.value })} />
              {mode === 'pipeline' && (
                <>
                  <button className="ghost" onClick={() => move(i, -1)}>↑</button>
                  <button className="ghost" onClick={() => move(i, 1)}>↓</button>
                </>
              )}
              <button className="ghost danger" disabled={agents.length <= 1} onClick={() => setAgents(agents.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button className="ghost" onClick={() => setAgents([...agents, { provider: project.defaultProvider, model: '', role: '' }])}>
            + 에이전트 추가
          </button>
        </div>
      </Field>

      <label className="check">
        <input type="checkbox" checked={useSynth} onChange={(e) => setUseSynth(e.target.checked)} />
        모두 끝나면 종합 에이전트가 결과를 비교·통합
      </label>
      {useSynth && (
        <div className="agent-edit-row">
          <ProviderSelect state={state} value={synth.provider} onChange={(v) => setSynth({ ...synth, provider: v })} />
          <input className="mono" style={{ width: 150 }} placeholder="모델" value={synth.model} onChange={(e) => setSynth({ ...synth, model: e.target.value })} />
          <input className="grow" placeholder="역할" value={synth.role} onChange={(e) => setSynth({ ...synth, role: e.target.value })} />
        </div>
      )}

      <div className="grid2">
        <Field label="스킬">
          <MultiPick items={state.skills.filter((k) => k.projectId === project.id).map((k) => ({ id: k.id, label: k.name }))} value={skillIds} onChange={setSkillIds} empty="이 프로젝트의 .skills 에 스킬이 없습니다" />
        </Field>
        <Field label="첨부 에셋">
          <MultiPick
            items={state.assets.filter((a) => a.projectId === project.id).map((a) => ({ id: a.id, label: a.name }))}
            value={assetIds}
            onChange={setAssetIds}
            empty="에셋 없음"
          />
        </Field>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="row end">
        <button className="primary" disabled={!prompt.trim() || !agents.length} onClick={() => void start()}>
          ▶ 실행
        </button>
      </div>
    </div>
  )
}

function RunBoard({ state, run, go }: { state: AppState; run: MultiRun; go: ViewProps['go'] }): ReactNode {
  const sessions = run.sessionIds.map((id) => state.sessions.find((s) => s.id === id)).filter((s): s is Session => !!s)
  const synth = run.synthesizerSessionId ? state.sessions.find((s) => s.id === run.synthesizerSessionId) : undefined
  return (
    <div className="run-board">
      <div className="session-head">
        <h3 className="ellipsis">{run.title}</h3>
        <span className="tag">{run.mode === 'parallel' ? '병렬' : `파이프라인 ${Math.min(run.step + 1, run.sessionIds.length)}/${run.sessionIds.length}`}</span>
        <span className={`pill ${run.status === 'running' ? 'running' : ''}`}>{STATUS_LABEL[run.status]}</span>
        <span className="muted small">{timeAgo(run.createdAt)}</span>
        <div className="grow" />
        {run.status === 'running' && (
          <button className="danger" onClick={() => void api.stopMulti(run.id)}>
            ■ 전체 중지
          </button>
        )}
        <button
          className="ghost danger"
          onClick={() => {
            if (confirm('이 실행 기록을 삭제할까요? (확인 = 세션도 함께 삭제)')) void api.removeMulti(run.id, true)
          }}
        >
          삭제
        </button>
      </div>
      <details className="run-prompt">
        <summary className="small muted">과제 보기</summary>
        <pre>{run.prompt}</pre>
      </details>
      <div className="columns">
        {sessions.map((s, i) => (
          <RunColumn key={s.id} session={s} label={`${i + 1}. ${run.agents[i]?.role || s.provider}`} go={go} />
        ))}
        {synth && <RunColumn session={synth} label={`종합 · ${run.synthesizer?.role || synth.provider}`} go={go} highlight />}
      </div>
    </div>
  )
}

function RunColumn({ session: s, label, go, highlight }: { session: Session; label: string; go: ViewProps['go']; highlight?: boolean }): ReactNode {
  const messages = useMessages(s.id)
  return (
    <div className={`column ${highlight ? 'highlight' : ''}`}>
      <div className="column-head">
        <StatusDot status={s.status} />
        <span className="ellipsis grow">{label}</span>
        <ProviderBadge id={s.provider} />
        <button className="ghost small" title="세션에서 열기 (이어서 대화)" onClick={() => go('sessions', { sessionId: s.id })}>
          ↗
        </button>
      </div>
      <MessageList messages={messages} running={s.status === 'running'} compact hideTools />
    </div>
  )
}
