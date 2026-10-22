import { execFile } from 'node:child_process'
import path from 'node:path'
import { shell } from 'electron'
import type { GitBranch, GitCommit, GitCommitDetail, GitFileChange, GitRepoStatus } from '../shared/types'

const US = '\x1f'
const RS = '\x1e'

/**
 * git 실행. 오류는 git 이 쓴 메시지(stderr)를 그대로 담아 던진다.
 * 자격 증명을 터미널로 묻지 않게 한다 (멈추는 대신 실패 → 화면에 이유 표시). 윈도우는 자격 증명 관리자 창이 뜬다.
 */
export function runGit(root: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      {
        cwd: root,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
      },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout)
        const msg = String(stderr || '').trim() || err.message
        reject(new Error(msg.replace(/^(fatal|error): /gm, '')))
      }
    )
    if (input !== undefined) {
      child.stdin?.end(input)
    }
  })
}

/** 경로가 저장소 밖으로 나가지 않게 (상대 경로만) */
function safeRels(rels: string[]): string[] {
  for (const r of rels) {
    if (!r || path.isAbsolute(r) || r.split(/[\\/]/).includes('..')) throw new Error(`잘못된 경로: ${r}`)
  }
  return rels
}

// ─────────────── 상태

export async function repoStatus(root: string): Promise<GitRepoStatus> {
  let out: string
  try {
    out = await runGit(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
  } catch (e) {
    const m = (e as Error).message
    if (/not a git repository/i.test(m)) return { isRepo: false, ahead: 0, behind: 0, files: [], hasCommits: false, remotes: [] }
    if (/ENOENT|not recognized|spawn git/i.test(m)) throw new Error('git 을 찾을 수 없습니다. Git 을 설치하세요 (https://git-scm.com)')
    throw e
  }
  const st: GitRepoStatus = { isRepo: true, ahead: 0, behind: 0, files: [], hasCommits: true, remotes: [] }
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (!p) continue
    if (p.startsWith('# ')) {
      const [, key, ...rest] = p.split(' ')
      const val = rest.join(' ')
      if (key === 'branch.oid') st.hasCommits = val !== '(initial)'
      else if (key === 'branch.head') {
        if (val === '(detached)') st.detached = true
        else st.branch = val
      } else if (key === 'branch.upstream') st.upstream = val
      else if (key === 'branch.ab') {
        const m = /\+(\d+) -(\d+)/.exec(val)
        if (m) {
          st.ahead = Number(m[1])
          st.behind = Number(m[2])
        }
      }
      continue
    }
    const kind = p[0]
    if (kind === '?') {
      st.files.push({ rel: p.slice(2), index: '?', work: '?', staged: false, unstaged: true, untracked: true, conflict: false })
      continue
    }
    if (kind === '!') continue
    const f = p.split(' ')
    const xy = f[1]
    if (kind === '1') {
      st.files.push(change(xy, f.slice(8).join(' ')))
    } else if (kind === '2') {
      // 이름 변경: 다음 항목이 원래 경로
      const c = change(xy, f.slice(9).join(' '))
      c.orig = parts[++i]
      st.files.push(c)
    } else if (kind === 'u') {
      st.files.push({ rel: f.slice(10).join(' '), index: xy[0], work: xy[1], staged: false, unstaged: true, untracked: false, conflict: true })
    }
  }
  try {
    st.remotes = (await runGit(root, ['remote'])).split(/\r?\n/).filter(Boolean)
  } catch {
    // 원격 없음
  }
  return st
}

function change(xy: string, rel: string): GitFileChange {
  return { rel, index: xy[0], work: xy[1], staged: xy[0] !== '.', unstaged: xy[1] !== '.', untracked: false, conflict: false }
}

// ─────────────── 히스토리

const LOG_FORMAT = ['%H', '%h', '%P', '%an', '%ae', '%at', '%s', '%D'].join(US) + RS

function parseCommit(rec: string): GitCommit | null {
  const f = rec.replace(/^\s+/, '').split(US)
  if (f.length < 8 || !f[0]) return null
  return {
    hash: f[0],
    short: f[1],
    parents: f[2] ? f[2].split(' ') : [],
    author: f[3],
    email: f[4],
    date: Number(f[5]) * 1000,
    subject: f[6],
    refs: f[7] ? f[7].split(', ').map((r) => r.replace(/^HEAD -> /, '→ ')) : []
  }
}

