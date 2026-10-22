import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { FilePreview as Preview, GitChange, Project, Session } from '../../../shared/types'
import { api, errorText, fileUrl } from '../api'
import { formatBytes } from '../ui'
import { CodeLines, contentLines, diffLines } from './DiffView'

const CODE_LABEL: Record<GitChange['code'], string> = { M: '수정됨', A: '추가됨', D: '삭제됨', R: '이름 변경', U: '새 파일' }
export const CODE_COLOR: Record<GitChange['code'], string> = { M: '#f0b45a', A: '#3ecf8e', D: '#ff7b7b', R: '#8b98ff', U: '#3ecf8e' }

export function FilePreviewView(props: {
  project: Project
  rel: string
  change: GitChange | undefined
  /** git 상태가 바뀔 때마다 증가 — 내용을 다시 읽는다 */
  version: number
  session: Session | undefined
}): ReactNode {
  const { project, rel, change } = props
  const [preview, setPreview] = useState<Preview | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [mode, setMode] = useState<'content' | 'diff'>(change?.code === 'M' ? 'diff' : 'content')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    setError('')
    api.readFile(project.id, rel).then(setPreview, (e) => setError(errorText(e)))
    if (change && change.code !== 'U') api.gitDiff(project.id, rel).then(setDiff, () => setDiff(''))
    else setDiff(null)
  }, [project.id, rel, props.version, change?.code])

  const lines = useMemo(() => {
    if (mode === 'diff' && diff) return diffLines(diff)
    return preview?.kind === 'text' ? contentLines(preview.content) : []
  }, [mode, diff, preview])

  const parts = rel.split('/')
  const name = parts.pop()!
  const canDiff = !!diff

  return (
    <div className="file-view">
      <div className="file-head">
        <div className="grow min0">
          <div className="mono small muted ellipsis">{parts.length ? parts.join('/') + '/' : './'}</div>
          <div className="row">
            <h1 className="mono ellipsis">{name}</h1>
            {change && (
              <span className="code-badge" style={{ color: CODE_COLOR[change.code], borderColor: CODE_COLOR[change.code] }}>
                {CODE_LABEL[change.code]}
              </span>
            )}
          </div>
        </div>
        {canDiff && (
          <div className="segmented">
            <button className={mode === 'content' ? 'on' : ''} onClick={() => setMode('content')}>
              내용
            </button>
            <button className={mode === 'diff' ? 'on' : ''} onClick={() => setMode('diff')}>
              변경
            </button>
          </div>
        )}
        <button onClick={() => void api.revealFile(project.id, rel)}>폴더에서 보기</button>
        <button
          className="primary"
          disabled={!props.session}
          title={props.session ? `"${props.session.title}" 세션에 첨부` : '왼쪽에서 세션을 먼저 선택하세요'}
          onClick={async () => {
            if (!props.session) return
            await api.attachFile(props.session.id, rel)
            setNotice(`"${props.session.title}" 세션에 첨부했습니다`)
            setTimeout(() => setNotice(''), 3000)
          }}
        >
          세션에 첨부
        </button>
      </div>
      <div className="file-meta small muted">
        {preview && <span>{formatBytes(preview.size)}</span>}
        {preview?.kind === 'text' && <span>{lines.length}줄</span>}
        {preview?.kind === 'text' && preview.truncated && <span>앞부분 512KB만 표시</span>}
        {notice && <span className="ok-text">{notice}</span>}
      </div>

      {error ? (
        <div className="error-box">{error}</div>
      ) : !preview ? (
        <div className="muted">불러오는 중…</div>
      ) : preview.kind === 'image' ? (
        <div className="image-view">
          <img src={`${fileUrl(project.id, rel)}?v=${props.version}`} alt={name} />
        </div>
      ) : preview.kind === 'binary' && mode === 'content' ? (
        <div className="empty-view muted">미리보기를 지원하지 않는 형식입니다 ({preview.mime})</div>
      ) : (
        <CodeLines lines={lines} />
      )}
    </div>
  )
}
