import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { AppState, Session } from '../../../shared/types'
import { ChatCard } from './AgentPanel'
import { Icon } from './Icon'

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const KEY = 'aw.floatingChat'
/** 버블 위치는 창과 따로 기억한다 (창이 화면에 맞춰 움직여도 버블은 제자리) */
const BUBBLE_KEY = 'aw.floatingBubble'
const MIN = { w: 340, h: 360 }
const BUBBLE = 52

function loadBox(): Box {
  const def = { w: 420, h: 580, x: window.innerWidth - 420 - 340, y: window.innerHeight - 580 - 24 }
  try {
    const b = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Box | null
    if (b && [b.x, b.y, b.w, b.h].every(Number.isFinite)) return b
  } catch {
    // 저장소를 못 쓰면 기본 위치
  }
  return def
}

function saveBox(b: Box): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b))
  } catch {
    // 위치 기억은 편의 기능 — 실패해도 그만
  }
}

type Point = { x: number; y: number }

function loadBubble(): Point | null {
  try {
    const p = JSON.parse(localStorage.getItem(BUBBLE_KEY) ?? 'null') as Point | null
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null
  } catch {
    return null
  }
}

function saveBubble(p: Point): void {
  try {
    localStorage.setItem(BUBBLE_KEY, JSON.stringify(p))
  } catch {
    // 위치 기억은 편의 기능
  }
}

const fitPoint = (p: Point, size: number): Point => ({
  x: Math.round(Math.max(8, Math.min(p.x, window.innerWidth - size - 8))),
  y: Math.round(Math.max(8, Math.min(p.y, window.innerHeight - size - 8)))
})

/** 버블 자리에서 창을 연다: 버블이 있는 쪽 모서리에 창을 붙여 화면 안쪽으로 펼친다 */
function anchorToBubble(b: Box, p: Point): Box {
  const right = p.x + BUBBLE / 2 > window.innerWidth / 2
  const bottom = p.y + BUBBLE / 2 > window.innerHeight / 2
  return fit({ ...b, x: right ? p.x + BUBBLE - b.w : p.x, y: bottom ? p.y + BUBBLE - b.h : p.y }, b.w, b.h)
}

/** 창(또는 버블)이 화면 밖으로 나가지 않게 위치를 맞춘다 */
function fit(b: Box, w: number, h: number): Box {
  return {
    ...b,
    x: Math.round(Math.max(8, Math.min(b.x, window.innerWidth - w - 8))),
    y: Math.round(Math.max(8, Math.min(b.y, window.innerHeight - h - 8)))
  }
}

/**
 * 대화 탭 밖에서 에이전트를 고르면 뜨는 채팅 창. 머리 줄을 끌어 옮기고, 오른쪽 아래 모서리로 크기를 바꾸며,
 * 최소화하면 둥근 버블로 접힌다 (버블도 끌어 옮길 수 있고 누르면 다시 펼쳐진다).
 */
