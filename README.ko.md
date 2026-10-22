<div align="center">

# Lev (레브)

**코딩 에이전트가 내게 필요한 대시보드와 도구를 만들어 주는 데스크톱 워크스페이스.**

Claude Code · OpenAI Codex · Gemini CLI 를 나란히 돌리고, 원하는 대시보드나 작은 도구를 말로 부탁하고,
만들어진 것을 바로 쓰세요 — 모든 동작은 내가 정한 권한 안에서.

[English](README.md) · **한국어**

<img src="docs/screenshots/board-dashboard.png" alt="Lev 의 프로젝트 대시보드: 커밋 흐름, TODO, 에이전트" width="100%" />

</div>

---

## 왜 Lev 인가

코딩 에이전트 CLI 는 강력하지만, 한 일은 터미널 스크롤 속으로 사라져요. Lev 는 프로젝트마다 **보드** — 대시보드와 작은 도구 — 를 두고, 에이전트가 만들고 내가 계속 쓰게 해요.

- **말로 만드는 대시보드.** "최근 2주 커밋 수를 날짜별로 보여줘"라고 쓰면 빌더 에이전트가 눈앞에서 보드를 고쳐요.
- **차트를 넘어 도구까지.** 보드는 입력을 받고, 스크립트를 돌리고, 파일을 저장하고, 에이전트에게 일을 넘길 수 있어요 — 릴리스 노트 작성기, TODO 정리기, 프로젝트에 필요한 무엇이든.
- **같이 일하는 에이전트.** Claude Code·Codex·Gemini 세션을 한 목록에서. 에이전트끼리 메시지를 주고받고 하위 에이전트에 일을 나눠요.
- **통제는 내 손에.** 스크립트 실행·파일 저장·에이전트에게 메시지·셸 명령은 앱 확인 창을 거쳐요. 믿을 수 있는 작업이면 자동 모드 스위치 하나로.

## 대시보드

프로젝트마다 **보드**가 있어요. 대시보드 빌더 에이전트에게 보고 싶은 것을 말하면 만들어 줘요.

- **숫자·표·목록·차트** — 준비된 위젯을 그리드에 배치.
- **나만의 화면** — 인터랙티브 차트, 필터, 원하는 레이아웃. 모양은 앱과 똑같이 맞춰져요.
- **어디서든 데이터** — 앱이 모르는 정보(git 기록, 로그 파일, 외부 서비스)는 작은 스크립트로 가져와요. 위 대시보드의 커밋·TODO 숫자가 이렇게 나와요.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/dashboard.png" alt="예시 요청이 있는 시작 대시보드" /></td>
<td width="50%"><img src="docs/screenshots/floating.png" alt="대시보드 위에 뜬 채팅 창" /></td>
</tr>
<tr>
<td><b>단순하게 시작해서 말로 키우기.</b> 새 프로젝트는 최소한의 보드와 <b>예시 요청</b>으로 시작해요 — 눌러서, 고쳐서, 대시보드 빌더에게 보내기.</td>
<td><b>보면서 계속 대화.</b> 보드를 보다가 에이전트를 고르면 대화가 떠 있는 창으로 열려요 — 끌어 옮기고, 크기를 바꾸고, 버블로 접고.</td>
</tr>
</table>

## 도구

**도구**는 무언가를 해 주는 보드, 프로젝트용 작은 앱이에요. 에이전트가 똑같이 만들어 주고, 거꾸로 에이전트에게 일을 시킬 수도 있어요.

<img src="docs/screenshots/tool-release.png" alt="릴리스 노트 도구: 커밋을 골라 에이전트에게 초안 맡기기" width="100%" />

**릴리스 노트** — 최근 일주일 커밋을 고르고 *에이전트에게 맡기기* 를 누르면, 새 세션이 초안을 써서 도구의 데이터 폴더에 저장해요. 고치고, 버전별로 저장하고, 원하는 곳으로 내보내기.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/tool-todo.png" alt="TODO 정리 도구" /></td>
<td width="50%"><img src="docs/screenshots/tool-confirm.png" alt="도구가 에이전트에게 메시지를 보내기 전 확인 창" /></td>
</tr>
<tr>
<td><b>TODO 정리</b> — 스크립트가 코드의 TODO 주석을 모아요. 골라서 에이전트에게 보내면, 누구에게 맡겼는지도 기억해요.</td>
<td><b>몰래 일어나는 일은 없어요.</b> 도구가 메시지를 보내거나 세션을 만들거나 파일을 저장할 때, 무슨 일이 일어날지 먼저 보여줘요.</td>
</tr>
</table>

