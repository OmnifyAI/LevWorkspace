import { useState, type ReactNode } from 'react'
import type { Project, ProviderId } from '../../../shared/types'
import type { ViewProps } from '../App'
import { api, errorText } from '../api'
import { Empty, Field, Modal, ProviderBadge, ProviderSelect, timeAgo } from '../ui'

interface Draft {
  id?: string
  name: string
  path: string
  description: string
  defaultProvider: ProviderId
}

export function ProjectsView({ state, project, go }: ViewProps): ReactNode {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')

  const startNew = async (): Promise<void> => {
    const picked = await api.pickFolder()
    if (!picked) return
    setError('')
    setDraft({ name: picked.name, path: picked.path, description: '', defaultProvider: 'claude' })
  }

  const save = async (): Promise<void> => {
    if (!draft) return
    try {
      if (draft.id) {
        await api.updateProject(draft.id, {
          name: draft.name,
          description: draft.description,
          defaultProvider: draft.defaultProvider,
          path: draft.path
        })
      } else {
        await api.createProject(draft)
      }
      setDraft(null)
    } catch (e) {
      setError(errorText(e))
    }
  }

  const remove = async (p: Project): Promise<void> => {
    if (!confirm(`"${p.name}" 프로젝트를 목록에서 지울까요?\n세션·에셋 기록이 함께 지워집니다. 폴더의 파일은 그대로 남습니다.`)) return
    await api.removeProject(p.id)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>프로젝트</h2>
        <button className="primary" onClick={() => void startNew()}>
          + 폴더로 새 프로젝트
        </button>
      </div>

      {!state.projects.length ? (
        <Empty title="프로젝트가 없습니다">
          <p className="muted">작업할 폴더를 골라 첫 프로젝트를 만드세요. 에이전트는 그 폴더 안에서 실행됩니다.</p>
        </Empty>
      ) : (
        <div className="card-grid">
          {state.projects.map((p) => {
            const sessions = state.sessions.filter((s) => s.projectId === p.id)
            const running = sessions.filter((s) => s.status === 'running').length
            const assets = state.assets.filter((a) => a.projectId === p.id).length
            const active = project?.id === p.id
            return (
              <div key={p.id} className={`card project-card ${active ? 'active' : ''}`}>
                <div className="card-head">
                  <h3 className="ellipsis">{p.name}</h3>
                  <ProviderBadge id={p.defaultProvider} />
                </div>
                <div className="mono small muted ellipsis" title={p.path}>
                  {p.path}
                </div>
                {p.description && <p className="small">{p.description}</p>}
                <div className="stats small muted">
                  <span>세션 {sessions.length}</span>
                  {running > 0 && <span className="running-text">실행 중 {running}</span>}
                  <span>스킬 {state.skills.filter((k) => k.projectId === p.id).length}</span>
                  <span>에셋 {assets}</span>
                  <span>{timeAgo(p.updatedAt)}</span>
                </div>
                <div className="card-actions">
                  <button
                    className="primary"
                    onClick={() => {
                      void api.setSettings({ lastProjectId: p.id })
                      go('sessions')
                    }}
                  >
                    열기
                  </button>
                  <button onClick={() => void api.openProject(p.id)}>폴더</button>
                  <button
                    onClick={() => {
                      setError('')
                      setDraft({ ...p })
                    }}
                  >
                    편집
                  </button>
                  <button className="danger ghost" onClick={() => void remove(p)}>
                    삭제
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {draft && (
        <Modal
          title={draft.id ? '프로젝트 편집' : '새 프로젝트'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button onClick={() => setDraft(null)}>취소</button>
              <button className="primary" disabled={!draft.name.trim()} onClick={() => void save()}>
                저장
              </button>
            </>
          }
        >
          <Field label="이름">
            <input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="작업 디렉터리">
            <div className="row">
              <input className="grow mono" value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value })} />
              <button
                onClick={async () => {
                  const picked = await api.pickFolder()
                  if (picked) setDraft({ ...draft, path: picked.path })
                }}
              >
                찾기
              </button>
            </div>
          </Field>
          <Field label="설명">
            <textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>
          <Field label="기본 CLI">
            <ProviderSelect state={state} value={draft.defaultProvider} onChange={(v) => setDraft({ ...draft, defaultProvider: v })} />
          </Field>
          {error && <div className="error-box">{error}</div>}
        </Modal>
      )}
    </div>
  )
}
