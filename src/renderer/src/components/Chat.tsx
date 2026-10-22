import { memo, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Message } from '../../../shared/types'

const MessageItem = memo(function MessageItem({ m, compact }: { m: Message; compact?: boolean }): ReactNode {
  if (m.role === 'tool') {
    return (
      <details className="msg msg-tool">
        <summary className="mono">{m.title ?? '도구'}</summary>
        {m.content && <pre>{m.content}</pre>}
      </details>
    )
  }
  if (m.role === 'system' || m.role === 'error') {
    return <div className={`msg msg-${m.role}`}>{m.content}</div>
  }
  if (m.role === 'user' && m.from) {
    return (
      <div className={`msg msg-agent ${m.from.reply ? 'is-reply' : ''}`}>
        <div className="msg-agent-head">
          <span className={`agent-avatar av-${m.from.provider}`} aria-hidden="true">
            {m.from.provider[0].toUpperCase()}
          </span>
          <span className="strong ellipsis">{m.from.title}</span>
          <span className="muted">{m.from.reply ? '의 답장' : '이 보낸 메시지 · 이 턴의 답이 자동으로 돌아갑니다'}</span>
        </div>
        <div className="msg-text">{compact && m.content.length > 400 ? m.content.slice(0, 400) + '…' : m.content}</div>
      </div>
    )
  }
  if (m.role === 'user') {
    return (
      <div className="msg msg-user">
        <div className="msg-text">{compact && m.content.length > 400 ? m.content.slice(0, 400) + '…' : m.content}</div>
      </div>
    )
  }
  return (
    <div className="msg msg-assistant markdown">
      <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
    </div>
  )
})

/** 메시지 목록. 사용자가 맨 아래를 보고 있을 때만 자동으로 따라 내려간다. */
export function MessageList(props: { messages: Message[]; compact?: boolean; running?: boolean; hideTools?: boolean }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const items = props.hideTools ? props.messages.filter((m) => m.role !== 'tool') : props.messages

  useLayoutEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items, props.running])

  return (
    <div
      ref={ref}
      className={`messages ${props.compact ? 'compact' : ''}`}
      onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
      }}
    >
      {items.map((m) => (
        <MessageItem key={m.id} m={m} compact={props.compact} />
      ))}
      {props.running && (
        <div className="typing">
          <span />
          <span />
          <span />
        </div>
      )}
    </div>
  )
}

/** 입력창의 / 명령 하나. run 이 있으면 앱이 직접 처리하고, 없으면 그대로 CLI 에 보낸다. */
export interface SlashItem {
  name: string
  desc?: string
  tag?: string
  /** 인자 자동완성 후보 (예: /model 의 모델 이름) */
  args?: string[]
  run?: (arg: string) => void
}

type SlashMenu = { phase: 'name'; items: SlashItem[] } | { phase: 'arg'; item: SlashItem; items: string[] }

const MENU_MAX = 60

function slashMenu(text: string, items: SlashItem[]): SlashMenu | null {
  const m = /^\/(\S*)(?:\s+(.*))?$/.exec(text)
  if (!m || text.includes('\n')) return null
  const [, name, arg] = m
  if (arg === undefined && !/\s$/.test(text)) {
    const q = name.toLowerCase()
    const pre = items.filter((i) => i.name.toLowerCase().startsWith(q))
    const mid = items.filter((i) => !i.name.toLowerCase().startsWith(q) && i.name.toLowerCase().includes(q))
    const list = [...pre, ...mid].slice(0, MENU_MAX)
    return list.length ? { phase: 'name', items: list } : null
  }
  const item = items.find((i) => i.name === name)
  if (!item?.args?.length) return null
  const q = (arg ?? '').trim().toLowerCase()
  const list = item.args.filter((a) => a.toLowerCase().includes(q) && a.toLowerCase() !== q).slice(0, MENU_MAX)
  return list.length ? { phase: 'arg', item, items: list } : null
}