보드에 별표를 누르면 왼쪽 **즐겨찾기**에 고정돼요 — 위 두 도구가 거기 있어요.

## 에이전트

<img src="docs/screenshots/chat.png" alt="다른 에이전트가 보낸 메시지가 있는 대화 탭" width="100%" />

- **모든 CLI 를 한 목록에서** — 상태·비용·CLI 를 한눈에. 우클릭으로 이름 바꾸기·초기화·삭제.
- **에이전트 간 메시지:** 받는 쪽엔 *누가* 보냈는지 표시되고, 답은 보낸 쪽으로 자동 전달돼요. 위 화면은 "리드"가 보낸 질문에 "API 리뷰"가 답하는 장면이에요.
- **자식 에이전트:** 하위 작업을 나눠 맡기고, 모두 끝나면 결과를 부모에게 모아 보고.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/slash.png" alt="/ 명령 메뉴" /></td>
<td width="50%"><img src="docs/screenshots/codex.png" alt="Codex 세션" /></td>
</tr>
<tr>
<td><b>/ 명령</b> — 앱 명령, 프로젝트 스킬, 각 CLI 가 알려 주는 명령·스킬 자동완성.</td>
<td><b>Codex·Gemini 도</b> — 세션별 권한 프리셋(읽기 전용 / 파일 편집 / 전체 허용, 네트워크·웹 검색).</td>
</tr>
</table>

## 권한

<table>
<tr>
<td width="50%"><img src="docs/screenshots/permission.png" alt="셸 명령 권한 확인 창" /></td>
<td width="50%"><img src="docs/screenshots/permissions.png" alt="자동 모드가 있는 권한 화면" /></td>
</tr>
<tr>
<td>Claude 자체 도구(Bash·WebFetch·Skill…)는 먼저 앱에서 물어봐요. "항상 허용"하면 이 프로젝트에서는 다시 묻지 않아요.</td>
<td><b>자동 모드</b>는 확인 창이 뜰 요청을 — 대시보드 스크립트까지 — 모두 허용하고, 켜져 있는 동안 <code>AUTO</code> 배지로 알려 줘요.</td>
</tr>
</table>

## 스킬

<img src="docs/screenshots/skills.png" alt="스킬 화면" width="100%" />

스킬은 프로젝트에 저장해 두고 다시 쓰는 작업 지침이에요. 기본으로 **dashboard-builder**(보드 만드는 법)와 **create-skill**(좋은 스킬 쓰는 법)을 넣어 주고, 채팅에서 `/` 를 치고 이름을 고르면 어떤 스킬이든 부를 수 있어요.

## 시작하기

**필요한 것**

- Node.js 22 이상
- 로그인해 둔 에이전트 CLI 하나 이상: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [OpenAI Codex](https://github.com/openai/codex), [Gemini CLI](https://github.com/google-gemini/gemini-cli)

```bash
git clone https://github.com/OmnifyAI/LevWorkspace.git
cd LevWorkspace
npm install
npm run dev        # 개발 모드 (핫 리로드)
```

```bash
npm run build      # out/ 으로 빌드
npm start          # 빌드한 앱 실행
npm run dist:win   # 설치 파일 (dist:mac, dist:linux)
```

그다음 **프로젝트 → 새 프로젝트**로 폴더를 고르고, **CLI 연결**에서 감지된 CLI 를 확인한 뒤, 대시보드의 요청 입력창에 보고 싶은 것을 적어 보세요.

## 더 알아보기

보드·스크립트·에이전트 도구·권한이 안에서 어떻게 동작하는지: **[docs/technical.ko.md](docs/technical.ko.md)**

## 라이선스

[MIT](LICENSE)
