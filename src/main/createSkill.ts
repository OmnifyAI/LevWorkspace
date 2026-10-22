import fs from 'node:fs'
import path from 'node:path'
import { SKILLS_DIR } from '../shared/types'

export const CREATE_SKILL = 'create-skill'
/** 내용을 바꾸면 올린다 — 앱이 만든 옛 버전은 새로 쓰고, 사용자가 버전 줄을 지운 파일은 건드리지 않는다 */
export const CREATE_SKILL_VERSION = 1

function createSkillText(): string {
  return `---
name: ${CREATE_SKILL}
x-aw-version: ${CREATE_SKILL_VERSION}
description: 이 프로젝트의 .skills 폴더에 새 스킬을 만들거나 기존 스킬을 고칠 때 쓴다. "스킬 만들어줘", "이 작업을 스킬로 남겨줘", "규칙을 스킬로 정리해줘" 같은 요청에 따른다.
---

# 스킬 만들기 (Lev)

스킬은 에이전트가 특정 작업을 할 때 따르는 지침이다. Lev 앱은 이 프로젝트의 \`${SKILLS_DIR}\` 폴더를 읽고,
세션에 고른 스킬의 본문을 그 세션의 첫 프롬프트에 넣는다. 채팅에서 \`/<스킬 이름> 요청\` 으로 부르면 에이전트가 SKILL.md 를 먼저 읽고 따른다.

## 파일 구조
\`\`\`
${SKILLS_DIR}/<스킬-이름>/
  SKILL.md          ← 필수. frontmatter + 본문
  references/…      ← 선택. 길거나 가끔만 필요한 참고 문서
  scripts/…         ← 선택. 반복되는 작업을 대신하는 스크립트
  examples/…        ← 선택. 좋은 결과물 예시
\`\`\`
- 폴더 이름 = 스킬 id. 영문 소문자·숫자·하이픈(kebab-case), 짧고 내용을 말해 주게 (\`commit-message\`, \`api-review\`).
- 같은 폴더의 다른 파일은 앱이 경로만 에이전트에게 안내한다 — 본문에 "언제 어떤 파일을 읽을지"를 적는다.
- 파일을 저장하면 앱이 바로 감지한다. 앱을 다시 켤 필요 없다.

## SKILL.md 형식
\`\`\`markdown
---
name: <폴더 이름과 같게>
description: <언제 이 스킬을 쓰는지 — 아래 규칙>
---

# <제목>
<지침 본문>
\`\`\`
- frontmatter 에는 name, description 만 쓴다. \`x-aw-version\` 은 앱이 자동으로 관리하는 스킬에만 붙는 표시라 새 스킬에는 넣지 않는다.

## description 쓰는 법 (가장 중요)
에이전트와 사용자가 스킬을 고를 때 보는 유일한 요약이다.
- **언제** 쓰는지를 먼저: 어떤 요청·상황·파일에서 쓰는지. 무엇을 하는지는 그다음.
- 사용자가 실제로 쓸 말을 넣는다 ("리뷰해줘", "릴리스 노트", "PR 설명").
- 한두 문장, 200자 안팎. "도와준다", "다양한" 같은 빈 말은 쓰지 않는다.
- 나쁜 예: \`코드 관련 작업을 도와주는 스킬\`
- 좋은 예: \`PR 이나 diff 를 리뷰해 달라고 할 때 쓴다. 이 저장소의 리뷰 체크리스트(보안·성능·테스트)와 코멘트 형식을 따른다.\`

## 본문 쓰는 법
1. **목적 한 줄**: 이 스킬을 따르면 무엇이 나오는지.
2. **절차**: 번호 목록으로, 실제로 할 순서대로. 각 단계는 행동으로 시작한다 ("…를 읽는다", "…를 실행한다").
3. **규칙과 기준**: 꼭 지킬 것만. 이유가 분명하지 않은 규칙에는 한 줄 이유를 단다.
4. **결과물 형식**: 무엇을 어디에 어떤 모양으로 남기는지. 예시가 길면 \`examples/\` 로.
5. **하지 말 것**: 실제로 자주 틀리는 것만 짧게.

원칙
- 짧게. 본문은 대략 300줄 안. 길어지면 상세 내용은 \`references/\` 로 빼고 본문에는 "X 가 필요하면 references/x.md 를 읽는다"만 남긴다.
- 이 프로젝트에만 있는 것(경로, 명령, 규칙, 용어)을 구체적으로. 모델이 이미 아는 일반론은 쓰지 않는다.
- 명령·경로·파일 이름은 실제로 확인한 것만 쓴다. 지어내지 않는다.
- 비밀값(토큰, 비밀번호, 개인 정보)을 스킬에 넣지 않는다 — 스킬 폴더는 저장소에 커밋될 수 있다.
- 반복해서 같은 코드를 쓰게 되는 부분은 \`scripts/\` 에 스크립트로 두고 실행 방법을 적는다.

## 작업 순서
1. 요청을 정리한다: 이 스킬이 다룰 작업, 쓰일 상황, 결과물. 애매하면 사용자에게 한 번 묻는다.
2. \`${SKILLS_DIR}\` 를 보고 비슷한 스킬이 있는지 확인한다. 있으면 새로 만들지 말고 그 스킬을 고치자고 제안한다.
3. 필요한 사실을 프로젝트에서 확인한다 (명령, 경로, 기존 규칙 문서).
4. \`${SKILLS_DIR}/<이름>/SKILL.md\` 를 쓰고, 필요하면 references·scripts·examples 를 함께 만든다.
5. 다 쓴 뒤 사용자에게 알린다: 스킬 이름, description, 만든 파일 목록, 그리고 쓰는 법 —
   세션 설정의 "스킬"에서 고르거나, 채팅에서 \`/<이름> 요청\` 으로 부른다.

## 기존 스킬 고치기
- 먼저 SKILL.md 전체와 같은 폴더의 파일을 읽는다.
- 사용자가 말한 부분만 고치고, 나머지 구조와 문체는 유지한다.
- frontmatter 에 \`x-aw-version\` 줄이 있는 스킬은 앱이 관리한다 (앱이 새 버전으로 덮어쓸 수 있음).
  직접 고쳐서 계속 쓰려면 그 줄을 지우라고 사용자에게 알린다.
`
}

/**
 * create-skill 스킬이 없거나 앱이 만든 옛 버전이면 새로 쓴다.
 * 사용자가 x-aw-version 줄을 지우면 직접 관리하는 것으로 보고 덮어쓰지 않는다.
 */
export function ensureCreateSkill(projectPath: string): void {
  const file = path.join(projectPath, SKILLS_DIR, CREATE_SKILL, 'SKILL.md')
  if (fs.existsSync(file)) {
    const v = /^x-aw-version:\s*(\d+)/m.exec(fs.readFileSync(file, 'utf8'))
    if (!v || Number(v[1]) >= CREATE_SKILL_VERSION) return
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, createSkillText())
}