export function Composer(props: {
  onSend: (text: string) => void
  placeholder?: string
  disabled?: boolean
  footer?: ReactNode
  /** 전송 버튼 왼쪽에 놓일 버튼들 */
  actions?: ReactNode
  autoFocusKey?: string
  /** / 로 시작하면 보여 줄 명령 목록 */
  slash?: SlashItem[]
}): ReactNode {
  const [text, setText] = useState('')
  const [sel, setSel] = useState(0)
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [props.autoFocusKey])

  const menu = props.slash?.length && closedFor !== text ? slashMenu(text, props.slash) : null
  const count = menu?.items.length ?? 0
  const cur = count ? Math.min(sel, count - 1) : 0

  useEffect(() => {
    listRef.current?.querySelector('.slash-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [cur, menu?.phase])

  const edit = (v: string): void => {
    setText(v)
    setSel(0)
  }

  /** 앱이 처리하는 명령이면 실행하고 true */
  const runApp = (t: string): boolean => {
    const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(t)
    const item = m && props.slash?.find((i) => i.name === m[1])
    if (!m || !item?.run) return false
    item.run((m[2] ?? '').trim())
    return true
  }

  const send = (): void => {
    const t = text.trim()
    if (!t) return
    if (runApp(t)) {
      edit('')
      return
    }
    if (props.disabled) return
    props.onSend(t)
    edit('')
  }

  /** 메뉴에서 고른 항목을 입력창에 채운다. execute 이고 더 받을 인자가 없으면 바로 실행 */
  const pick = (i: number, execute: boolean): void => {
    if (!menu) return
    const item = menu.phase === 'name' ? menu.items[i] : menu.item
    const arg = menu.phase === 'arg' ? menu.items[i] : ''
    if (execute && item.run && (menu.phase === 'arg' || !item.args?.length)) {
      item.run(arg)
      edit('')
      return
    }
    edit(menu.phase === 'name' ? `/${item.name} ` : `/${item.name} ${arg}`)
    ref.current?.focus()
  }

  const option = (key: string, i: number, body: ReactNode): ReactNode => (
    <button
      key={key}
      type="button"
      role="option"
      aria-selected={i === cur}
      className={`slash-item ${i === cur ? 'on' : ''}`}
      onMouseEnter={() => setSel(i)}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pick(i, true)}
    >
      {body}
    </button>
  )

  return (
    <div className="composer">
      {menu && (
        <div className="slash-menu" role="listbox" aria-label={menu.phase === 'name' ? '명령' : `/${menu.item.name} 인자`} ref={listRef}>
          {menu.phase === 'name'
            ? menu.items.map((it, i) =>
                option(
                  it.name,
                  i,
                  <>
                    <span className="mono slash-name">/{it.name}</span>
                    {it.desc && <span className="muted ellipsis grow">{it.desc}</span>}
                    {it.tag && <span className={`slash-tag tag-${it.tag}`}>{it.tag}</span>}
                  </>
                )
              )
            : menu.items.map((a, i) => option(a, i, <span className="mono slash-name">{a}</span>))}
          <div className="slash-hint muted">↑↓ 이동 · Enter 선택 · Tab 채우기 · Esc 닫기</div>
        </div>
      )}
      <textarea
        ref={ref}
        rows={3}
        value={text}
        placeholder={props.placeholder ?? '메시지 입력 (Ctrl+Enter 전송)'}
        onChange={(e) => edit(e.target.value)}
        onKeyDown={(e) => {
          if (menu && count) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((cur + (e.key === 'ArrowDown' ? 1 : count - 1)) % count)
              return
            }
            if (e.key === 'Tab' || (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey)) {
              e.preventDefault()
              pick(cur, e.key === 'Enter')
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setClosedFor(text)
              return
            }
          }
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            send()
          }
        }}
      />
      <div className="composer-bar">
        <div className="composer-footer">{props.footer}</div>
        {props.actions}
        <button className="primary sm" disabled={!text.trim() || (props.disabled && !text.trim().startsWith('/'))} onClick={send}>
          전송
        </button>
      </div>
    </div>
  )
}