export async function log(root: string, opts: { limit?: number; skip?: number; all?: boolean; path?: string } = {}): Promise<GitCommit[]> {
  const args = ['log', `--format=${LOG_FORMAT}`, '-n', String(Math.min(opts.limit ?? 100, 500)), '--skip', String(opts.skip ?? 0)]
  if (opts.all) args.push('--all')
  if (opts.path) args.push('--', ...safeRels([opts.path]))
  let out: string
  try {
    out = await runGit(root, args)
  } catch (e) {
    // 커밋이 아직 없는 저장소
    if (/does not have any commits|bad default revision|unknown revision/i.test((e as Error).message)) return []
    throw e
  }
  return out.split(RS).map(parseCommit).filter((c): c is GitCommit => !!c)
}

export async function commitDetail(root: string, hash: string): Promise<GitCommitDetail> {
  if (!/^[0-9a-f]{4,64}$/i.test(hash)) throw new Error('잘못된 커밋 id')
  const head = await runGit(root, ['show', '-s', `--format=${LOG_FORMAT}%B`, hash])
  const [meta, body = ''] = head.split(RS)
  const c = parseCommit(meta)
  if (!c) throw new Error('커밋을 읽지 못했습니다')
  // 첫 커밋도 보이게 --root, 병합 커밋은 첫 부모 기준
  const ns = await runGit(root, ['show', '--format=', '--name-status', '-z', '--root', '--first-parent', '-m', hash])
  const nm = await runGit(root, ['show', '--format=', '--numstat', '-z', '--root', '--first-parent', '-m', hash])
  const stats = new Map<string, { adds?: number; dels?: number }>()
  {
    const t = nm.split('\0')
    for (let i = 0; i < t.length; i++) {
      const m = /^\s*(\d+|-)\t(\d+|-)\t(.*)$/s.exec(t[i])
      if (!m) continue
      let rel = m[3]
      if (!rel) {
        // 이름 변경: 다음 두 칸이 원래·새 경로
        i += 2
        rel = t[i]
      }
      stats.set(rel, { adds: m[1] === '-' ? undefined : Number(m[1]), dels: m[2] === '-' ? undefined : Number(m[2]) })
    }
  }
  const files: GitCommitDetail['files'] = []
  const t = ns.split('\0').filter((x) => x !== '')
  for (let i = 0; i < t.length; i++) {
    const code = t[i]
    if (!/^[A-Z]/.test(code)) continue
    if (code[0] === 'R' || code[0] === 'C') {
      const orig = t[++i]
      const rel = t[++i]
      files.push({ rel, orig, code: code[0], ...stats.get(rel) })
    } else {
      const rel = t[++i]
      files.push({ rel, code: code[0], ...stats.get(rel) })
    }
  }
  return { ...c, body: body.trim(), files }
}

/** 커밋 하나에서 파일 하나의 diff */
export async function commitFileDiff(root: string, hash: string, rel: string): Promise<string> {
  if (!/^[0-9a-f]{4,64}$/i.test(hash)) throw new Error('잘못된 커밋 id')
  return runGit(root, ['show', '--no-color', '--format=', '--root', '--first-parent', '-m', hash, '--', ...safeRels([rel])])
}

/** 작업 폴더 변경의 diff (staged = 스테이징된 것 기준) */
export async function workDiff(root: string, rel: string, staged: boolean): Promise<string> {
  const args = ['diff', '--no-color']
  if (staged) args.push('--cached')
  return runGit(root, [...args, '--', ...safeRels([rel])])
}

// ─────────────── 변경 관리

export async function stage(root: string, rels: string[] | 'all'): Promise<void> {
  await runGit(root, rels === 'all' ? ['add', '-A'] : ['add', '--', ...safeRels(rels)])
}

export async function unstage(root: string, rels: string[] | 'all', hasCommits: boolean): Promise<void> {
  const target = rels === 'all' ? ['.'] : safeRels(rels)
  // 첫 커밋 전에는 HEAD 가 없어 restore --staged 를 못 쓴다
  if (hasCommits) await runGit(root, ['restore', '--staged', '--', ...target])
  else await runGit(root, ['rm', '-r', '--cached', '--quiet', '--', ...target])
}

/**
 * 변경 취소. 추적 중인 파일은 마지막 커밋(또는 스테이징) 상태로 되돌리고, 새 파일은 휴지통으로 옮긴다 (되살릴 수 있게).
 */
export async function discard(root: string, files: GitFileChange[]): Promise<void> {
  const tracked = files.filter((f) => !f.untracked).map((f) => f.rel)
  const untracked = files.filter((f) => f.untracked).map((f) => f.rel)
  if (tracked.length) await runGit(root, ['restore', '--worktree', '--', ...safeRels(tracked)])
  for (const rel of safeRels(untracked)) await shell.trashItem(path.join(root, rel))
}

