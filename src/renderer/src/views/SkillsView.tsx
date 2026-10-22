import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Project, Skill } from '../../../shared/types'
import { SKILLS_DIR } from '../../../shared/types'
import type { ViewProps } from '../App'
import { api, errorText } from '../api'
import { Icon } from '../components/Icon'
import { timeAgo } from '../ui'

const TEMPLATE = `## 언제 쓰나
- 이 스킬이 적용되어야 하는 상황

## 지침
1.
2.
`

type Notice = { text: string; error?: boolean } | null

export function SkillsView({ state, project, openFile }: ViewProps): ReactNode {
  const skills = state.skills.filter((k) => k.projectId === project?.id)
  const [selectedId, setSelectedId] = useState<string | undefined>(skills[0]?.id)
  const [filter, setFilter] = useState('')
  const [notice, setNotice] = useState<Notice>(null)
  if (!project) return null

  const selected = skills.find((k) => k.id === selectedId) ?? skills[0]
  const q = filter.toLowerCase()
  const shown = skills.filter((k) => !q || `${k.name} ${k.description} ${k.id}`.toLowerCase().includes(q))
  const defaults = project.skillIds.filter((id) => skills.some((k) => k.id === id)).length

  const flash = (text: string, error = false): void => {
    setNotice({ text, error })
    setTimeout(() => setNotice(null), 5000)
  }
  const run = async (fn: () => Promise<string>): Promise<void> => {
    try {
      flash(await fn())
    } catch (e) {
      flash(errorText(e), true)
    }
  }
  const create = (): void =>
    void run(async () => {
      const k = await api.createSkill(project.id, { name: `new-skill-${skills.length + 1}`, description: '', content: TEMPLATE })
      setSelectedId(k.id)
      return `${k.relPath} 를 만들었습니다`
    })

  return (
    <div className="bento-page skills-bento">
      {/* ── 스킬 목록 */}
      <section className="bento skill-list-card" aria-labelledby="skill-list-title">
        <div className="bento-head">
          <div className="row">
            <h2 id="skill-list-title" className="grow">
              스킬 <span className="muted count">{skills.length}</span>
            </h2>
            <button className="primary sm" onClick={create}>
              + 새 스킬
            </button>
          </div>
          <label className="search">
            <Icon name="search" size={13} />
            <span className="sr-only">스킬 검색</span>
            <input placeholder="이름·설명 검색" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
        </div>
        <div className="skill-list">
          {shown.map((k) => {
            const on = selected?.id === k.id
            const def = project.skillIds.includes(k.id)
            return (
              <button key={k.id} className={`skill-row ${on ? 'on' : ''}`} onClick={() => setSelectedId(k.id)}>
                <span className="skill-row-top">
                  <span className="ellipsis strong">{k.name}</span>
                  {def && <span className="tag accent-tag">기본</span>}
                </span>
                <span className="ellipsis muted small">{k.description || '설명 없음'}</span>
                <span className="ellipsis muted small mono">
                  {SKILLS_DIR}/{k.id}
                  {k.extraFiles.length > 0 && ` · 파일 ${k.extraFiles.length}`}
                </span>
              </button>
            )
          })}
          {!shown.length && <div className="muted small pad">{skills.length ? '검색 결과가 없습니다' : `${SKILLS_DIR} 폴더에 스킬이 없습니다`}</div>}
        </div>
        <div className="bento-foot">
          <button className="grow sm" title="탐색기에서 .skills 폴더 열기" onClick={() => void api.openSkillsFolder(project.id)}>
            폴더 열기
          </button>
          <button
            className="grow sm"
            title="~/.claude/skills 와 이 프로젝트의 .claude/skills 에 있는 스킬 폴더를 .skills 로 복사"
            onClick={() =>
              void run(async () => {
                const copied = await api.importSkills(project.id)
                return copied.length ? `${copied.length}개 가져옴: ${copied.join(', ')}` : '새로 가져올 스킬이 없습니다'
              })
            }
          >
            가져오기
          </button>
        </div>
      </section>

      {/* ── 선택한 스킬 */}
      {selected ? (
        <SkillEditor
          key={selected.id}
          project={project}
          skill={selected}
          openFile={openFile}
          notice={notice}
          defaults={defaults}
          total={skills.length}
          onExport={() =>
            void run(async () => {
              const written = await api.exportSkillsToClaude(project.id)
              return written.length ? `${written.length}개를 .claude/skills 로 복사했습니다` : '기본 포함으로 표시한 스킬이 없습니다'
            })
          }
        />
      ) : (
        <section className="bento skill-empty-card">
          <div className="empty">
            <div className="empty-title">스킬이 없습니다</div>
            <p className="muted">
              스킬은 프로젝트 폴더의 <code>{SKILLS_DIR}/&lt;이름&gt;/SKILL.md</code> 파일입니다. 여기서 만들거나, 에디터로 폴더를 직접 만들어도 바로
              반영됩니다.
            </p>
            <div className="row">
              <button className="primary" onClick={create}>
                + 새 스킬
              </button>
              <button onClick={() => void api.openSkillsFolder(project.id)}>{SKILLS_DIR} 폴더 열기</button>
            </div>
            {notice && <div className={notice.error ? 'error-box' : 'notice'}>{notice.text}</div>}
          </div>
        </section>
      )}
    </div>
  )
}

