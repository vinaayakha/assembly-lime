# Assembly Lime — Software Factory POC (Bun + TypeScript)  
*A detailed build plan + agent instructions for an AI coding agent to implement with you.*

> Goal: a “software factory” dashboard where PM/Dev/QA collaborate on **planning + execution** with AI agents, connected to an org’s **GitHub repositories** (future: GitLab/Bitbucket/custom) and **deployment pipelines** (start: GitHub Actions).

---

## 0) What you’re building (POC scope)

### Core user experience (inspired by the attached UIs)
1. **Command Center (Chat-first)**  
   - Large prompt box with **model/provider selector**, quick action chips (“Start a task”, “Plan tasks”, “Find & fix bug”, “Work on ticket”), and conversation history.  
   - Similar to the “AI code agent” landing prompt + ChatGPT-like layout.

2. **Kanban Board (Jira-like)**  
   - Project board with columns: `Backlog → Todo → In Progress → Code Review → QA → Done`  
   - Cards show title, tags, assignee, status icons, linked repo/PR, and AI suggestions.
   - Drag & drop cards and quick filters.

3. **Repo & Pipeline Connections**  
   - Connect a GitHub org/repo via OAuth (or GitHub App, recommended), pull repo metadata and workflow status.
   - Show PRs, recent workflow runs, build status on cards.

4. **AI “Agents” that act on work items**
   - “Plan tasks”: turn a feature request into a set of structured tickets (epics/stories/tasks).
   - “Work on a ticket”: agent creates branch, edits code, runs tests, opens PR draft.
   - “Find and fix a bug”: agent uses repo context to produce patch + PR.
   - Providers: **OpenAI Codex SDK** + **Claude Agent SDK** in TypeScript.

---

## 1) Non-goals (for POC)
- Full enterprise governance, RBAC matrices, SCIM, SSO, fine-grained audit analytics.
- Supporting >1 repo provider (only GitHub for POC).
- Supporting every CI/CD platform (start with GitHub Actions visibility; optional “trigger rerun” later).

---

## 2) Key constraints from SDKs (design implications)

### OpenAI Codex SDK (TypeScript)
- Install: `npm install @openai/codex-sdk` and basic usage is `const codex = new Codex(); const thread = codex.startThread(); await thread.run("...");` and you can resume via `codex.resumeThread(threadId)`. citeturn1view0  
- Docs specify server-side usage and **Node.js 18+** is required. citeturn1view0  

**Implication:** Your main app can be Bun, but Codex execution may run in a **Node 20 worker container** to stay fully aligned with official support. (Bun may work, but treat that as “best effort” rather than a guarantee.)

### Claude Agent SDK (TypeScript)
- Install: `npm install @anthropic-ai/claude-agent-sdk` and interact via `query()` which streams messages via an async generator. citeturn0search0turn2view0  
- Options include `executable: 'bun' | 'deno' | 'node'` and rich execution controls like `allowedTools`, `settingSources`, `mcpServers`, checkpointing, etc. citeturn2view1  

**Implication:** Claude agent workers can run under **Bun** cleanly. Also, you can expose a “tool allowlist” per org/project.

---

## 3) Proposed architecture (POC)

### Services (minimal but production-shaped)
1. **web** (frontend)  
   - React + Vite (served by Bun)  
   - Tailwind + Radix UI (or shadcn-compatible primitives)  
   - Drag/drop board: `@dnd-kit`  
   - Real-time updates via WebSocket to `api`.

2. **api** (Bun runtime)  
   - Framework: **Hono** or **Elysia** (both work well on Bun)  
   - Auth, org/project management, kanban CRUD, GitHub integration, agent orchestration, event log.
   - WebSocket endpoint for board + agent run events.

3. **agent-worker-codex** (Node 20 runtime container)  
   - Runs OpenAI Codex SDK, clones repos, executes tasks, produces diffs/patches, opens PRs.
   - Reads job messages from Redis queue.

4. **agent-worker-claude** (Bun runtime container)  
   - Runs Claude Agent SDK with `executable: 'bun'`.
   - Same job protocol.

