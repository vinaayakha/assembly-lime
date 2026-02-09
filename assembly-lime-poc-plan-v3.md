# Assembly Lime — Software Factory POC (v3)
*Bun + TypeScript + Postgres (bigint IDs) with **multi-repo projects**, **deployments**, and a **feature→repo mapping system** that agents can search.*

> This v3 update adds:  
> 1) **Projects can have many repositories** (backend, frontend(s), SDKs, infra/pipeline repos).  
> 2) **Deployments** and **pipeline repos** as first-class.  
> 3) A searchable **Feature Map** so the agent auto-plans changes across all affected repos (e.g., “spin wheel” → backend + SDKs + web + mobile + npm pkg).

---

## 1) Core requirement you added (what must happen)
When a user says: “Create/update feature X”, the planning agent must:
1. Identify which **feature area** it belongs to (e.g., “spin wheel”).
2. Retrieve the **mapped repositories** for that feature.
3. Produce a plan with **repo-specific tasks**:
   - backend changes in backend repo(s)
   - UI changes in frontend repo(s)
   - SDK changes across all SDK repos
   - pipeline/deployment changes in pipeline/infra repo(s)
4. Make this mapping **easily searchable** by agents.

---

## 2) Updated Postgres schema additions (bigint IDs, tenant-scoped)

### 2.1 Extensions for search
```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy search
```

### 2.2 Projects ↔ repositories mapping (many-to-many)
You already have `repositories` and `projects`. Add a link table with “repo role”.

**project_repositories**  (NEW)
- `id BIGINT PK`
- `tenant_id BIGINT FK tenants`
- `project_id BIGINT FK projects ON DELETE CASCADE`
- `repository_id BIGINT FK repositories`
- `repo_role SMALLINT NOT NULL`  
  Suggested:  
  - 10=backend  
  - 20=frontend  
  - 30=web_sdk  
  - 31=ios_sdk  
  - 32=android_sdk  
  - 33=flutter_sdk  
  - 40=npm_package  
  - 50=infra  
  - 60=pipeline_repo  
  - 70=docs
- `is_primary BOOLEAN NOT NULL DEFAULT FALSE`
- `notes TEXT NULL`
- `created_at timestamptz DEFAULT now()`
- `UNIQUE(tenant_id, project_id, repository_id)`

Indexes:
- `(tenant_id, project_id, repo_role)`
- `(tenant_id, repository_id)`

**Why this exists:** A project can include many repos, and the system must know which repo plays which role.

---

## 3) Feature Map: “spin wheel” → list of repos (searchable by agent)

### 3.1 Feature catalog
**features** (NEW)
- `id BIGINT PK`
- `tenant_id BIGINT FK tenants`
- `project_id BIGINT FK projects ON DELETE CASCADE`
- `key TEXT NOT NULL`            (stable identifier: `spin-wheel`)
- `name TEXT NOT NULL`           (`Spin Wheel`)
- `description TEXT NULL`
- `tags TEXT[] NOT NULL DEFAULT '{}'`
- `owner_team TEXT NULL`
- `created_at timestamptz DEFAULT now()`
- `UNIQUE(tenant_id, project_id, key)`

Search optimization:
- Add computed search fields:
  - `search_text TEXT GENERATED ALWAYS AS (coalesce(key,'') || ' ' || coalesce(name,'') || ' ' || coalesce(description,'')) STORED`
- Index:
  - `GIN (search_text gin_trgm_ops)`
  - Optional: `GIN(tags)` if you filter heavily by tags

### 3.2 Feature ↔ repository mapping (many-to-many)
**feature_repository_map** (NEW)
- `id BIGINT PK`
- `tenant_id BIGINT FK tenants`
- `feature_id BIGINT FK features ON DELETE CASCADE`
- `repository_id BIGINT FK repositories`
- `change_type SMALLINT NOT NULL`  
  Suggested:
  - 1=code
  - 2=config
  - 3=docs
  - 4=tests
- `priority SMALLINT NOT NULL DEFAULT 2` (1=must, 2=likely, 3=maybe)
- `notes TEXT NULL` (e.g., “update API + schema”, “sync events”, “bump sdk version”)
- `UNIQUE(tenant_id, feature_id, repository_id)`

Indexes:
- `(tenant_id, feature_id, priority)`
- `(tenant_id, repository_id)`

