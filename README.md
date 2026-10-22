<div align="center">

# Lev

**Describe the dashboard or tool you need. Your agents build it.**

Don't wait for someone to build the screen your project needs — ask for it. Claude Code, Codex and Gemini agents
build it right inside your project, you use it immediately, and you keep asking until it's right.

**English** · [한국어](README.ko.md)

<img src="docs/screenshots/build-result.png" alt="A stock tool built by an agent from a single request" width="100%" />

<sub>↑ Built by an agent from a single request. No hand edits.</sub>

</div>

---

## Build your own tool

### 1. Ask in plain words

<img src="docs/screenshots/build-ask.png" alt="New tool dialog with the request written in plain words" width="100%" />

Say what it should show, which buttons it needs and what happens when you press them. No code, no file formats.

### 2. Watch it being built

<img src="docs/screenshots/build-working.png" alt="The tool appears while the builder agent is still working" width="100%" />

The dashboard-builder agent writes the screen and any data scripts straight into your project. The tool redraws every time a file is saved, so you see it take shape.

### 3. Use it, then keep shaping it

The screenshot at the top is the result of that exact request — one pass with Claude, about $0.65. Press **재입고 알림 맡기기** (hand off a restock alert) on a sold-out product and a new agent goes off to implement it.
Want changes? Ask again in the request box, or click one of the **example requests** the agent left for you — "sort by lowest stock", "let me change the low-stock threshold".

## What can you build?

Anything from a page of numbers and charts to a small app that takes input and gets work done.

- **Data the app doesn't have** — git history, log files, databases, external services. The agent writes the scripts it needs, too.
- **Hand work to agents** — one button starts a new agent or gives a task to one that's already running.
- **Save and export** — keep what you write in a tool inside the project, or export it anywhere.
- **Looks like the app** — cards, tables and charts that match Lev without any styling work.

More boards from the same demo project:

<table>
<tr>
<td width="50%"><img src="docs/screenshots/board-dashboard.png" alt="Development dashboard" /></td>
<td width="50%"><img src="docs/screenshots/tool-todo.png" alt="TODO triage tool" /></td>
</tr>
<tr>
<td><b>Development dashboard</b> — commits per day, open TODOs, cost per agent.</td>
<td><b>TODO triage</b> — collect TODOs from the code, hand some to an agent, remember who got what.</td>
</tr>
<tr>
<td width="50%"><img src="docs/screenshots/tool-release.png" alt="Release notes tool" /></td>
<td width="50%"><img src="docs/screenshots/tool-confirm.png" alt="Confirmation before a tool hands work to an agent" /></td>
</tr>
<tr>
<td><b>Release notes</b> — pick commits, have an agent draft the notes, edit and save.</td>
<td><b>Nothing happens behind your back</b> — before a tool hands off work or saves a file, Lev shows you exactly what will happen.</td>
</tr>
</table>

Try asking for: an API tester with a button per endpoint, today's error-log summary, a pre-release checklist, a missing-translation finder, an asset gallery…
Star the boards you use most to pin them to the sidebar.

## Agents

<img src="docs/screenshots/chat.png" alt="Conversation tab with a message from another agent" width="100%" />

- **One list for every CLI** — status, cost and provider at a glance; right-click to rename, reset or delete.
- **Agent-to-agent messages:** the receiver sees *who* sent it, and its answer goes back to the sender automatically. Above, "API 리뷰" answers a question from "리드".
- **Child agents:** delegate sub-tasks; results are reported to the parent when all children finish.
- **Chat while you look:** pick an agent from a board and its chat opens in a floating window you can drag or fold into a bubble.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/slash.png" alt="Slash command menu" /></td>
<td width="50%"><img src="docs/screenshots/codex.png" alt="A Codex session" /></td>
</tr>
<tr>
<td><b>/ commands</b> — app commands, project skills, and the commands and skills each CLI reports.</td>
<td><b>Codex and Gemini too</b> — per-session permission presets (read-only / edit / full, network & web search).</td>
</tr>
</table>

## Permissions

<table>
<tr>
<td width="50%"><img src="docs/screenshots/permission.png" alt="Permission prompt for a shell command" /></td>
<td width="50%"><img src="docs/screenshots/permissions.png" alt="Permissions screen with AutoMode" /></td>
</tr>
<tr>
<td>Claude's own tools (Bash, WebFetch, Skill…) ask you in the app first. "Always allow" remembers it for this project.</td>
<td><b>AutoMode</b> approves everything that would prompt — including dashboard scripts — and shows an <code>AUTO</code> badge while it's on.</td>
</tr>
</table>

## Skills

<img src="docs/screenshots/skills.png" alt="Skills screen" width="100%" />

Skills are reusable instructions stored with each project. Lev ships **dashboard-builder** (how to build boards) and **create-skill** (how to write a good skill); call any skill from chat by typing `/` and its name.

## Getting started

**Requirements**

- Node.js 22 or later
- At least one agent CLI, logged in: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [OpenAI Codex](https://github.com/openai/codex), or [Gemini CLI](https://github.com/google-gemini/gemini-cli)

```bash
git clone https://github.com/OmnifyAI/LevWorkspace.git
cd LevWorkspace
npm install
npm run dev        # development with hot reload
```

```bash
npm run build      # build to out/
npm start          # run the built app
npm run dist:win   # installer (also dist:mac, dist:linux)
```

Then: **프로젝트 → 새 프로젝트** to pick a folder, **CLI 연결** to check which CLIs were detected, and describe what you want under **보드 → + 새 도구** (Boards → New tool).

> The UI is currently in Korean. English UI is planned.

## Learn more

How boards, scripts, agent tools and permissions work under the hood: **[docs/technical.md](docs/technical.md)**

## License

[MIT](LICENSE)