5. **postgres** (data)  
   - Stores orgs, users, projects, boards, tickets, agent runs, transcripts, repo connections.

6. **redis** (queue + cache)  
   - BullMQ for jobs, pub/sub for live events, short-term caching.

> Start with `docker-compose` for local. Later, map directly to Kubernetes deployments.

---

## 4) Tech stack (POC defaults)
- Runtime: **Bun** for `api` and `web`, Node 20 for `agent-worker-codex`.
- Language: TypeScript everywhere.
- DB: Postgres 16.
- ORM: Drizzle ORM (Bun-friendly).
- Queue: BullMQ + Redis.
- Auth: GitHub OAuth + session cookies (or JWT). Prefer “GitHub App” later.
- Realtime: WebSocket (Bun supports it) + event stream semantics.
- Logging: pino, request IDs, run IDs.
- Tracing (optional): OpenTelemetry.

---

## 5) Data model (POC schema)

### Core tables
- `orgs`  
  - `id`, `name`, `created_at`
- `users`  
  - `id`, `org_id`, `email`, `name`, `role` (admin/pm/dev/qa), `created_at`
- `projects`  
  - `id`, `org_id`, `name`, `key`, `created_at`
- `boards`  
  - `id`, `project_id`, `name`, `columns_json` (ordered list)
- `tickets`  
  - `id`, `project_id`, `board_id`, `column_key`, `title`, `description_md`,  
    `priority`, `labels_json`, `assignee_user_id`,  
    `repo_connection_id` (nullable), `branch`, `pr_url`, `status_meta_json`,  
    `created_by`, `created_at`, `updated_at`
- `repo_connections`  
  - `id`, `org_id`, `provider` (github), `external_org`, `external_repo`,  
    `auth_type` (oauth/app), `access_token_enc`, `refresh_token_enc`, `scopes_json`,  
    `created_at`, `revoked_at`
- `pipeline_runs` (optional v1)
  - `id`, `repo_connection_id`, `provider_run_id`, `workflow_name`, `status`, `conclusion`, `url`, `started_at`, `completed_at`
- `agent_runs`  
  - `id`, `org_id`, `project_id`, `ticket_id` (nullable), `provider` (codex/claude),  
    `mode` (plan/implement/bugfix/review), `status` (queued/running/succeeded/failed/cancelled),  
    `input_prompt`, `output_summary`, `artifacts_json`, `started_at`, `ended_at`, `cost_meta_json`
- `agent_events`  
  - `id`, `agent_run_id`, `ts`, `type` (tool/message/diff/log/error), `payload_json`
- `audit_log`  
  - `id`, `org_id`, `actor_user_id`, `action`, `target_type`, `target_id`, `payload_json`, `ts`

### Column conventions
- All JSON columns are validated by Zod at the API boundary.
- “enc” fields use envelope encryption (see Security section).

---

## 6) GitHub integration (POC)

### Authentication approach (POC)
- Easiest: **GitHub OAuth App** with `repo`, `workflow`, `read:org` scopes (tighten later).
- Better (recommended for v1): **GitHub App** with granular permissions and org install flow.

### Webhooks to subscribe
- `push`, `pull_request`, `pull_request_review`, `issues`, `issue_comment`, `workflow_run`

### Sync strategy
- On connect:
  1. Fetch repos the user can access
  2. Allow selecting 1–N repos for a project
  3. Store `repo_connection`
  4. Register webhook
- Ongoing:
  - Webhook events append to `audit_log` and update `tickets` metadata (PR status, workflow status).

---

## 7) AI providers integration plan (unified interface)

### 7.1 Provider abstraction (one interface)
Create a shared interface so UI/API doesn’t care whether it’s Codex or Claude:

