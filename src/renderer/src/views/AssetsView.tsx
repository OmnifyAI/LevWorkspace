import { useEffect, useState, type ReactNode } from 'react'
import type { Asset } from '../../../shared/types'
import type { ViewProps } from '../App'
import { api, errorText } from '../api'
import { Empty, Field, formatBytes, timeAgo } from '../ui'

const isImage = (a: Asset): boolean => a.mime.startsWith('image/')
const isText = (a: Asset): boolean =>
  a.mime.startsWith('text/') || ['application/json', 'application/xml'].includes(a.mime)

function icon(a: Asset): string {
  if (isImage(a)) return '🖼'
  if (a.mime === 'application/pdf') return '📕'
  if (a.mime.startsWith('video/')) return '🎞'
  if (a.mime.startsWith('audio/')) return '🎵'
  if (isText(a)) return '📄'
  return '📦'
}

export function AssetsView({ state, project }: ViewProps): ReactNode {
  const p = project!
  const assets = state.assets.filter((a) => a.projectId === p.id)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [filter, setFilter] = useState('')
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const selected = assets.find((a) => a.id === selectedId)

  useEffect(() => {
    void api.rescanAssets(p.id)
  }, [p.id])

  const q = filter.toLowerCase()
  const shown = assets.filter((a) => !q || a.name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q)))

  const importFiles = async (files: string[]): Promise<void> => {
    if (!files.length) return
    try {
      setError('')
      const added = await api.importAssets(p.id, files)
      if (added[0]) setSelectedId(added[0].id)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div
      className={`split ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        void importFiles([...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean))
      }}
    >
      <div className="page scroll grow">
        <div className="page-head">
          <h2>에셋</h2>
          <span className="muted small mono">{p.path}/.agent-assets</span>
          <div className="grow" />
          <input placeholder="이름·태그 검색" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button onClick={() => void api.rescanAssets(p.id)} title="폴더에 직접 넣은 파일 반영">
            ⟳
          </button>
          <button className="primary" onClick={async () => importFiles(await api.pickFiles())}>
            + 파일 추가
          </button>
        </div>
        {error && <div className="error-box">{error}</div>}
        {!assets.length ? (
          <Empty title="에셋이 없습니다">
            <p className="muted">파일을 끌어다 놓거나 [+ 파일 추가] 를 누르세요. 프로젝트의 .agent-assets 폴더로 복사되어 에이전트가 읽을 수 있습니다.</p>
          </Empty>
        ) : (
          <div className="asset-grid">
            {shown.map((a) => (
              <button key={a.id} className={`asset-tile ${selected?.id === a.id ? 'active' : ''}`} onClick={() => setSelectedId(a.id)}>
                <div className="asset-thumb">{isImage(a) ? <img src={`ws-asset://${a.id}/`} alt="" /> : <span>{icon(a)}</span>}</div>
                <div className="ellipsis small">{a.name}</div>
                <div className="muted small">{formatBytes(a.size)}</div>
              </button>
            ))}
          </div>
        )}
        <div className="drop-hint">여기에 파일을 놓으면 추가됩니다</div>
      </div>
      {selected && <AssetDetail key={selected.id} asset={selected} sessionsUsing={state.sessions.filter((s) => s.assetIds.includes(selected.id)).length} />}
    </div>
  )
}

function AssetDetail({ asset: a, sessionsUsing }: { asset: Asset; sessionsUsing: number }): ReactNode {
  const [text, setText] = useState<string | null>(null)
  const [textErr, setTextErr] = useState('')

  useEffect(() => {
    if (!isText(a)) return
    api.readAssetText(a.id).then(setText, (e) => setTextErr(errorText(e)))
  }, [a.id])

  return (
    <aside className="settings-panel wide">
      <h3 className="ellipsis">{a.name}</h3>
      <div className="preview">
        {isImage(a) ? (
          <img src={`ws-asset://${a.id}/`} alt={a.name} />
        ) : a.mime.startsWith('video/') ? (
          <video src={`ws-asset://${a.id}/`} controls />
        ) : a.mime.startsWith('audio/') ? (
          <audio src={`ws-asset://${a.id}/`} controls />
        ) : isText(a) ? (
          <pre>{text ?? (textErr || '불러오는 중…')}</pre>
        ) : (
          <div className="muted pad">미리보기를 지원하지 않는 형식입니다 ({a.mime})</div>
        )}
      </div>
      <div className="kv small">
        <span>경로</span>
        <code>{a.relPath}</code>
        <span>크기</span>
        <span>{formatBytes(a.size)}</span>
        <span>추가</span>
        <span>{timeAgo(a.createdAt)}</span>
        <span>사용 세션</span>
        <span>{sessionsUsing}</span>
      </div>
      <Field label="태그" hint="쉼표로 구분">
        <input
          defaultValue={a.tags.join(', ')}
          onBlur={(e) =>
            void api.updateAsset(a.id, {
              tags: e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            })
          }
        />
      </Field>
      <Field label="메모" hint="세션에 첨부할 때 파일 경로와 함께 에이전트에게 전달됩니다">
        <textarea rows={3} defaultValue={a.note} onBlur={(e) => void api.updateAsset(a.id, { note: e.target.value })} />
      </Field>
      <div className="stack">
        <button onClick={() => void api.revealAsset(a.id)}>폴더에서 보기</button>
        <button onClick={() => void navigator.clipboard.writeText(a.relPath)}>경로 복사</button>
        <button
          className="danger"
          onClick={() => {
            if (confirm(`"${a.name}" 을(를) 삭제할까요?\n파일은 휴지통으로 이동합니다.`)) void api.removeAsset(a.id, true)
          }}
        >
          삭제 (휴지통)
        </button>
      </div>
    </aside>
  )
}
