# Lev (레브)

Claude Code / OpenAI Codex / Gemini CLI 를 한 곳에서 다루는 Electron 데스크톱 앱 (Windows · macOS · Linux).

```bash
npm install
npm run dev        # 개발 모드 (HMR)
npm run build      # out/ 으로 빌드
npm run dist:win   # 설치 파일 (dist:mac, dist:linux)
```

## 기능

| 영역 | 내용 |
|---|---|
| CLI 연결 | CLI 별 실행 명령·기본 모델·추가 인자 설정, 설치/버전 자동 감지 |
| 화면 | 왼쪽 내비게이션(접기 가능) · 슬림 에이전트 목록(숨기기 가능) · 가운데 탭(고정 "대화" 탭 + 보드·화면·파일) · 오른쪽 파일. 대화 탭이 아닐 때 에이전트를 고르면 끌어 옮기는 떠 있는 채팅 창(버블로 접기) |
| 프로젝트 | 폴더 = 에이전트 작업 디렉터리(cwd). 기본 CLI, 사용 스킬 지정 |
| 세션 | CLI 세션 id 로 `--resume` 하여 대화 이어가기, 실행 중 입력은 대기열, 중지/초기화, 비용 표시. 입력창 `/` 명령: 앱 명령(`/model`·`/clear`·`/stop`·`/child`·`/settings`) + CLI 가 시작할 때 알려 준 명령·스킬 자동완성 (모델은 `/model` 로만 바꾼다) |
| ChildAgent | 수동 생성 또는 리드 에이전트가 `<delegate agent=".." title="..">` 블록으로 자동 위임. 같은 턴의 자식이 모두 끝나면 결과를 부모에 묶어 보고 (깊이 2, 턴당 5개 제한) |
| MultiAgent | 병렬(같은 과제를 여러 에이전트에) / 파이프라인(앞 결과 → 다음 입력) + 선택적 종합 에이전트 |
| 스킬 | 프로젝트 폴더의 `.skills/<이름>/SKILL.md` 가 원본 (프로젝트를 만들면 폴더 생성, 외부 수정 자동 반영). 세션 첫 프롬프트에 주입하고, 같은 폴더의 참고 파일은 경로로 안내. `~/.claude/skills` 에서 가져오기, `.claude/skills` 로 내보내기. 기본 스킬 `create-skill`(스킬 만드는 법)·`dashboard-builder` 는 앱이 넣고 버전으로 갱신(`x-aw-version` 줄을 지우면 직접 관리). 채팅 `/` 메뉴에서 `/<스킬> 요청` 으로 부르면 에이전트가 그 SKILL.md 를 먼저 읽고 따른다 |
| Git | 왼쪽 내비 "Git": 브랜치 전환·만들기·삭제(병합된 것만), 가져오기(fetch)·받기(pull --ff-only)·올리기(push, 처음엔 upstream 설정), 변경 목록(스테이징·내리기·변경 취소 — 새 파일은 휴지통), 커밋(여러 줄·마지막 커밋 고치기, 아무것도 안 올렸으면 "모두 커밋"), 히스토리(페이지·모든 브랜치)·커밋 상세·파일별 diff. 저장소가 아니면 "git 저장소 만들기". 커밋·push 등은 활동 로그에 남고, 바뀌면 파일 패널도 갱신 |
| 첨부 | 오른쪽 파일 트리에서 파일 우클릭 → "세션에 첨부" (또는 미리보기의 "세션에 첨부"). 첨부한 파일 경로는 매 프롬프트에 포함. 예전 에셋 화면(`.agent-assets/`)은 메뉴에서 뺐고 `aw.openView('assets')` 로만 열린다 |

## 대시보드 · Data API

- 대시보드는 프로젝트의 `.dashboard/` 폴더. 파일이 바뀌면 바로 다시 그린다.
  - `boards/<id>.json`: 보드 하나 = 파일 하나. `kind: "dashboard"`(지표 모음) 또는 `"tool"`(입력·실행이 있는 작은 앱, 보통 `height: "fill"` HTML 패널 하나).
    `main.json` 이 기본 대시보드 (예전 `dashboard.json` 은 자동으로 옮김). 상단 "보드" 메뉴에서 열기·새로 만들기, 각 보드는 가운데 탭으로 열린다.
    보드 파일에는 패널 목록·순서·폭 + JSON 기본 위젯 (kpi, table, list, chart, markdown, pipeline, media)
  - 패널 모양: 모든 패널에 `--aw-*` 변수와 `.aw-*` 기본 클래스(카드·KPI·버튼·입력·표·배지·빈/오류/로딩 상태)가 주입된다. 사용법은 `.skills/dashboard-builder/style-guide.md`.
  - `panels/*.html`: 자유 HTML 패널 (`type: "html"`). `ws-panel://` 로 샌드박스 iframe(allow-scripts 만)에 띄우고, 패널 전용 CSP(외부 통신 차단, 허용 CDN 만) 적용. 데이터는 주입된 `window.aw` 브리지(`aw.query`, `aw.run`, `aw.on('state')`, `aw.openSession` …)로만 받는다.
  - `data/`: 패널(도구)이 쓰는 저장소. `aw.saveJSON/saveFile`(쓰기 — 확인 창, 패널 단위 "항상 허용"), `aw.readJSON/readFile/listFiles`(읽기).
    바깥으로 내보낼 때는 `aw.saveAs`(OS 저장 대화상자). 패널의 `<a download>` 는 샌드박스에서 막힌다.
  - `scripts/*`: 데이터 스크립트. 기본은 Node.js(`.mjs`/`.js`, 앱 내장 Node 로 실행 — 설치 불필요). 그 밖에 .py, .ps1, .sh, .rb, .php 도 되지만
    PC 에 런타임이 있을 때만 (`GET /api/scripts` 의 `runtimes`, MCP `aw_list_scripts` 로 확인). stdin 으로 인자 JSON, stdout 으로 결과 JSON. 처음 실행·내용 변경 시 사용자 승인 창, 30초(최대 300초)·5MB 제한. 패널(`aw.run`), JSON 위젯(`script` 소스), Data API, MCP(`aw_run_script`)에서 쓴다.