export function FloatingChat(props: {
  state: AppState
  session: Session
  onSelect: (id: string) => void
  onOpenRun: (runId: string) => void
  onExpand: () => void
  onClose: () => void
}): ReactNode {
  const [box, setBox] = useState<Box>(() => fit(loadBox(), 420, 580))
  const [min, setMin] = useState(false)
  const [bubble, setBubble] = useState<Point | null>(() => loadBubble())
  const boxRef = useRef(box)
  boxRef.current = box
  const bubbleRef = useRef(bubble)
  bubbleRef.current = bubble
  const rootRef = useRef<HTMLDivElement>(null)

  // 창 크기를 바꾸면 밖으로 나가지 않게
  useEffect(() => {
    const onResize = (): void => {
      setBox((b) => fit(b, b.w, b.h))
      setBubble((p) => p && fitPoint(p, BUBBLE))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 사용자가 모서리로 크기를 바꾸면 기억
  useEffect(() => {
    const el = rootRef.current
    if (!el || min) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const b = boxRef.current
      if (Math.abs(r.width - b.w) > 1 || Math.abs(r.height - b.h) > 1) {
        const next = { ...b, w: Math.round(r.width), h: Math.round(r.height) }
        boxRef.current = next
        setBox(next)
        saveBox(next)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [min])

  /** 끌기 시작. 움직이지 않고 놓으면 onClick 을 부른다 (버블 펼치기) */
  const drag = (e: ReactPointerEvent, onClick?: () => void): void => {
    if (e.button !== 0) return
    const origin = min && bubbleRef.current ? bubbleRef.current : boxRef.current
    const start = { x: e.clientX, y: e.clientY, bx: origin.x, by: origin.y }
    let moved = false
    const move = (ev: PointerEvent): void => {
      const dx = ev.clientX - start.x
      const dy = ev.clientY - start.y
      if (!moved && Math.hypot(dx, dy) < 4) return
      moved = true
      document.body.classList.add('dragging')
      if (min) {
        const p = fitPoint({ x: start.bx + dx, y: start.by + dy }, BUBBLE)
        bubbleRef.current = p
        setBubble(p)
      } else setBox((b) => fit({ ...b, x: start.bx + dx, y: start.by + dy }, b.w, b.h))
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('dragging')
      if (moved) {
        if (min && bubbleRef.current) saveBubble(bubbleRef.current)
        else saveBox(boxRef.current)
      } else onClick?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** 창 → 버블. 버블 자리를 아직 정하지 않았으면 창 오른쪽 위(접기 버튼 근처)에 둔다 */
  const minimize = (): void => {
    if (!bubbleRef.current) {
      const b = boxRef.current
      const p = fitPoint({ x: b.x + b.w - BUBBLE - 8, y: b.y + 8 }, BUBBLE)
      setBubble(p)
      saveBubble(p)
    }
    setMin(true)
  }

  /** 버블 → 창. 버블 옆에 펼치고, 버블 자리는 그대로 둔다 */
  const restore = (): void => {
    const p = bubbleRef.current
    setBox((b) => {
      const next = p ? anchorToBubble(b, p) : fit(b, b.w, b.h)
      saveBox(next)
      return next
    })
    setMin(false)
  }

  const s = props.session

  if (min) {
    return (
      <button
        className={`chat-bubble av-${s.provider}`}
        style={{ left: bubble?.x ?? box.x, top: bubble?.y ?? box.y }}
        aria-label={`${s.title} 대화 펼치기`}
        title={`${s.title} — 누르면 펼치기, 끌면 옮기기`}
        onPointerDown={(e) => drag(e, restore)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && restore()}
      >
        {s.provider[0].toUpperCase()}
        <span className={`agent-status st-${s.status}`} />
      </button>
    )
  }

  return (
    <div
      ref={rootRef}
      className="chat-float"
      role="dialog"
      aria-label={`${s.title} 대화`}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, minWidth: MIN.w, minHeight: MIN.h }}
      onPointerDown={(e) => {
        // 머리 줄(버튼 제외)을 잡으면 끈다
        const t = e.target as HTMLElement
        if (t.closest('.chat-head') && !t.closest('button, a, input, select, textarea')) drag(e)
      }}
      onKeyDown={(e) => e.key === 'Escape' && props.onClose()}
    >
      <ChatCard
        key={s.id}
        state={props.state}
        session={s}
        onSelect={props.onSelect}
        onOpenRun={props.onOpenRun}
        floating
        headExtra={
          <>
            <button className="icon-btn" aria-label="버블로 접기" title="접기" onClick={minimize}>
              <Icon name="minus" />
            </button>
            <button className="icon-btn" aria-label="대화 탭에서 열기" title="대화 탭에서 열기" onClick={props.onExpand}>
              <Icon name="expand" />
            </button>
            <button className="icon-btn" aria-label="닫기" title="닫기 (Esc)" onClick={props.onClose}>
              <Icon name="close" />
            </button>
          </>
        }
      />
    </div>
  )
}