```ts
export type AgentProviderId = "codex" | "claude";

export type AgentMode = "plan" | "implement" | "bugfix" | "review";

export type AgentRunRequest = {
  runId: string;
  mode: AgentMode;
  prompt: string;
  repo?: {
    cloneUrl: string;
    defaultBranch: string;
    ref?: string;        // branch/sha
    allowedPaths?: string[];
  };
  ticket?: { id: string; title: string; descriptionMd?: string };
  constraints?: {
    timeBudgetSec?: number;
    maxCostUsd?: number;
    allowedTools?: string[]; // for Claude SDK allowlist
  };
};

export type AgentEvent =
  | { type: "message"; role: "system"|"assistant"|"tool"; text: string }
  | { type: "log"; text: string }
  | { type: "diff"; unifiedDiff: string; summary?: string }
  | { type: "artifact"; name: string; url?: string; mime?: string }
  | { type: "error"; message: string; stack?: string };

export interface IAgentProvider {
  id: AgentProviderId;
  run(req: AgentRunRequest, emit: (e: AgentEvent) => Promise<void>): Promise<void>;
  cancel?(runId: string): Promise<void>;
}
```

### 7.2 Codex provider (worker)
- Uses Codex SDK threads. Docs show:
  - install: `npm install @openai/codex-sdk`
  - create agent: `const codex = new Codex()`
  - run: `const thread = codex.startThread(); await thread.run("...")`
  - resume: `codex.resumeThread(threadId)` citeturn1view0  

Implementation idea:
- For each job:
  1. Create a workspace dir
  2. Clone repo (depth=1)
  3. Create a “task branch”
  4. Run Codex prompt: “Explore this repo and implement …”
  5. Capture diff (`git diff`)
  6. Run unit tests/lint (best effort)
  7. Create PR draft via GitHub API (optional in v0)

### 7.3 Claude provider (worker)
- Uses `query()` and streams messages. citeturn2view1  
- Use options:
  - `allowedTools` (tool allowlist)
  - `executable: 'bun'` so the agent can run local commands with Bun citeturn2view1  
  - `settingSources: ['project']` to load project conventions if you later add `.claude/settings.json` citeturn2view1  

Implementation idea:
- For each job:
  1. Clone repo to workspace
  2. Start a Claude query:
     - Prompt includes objective + acceptance criteria
     - Options allow `Read`, `Edit`, `Bash`, `Grep`, `Glob` as needed
  3. Stream events back to API via Redis pub/sub
  4. Produce diff via `git diff`

---

## 8) Security model (POC but safe)

### Secrets
- Store provider keys encrypted at rest (KMS later; for POC use libsodium + master key env var).
- Never send secrets to agents in plain text.

### Sandboxing
- Workers run in containers with:
  - read/write only in workspace directory
  - no docker socket
  - limited network egress (allow GitHub + package registries if needed)
- Agent tool allowlist:
  - Claude: enforce `allowedTools` citeturn2view1  
  - Codex: constrain by running inside isolated container and using a repo allowlist.

### Audit trail
- Every agent action emits `agent_events` and is visible in UI.
- Every GitHub mutation logs to `audit_log`.

---

## 9) UI spec (minutely detailed)

### Global shell (ChatGPT-like)
- Left sidebar (dark)
  - Org switcher
  - Projects list
  - Links: Command Center, Board, Repos, Pipelines, Agents, Settings
- Top bar
  - Current project name
  - Search
  - “Run Agent” button
  - User menu

### Command Center (hero prompt)
- Main panel:
  - Title: “What are we building today?”
  - Large textarea
  - Model dropdown (Codex / Claude Agent)
  - Submit button
  - Quick chips:
    - Start a task
    - Plan tasks
    - Find & fix a bug
    - Work on a ticket
- Right panel (optional):
  - Recent runs
  - Active run stream
- Output area:
  - Streaming transcript (messages + tool logs)
  - Artifacts section:
    - Diff viewer
    - Files changed
    - PR link
    - Test results

### Board (Jira-like)
- Columns horizontally scrollable
- Each column shows count
- Card layout:
  - Title (2 lines)
  - Labels (pills)
  - Repo badge + branch
  - PR status icon
  - Assignee avatar
- Interactions:
  - Drag card between columns (optimistic UI + server confirm)
  - Click opens Ticket Drawer:
    - description, comments, attachments
    - linked repo, branch, PR
    - “Ask AI” / “Implement” / “Review” buttons
    - Activity log