### 3.3 Repo aliases and keywords (to improve matching)
**repository_aliases** (NEW)
- `id BIGINT PK`
- `tenant_id BIGINT FK tenants`
- `repository_id BIGINT FK repositories ON DELETE CASCADE`
- `alias TEXT NOT NULL`  (e.g., “spin wheel”, “wheel”, “flyy-spin-the-wheel”, “prize wheel”)
- `UNIQUE(tenant_id, repository_id, alias)`

Indexes:
- `GIN (alias gin_trgm_ops)`

### 3.4 Feature aliases and keywords (optional but helpful)
**feature_aliases** (NEW)
- `id BIGINT PK`
- `tenant_id BIGINT FK tenants`
- `feature_id BIGINT FK features ON DELETE CASCADE`
- `alias TEXT NOT NULL`
- `UNIQUE(tenant_id, feature_id, alias)`

Indexes:
- `GIN (alias gin_trgm_ops)`

---

## 4) How the agent uses the Feature Map (mandatory behavior)

### 4.1 Agent “repo selection” algorithm
When user requests a change:
1. Extract candidate keywords from prompt:
   - entities: repo names mentioned
   - feature words: “spin wheel”, “sdk”, “ios”, “deployment”
2. If the prompt references a repo explicitly (e.g., `flyy-spin-the-wheel`), use:
   - `repositories.full_name ILIKE '%...%'` or alias table search
3. Also search features:
   - match `features.search_text` + `feature_aliases.alias`
4. If feature is found:
   - fetch all repos from `feature_repository_map`
5. If feature not found:
   - fallback to project default repos:
     - list `project_repositories` and pick relevant roles based on words:
       - “backend” → backend repos
       - “frontend” → frontend repos
       - “sdk” → all sdk roles
       - “deploy/pipeline” → pipeline_repo + infra
6. The plan output MUST be grouped by repository.

### 4.2 Required API endpoints for agent lookup
- `GET /projects/:projectId/repositories` (returns repo_role list)
- `GET /projects/:projectId/features/search?q=...`
- `GET /features/:featureId/repositories`
- `GET /repositories/search?q=...` (includes aliases)

---

## 5) Your example mapping: “spin wheel” in roid-software
For your scenario (tenant uses roid-software org), create a feature row:

**features**
- `key`: `spin-wheel`
- `name`: `Spin Wheel`
- `aliases`: `spinwheel`, `wheel`, `prize wheel`

Then map repos (examples as you listed):
- `flyy-backend`              (role=backend, change_type=code, priority=1)
- `flyy-spin-the-wheel`       (role=frontend or feature-ui repo, priority=1)
- `flyy-sdk`                  (role=web_sdk or core sdk, priority=1)
- `flyy-sdk-ios`              (role=ios_sdk, priority=2)
- `flyy-flutter-sdk`          (role=flutter_sdk, priority=2)
- `flyy-web-sdk`              (role=web_sdk, priority=2)
- `flyy-sdk-package` (npm)    (role=npm_package, priority=2)
- `pipeline repo` (if exists) (role=pipeline_repo, priority=2) for version bump + deployment changes

**Resulting agent plan (required style):**
- Repo: flyy-backend
  - Task: add/modify API endpoint + schema changes
  - Task: update event tracking + validation
- Repo: flyy-spin-the-wheel
  - Task: UI changes, config flags, tests
- Repo: flyy-sdk / flyy-web-sdk / npm pkg
  - Task: add new methods/events, bump version, update docs
- Repo: iOS/Flutter SDKs
  - Task: parity updates, release notes
- Repo: pipeline repo
  - Task: build/release steps, version bump propagation

---

## 6) Deployments (added as first-class feature)

### 6.1 Why deployments need explicit modeling
A feature may require:
- pipeline changes (CI/CD)
- environment variables
- deployment target config
- release orchestration across multiple repos (backend + SDK + UI)

### 6.2 Deployment model (NEW)
**deployments**
- `id BIGINT PK`
- `tenant_id BIGINT FK tenants`
- `project_id BIGINT FK projects ON DELETE CASCADE`
- `ticket_id BIGINT NULL FK tickets`
- `deployment_target_id BIGINT FK deployment_targets`
- `status SMALLINT NOT NULL DEFAULT 1`  
  Suggested:
  - 1=planned
  - 2=queued
  - 3=running
  - 4=succeeded
  - 5=failed
  - 6=cancelled