- 대시보드 상단 입력창에 원하는 내용을 쓰면 `dashboard-builder` 스킬을 단 "대시보드 빌더" 세션이 파일을 고친다.
  보드 파일의 `suggestions`(예시 요청 배열)는 입력창 아래 칩으로 보이고, 누르면 입력창에 채워진다.
- 새 프로젝트의 기본 대시보드는 일부러 단순하다: 시작 안내 카드, 지표 3개(세션·누적 비용·프로젝트 스킬), 최근 활동, 예시 요청 5개 — 에이전트에게 말해서 자기 대시보드를 만들도록 이끈다.
- 위젯 쿼리와 같은 엔진을 로컬 HTTP API(127.0.0.1, 실행마다 새 토큰)로 연다: `GET /api/schema`, `POST /api/query`, `GET /api/dashboard`, `POST /api/dashboard/validate`.
- 앱이 띄우는 CLI 에는 `AGENT_WORKSPACE_API` / `_TOKEN` / `_PROJECT` 환경 변수와 `aw` 명령(`aw schema`, `aw query q.json`, `aw validate`)이 주어진다.
- MCP: 앱이 띄우는 세션에 stdio MCP 서버 `agent_workspace` 를 자동으로 붙인다 (도구: `aw_schema`, `aw_projects`, `aw_query`, `aw_dashboard`, `aw_dashboard_validate`, 읽기 전용).
  claude 는 `--mcp-config` + 도구 자동 허용, codex 는 `-c mcp_servers.agent_workspace.*`, gemini 는 `GEMINI_CLI_SYSTEM_SETTINGS_PATH`. CLI 연결 화면에서 CLI 별로 끌 수 있다.
  서버 스크립트와 설정은 앱 데이터 폴더 `mcp/` 에 있고, 토큰은 그 폴더의 `api.json` 에서만 읽는다 (앱 종료 시 비움).
- 외부 MCP 서버 중계 (MCP 서버 화면): 프로젝트 `.mcp.json`(claude 와 같은 형식) + 전역 `userData/mcp/servers.json` 의 서버를 앱이 직접 연결해 두고,
  세션에는 `agent_workspace` 를 거쳐 `<서버>__<도구>` 로 제공한다 (CLI 별 설정 불필요, 비밀값은 CLI 에 안 넘어감, `${VAR}` / `${VAR:-기본값}` 치환).
  프로젝트 서버는 처음·내용 변경 시 승인해야 실행된다. claude 에는 `--settings` 의 `disabledMcpjsonServers` 로 같은 서버를 직접 읽지 않게 한다.
  도구별 정책: 자동 허용 / 매번 확인(앱 확인 창, "항상 허용" = 그 도구를 자동 허용으로) / 차단(세션에 안 보임). 서버 기본값 "자동"은
  `readOnlyHint` 가 있는 도구만 허용하고 나머지는 확인. 모든 호출은 활동 로그(`mcp`)와 `mcpCalls` 데이터 소스에 남는다.
  비밀값: OS 키 저장소(`safeStorage`)로 암호화해 `userData/mcp/secrets.json` 에 두고 `${이름}` 자리에 넣는다 (비밀값 → 앱 환경 변수 → `:-기본값` 순).
  값은 렌더러·CLI·프로젝트 폴더로 나가지 않고, 바꾸면 그 변수를 쓰는 서버가 새 값으로 다시 연결된다.
  OAuth: 원격 서버가 401 이면 "로그인 필요"로 표시만 하고(백그라운드에서는 클라이언트 등록도 하지 않음), "로그인"을 누르면
  루프백 콜백(127.0.0.1 임의 포트)을 열고 시스템 브라우저로 인증 → PKCE 코드 교환 → 토큰·클라이언트 정보를 암호화 저장. 갱신은 SDK 가 한다.