### Agents page
- List of runs with filters (status, provider, mode)
- Run details:
  - timeline of events
  - cost meta
  - diff + artifacts

---

## 10) API design (routes)

### Auth
- `GET /auth/github/start`
- `GET /auth/github/callback`
- `POST /auth/logout`
- `GET /me`

### Orgs / Projects
- `GET /orgs`
- `POST /orgs`
- `GET /projects?orgId=...`
- `POST /projects`

### Board
- `GET /projects/:projectId/board`
- `POST /projects/:projectId/tickets`
- `PATCH /tickets/:ticketId` (move column, edit fields)
- `GET /tickets/:ticketId`
- `POST /tickets/:ticketId/comments`

### Repos
- `GET /github/repos`
- `POST /projects/:projectId/repos/connect`
- `POST /github/webhook` (receiver)

### Agents
- `POST /agent-runs` (creates job, returns runId)
- `GET /agent-runs/:runId`
- `POST /agent-runs/:runId/cancel`
- WebSocket:
  - `/ws` where client subscribes to `run:<id>` and `board:<projectId>`

---

## 11) Infra base (local → prod-ready path)

### 11.1 Local dev (docker-compose)
Services:
- `postgres:16`
- `redis:7`
- `api` (bun)
- `web` (bun + vite)
- `worker-claude` (bun)
- `worker-codex` (node:20)

Volumes:
- `./workspaces` mounted into workers (or per-container tmp dirs)

### 11.2 Production-ish (single VM)
- Caddy or Nginx reverse proxy
- `api` + `web` (Bun) behind proxy
- Workers as separate processes/containers
- Postgres managed (Neon/Supabase/RDS later)
- Redis managed (Upstash/Elasticache later)

### 11.3 Kubernetes-ready shape
- Deployments:
  - `api-deploy`
  - `web-deploy`
  - `worker-claude-deploy`
  - `worker-codex-deploy`
- Stateful/managed:
  - Postgres, Redis
- Secrets:
  - sealed-secrets / external secrets operator

---

## 12) Implementation sequence (agent-friendly)

### Milestone 0 — Repo scaffolding (Day 1)
1. Create monorepo (recommended):
   - `apps/web`
   - `apps/api`
   - `apps/worker-claude`
   - `apps/worker-codex`
   - `packages/shared` (types, zod schemas, event protocol)
2. Add lint/format:
   - eslint + prettier
3. Add docker-compose with Postgres/Redis

**Acceptance:** `bun dev` boots web+api; `docker compose up` starts deps.

---

### Milestone 1 — Auth + Org/Project (Day 2–3)
1. GitHub OAuth flow
2. Create org + project
3. Persist session (cookie)

**Acceptance:** Login works, can create a project.

---

### Milestone 2 — Board CRUD + realtime (Day 4–6)
1. DB schema for board/tickets
2. Board UI with drag/drop
3. WebSocket updates

**Acceptance:** Two browsers see card moves live.

---

### Milestone 3 — GitHub repo connect + webhooks (Day 7–10)
1. List accessible repos
2. Connect repo to project
3. Webhook receiver updates ticket PR status

**Acceptance:** PR opened updates linked ticket in UI.

---

### Milestone 4 — Agent orchestration v0 (Day 11–16)
1. `POST /agent-runs` creates `agent_runs` + enqueues job
2. Workers consume jobs
3. Streaming events via Redis pub/sub → WebSocket → UI
4. First “Plan tasks” action: create tickets from prompt (no code changes)

**Acceptance:** Prompt → structured ticket list appears and is created in board.

---

### Milestone 5 — Agent code changes + diff viewer (Day 17–24)
1. Worker clones repo and produces diff
2. UI shows diff viewer
3. Optional: create PR draft

**Acceptance:** “Fix bug” produces diff; user can apply/merge via PR.

---

## 13) Detailed “agent instructions” (copy/paste for Codex/Claude)

