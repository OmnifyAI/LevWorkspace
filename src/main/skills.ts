import fs from 'node:fs'
import path from 'node:path'
import type { Skill, SkillInput } from '../shared/types'
import { SKILLS_DIR } from '../shared/types'

const SKILL_FILE = 'SKILL.md'

const README = `# .skills

이 폴더의 스킬은 Lev 가 읽어서 세션에 넣습니다.

- 스킬 하나 = 폴더 하나: \`.skills/<이름>/SKILL.md\`
- SKILL.md 맨 위에 frontmatter 로 name, description 을 적고 그 아래에 본문(지침)을 씁니다.
- 같은 폴더에 참고 문서나 스크립트를 함께 두면 에이전트에게 경로가 안내됩니다.
- 앱에서 고쳐도, 에디터로 직접 고쳐도 됩니다. 앱이 변경을 감지합니다.

\`\`\`markdown
---
name: code-review
description: 코드 리뷰를 요청받았을 때 쓰는 체크리스트
---

## 지침
1. ...
\`\`\`
`

export function skillsRoot(projectPath: string): string {
  return path.join(projectPath, SKILLS_DIR)
}

/** .skills 폴더가 없으면 만들고 안내 README 를 둔다 */
export function ensureSkillsDir(projectPath: string): void {
  const root = skillsRoot(projectPath)
  if (fs.existsSync(root)) return
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'README.md'), README)
}

export function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) return { meta: {}, body: text.trim() }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    let v = kv[2].trim()
    if (v.startsWith('"')) {
      try {
        v = JSON.parse(v)
      } catch {
        v = v.slice(1, -1)
      }
    } else if (v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1)
    meta[kv[1]] = v
  }
  return { meta, body: m[2].trim() }
}

/** YAML 에서 따옴표가 필요한 값은 JSON 문자열(= YAML 큰따옴표 문자열)로 쓴다 */
function yamlValue(v: string): string {
  return /^[\s'"]|[:#\n\r]|\s$/.test(v) || v === '' ? JSON.stringify(v) : v
}

function listExtraFiles(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...listExtraFiles(dir, rel))
    else if (rel !== SKILL_FILE) out.push(rel)
  }
  return out
}

export function readSkills(projectId: string, projectPath: string): Skill[] {
  const root = skillsRoot(projectPath)
  if (!fs.existsSync(root)) return []
  const skills: Skill[] = []
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const file = path.join(root, e.name, SKILL_FILE)
    if (!fs.existsSync(file)) continue
    try {
      const { meta, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'))
      skills.push({
        id: e.name,
        projectId,
        name: meta.name || e.name,
        description: meta.description ?? '',
        content: body,
        relPath: `${SKILLS_DIR}/${e.name}/${SKILL_FILE}`,
        extraFiles: listExtraFiles(path.join(root, e.name)).slice(0, 50),
        updatedAt: fs.statSync(file).mtimeMs
      })
    } catch {
      // 쓰는 도중이거나 읽을 수 없는 파일은 다음 스캔에서 다시 본다
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

/** 이름에서 폴더 이름을 만든다. 이미 있으면 -2, -3 … */
export function newSkillDir(projectPath: string, name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9가-힣_-]+/g, '-').replace(/^-+|-+$/g, '') || 'skill'
  let dir = base
  for (let n = 2; fs.existsSync(path.join(skillsRoot(projectPath), dir)); n++) dir = `${base}-${n}`
  return dir
}

function skillDir(projectPath: string, id: string): string {
  const dir = path.join(skillsRoot(projectPath), id)
  if (path.dirname(dir) !== skillsRoot(projectPath)) throw new Error('잘못된 스킬 이름입니다')
  return dir
}

/** SKILL.md 를 쓴다. 기존 frontmatter 의 다른 키(allowed-tools 등)는 보존한다 */
export function writeSkill(projectPath: string, id: string, input: Partial<SkillInput>): void {
  const dir = skillDir(projectPath, id)
  const file = path.join(dir, SKILL_FILE)
  const prev = fs.existsSync(file) ? parseFrontmatter(fs.readFileSync(file, 'utf8')) : { meta: {}, body: '' }
  const meta: Record<string, string> = { ...prev.meta }
  if (input.name !== undefined) meta.name = input.name
  if (input.description !== undefined) meta.description = input.description
  meta.name ||= id
  meta.description ??= ''
  const ordered = ['name', 'description', ...Object.keys(meta).filter((k) => k !== 'name' && k !== 'description')]
  const head = ordered.map((k) => `${k}: ${yamlValue(meta[k])}`).join('\n')
  const body = input.content ?? prev.body
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, `---\n${head}\n---\n\n${body.trim()}\n`)
}

export function skillFolder(projectPath: string, id: string): string {
  return skillDir(projectPath, id)
}

/** 다른 곳(~/.claude/skills 등)의 스킬 폴더들을 .skills 로 복사. 같은 이름이 있으면 건너뛴다 */
export function copySkillFolders(projectPath: string, sourceRoot: string): string[] {
  if (!fs.existsSync(sourceRoot)) return []
  const copied: string[] = []
  for (const e of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!e.isDirectory() || !fs.existsSync(path.join(sourceRoot, e.name, SKILL_FILE))) continue
    const target = path.join(skillsRoot(projectPath), e.name)
    if (fs.existsSync(target)) continue
    fs.cpSync(path.join(sourceRoot, e.name), target, { recursive: true })
    copied.push(e.name)
  }
  return copied
}