- 쓰기 동작(메시지 보내기·세션 만들기·중지): 패널 `aw.sendMessage/createSession/stopSession`, MCP `aw_send_message/aw_create_session(child 가능)/aw_stop_session`,
  HTTP `POST /api/sessions`, `/api/sessions/:id/messages`, `/api/sessions/:id/stop`. 모두 앱 안 확인 창(거부 / 이번만 허용 / 항상 허용)을 거친다.
  출처(패널·에이전트 세션·HTTP API)별로 1분 20회 제한, 에이전트는 자기 자신에게 보낼 수 없음, 10분 무응답 시 거부.
  자동 모드(권한 화면 맨 위 토글): 확인 창이 뜰 요청(claude CLI 도구·"매번 확인" MCP 도구·쓰기 동작)을 모두 묻지 않고 허용하고 활동 로그에 남긴다.
  "차단" MCP 도구와 "쓰기 동작 허용" 끔은 그대로 막고, 쓰기 동작의 1분 횟수 제한도 유지한다. 켜져 있으면 내비의 권한에 AUTO 표시.
  에이전트가 `aw_send_message` 로 보낸 메시지는 상대 채팅에 "보낸 에이전트"로 표시되고, 상대의 그 턴 답변이 보낸 세션에 "답장"으로 자동 전달된다
  (답장에는 다시 답장하지 않음). `wait: true` 면 답을 도구 결과로 받는다 (최대 4분, 넘으면 답장으로 도착). 서로 기다리는 순환은 거부한다. "항상 허용"은 권한 화면에서 회수·전체 끄기.

## 구조

```
src/shared/types.ts      공용 타입
src/main/store.ts        JSON 저장소 (userData/data/workspace.json)
src/main/data/           Data API: 소스·쿼리 엔진·대시보드 파일·HTTP 서버·aw 명령
src/main/skills.ts       .skills 폴더 읽기/쓰기·감시 (SKILL.md frontmatter)
src/main/files.ts        프로젝트 파일 목록·미리보기·git 상태
src/main/providers.ts    CLI 별 명령 구성 · 출력(JSON 스트림) 파싱 · 감지
src/main/runner.ts       세션 프로세스 실행/스트리밍/대기열 (AgentManager)
src/main/workspace.ts    도메인 로직 + Child/Multi 오케스트레이션
src/main/ipc.ts          렌더러 ↔ 메인 채널
src/renderer/src/        React UI (views/*)
```

CLI 실행 방식: 프롬프트는 stdin 으로 전달
- claude: `claude -p --output-format stream-json --verbose [--resume id]`
- codex: `codex exec --json --skip-git-repo-check [resume id] -`
- gemini: `gemini --output-format stream-json [--resume id]`

claude 자체 도구 권한: `-p` 모드에서는 권한 질문 창이 없으므로 `--permission-prompt-tool mcp__agent_workspace__aw_permission_prompt` 로
권한이 필요한 도구(WebFetch·Bash·Skill 등)를 앱 확인 창으로 받는다. "항상 허용"은 프로젝트 규칙(`Bash(npm *)`, `WebFetch(domain:…)`, 도구 이름)으로
저장되어 다음 실행부터 `--allowedTools` 로 넘어가고, 권한 화면에서 회수한다. codex·gemini 에는 이런 연결 지점이 없어 실행 옵션으로만 정한다:
새 세션·세션 설정의 권한 프리셋(CLI 설정 그대로 / 읽기 전용 / 파일 편집 / 전체 허용 + 네트워크·웹 토글, `src/shared/access.ts`).
codex 는 `--sandbox read-only|workspace-write|danger-full-access` + `-c approval_policy=never` (+ `sandbox_workspace_write.network_access`, 웹 검색을 끄면 `web_search=disabled` — codex 기본은 켜짐),
gemini 는 `--approval-mode default|auto_edit|yolo` (+ `--allowed-tools web_fetch/google_web_search`). 프리셋을 고르면 겹치는 추가 인자(`--full-auto` 등)는 빠진다.

파일 수정 등 도구 사용을 자동 승인하려면 CLI 연결 화면의 "추가 인자"에 예: `--permission-mode acceptEdits` / `--sandbox workspace-write` / `--approval-mode auto_edit`.

codex 0.16x 메모 (0.163 으로 확인): `--full-auto` 가 없어져 앱이 `--sandbox workspace-write -c approval_policy=never` 로 바꿔 넘긴다.
MCP 도구 호출마다 승인이 필요해져서 앱 서버에는 `default_tools_approval_mode=approve` 를 준다 (외부 MCP·쓰기 동작은 앱 정책·확인 창이 거른다).
MCP 도구는 도구 검색으로 찾아 쓰는 방식이고, 웹 검색은 기본으로 켜져 있다. Windows 에서 앱을 켠 뒤 설치한 CLI 는 레지스트리 PATH 를 다시 읽어 찾는다.
Windows 한글: PowerShell 5.1 은 출력 한글을 CP949 로 바꿔 깨뜨리므로 (codex 샌드박스는 Constrained Language Mode 라 [Console]::OutputEncoding 도 못 바꿈),
세션 첫 프롬프트에 "파일 보기는 `cmd /c type`·`findstr`·`node -e`, PowerShell cmdlet 으로 파이프하지 말 것, 쓰기는 패치 도구나 `-Encoding UTF8`" 안내를 넣는다.