### 13.1 Repo conventions (tell the agent)
- Use Bun for API and workers except Codex worker which stays Node 20.
- Prefer small, composable modules.
- All API inputs validated with Zod.
- No secrets in logs.
- Every agent job must emit structured events.

### 13.2 Ticket template (standard)
**Title:**  
**Context:**  
**Goal / Acceptance criteria:**  
**Constraints:**  
**Out of scope:**  
**Definition of done:**  
**Test plan:**  

### 13.3 “Plan tasks” prompt (structured output)
> You are the Planning Agent. Convert the user request into:  
> - 1 Epic  
> - 3–7 Stories  
> - 3–5 Tasks per story  
> Each item must include: title, description, acceptance criteria, owner role (PM/Dev/QA), and suggested column.

### 13.4 “Implement ticket” prompt (repo-aware)
> You are the Implementation Agent. You have access to the repository in a sandbox.  
> Objective: implement the ticket exactly.  
> Requirements:  
> - create a branch `al/<ticketId>-<slug>`  
> - run tests/lint  
> - produce a unified diff + summary  
> - do not change unrelated files  
> - if uncertain, add TODO comments + explain tradeoffs

### 13.5 “Bugfix” prompt
> Locate root cause, write minimal fix, add a regression test, provide diff and explanation.

### 13.6 “Code review” prompt
> Review the diff for correctness, security, edge cases, performance, and style. Output actionable comments.

---

## 14) “Miniscule details” for the AI coding agent (what to generate)

### Required repo files
- `README.md` (how to run, env vars)
- `.env.example`
- `docker-compose.yml`
- `packages/shared/src/protocol.ts` (AgentRunRequest, AgentEvent, etc.)
- `apps/api/src/index.ts` (Hono/Elysia server)
- `apps/api/src/ws.ts` (WS broker)
- `apps/api/src/queue.ts` (BullMQ)
- `apps/api/src/github/*` (oauth + webhook)
- `apps/web/src/routes/*` (Command Center, Board, Agents)
- `apps/web/src/components/*` (Sidebar, BoardColumn, TicketCard, DiffViewer)
- `apps/worker-claude/src/main.ts` (Claude provider)
- `apps/worker-codex/src/main.ts` (Codex provider)

### Environment variables
- `DATABASE_URL=postgres://...`
- `REDIS_URL=redis://...`
- `GITHUB_CLIENT_ID=...`
- `GITHUB_CLIENT_SECRET=...`
- `OPENAI_API_KEY=...`
- `ANTHROPIC_API_KEY=...`
- `ENCRYPTION_MASTER_KEY=...`

### Event protocol rules
- Every worker must:
  - emit `message` events for high-level steps
  - emit `log` events for commands
  - emit one final `diff` or `artifact` on success
  - emit `error` on failure
- API must persist all events into `agent_events`.

---

## 15) Risk list (POC)
- **Tool safety**: agents executing commands → sandbox is mandatory.
- **Provider differences**: Codex vs Claude outputs vary; unify via protocol + adapters.
- **Bun compatibility**: Codex SDK says Node 18+; keep Codex worker on Node. citeturn1view0  
- **Token/cost**: add `maxCostUsd` and store usage.

---

## 16) What “done” means (POC demo script)
1. Login with GitHub
2. Create project
3. Connect a GitHub repo
4. “Plan tasks” → board fills with stories/tasks
5. Pick one ticket → “Work on ticket” → live stream logs
6. See diff + PR link
7. Move ticket to “Code Review” and run “AI Review” → comments show

---

## 17) Next steps after POC
- GitHub App installation flow
- Multi-provider repo abstraction (GitLab/Bitbucket)
- Pipeline integrations beyond GitHub Actions
- Fine-grained RBAC + audit exports
- Multi-agent orchestration (planner → implementer → reviewer → QA)
- MCP connectors (Jira, Slack, Linear, CI tools)

---

## Appendix A — References
- OpenAI Codex SDK docs (install, threads, resume). citeturn1view0  
- Claude Agent SDK overview + TypeScript reference (install, query(), options including bun). citeturn0search0turn2view1  