export async function commit(root: string, message: string, opts: { amend?: boolean } = {}): Promise<string> {
  const msg = message.trim()
  if (!msg && !opts.amend) throw new Error('커밋 메시지를 쓰세요')
  const args = ['commit', '-F', '-']
  if (opts.amend) args.push('--amend')
  if (opts.amend && !msg) args.splice(1, 2, '--no-edit')
  await runGit(root, args, msg ? msg + '\n' : undefined)
  return (await runGit(root, ['rev-parse', '--short', 'HEAD'])).trim()
}

// ─────────────── 브랜치

export async function branches(root: string): Promise<GitBranch[]> {
  const fmt = ['%(refname)', '%(refname:short)', '%(HEAD)', '%(upstream:short)', '%(upstream:track)', '%(committerdate:unix)', '%(contents:subject)'].join(US)
  let out: string
  try {
    out = await runGit(root, ['for-each-ref', `--format=${fmt}`, '--sort=-committerdate', 'refs/heads', 'refs/remotes'])
  } catch {
    return []
  }
  const list: GitBranch[] = []
  for (const line of out.split(/\r?\n/)) {
    const f = line.split(US)
    if (f.length < 7 || f[0].endsWith('/HEAD')) continue
    const track = f[4]
    list.push({
      name: f[1],
      remote: f[0].startsWith('refs/remotes/'),
      current: f[2] === '*',
      upstream: f[3] || undefined,
      ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
      behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
      gone: track.includes('gone'),
      date: Number(f[5]) * 1000,
      subject: f[6]
    })
  }
  return list
}

const BRANCH_RE = /^(?!-)(?!.*\.\.)(?!.*\/\/)[^\s~^:?*[\\]+(?<!\.lock)(?<![./])$/

export async function switchBranch(root: string, name: string): Promise<void> {
  if (!BRANCH_RE.test(name)) throw new Error('잘못된 브랜치 이름')
  // 원격 브랜치(origin/x)를 고르면 같은 이름의 로컬 브랜치를 만들어 추적한다
  const remote = /^[^/]+\/(.+)$/.exec(name)
  const locals = (await branches(root)).filter((b) => !b.remote).map((b) => b.name)
  if (remote && !locals.includes(name) && (await branches(root)).some((b) => b.remote && b.name === name)) {
    if (locals.includes(remote[1])) await runGit(root, ['switch', remote[1]])
    else await runGit(root, ['switch', '--track', name])
    return
  }
  await runGit(root, ['switch', name])
}

export async function createBranch(root: string, name: string, from?: string): Promise<void> {
  if (!BRANCH_RE.test(name)) throw new Error('브랜치 이름에 공백이나 ~ ^ : ? * [ \\ 를 쓸 수 없습니다')
  if (from && !BRANCH_RE.test(from) && !/^[0-9a-f]{4,64}$/i.test(from)) throw new Error('잘못된 시작 지점')
  await runGit(root, ['switch', '-c', name, ...(from ? [from] : [])])
}

/** 병합된 브랜치만 지운다 (-d). 병합 안 된 브랜치는 git 이 거부하고 그 이유를 보여 준다 */
export async function deleteBranch(root: string, name: string): Promise<void> {
  if (!BRANCH_RE.test(name)) throw new Error('잘못된 브랜치 이름')
  await runGit(root, ['branch', '-d', name])
}

// ─────────────── 원격

export async function fetchAll(root: string): Promise<void> {
  await runGit(root, ['fetch', '--all', '--prune'])
}

/** 빨리 감기만 (병합 커밋·충돌을 몰래 만들지 않는다) */
export async function pull(root: string): Promise<string> {
  return (await runGit(root, ['pull', '--ff-only'])).trim()
}

/** 처음 올리는 브랜치는 origin 에 같은 이름으로 만들고 추적한다 */
export async function push(root: string, st: GitRepoStatus): Promise<string> {
  if (!st.remotes.length) throw new Error('원격 저장소가 없습니다 (git remote add origin <주소>)')
  if (!st.upstream) {
    const remote = st.remotes.includes('origin') ? 'origin' : st.remotes[0]
    return (await runGit(root, ['push', '-u', remote, 'HEAD'])).trim()
  }
  return (await runGit(root, ['push'])).trim()
}

export async function init(root: string): Promise<void> {
  await runGit(root, ['init'])
}
