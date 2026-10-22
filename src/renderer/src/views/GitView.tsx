import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { GitBranch, GitCommit, GitCommitDetail, GitFileChange, GitRepoStatus } from '../../../shared/types'
import type { ViewProps } from '../App'
import { api, errorText } from '../api'
import { ContextMenu } from '../components/ContextMenu'
import { DiffView } from '../components/DiffView'
import { Icon } from '../components/Icon'
import { timeAgo } from '../ui'

const PAGE = 60

const CODE_COLOR: Record<string, string> = { M: 'var(--warn)', A: 'var(--ok)', D: 'var(--bad)', R: 'var(--accent)', C: 'var(--accent)', U: 'var(--ok)', '!': 'var(--bad)' }
const CODE_LABEL: Record<string, string> = { M: '수정', A: '추가', D: '삭제', R: '이름 변경', C: '복사', U: '새 파일', '!': '충돌', T: '형식 변경' }

/** 스테이징 목록은 index 글자, 변경 목록은 work 글자 */
const codeOf = (f: GitFileChange, staged: boolean): string => (f.conflict ? '!' : f.untracked ? 'U' : staged ? f.index : f.work)

const split = (rel: string): { name: string; dir: string } => {
  const i = rel.lastIndexOf('/')
  return i < 0 ? { name: rel, dir: '' } : { name: rel.slice(i + 1), dir: rel.slice(0, i) }
}

type Selection = { kind: 'work'; file: GitFileChange; staged: boolean } | null