interface Draft {
  name: string
  description: string
  content: string
}

function SkillEditor(props: {
  project: Project
  skill: Skill
  openFile: (rel: string) => void
  notice: Notice
  defaults: number
  total: number
  onExport: () => void
}): ReactNode {
  const { project, skill } = props
  const fromSkill = (): Draft => ({ name: skill.name, description: skill.description, content: skill.content })
  // base = 편집을 시작한(또는 마지막으로 저장·불러온) 시점의 파일 내용
  const [base, setBase] = useState(fromSkill)
  const [draft, setDraft] = useState(fromSkill)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState('')
  const same = (a: Draft, b: Draft): boolean => a.name === b.name && a.description === b.description && a.content === b.content
  const dirty = !same(draft, base)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const inDefault = project.skillIds.includes(skill.id)

  // 파일 내용이 바뀌면(바깥 수정 또는 우리 저장): 편집 중이 아니면 따라가고, 편집 중인데 내용이 다르면 알린다
  useEffect(() => {
    const now = fromSkill()
    if (same(now, base)) return
    if (!dirtyRef.current || same(now, draft)) {
      setBase(now)
      setDraft(now)
      setConflict(false)
    } else setConflict(true)
  }, [skill.updatedAt, skill.name, skill.description, skill.content])

  const save = async (): Promise<void> => {
    try {
      await api.updateSkill(project.id, skill.id, draft)
      setBase(draft)
      setConflict(false)
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (dirtyRef.current) void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const folder = `${SKILLS_DIR}/${skill.id}`

  return (
    <div className="skill-main">
      {/* ── 헤더 */}
      <section className="bento skill-head-card">
        <div className="skill-head">
          <div className="grow min0">
            <div className="row">
              <h1 className="ellipsis">{draft.name || skill.id}</h1>
              {dirty && <span className="tag warn-tag">저장 안 됨</span>}
            </div>
            <button className="link mono small" title="가운데 탭에서 파일 열기" onClick={() => props.openFile(skill.relPath)}>
              {skill.relPath}
            </button>
          </div>
          <span className="muted small">수정 {timeAgo(skill.updatedAt)}</span>
          <button className="primary" disabled={!dirty || !draft.name.trim()} onClick={() => void save()}>
            저장 (Ctrl+S)
          </button>
          <button
            className="icon-btn danger"
            aria-label="스킬 삭제"
            title="스킬 폴더를 휴지통으로"
            onClick={() => {
              if (confirm(`"${skill.name}" 스킬 폴더(${folder})를 휴지통으로 옮길까요?`)) {
                api.removeSkill(project.id, skill.id).catch((e) => setError(errorText(e)))
              }
            }}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
        {conflict && (
          <div className="error-box row">
            <span className="grow">파일이 바깥에서 바뀌었습니다. 저장하면 지금 편집 내용으로 덮어씁니다.</span>
            <button
              className="sm"
              onClick={() => {
                setBase(fromSkill())
                setDraft(fromSkill())
                setConflict(false)
              }}
            >
              파일 내용 다시 불러오기
            </button>
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
        {props.notice && <div className={props.notice.error ? 'error-box' : 'notice'}>{props.notice.text}</div>}
      </section>

      <div className="skill-grid">
        {/* ── 본문 */}
        <section className="bento skill-body-card" aria-labelledby="skill-body-title">
          <div className="card-title-row">
            <h2 id="skill-body-title">본문</h2>
            <span className="muted small">Markdown · {draft.content.split('\n').length}줄</span>
          </div>
          <label className="sr-only" htmlFor="skill-body">
            스킬 본문
          </label>
          <textarea id="skill-body" className="mono skill-body" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
        </section>

        <div className="skill-side">
          {/* ── 속성 */}
          <section className="bento pad-bento" aria-labelledby="skill-meta-title">
            <h2 id="skill-meta-title">속성</h2>
            <label className="field">
              <span className="field-label">이름 (name)</span>
              <input className="mono" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <span className="field-hint">폴더 이름({skill.id})은 그대로 두고 frontmatter 만 바뀝니다</span>
            </label>
            <label className="field">
              <span className="field-label">설명 (description)</span>
              <textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              <span className="field-hint">언제 이 스킬을 써야 하는지 — 에이전트가 이걸 보고 판단합니다</span>
            </label>
            <label className="toggle-row">
              <span className="grow">
                <span className="strong">새 세션에 기본 포함</span>
                <span className="block-text muted small">새 세션·멀티 실행에서 기본으로 체크</span>
              </span>
              <input
                type="checkbox"
                className="switch"
                checked={inDefault}
                onChange={(e) =>
                  void api.updateProject(project.id, {
                    skillIds: e.target.checked ? [...project.skillIds, skill.id] : project.skillIds.filter((x) => x !== skill.id)
                  })
                }
              />
            </label>
          </section>

          {/* ── 참고 파일 */}
          <section className="bento pad-bento" aria-labelledby="skill-files-title">
            <div className="row">
              <h2 id="skill-files-title" className="grow">
                참고 파일 <span className="muted count">{skill.extraFiles.length}</span>
              </h2>
              <button className="icon-btn" aria-label="스킬 폴더 열기" title="스킬 폴더 열기" onClick={() => void api.openSkillsFolder(project.id, skill.id)}>
                <Icon name="folder" size={14} />
              </button>
            </div>
            {skill.extraFiles.length ? (
              <div className="file-chips">
                {skill.extraFiles.map((f) => (
                  <button key={f} className="file-chip mono" title={`${folder}/${f}`} onClick={() => props.openFile(`${folder}/${f}`)}>
                    <Icon name="file" size={13} />
                    <span className="ellipsis">{f}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted small">참고 문서나 스크립트를 이 스킬 폴더에 넣으면, 세션에 넣을 때 경로가 함께 안내됩니다.</p>
            )}
          </section>

          {/* ── Claude Code 연동 */}
          <section className="bento pad-bento" aria-labelledby="skill-export-title">
            <h2 id="skill-export-title">Claude Code 로 내보내기</h2>
            <p className="muted small">
              기본 포함 스킬 {props.defaults}개 / 전체 {props.total}개를 <code>.claude/skills</code> 로 복사합니다. Claude Code 가 네이티브 스킬로 직접 읽습니다.
            </p>
            <button onClick={props.onExport}>내보내기</button>
          </section>
        </div>
      </div>
    </div>
  )
}
