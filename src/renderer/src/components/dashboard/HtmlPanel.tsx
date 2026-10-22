import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BridgeCall, BridgeEvent, BridgeReply, HtmlWidget, Query } from '../../../../shared/dashboard'
import { PANEL_SCHEME } from '../../../../shared/dashboard'
import type { AppState, Project } from '../../../../shared/types'
import { api, errorText } from '../../api'
import type { DashboardActions } from './DynamicDashboard'

const MIN_H = 40
const MAX_H = 4000
const VIEWS = ['projects', 'multi', 'skills', 'assets', 'cli'] as const

const panelUrl = (projectId: string, src: string, rev: number): string =>
  `${PANEL_SCHEME}://${projectId}/${src.replace(/^\.?\/+/, '').split('/').map(encodeURIComponent).join('/')}?r=${rev}`

/**
 * 샌드박스 iframe 패널. allow-scripts 만 주고 allow-same-origin 은 주지 않아
 * 패널은 앱 DOM·저장소·IPC 에 접근할 수 없다. 앱과는 postMessage(aw 브리지)로만 이야기한다.
 */
export function HtmlPanel(props: { w: HtmlWidget; project: Project; state: AppState; reloadKey: number; actions: DashboardActions }): ReactNode {
  const { w, project, actions } = props
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(w.height ?? 160)
  const [error, setError] = useState('')
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  // 패널을 다시 불러오면(파일 수정 등) 이전 문서의 오류 표시는 지운다. 새 문서의 오류는 그 뒤에 다시 온다
  useEffect(() => setError(''), [props.reloadKey])

  useEffect(() => {
    setError('')
    const onMessage = async (e: MessageEvent): Promise<void> => {
      const frame = ref.current?.contentWindow
      if (!frame || e.source !== frame) return
      const m = e.data as BridgeCall
      if (!m || m.__aw !== 1 || m.type !== 'call') return
      const p = (m.params ?? {}) as Record<string, any>
      const reply = (r: Omit<BridgeReply, '__aw' | 'type' | 'id'>): void => {
        if (m.id) frame.postMessage({ __aw: 1, type: 'reply', id: m.id, ...r } satisfies BridgeReply, '*')
      }
      try {
        let result: unknown = null
        switch (m.method) {
          case 'query': {
            const q = { ...(p.query as Query), ...(p.project ? { project: String(p.project) } : {}) }
            result = await api.query(project.id, q)
            break
          }
          case 'schema':
            result = await api.schema()
            break
          case 'run':
            result = await api.runScript(project.id, String(p.script ?? ''), p.args ?? {}, p.options, `대시보드 패널 ${w.src}`)
            break
          case 'scripts':
            result = await api.listScripts(project.id)
            break
          case 'fileRead':
            result = await api.panelReadFile(project.id, String(p.path ?? ''), p.encoding)
            break
          case 'fileList':
            result = await api.panelListFiles(project.id, String(p.dir ?? ''))
            break
          case 'fileSave':
            result = await api.panelSaveFile(project.id, w.src, String(p.path ?? ''), p.content, p.encoding)
            break
          case 'saveAs':
            result = await api.panelSaveAs(project.id, p.content, String(p.name ?? ''), p.encoding)
            break
          case 'write':
            result = await api.writeFromPanel(project.id, w.src, p.action)
            break
          case 'context':
            result = { projectId: project.id, projectName: project.name, widgetId: w.id, src: w.src, network: !!w.network }
            break
          case 'openSession':
            actionsRef.current.openSession(String(p.id))
            break
          case 'openFile':
            actionsRef.current.openFile(String(p.rel))
            break
          case 'openView':
            if (!VIEWS.includes(p.view)) throw new Error(`view 는 ${VIEWS.join(' | ')} 중 하나`)
            actionsRef.current.openView(p.view)
            break
          case 'resize':
            if (p.error) {
              setError(String(p.error))
              void api.reportPanelError(project.id, w.src, String(p.error))
            }
            else if (w.height === undefined && typeof p.height === 'number') setHeight(Math.min(MAX_H, Math.max(MIN_H, p.height)))
            break
          default:
            throw new Error(`알 수 없는 aw 메서드: ${String(m.method)}`)
        }
        reply({ ok: true, result })
      } catch (err) {
        reply({ ok: false, error: errorText(err) })
      }
    }
    const listener = (e: MessageEvent): void => void onMessage(e)
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [project.id, w.id, w.src, w.height])

  // 앱 상태가 바뀌면 패널에 알린다 (스트리밍 중 과도한 이벤트를 막으려고 0.5초 모아서)
  useEffect(() => {
    const t = setTimeout(() => {
      ref.current?.contentWindow?.postMessage({ __aw: 1, type: 'event', event: 'state', data: { at: Date.now() } } satisfies BridgeEvent, '*')
    }, 500)
    return () => clearTimeout(t)
  }, [props.state])

  return (
    <>
      {error && <div className="error-box small">패널 오류: {error}</div>}
      <iframe
        ref={ref}
        title={w.title ?? w.src}
        src={panelUrl(project.id, w.src, props.reloadKey)}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className={`panel-frame ${w.height === 'fill' ? 'fill' : ''}`}
        style={w.height === 'fill' ? undefined : { height: w.height ?? height }}
      />
    </>
  )
}
