import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BoardInfo, BoardKind } from '../../../shared/dashboard'
import { api, errorText } from '../api'
import { Field, Modal } from '../ui'
import { Icon } from './Icon'

export const boardIcon = (kind: BoardKind): string => (kind === 'tool' ? 'tool' : 'dashboard')

/** 상단 "보드" 메뉴 — 대시보드·도구 목록과 새로 만들기 */
export function BoardsMenu(props: {
  boards: BoardInfo[]
  activeBoard: string | undefined
  disabled: boolean
  onOpen: (id: string) => void
  onNew: (kind: BoardKind) => void
  favorites: string[]
  onToggleFavorite: (id: string) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const group = (kind: BoardKind): BoardInfo[] => props.boards.filter((b) => b.kind === kind)
  const pick = (fn: () => void): void => {
    setOpen(false)
    fn()
  }

  return (
    <div className="boards-menu" ref={ref}>
      <button
        className={`nav-btn ${open || (props.activeBoard && !props.favorites.includes(props.activeBoard)) ? 'on' : ''}`}
        title="보드"
        disabled={props.disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="dashboard" size={16} />
        <span className="nav-label">보드</span>
        <span className="nav-label nav-chevron" aria-hidden="true">
          <Icon name="chevron" size={12} />
        </span>
      </button>
      {open && (
        <div className="boards-pop" role="menu">
          {(['dashboard', 'tool'] as const).map((kind) => (
            <div key={kind} className="boards-group">
              <div className="boards-group-head">
                <span className="muted small strong">{kind === 'tool' ? '도구' : '대시보드'}</span>
                <button className="link small" role="menuitem" onClick={() => pick(() => props.onNew(kind))}>
                  + 새 {kind === 'tool' ? '도구' : '대시보드'}
                </button>
              </div>
              {group(kind).map((b) => {
                const fav = props.favorites.includes(b.id)
                return (
                  <div key={b.id} className={`board-row ${props.activeBoard === b.id ? 'on' : ''}`}>
                    <button role="menuitem" className="board-item" onClick={() => pick(() => props.onOpen(b.id))}>
                      <Icon name={boardIcon(b.kind)} size={14} />
                      <span className="grow min0">
                        <span className="block-text ellipsis">{b.title}</span>
                        <span className="block-text ellipsis muted small">{b.description || `${b.path} · 위젯 ${b.widgets}`}</span>
                      </span>
                      {b.issues > 0 && <span className="tag warn-tag">오류 {b.issues}</span>}
                    </button>
                    <button
                      className={`board-star ${fav ? 'on' : ''}`}
                      aria-pressed={fav}
                      aria-label={fav ? `${b.title} 즐겨찾기 해제` : `${b.title} 즐겨찾기`}
                      title={fav ? '즐겨찾기 해제' : '즐겨찾기 — 왼쪽 내비에 바로가기'}
                      onClick={() => props.onToggleFavorite(b.id)}
                    >
                      <Icon name={fav ? 'starFill' : 'star'} size={15} />
                    </button>
                  </div>
                )
              })}
              {!group(kind).length && <div className="muted small board-empty">아직 없습니다</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** 새 보드 만들기. 요청 내용을 쓰면 만든 뒤 바로 빌더 에이전트에게 맡긴다 */
export function NewBoardModal(props: {
  projectId: string
  kind: BoardKind
  onClose: () => void
  onCreated: (board: BoardInfo, request: string) => void
}): ReactNode {
  const [kind, setKind] = useState<BoardKind>(props.kind)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [request, setRequest] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const b = await api.createBoard(props.projectId, { title, kind, description })
      props.onCreated(b, request.trim())
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={kind === 'tool' ? '새 도구' : '새 대시보드'}
      onClose={props.onClose}
      footer={
        <>
          <button onClick={props.onClose}>취소</button>
          <button className="primary" disabled={!title.trim() || busy} onClick={() => void create()}>
            {request.trim() ? '만들고 빌더에게 요청' : '만들기'}
          </button>
        </>
      }
    >
      <div className="segmented kind-pick" role="radiogroup" aria-label="종류">
        <button role="radio" aria-checked={kind === 'dashboard'} className={kind === 'dashboard' ? 'on' : ''} onClick={() => setKind('dashboard')}>
          대시보드 — 지표·차트 모음
        </button>
        <button role="radio" aria-checked={kind === 'tool'} className={kind === 'tool' ? 'on' : ''} onClick={() => setKind('tool')}>
          도구 — 입력·실행이 있는 작은 앱
        </button>
      </div>
      <Field label="이름">
        <input autoFocus value={title} placeholder={kind === 'tool' ? '예: PR 리뷰 도구' : '예: 릴리스 현황'} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="설명 (선택)">
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field
        label="빌더에게 요청 (선택)"
        hint={kind === 'tool' ? '어떤 입력을 받아 무엇을 하는 도구인지 설명하세요. 필요하면 스크립트도 만듭니다.' : '보여 줄 지표·차트를 설명하세요.'}
      >
        <textarea
          rows={4}
          value={request}
          placeholder={
            kind === 'tool'
              ? '예: PR 번호를 입력하면 git diff 를 보여 주고, "리뷰 요청" 버튼으로 리뷰 세션을 만드는 도구'
              : '예: 최근 7일 CLI별 비용 추이와 실패한 턴 목록'
          }
          onChange={(e) => setRequest(e.target.value)}
        />
      </Field>
      {error && <div className="error-box">{error}</div>}
    </Modal>
  )
}