export function GitView({ state, project, openFile }: ViewProps): ReactNode {
  const pid = project!.id
  const [repo, setRepo] = useState<GitRepoStatus | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [more, setMore] = useState(false)
  const [allBranches, setAllBranches] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const [detailFile, setDetailFile] = useState<string | null>(null)
  const [detailDiff, setDetailDiff] = useState<string | null>(null)
  const [work, setWork] = useState<Selection>(null)
  const [workDiff, setWorkDiff] = useState<string | null>(null)
  const [tab, setTab] = useState<'history' | 'branches'>('history')
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [branchMenu, setBranchMenu] = useState<{ x: number; y: number; w: number } | null>(null)
  const [newBranch, setNewBranch] = useState<string | null>(null)

  const flash = (t: string): void => {
    setNotice(t)
    setTimeout(() => setNotice(''), 3500)
  }

  const loadRepo = useCallback(async () => {
    try {
      setRepo(await api.gitRepo(pid))
    } catch (e) {
      setError(errorText(e))
    }
  }, [pid])

  const loadLog = useCallback(
    async (append = false) => {
      try {
        const list = await api.gitLog(pid, { limit: PAGE, skip: append ? commits.length : 0, all: allBranches })
        setCommits((c) => (append ? [...c, ...list] : list))
        setMore(list.length === PAGE)
      } catch (e) {
        setError(errorText(e))
      }
    },
    [pid, allBranches, commits.length]
  )

  const loadBranches = useCallback(async () => setBranches(await api.gitBranches(pid).catch(() => [])), [pid])

  const reload = useCallback(() => {
    void loadRepo()
    void loadLog(false)
    void loadBranches()
  }, [loadRepo, loadLog, loadBranches])

  // 처음, 저장소가 바뀌었다는 알림, 창으로 돌아올 때, 에이전트 턴이 끝날 때
  useEffect(() => {
    reload()
    const off = api.on('git', (m: { projectId: string }) => m.projectId === pid && reload())
    const onFocus = (): void => reload()
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, allBranches])
  const running = state.sessions.filter((s) => s.projectId === pid && s.status === 'running').length
  const prevRunning = useRef(running)
  useEffect(() => {
    if (running < prevRunning.current) reload()
    prevRunning.current = running
  }, [running, reload])

  // 고른 커밋의 상세
  useEffect(() => {
    setDetail(null)
    setDetailFile(null)
    if (!picked) return
    api.gitCommitDetail(pid, picked).then(setDetail, (e) => setError(errorText(e)))
  }, [pid, picked])
  useEffect(() => {
    setDetailDiff(null)
    if (picked && detailFile) api.gitCommitFileDiff(pid, picked, detailFile).then(setDetailDiff, (e) => setDetailDiff(`오류: ${errorText(e)}`))
  }, [pid, picked, detailFile])
  // 고른 작업 파일의 diff (새 파일은 내용 전체가 추가)
  useEffect(() => {
    setWorkDiff(null)
    if (!work) return
    if (work.file.untracked) {
      api.readFile(pid, work.file.rel).then(
        (p) => setWorkDiff(p.kind === 'text' ? `@@ -0,0 +1 @@\n${p.content.split(/\r?\n/).map((l) => '+' + l).join('\n')}` : 'Binary files differ'),
        (e) => setWorkDiff(`오류: ${errorText(e)}`)
      )
    } else api.gitWorkDiff(pid, work.file.rel, work.staged).then(setWorkDiff, (e) => setWorkDiff(`오류: ${errorText(e)}`))
  }, [pid, work, repo])

  /** 바꾸는 동작: 진행 표시, 오류는 위에 띄우고, 끝나면 다시 읽기 */
  const run = async (label: string, fn: () => Promise<unknown>, done?: string): Promise<boolean> => {
    setBusy(label)
    setError('')
    try {
      await fn()
      if (done) flash(done)
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    } finally {
      setBusy('')
      reload()
    }
  }

  if (!repo) {
    return (
      <div className="page scroll">
        {error ? <div className="error-box">{error}</div> : <div className="muted">git 상태를 읽는 중…</div>}
      </div>
    )
  }

  if (!repo.isRepo) {
    return (
      <div className="page scroll">
        <div className="empty">
          <div className="empty-title">이 프로젝트는 git 저장소가 아닙니다</div>
          <p className="muted">
            저장소를 만들면 변경 내역을 커밋으로 남기고, 에이전트가 바꾼 것을 되돌아보거나 되돌릴 수 있습니다.
            <br />
            <span className="mono small">{project!.path}</span>
          </p>
          <button className="primary" disabled={!!busy} onClick={() => void run('init', () => api.gitInit(pid), 'git 저장소를 만들었습니다')}>
            git 저장소 만들기
          </button>
          {error && <div className="error-box">{error}</div>}
        </div>
      </div>
    )
  }

  const staged = repo.files.filter((f) => f.staged && !f.conflict)
  const unstaged = repo.files.filter((f) => f.unstaged || f.conflict)
  const conflicts = repo.files.filter((f) => f.conflict).length
  const locals = branches.filter((b) => !b.remote)
  const remotes = branches.filter((b) => b.remote)

  const commitNow = async (): Promise<void> => {
    const stageFirst = !staged.length && !amend
    if (stageFirst && !unstaged.length) return
    const ok = await run(
      'commit',
      async () => {
        if (stageFirst) await api.gitStage(pid, 'all')
        return api.gitCommit(pid, message, { amend })
      },
      amend ? '마지막 커밋을 고쳤습니다' : '커밋했습니다'
    )
    if (ok) {
      setMessage('')
      setAmend(false)
      setWork(null)
    }
  }

  const fileRow = (f: GitFileChange, isStaged: boolean): ReactNode => {
    const code = codeOf(f, isStaged)
    const { name, dir } = split(f.rel)
    const on = work?.file.rel === f.rel && work.staged === isStaged
    return (
      <div key={(isStaged ? 's:' : 'w:') + f.rel} className={`git-file ${on ? 'on' : ''}`}>
        <button className="git-file-main" title={f.orig ? `${f.orig} → ${f.rel}` : f.rel} onClick={() => setWork({ kind: 'work', file: f, staged: isStaged })}>
          <span className="git-code mono" style={{ color: CODE_COLOR[code] }} title={CODE_LABEL[code] ?? code}>
            {code}
          </span>
          <span className="ellipsis git-file-name">{name}</span>
          <span className="ellipsis muted small mono git-file-dir">{dir}</span>
        </button>
        <span className="git-file-actions">
          <button className="icon-btn sm-icon" aria-label={`${f.rel} 열기`} title="파일 열기" onClick={() => openFile(f.rel)}>
            <Icon name="file" size={13} />
          </button>
          {isStaged ? (
            <button className="icon-btn sm-icon" aria-label={`${f.rel} 스테이징 취소`} title="스테이징 취소" onClick={() => void run('unstage', () => api.gitUnstage(pid, [f.rel], repo.hasCommits))}>
              <Icon name="minus" size={13} />
            </button>
          ) : (
            <>
              <button
                className="icon-btn sm-icon"
                aria-label={`${f.rel} 변경 취소`}
                title={f.untracked ? '새 파일을 휴지통으로' : '변경 취소 (마지막 상태로 되돌리기)'}
                onClick={() =>
                  confirm(f.untracked ? `새 파일 "${f.rel}" 을 휴지통으로 옮길까요?` : `"${f.rel}" 의 변경을 취소하고 되돌릴까요?\n되돌린 내용은 git 으로 복구할 수 없습니다.`) &&
                  void run('discard', () => api.gitDiscard(pid, [f]), '변경을 취소했습니다')
                }
              >
                <Icon name="refresh" size={13} />
              </button>
              <button className="icon-btn sm-icon" aria-label={`${f.rel} 스테이징`} title="스테이징" onClick={() => void run('stage', () => api.gitStage(pid, [f.rel]))}>
                <Icon name="plus" size={13} />
              </button>
            </>
          )}
        </span>
      </div>
    )
  }

  const current = branches.find((b) => b.current)

  return (
    <div className="git-page">
      {/* ── 머리: 브랜치 · 원격 */}
      <div className="git-head">
        <button
          className={`git-branch-btn ${branchMenu ? 'open' : ''}`}
          title="브랜치 바꾸기"
          onMouseDown={(e) => branchMenu && e.stopPropagation()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setBranchMenu(branchMenu ? null : { x: r.left, y: r.bottom + 4, w: Math.max(r.width, 240) })
          }}
        >
          <Icon name="branch" size={15} />
          <span className="strong ellipsis">{repo.detached ? '(분리된 HEAD)' : (repo.branch ?? '?')}</span>
          <span className="project-chev" aria-hidden="true">
            <Icon name="chevron" size={12} />
          </span>
        </button>
        {repo.upstream ? (
          <span className="muted small mono" title="추적 중인 원격 브랜치">
            {repo.upstream}
          </span>
        ) : (
          repo.remotes.length > 0 && <span className="muted small">원격에 아직 올리지 않음</span>
        )}
        {repo.ahead > 0 && <span className="git-pill" title="올릴 커밋">↑ {repo.ahead}</span>}
        {repo.behind > 0 && <span className="git-pill warn" title="받을 커밋">↓ {repo.behind}</span>}
        {conflicts > 0 && <span className="git-pill bad">충돌 {conflicts}</span>}
        <span className="grow" />
        {busy && <span className="muted small">{BUSY_LABEL[busy] ?? '작업 중…'}</span>}
        {notice && <span className="ok-text small">{notice}</span>}
        <button className="sm" disabled={!!busy || !repo.remotes.length} title="원격의 새 커밋 정보 가져오기 (fetch)" onClick={() => void run('fetch', () => api.gitFetch(pid), '가져왔습니다')}>
          가져오기
        </button>
        <button
          className="sm"
          disabled={!!busy || !repo.upstream}
          title="원격 커밋 받기 (빨리 감기만, pull --ff-only)"
          onClick={() => void run('pull', () => api.gitPull(pid), '받았습니다')}
        >
          받기{repo.behind ? ` ${repo.behind}` : ''}
        </button>
        <button
          className={repo.ahead > 0 || (!repo.upstream && repo.remotes.length > 0 && repo.hasCommits) ? 'primary sm' : 'sm'}
          disabled={!!busy || !repo.remotes.length || !repo.hasCommits}
          title={repo.remotes.length ? '원격에 올리기 (push)' : '원격 저장소가 없습니다'}
          onClick={() => void run('push', () => api.gitPush(pid), '올렸습니다')}
        >
          올리기{repo.ahead ? ` ${repo.ahead}` : ''}
        </button>
        <button className="icon-btn" aria-label="새로고침" title="새로고침" onClick={reload}>
          <Icon name="refresh" />
        </button>
      </div>
      {error && (
        <div className="error-box git-error">
          <span className="grow">{error}</span>
          <button className="icon-btn" aria-label="오류 닫기" onClick={() => setError('')}>
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      <div className="git-body">
        {/* ── 왼쪽: 커밋 · 변경 */}
        <section className="bento git-changes" aria-label="변경 사항">
          <div className="git-commit-box">
            <textarea
              rows={3}
              value={message}
              placeholder={amend ? '비우면 마지막 커밋 메시지를 그대로 씁니다' : '커밋 메시지 (Ctrl+Enter 로 커밋)'}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  void commitNow()
                }
              }}
            />
            <div className="row">
              <label className="check small muted" title="마지막 커밋에 지금 스테이징한 것을 합치고 메시지를 바꿉니다">
                <input type="checkbox" checked={amend} disabled={!repo.hasCommits} onChange={(e) => setAmend(e.target.checked)} /> 마지막 커밋 고치기
              </label>
              <span className="grow" />
              <button
                className="primary sm"
                disabled={!!busy || conflicts > 0 || (!amend && !message.trim()) || (!amend && !staged.length && !unstaged.length)}
                onClick={() => void commitNow()}
              >
                {amend ? '커밋 고치기' : staged.length ? `커밋 (${staged.length})` : unstaged.length ? `모두 커밋 (${unstaged.length})` : '커밋'}
              </button>
            </div>
          </div>

          <div className="git-lists">
            <div className="git-group-head">
              <span className="strong">스테이징됨</span>
              <span className="muted count">{staged.length}</span>
              <span className="grow" />
              {staged.length > 0 && (
                <button className="link small" onClick={() => void run('unstage', () => api.gitUnstage(pid, 'all', repo.hasCommits))}>
                  모두 내리기
                </button>
              )}
            </div>
            {staged.map((f) => fileRow(f, true))}
            {!staged.length && <div className="muted small git-empty">커밋할 파일을 아래에서 + 로 올리세요</div>}

            <div className="git-group-head">
              <span className="strong">변경</span>
              <span className="muted count">{unstaged.length}</span>
              <span className="grow" />
              {unstaged.length > 0 && (
                <button className="link small" onClick={() => void run('stage', () => api.gitStage(pid, 'all'))}>
                  모두 올리기
                </button>
              )}
            </div>
            {unstaged.map((f) => fileRow(f, false))}
            {!unstaged.length && <div className="muted small git-empty">바뀐 파일이 없습니다</div>}
          </div>
        </section>

        {/* ── 오른쪽: 변경 diff 또는 히스토리·브랜치 */}
        <section className="bento git-side">
          {work ? (
            <>
              <div className="git-side-head">
                <span className="git-code mono" style={{ color: CODE_COLOR[codeOf(work.file, work.staged)] }}>
                  {codeOf(work.file, work.staged)}
                </span>
                <span className="strong mono ellipsis grow" title={work.file.rel}>
                  {work.file.rel}
                </span>
                <span className="muted small">{work.staged ? '스테이징된 변경' : work.file.untracked ? '새 파일' : '작업 폴더 변경'}</span>
                <button className="icon-btn" aria-label="diff 닫기" title="히스토리로" onClick={() => setWork(null)}>
                  <Icon name="close" size={13} />
                </button>
              </div>
              <div className="git-diff-scroll">
                <DiffView diff={workDiff} />
              </div>
            </>
          ) : (
            <>
              <div className="git-side-head">
                <div className="seg" role="tablist" aria-label="Git 보기">
                  <button role="tab" aria-selected={tab === 'history'} className={`seg-btn ${tab === 'history' ? 'on' : ''}`} onClick={() => setTab('history')}>
                    히스토리
                  </button>
                  <button role="tab" aria-selected={tab === 'branches'} className={`seg-btn ${tab === 'branches' ? 'on' : ''}`} onClick={() => setTab('branches')}>
                    브랜치 <span className="muted">{locals.length}</span>
                  </button>
                </div>
                <span className="grow" />
                {tab === 'history' && (
                  <label className="check small muted">
                    <input type="checkbox" checked={allBranches} onChange={(e) => setAllBranches(e.target.checked)} /> 모든 브랜치
                  </label>
                )}
                {tab === 'branches' && (
                  <button className="sm" onClick={() => setNewBranch('')}>
                    + 새 브랜치
                  </button>
                )}
              </div>

              {tab === 'history' ? (
                <div className="git-history">
                  <div className="git-commits" role="listbox" aria-label="커밋">
                    {commits.map((c) => (
                      <button key={c.hash} role="option" aria-selected={picked === c.hash} className={`git-commit ${picked === c.hash ? 'on' : ''}`} onClick={() => setPicked(c.hash)}>
                        <span className="git-commit-top">
                          <span className="ellipsis grow">{c.subject}</span>
                        </span>
                        <span className="git-commit-meta muted small">
                          <span className="mono">{c.short}</span>
                          <span className="ellipsis">
                            {c.author} · {timeAgo(c.date)}
                            {c.parents.length > 1 && ' · 병합'}
                          </span>
                          {c.refs.slice(0, 3).map((r) => (
                            <span key={r} className={`git-ref ${r.startsWith('→') ? 'head' : r.startsWith('tag: ') ? 'tag' : ''}`}>
                              {r.replace(/^tag: /, '')}
                            </span>
                          ))}
                        </span>
                      </button>
                    ))}
                    {!commits.length && <div className="muted small git-empty">{repo.hasCommits ? '커밋이 없습니다' : '아직 커밋이 없습니다. 왼쪽에서 첫 커밋을 만드세요.'}</div>}
                    {more && (
                      <button className="link small git-more" onClick={() => void loadLog(true)}>
                        더 보기
                      </button>
                    )}
                  </div>
                  <div className="git-detail">
                    {!picked ? (
                      <div className="muted small git-empty">커밋을 고르면 바뀐 파일과 내용이 보입니다</div>
                    ) : !detail ? (
                      <div className="muted small git-empty">불러오는 중…</div>
                    ) : (
                      <>
                        <div className="git-detail-head">
                          <div className="strong">{detail.subject}</div>
                          {detail.body.split(/\r?\n/).slice(1).join('\n').trim() && <pre className="git-body-text">{detail.body.split(/\r?\n/).slice(1).join('\n').trim()}</pre>}
                          <div className="muted small">
                            <button className="link mono small" title="커밋 id 복사" onClick={() => void navigator.clipboard.writeText(detail.hash).then(() => flash('커밋 id 를 복사했습니다'))}>
                              {detail.short}
                            </button>{' '}
                            · {detail.author} &lt;{detail.email}&gt; · {new Date(detail.date).toLocaleString()}
                          </div>
                        </div>
                        <div className="git-detail-files">
                          {detail.files.map((f) => {
                            const { name, dir } = split(f.rel)
                            return (
                              <button key={f.rel} className={`git-file-main git-detail-file ${detailFile === f.rel ? 'on' : ''}`} title={f.orig ? `${f.orig} → ${f.rel}` : f.rel} onClick={() => setDetailFile(detailFile === f.rel ? null : f.rel)}>
                                <span className="git-code mono" style={{ color: CODE_COLOR[f.code] }}>
                                  {f.code}
                                </span>
                                <span className="ellipsis git-file-name">{name}</span>
                                <span className="ellipsis muted small mono git-file-dir">{dir}</span>
                                {f.adds !== undefined && <span className="git-adds small mono">+{f.adds}</span>}
                                {f.dels !== undefined && <span className="git-dels small mono">−{f.dels}</span>}
                              </button>
                            )
                          })}
                        </div>
                        {detailFile && (
                          <div className="git-detail-diff">
                            <DiffView diff={detailDiff} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="git-branches">
                  {newBranch !== null && (
                    <form
                      className="git-new-branch"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const name = newBranch.trim()
                        if (name) void run('branch', () => api.gitCreateBranch(pid, name), `브랜치 ${name} 을 만들고 옮겼습니다`).then((ok) => ok && setNewBranch(null))
                      }}
                    >
                      <input autoFocus className="mono" placeholder="새 브랜치 이름 (지금 위치에서 만들고 옮겨 감)" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
                      <button className="primary sm" type="submit" disabled={!newBranch.trim() || !!busy}>
                        만들기
                      </button>
                      <button className="sm" type="button" onClick={() => setNewBranch(null)}>
                        취소
                      </button>
                    </form>
                  )}
                  <div className="git-group-head">
                    <span className="strong">로컬</span>
                  </div>
                  {locals.map((b) => (
                    <div key={b.name} className={`git-branch ${b.current ? 'on' : ''}`}>
                      <span className="git-branch-check">{b.current ? '✓' : ''}</span>
                      <span className="grow min0">
                        <span className="block-text ellipsis mono">{b.name}</span>
                        <span className="block-text ellipsis muted small">
                          {b.upstream ? `${b.upstream}${b.gone ? ' (원격에서 사라짐)' : ''} · ` : ''}
                          {timeAgo(b.date)} · {b.subject}
                        </span>
                      </span>
                      {b.ahead > 0 && <span className="git-pill">↑ {b.ahead}</span>}
                      {b.behind > 0 && <span className="git-pill warn">↓ {b.behind}</span>}
                      {!b.current && (
                        <>
                          <button className="sm" disabled={!!busy} onClick={() => void run('switch', () => api.gitSwitch(pid, b.name), `${b.name} 로 옮겼습니다`)}>
                            전환
                          </button>
                          <button
                            className="icon-btn danger-icon"
                            aria-label={`${b.name} 삭제`}
                            title="삭제 (병합된 브랜치만)"
                            disabled={!!busy}
                            onClick={() => confirm(`브랜치 "${b.name}" 을 지울까요?\n병합되지 않은 브랜치는 git 이 거부합니다.`) && void run('delete', () => api.gitDeleteBranch(pid, b.name), `${b.name} 을 지웠습니다`)}
                          >
                            <Icon name="close" size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                  {remotes.length > 0 && (
                    <>
                      <div className="git-group-head">
                        <span className="strong">원격</span>
                      </div>
                      {remotes.map((b) => (
                        <div key={b.name} className="git-branch">
                          <span className="git-branch-check" />
                          <span className="grow min0">
                            <span className="block-text ellipsis mono">{b.name}</span>
                            <span className="block-text ellipsis muted small">
                              {timeAgo(b.date)} · {b.subject}
                            </span>
                          </span>
                          <button className="sm" disabled={!!busy} title="같은 이름의 로컬 브랜치로 옮김 (없으면 만들어 추적)" onClick={() => void run('switch', () => api.gitSwitch(pid, b.name), `${b.name} 로 옮겼습니다`)}>
                            가져와 전환
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {branchMenu && (
        <ContextMenu
          x={branchMenu.x}
          y={branchMenu.y}
          width={branchMenu.w}
          label="브랜치 바꾸기"
          onClose={() => setBranchMenu(null)}
          items={[
            ...locals.map((b) => ({
              label: b.name,
              detail: `${timeAgo(b.date)} · ${b.subject}`,
              checked: b.current,
              run: () => (b.current ? undefined : void run('switch', () => api.gitSwitch(pid, b.name), `${b.name} 로 옮겼습니다`))
            })),
            { sep: true as const },
            {
              label: '+ 새 브랜치…',
              run: () => {
                setTab('branches')
                setWork(null)
                setNewBranch('')
              }
            }
          ]}
        />
      )}
      {current === undefined && repo.detached && null}
    </div>
  )
}

const BUSY_LABEL: Record<string, string> = {
  fetch: '가져오는 중…',
  pull: '받는 중…',
  push: '올리는 중…',
  commit: '커밋하는 중…',
  switch: '브랜치 옮기는 중…',
  init: '저장소 만드는 중…'
}