- `created_by BIGINT FK users`
- `created_at timestamptz DEFAULT now()`
- `started_at timestamptz NULL`
- `ended_at timestamptz NULL`

Indexes:
- `(tenant_id, project_id, created_at DESC)`
- `(tenant_id, deployment_target_id, status)`

**deployment_steps** (NEW)
- `id BIGINT PK`
- `tenant_id BIGINT FK tenants`
- `deployment_id BIGINT FK deployments ON DELETE CASCADE`
- `step_order INT NOT NULL`
- `kind SMALLINT NOT NULL`
  Suggested:
  - 10=pipeline_run
  - 20=manual_approval
  - 30=env_var_apply
  - 40=release_tag
  - 50=rollback
- `pipeline_id BIGINT NULL FK build_pipelines`
- `repository_id BIGINT NULL FK repositories`  (if step impacts a repo)
- `config_json JSONB NOT NULL DEFAULT '{}'::jsonb`
- `status SMALLINT NOT NULL DEFAULT 1` (planned/running/ok/failed)
- `created_at timestamptz DEFAULT now()`
- `UNIQUE(tenant_id, deployment_id, step_order)`

Indexes:
- `(tenant_id, deployment_id, step_order)`

### 6.3 Pipeline repo support
Sometimes pipelines live in a **separate repo** from the app repo. Add:

**build_pipelines** (UPDATE)
- Add `pipeline_repository_id BIGINT NULL FK repositories`
  - If NULL, pipeline config is assumed in `repository_id`
Indexes:
- `(tenant_id, pipeline_repository_id)` (nullable)

---

## 7) Planning behavior update (mandatory)
When user requests “create/update feature”, planning agent must include **deployment work** if:
- there are mapped repos with role `pipeline_repo` or `infra`
- the feature affects SDK versions or packages (release steps)
- env var changes are needed

**New acceptance criteria for plans:**
- Plan includes “Implementation tasks per repo”
- Plan includes “Release/deployment tasks” where applicable
- Plan includes “Version bump matrix” for SDK/package repos if touched

---

## 8) Searchability requirements (so the agent can find mappings fast)

### 8.1 Query patterns the agent must use
- Feature search:
  - `features.search_text % q` (trgm similarity) and alias match
- Repo search:
  - `repositories.full_name ILIKE '%q%'` and `repository_aliases.alias % q`
- Mapping retrieval:
  - join `feature_repository_map` on matched feature_id

### 8.2 Performance considerations (Postgres)
- Use `pg_trgm` + GIN indexes on `features.search_text`, alias tables.
- Keep mapping tables narrow, indexed by `(tenant_id, feature_id)` and `(tenant_id, repository_id)`.

---

## 9) API endpoints to implement (delta)
- `POST /projects/:projectId/features` (create feature)
- `POST /features/:featureId/repositories` (attach repo to feature)
- `GET /projects/:projectId/features/search?q=...`
- `GET /features/:featureId/repositories`
- `GET /repositories/search?q=...`
- `POST /deployments`
- `GET /deployments/:id`
- `POST /deployments/:id/steps`

---

## 10) UI additions (delta)
- **Project → Repositories** page:
  - attach multiple repos to a project
  - assign `repo_role`
- **Features** page:
  - create feature keys, aliases, map repos
  - “Test search” input to preview agent selection results
- **Deployments** page:
  - create deployment plan, show steps, statuses, logs
- Ticket drawer:
  - “Impacted repos” computed from feature mapping

---

## 11) Agent prompts (delta snippets)

### 11.1 “Feature planning” prompt (must consult mapping)
> You are the Planning Agent.  
> Step 1: Identify whether the request matches an existing feature (search via /features/search).  
> Step 2: Retrieve mapped repositories.  
> Step 3: Output a plan grouped by repository, including backend/frontend/sdk/pipeline repos as applicable.  
> Step 4: If deployments are needed, create a deployment checklist (pipeline/env/version bumps).  
> If mapping is missing, propose a mapping and ask to confirm.

### 11.2 “Implement feature across repos” prompt
> You are the Implementation Agent.  
> You will receive a list of impacted repos.  
> For each repo: implement only the assigned tasks; produce diffs; run tests; open PR drafts.  
> Ensure SDK versions and release artifacts are consistent.

---

## 12) Clarification needed to finalize design
Do you want feature→repo mapping to be:
A) **Manually curated** only (most reliable for POC), or  
B) Manually curated + **agent-suggested** mappings that humans approve?
