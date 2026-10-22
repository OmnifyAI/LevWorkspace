import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export type MenuItem =
  | { sep: true }
  | {
      sep?: false
      label: string
      hint?: string
      /** 둘째 줄 (흐리게) */
      detail?: string
      /** 있으면 고르기 항목 (체크 표시) */
      checked?: boolean
      danger?: boolean
      disabled?: boolean
      run: () => void
    }

/**
 * 우클릭 메뉴. 화면 밖으로 나가지 않게 위치를 맞추고, 열리면 첫 항목에 초점.
 * ↑↓ Home End 로 이동, Enter 실행, Esc·바깥 클릭·스크롤·창 크기 변경으로 닫힌다.
 */
export function ContextMenu(props: { x: number; y: number; label: string; items: MenuItem[]; onClose: () => void; width?: number }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: props.x, top: props.y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(props.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(props.y, window.innerHeight - r.height - 8))
    })
    // 고른 항목이 있으면 거기에, 없으면 첫 항목에 초점
    ;(el.querySelector<HTMLButtonElement>('[aria-checked=true]') ?? el.querySelector<HTMLButtonElement>('[role^=menuitem]:not(:disabled)'))?.focus()
  }, [props.x, props.y])

  useEffect(() => {
    const close = (e: Event): void => {
      if (e.type === 'mousedown' && ref.current?.contains(e.target as Node)) return
      props.onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [props.onClose])

  const move = (dir: 1 | -1 | 'first' | 'last'): void => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role^=menuitem]:not(:disabled)') ?? [])]
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = dir === 'first' ? 0 : dir === 'last' ? items.length - 1 : (i + dir + items.length) % items.length
    items[next].focus()
  }

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      aria-label={props.label}
      style={{ ...pos, width: props.width }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Tab') {
          e.preventDefault()
          props.onClose()
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        } else if (e.key === 'Home') {
          e.preventDefault()
          move('first')
        } else if (e.key === 'End') {
          e.preventDefault()
          move('last')
        }
      }}
    >
      {props.items.map((it, i) =>
        it.sep ? (
          <div key={`sep${i}`} className="ctx-sep" role="separator" />
        ) : (
          <button
            key={it.label}
            role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
            aria-checked={it.checked}
            className={`ctx-item ${it.danger ? 'danger' : ''} ${it.detail ? 'two-line' : ''} ${it.checked ? 'checked' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              props.onClose()
              it.run()
            }}
          >
            {it.checked !== undefined && (
              <span className="ctx-check" aria-hidden="true">
                {it.checked ? '✓' : ''}
              </span>
            )}
            <span className="grow min0">
              <span className="block-text ellipsis">{it.label}</span>
              {it.detail && <span className="block-text ellipsis ctx-detail">{it.detail}</span>}
            </span>
            {it.hint && <span className="ctx-hint">{it.hint}</span>}
          </button>
        )
      )}
    </div>
  )
}
