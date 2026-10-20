import type Database from 'better-sqlite3'

/**
 * Versioned migrations. Append new entries — never edit an applied one.
 */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: /* sql */ `
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE providers (
        id          TEXT PRIMARY KEY,
        kind        TEXT NOT NULL CHECK (kind IN ('anthropic','openai','claude-cli','codex-cli','mock')),
        label       TEXT NOT NULL,
        model       TEXT NOT NULL DEFAULT '',
        api_key_enc BLOB,
        cli_path    TEXT,
        is_default  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE agents (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        role        TEXT NOT NULL DEFAULT '',
        persona     TEXT NOT NULL DEFAULT '',
        provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
        model       TEXT,
        color       TEXT NOT NULL DEFAULT '#6366f1',
        hair        TEXT NOT NULL DEFAULT '#3f2a1d',
        skin        TEXT NOT NULL DEFAULT '#f1c27d',
        desk_index  INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL DEFAULT 'idle'
                    CHECK (status IN ('idle','working','break','error','offline')),
        status_note TEXT,
        is_lead     INTEGER NOT NULL DEFAULT 0,
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE agent_permissions (
        agent_id         TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
        fs_read          INTEGER NOT NULL DEFAULT 1,
        fs_write         INTEGER NOT NULL DEFAULT 0,
        terminal         INTEGER NOT NULL DEFAULT 0,
        network          INTEGER NOT NULL DEFAULT 0,
        browser          INTEGER NOT NULL DEFAULT 0,
        require_approval INTEGER NOT NULL DEFAULT 1,
        allowed_paths    TEXT NOT NULL DEFAULT '[]',
        updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE tasks (
        id           TEXT PRIMARY KEY,
        seq          INTEGER NOT NULL UNIQUE,
        key          TEXT NOT NULL UNIQUE,
        title        TEXT NOT NULL,
        description  TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT 'todo'
                     CHECK (status IN ('todo','in_progress','in_review','done')),
        priority     INTEGER NOT NULL DEFAULT 1 CHECK (priority BETWEEN 0 AND 3),
        assignee_id  TEXT REFERENCES agents(id) ON DELETE SET NULL,
        progress     INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
        sort_order   REAL NOT NULL DEFAULT 0,
        created_by   TEXT NOT NULL DEFAULT 'user',
        review_note  TEXT,
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        started_at   TEXT,
        completed_at TEXT
      );
      CREATE INDEX idx_tasks_status ON tasks(status, sort_order);
      CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);

      CREATE TABLE runs (
        id         TEXT PRIMARY KEY,
        task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        status     TEXT NOT NULL
                   CHECK (status IN ('awaiting_approval','running','paused','succeeded','failed','cancelled')),
        output     TEXT,
        error      TEXT,
        tokens_in  INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost_usd   REAL NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        ended_at   TEXT
      );
      CREATE INDEX idx_runs_status ON runs(status);
      CREATE INDEX idx_runs_task ON runs(task_id);

      CREATE TABLE messages (
        id          TEXT PRIMARY KEY,
        channel     TEXT NOT NULL,
        sender_type TEXT NOT NULL CHECK (sender_type IN ('user','agent','system')),
        sender_id   TEXT,
        content     TEXT NOT NULL,
        meta        TEXT,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_messages_channel ON messages(channel, created_at);

      CREATE TABLE agent_logs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id     TEXT,
        agent_id   TEXT,
        task_id    TEXT,
        level      TEXT NOT NULL CHECK (level IN ('debug','info','warn','error','tool','output')),
        message    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_logs_run ON agent_logs(run_id);
      CREATE INDEX idx_logs_task ON agent_logs(task_id);

      CREATE TABLE memories (
        id               TEXT PRIMARY KEY,
        agent_id         TEXT REFERENCES agents(id) ON DELETE CASCADE,
        scope            TEXT NOT NULL CHECK (scope IN ('global','agent','task')),
        kind             TEXT NOT NULL CHECK (kind IN ('fact','decision','context','preference','summary')),
        content          TEXT NOT NULL,
        importance       REAL NOT NULL DEFAULT 0.5,
        source           TEXT,
        task_id          TEXT,
        access_count     INTEGER NOT NULL DEFAULT 0,
        created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        last_accessed_at TEXT
      );
      CREATE INDEX idx_memories_agent ON memories(agent_id);

      CREATE VIRTUAL TABLE memories_fts USING fts5(
        content, content='memories', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER memories_au AFTER UPDATE OF content ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TABLE decisions (
        id         TEXT PRIMARY KEY,
        seq        INTEGER NOT NULL UNIQUE,
        title      TEXT NOT NULL,
        context    TEXT NOT NULL DEFAULT '',
        decision   TEXT NOT NULL DEFAULT '',
        rationale  TEXT NOT NULL DEFAULT '',
        status     TEXT NOT NULL DEFAULT 'proposed'
                   CHECK (status IN ('proposed','accepted','rejected','superseded')),
        decided_by TEXT,
        task_id    TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE reports (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        kind       TEXT NOT NULL CHECK (kind IN ('task','daily','custom')),
        body_md    TEXT NOT NULL,
        agent_id   TEXT,
        task_id    TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `
  },
  {
    version: 2,
    sql: /* sql */ `
      -- User-defined job description and skill tags (JSON array of strings) per agent.
      ALTER TABLE agents ADD COLUMN job_description TEXT NOT NULL DEFAULT '';
      ALTER TABLE agents ADD COLUMN skills TEXT NOT NULL DEFAULT '[]';
    `
  },
  {
    version: 3,
    sql: /* sql */ `
      -- Organization tree: organization > company > department > team (unlimited nesting).
      CREATE TABLE units (
        id            TEXT PRIMARY KEY,
        parent_id     TEXT REFERENCES units(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        kind          TEXT NOT NULL DEFAULT 'team'
                      CHECK (kind IN ('organization','company','department','team')),
        description   TEXT NOT NULL DEFAULT '',
        color         TEXT NOT NULL DEFAULT '#6366f1',
        lead_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        sort_order    REAL NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_units_parent ON units(parent_id);

      -- An agent may belong to several units.
      CREATE TABLE unit_members (
        unit_id    TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        title      TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (unit_id, agent_id)
      );
      CREATE INDEX idx_unit_members_agent ON unit_members(agent_id);

      CREATE TABLE projects (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        description   TEXT NOT NULL DEFAULT '',
        root_path     TEXT NOT NULL DEFAULT '',
        color         TEXT NOT NULL DEFAULT '#6366f1',
        lead_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
        status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
        is_default    INTEGER NOT NULL DEFAULT 0,
        sort_order    REAL NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      -- Teams (any unit) assigned to a project; sub-units come along implicitly.
      CREATE TABLE project_units (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        unit_id    TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        PRIMARY KEY (project_id, unit_id)
      );

      -- Project scoping. Existing rows are attached to the default project by ensureOrgDefaults().
      ALTER TABLE tasks     ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
      ALTER TABLE runs      ADD COLUMN project_id TEXT;
      ALTER TABLE messages  ADD COLUMN project_id TEXT;
      ALTER TABLE decisions ADD COLUMN project_id TEXT;
      ALTER TABLE reports   ADD COLUMN project_id TEXT;
      ALTER TABLE memories  ADD COLUMN project_id TEXT;
      CREATE INDEX idx_tasks_project     ON tasks(project_id, status);
      CREATE INDEX idx_messages_project  ON messages(project_id, channel, created_at);
      CREATE INDEX idx_decisions_project ON decisions(project_id);
      CREATE INDEX idx_reports_project   ON reports(project_id);
      CREATE INDEX idx_memories_project  ON memories(project_id);
    `
  },
  {
    version: 4,
    sql: `
      -- When the user last opened the project (startup project picker, "recent" order).
      ALTER TABLE projects ADD COLUMN last_opened_at TEXT;
    `
  },
  {
    version: 5,
    sql: `
      -- Agent transcripts: new entry kinds (prompt / instruction / status), project scope and structured meta.
      -- SQLite cannot alter a CHECK constraint, so the table is rebuilt (ids are kept).
      CREATE TABLE agent_logs_v5 (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id     TEXT,
        agent_id   TEXT,
        task_id    TEXT,
        project_id TEXT,
        level      TEXT NOT NULL
                   CHECK (level IN ('debug','info','warn','error','tool','output','prompt','instruction','status')),
        message    TEXT NOT NULL,
        meta       TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      INSERT INTO agent_logs_v5 (id, run_id, agent_id, task_id, project_id, level, message, created_at)
        SELECT l.id, l.run_id, l.agent_id, l.task_id,
               COALESCE((SELECT project_id FROM runs WHERE runs.id = l.run_id), (SELECT project_id FROM tasks WHERE tasks.id = l.task_id)),
               l.level, l.message, l.created_at
        FROM agent_logs l;
      DROP TABLE agent_logs;
      ALTER TABLE agent_logs_v5 RENAME TO agent_logs;
      CREATE INDEX idx_logs_run ON agent_logs(run_id);
      CREATE INDEX idx_logs_task ON agent_logs(task_id);
      CREATE INDEX idx_logs_agent ON agent_logs(agent_id, id);
      CREATE INDEX idx_logs_created ON agent_logs(created_at);

      -- Token usage per model call / run segment (provider-reported, or estimated for the demo provider).
      CREATE TABLE token_usage (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id     TEXT NOT NULL,
        run_id       TEXT,
        task_id      TEXT,
        project_id   TEXT,
        mode         TEXT NOT NULL CHECK (mode IN ('task','chat','review')),
        provider     TEXT NOT NULL,
        model        TEXT NOT NULL DEFAULT '',
        input        INTEGER NOT NULL DEFAULT 0,
        output       INTEGER NOT NULL DEFAULT 0,
        cache_read   INTEGER NOT NULL DEFAULT 0,
        cache_write  INTEGER NOT NULL DEFAULT 0,
        cost_usd     REAL NOT NULL DEFAULT 0,
        estimated    INTEGER NOT NULL DEFAULT 0,
        session_id   TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_usage_agent ON token_usage(agent_id, created_at);
      CREATE INDEX idx_usage_task ON token_usage(task_id);
      CREATE INDEX idx_usage_session ON token_usage(session_id);
      CREATE INDEX idx_usage_project ON token_usage(project_id);

      -- Pre-v5 runs carried totals only; keep them as history so all-time numbers stay correct.
      INSERT INTO token_usage (agent_id, run_id, task_id, project_id, mode, provider, input, output, cost_usd, session_id, created_at)
        SELECT agent_id, id, task_id, project_id, 'task', 'legacy', tokens_in, tokens_out, cost_usd, 'legacy', started_at
        FROM runs WHERE tokens_in > 0 OR tokens_out > 0 OR cost_usd > 0;

      -- Direct user instructions to an agent (history + queue + audit).
      CREATE TABLE agent_instructions (
        id         TEXT PRIMARY KEY,
        agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        project_id TEXT,
        task_id    TEXT,
        run_id     TEXT,
        text       TEXT NOT NULL,
        mode       TEXT NOT NULL CHECK (mode IN ('redirect','queue','task')),
        status     TEXT NOT NULL CHECK (status IN ('queued','applied','started_task','cancelled','rejected')),
        note       TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        applied_at TEXT
      );
      CREATE INDEX idx_instructions_agent ON agent_instructions(agent_id, created_at);
      CREATE INDEX idx_instructions_run ON agent_instructions(run_id, status);
    `
  },
  {
    version: 6,
    sql: `
      -- Servers and databases the agents may use (organization-wide). Secrets are encrypted with safeStorage.
      CREATE TABLE connections (
        id                 TEXT PRIMARY KEY,
        name               TEXT NOT NULL,
        kind               TEXT NOT NULL CHECK (kind IN ('ssh','postgres','mysql','mssql')),
        env                TEXT NOT NULL DEFAULT 'development' CHECK (env IN ('development','staging','production')),
        description        TEXT NOT NULL DEFAULT '',
        purpose            TEXT NOT NULL DEFAULT '',
        notes              TEXT NOT NULL DEFAULT '',
        host               TEXT NOT NULL DEFAULT '',
        port               INTEGER NOT NULL DEFAULT 0,
        username           TEXT NOT NULL DEFAULT '',
        database           TEXT NOT NULL DEFAULT '',
        ssh_auth           TEXT NOT NULL DEFAULT 'key-file' CHECK (ssh_auth IN ('key-file','key','password','agent')),
        key_path           TEXT NOT NULL DEFAULT '',
        ssl                INTEGER NOT NULL DEFAULT 0,
        trust_server_cert  INTEGER NOT NULL DEFAULT 0,
        ro_username        TEXT NOT NULL DEFAULT '',
        ssh_read           TEXT NOT NULL DEFAULT '[]',
        ssh_write          TEXT NOT NULL DEFAULT '[]',
        ssh_execute        TEXT NOT NULL DEFAULT '[]',
        secret_enc         TEXT,
        ro_secret_enc      TEXT,
        host_key           TEXT,
        last_test_at       TEXT,
        last_test_ok       INTEGER,
        last_test_message  TEXT,
        schema_json        TEXT,
        schema_fetched_at  TEXT,
        created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      -- Deny all by default: no row = no access.
      CREATE TABLE connection_permissions (
        connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
        agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        level         TEXT NOT NULL CHECK (level IN ('none','read','write','execute','admin')),
        updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (connection_id, agent_id)
      );
      CREATE INDEX idx_connperm_agent ON connection_permissions(agent_id);

      -- Every connection access and critical change (who, when, which task, what, result).
      CREATE TABLE audit_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        actor_type      TEXT NOT NULL CHECK (actor_type IN ('agent','user','system')),
        actor_id        TEXT,
        actor_name      TEXT NOT NULL DEFAULT '',
        connection_id   TEXT,
        connection_name TEXT NOT NULL DEFAULT '',
        project_id      TEXT,
        task_id         TEXT,
        run_id          TEXT,
        action          TEXT NOT NULL,
        detail          TEXT NOT NULL DEFAULT '',
        result          TEXT NOT NULL CHECK (result IN ('ok','error','denied','pending')),
        message         TEXT,
        duration_ms     INTEGER
      );
      CREATE INDEX idx_audit_at ON audit_log(at);
      CREATE INDEX idx_audit_conn ON audit_log(connection_id, at);
      CREATE INDEX idx_audit_actor ON audit_log(actor_id, at);
    `
  },
  {
    version: 7,
    sql: `
      -- Attachments: uploaded by the user, saved by agents, or changed by CLI agents in the project folder.
      -- Originals live in <data>/files/<sha256[0:2]>/<sha256> (content-addressed); workspace files are only referenced.
      CREATE TABLE files (
        id              TEXT PRIMARY KEY,
        project_id      TEXT REFERENCES projects(id) ON DELETE CASCADE,
        name            TEXT NOT NULL,
        ext             TEXT NOT NULL DEFAULT '',
        mime            TEXT NOT NULL DEFAULT 'application/octet-stream',
        kind            TEXT NOT NULL DEFAULT 'other'
                        CHECK (kind IN ('pdf','docx','xlsx','pptx','csv','text','markdown','json','image','other')),
        size            INTEGER NOT NULL DEFAULT 0,
        sha256          TEXT NOT NULL DEFAULT '',
        origin          TEXT NOT NULL CHECK (origin IN ('user','agent','workspace')),
        created_by_type TEXT NOT NULL DEFAULT 'user' CHECK (created_by_type IN ('user','agent')),
        created_by_id   TEXT,
        rel_path        TEXT,
        status          TEXT NOT NULL DEFAULT 'processing'
                        CHECK (status IN ('processing','ready','partial','unsupported','failed')),
        status_message  TEXT,
        warnings        TEXT NOT NULL DEFAULT '[]',
        suspicious      TEXT NOT NULL DEFAULT '[]',
        pages           INTEGER,
        sheets          TEXT,
        width           INTEGER,
        height          INTEGER,
        encoding        TEXT,
        chars           INTEGER NOT NULL DEFAULT 0,
        chunk_count     INTEGER NOT NULL DEFAULT 0,
        project_shared  INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX idx_files_project ON files(project_id, created_at);
      CREATE INDEX idx_files_sha ON files(sha256);
      CREATE UNIQUE INDEX idx_files_workspace ON files(project_id, rel_path) WHERE origin = 'workspace';

      -- Extracted text, split into chunks agents read one at a time.
      CREATE TABLE file_chunks (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        idx     INTEGER NOT NULL,
        label   TEXT NOT NULL DEFAULT '',
        text    TEXT NOT NULL,
        UNIQUE (file_id, idx)
      );
      CREATE VIRTUAL TABLE file_chunks_fts USING fts5(
        text, content='file_chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER file_chunks_ai AFTER INSERT ON file_chunks BEGIN
        INSERT INTO file_chunks_fts(rowid, text) VALUES (new.id, new.text);
      END;
      CREATE TRIGGER file_chunks_ad AFTER DELETE ON file_chunks BEGIN
        INSERT INTO file_chunks_fts(file_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
      END;

      -- Where a file was used: chat message, task, run (session), direct instruction.
      CREATE TABLE file_links (
        file_id     TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK (target_type IN ('message','task','run','instruction')),
        target_id   TEXT NOT NULL,
        role        TEXT NOT NULL DEFAULT 'attached' CHECK (role IN ('attached','given','read','generated')),
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (file_id, target_type, target_id, role)
      );
      CREATE INDEX idx_file_links_target ON file_links(target_type, target_id);

      -- Deny by default: an agent reads a file only with a row here, a project-wide share,
      -- or through the task it is working on.
      CREATE TABLE file_access (
        file_id    TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        granted_by TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (file_id, agent_id)
      );
      CREATE INDEX idx_file_access_agent ON file_access(agent_id);
    `
  },
  {
    version: 8,
    sql: `
      -- Skills: instruction packages (SKILL.md + reference files / scripts) installed from GitHub, a .zip, a folder or a
      -- single .md, or written in the app. Files live in the database so backups, restore and reset include them.
      CREATE TABLE skills (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description TEXT NOT NULL DEFAULT '',
        source      TEXT NOT NULL DEFAULT '{}',          -- JSON SkillSource {type, location, subpath, ref}
        enabled     INTEGER NOT NULL DEFAULT 1,
        modified    INTEGER NOT NULL DEFAULT 0,          -- edited in the app after install
        has_scripts INTEGER NOT NULL DEFAULT 0,
        file_count  INTEGER NOT NULL DEFAULT 0,
        size        INTEGER NOT NULL DEFAULT 0,
        warnings    TEXT NOT NULL DEFAULT '[]',
        installed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE skill_files (
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        path     TEXT NOT NULL,                          -- relative, '/' separated; 'SKILL.md' at the root
        data     BLOB NOT NULL,
        size     INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (skill_id, path)
      );

      -- Who may use a skill: an agent directly, or every member of a unit and its sub-units (the root unit = everyone).
      CREATE TABLE skill_assignments (
        skill_id    TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL CHECK (target_type IN ('agent','unit')),
        target_id   TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (skill_id, target_type, target_id)
      );
      CREATE INDEX idx_skill_assign_target ON skill_assignments(target_type, target_id);
      CREATE TRIGGER skill_assign_agent_gone AFTER DELETE ON agents BEGIN
        DELETE FROM skill_assignments WHERE target_type = 'agent' AND target_id = old.id;
      END;
      CREATE TRIGGER skill_assign_unit_gone AFTER DELETE ON units BEGIN
        DELETE FROM skill_assignments WHERE target_type = 'unit' AND target_id = old.id;
      END;
    `
  },
  {
    version: 9,
    sql: `
      -- Apps: MCP servers the user connects (local program over stdio, or remote over HTTP, optionally OAuth).
      -- Environment variables, extra headers and OAuth state are encrypted with safeStorage.
      CREATE TABLE mcp_servers (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL UNIQUE COLLATE NOCASE,
        description  TEXT NOT NULL DEFAULT '',
        transport    TEXT NOT NULL CHECK (transport IN ('stdio','http')),
        command      TEXT NOT NULL DEFAULT '',
        args         TEXT NOT NULL DEFAULT '[]',
        cwd          TEXT NOT NULL DEFAULT '',
        env_keys     TEXT NOT NULL DEFAULT '[]',
        env_enc      BLOB,
        url          TEXT NOT NULL DEFAULT '',
        header_keys  TEXT NOT NULL DEFAULT '[]',
        headers_enc  BLOB,
        oauth        INTEGER NOT NULL DEFAULT 0,
        oauth_enc    BLOB,
        enabled      INTEGER NOT NULL DEFAULT 1,
        tools        TEXT NOT NULL DEFAULT '[]',
        tools_at     TEXT,
        server_name  TEXT,
        last_ok      INTEGER,
        last_message TEXT,
        last_at      TEXT,
        created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      -- Per-tool overrides (auto = no approval, approve = ask the user each time, block = never).
      CREATE TABLE mcp_tool_policies (
        server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
        tool      TEXT NOT NULL,
        policy    TEXT NOT NULL CHECK (policy IN ('auto','approve','block')),
        PRIMARY KEY (server_id, tool)
      );

      -- Deny by default: no row = the agent can't use the app.
      CREATE TABLE mcp_permissions (
        server_id  TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
        agent_id   TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        PRIMARY KEY (server_id, agent_id)
      );
      CREATE INDEX idx_mcp_perm_agent ON mcp_permissions(agent_id);
    `
  },
  {
    version: 10,
    sql: `
      -- Who sent an instruction: the user, or the project lead (a note to a running task from the lead's chat reply).
      ALTER TABLE agent_instructions ADD COLUMN source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user','lead'));
      -- The lead's chat context reads the latest report of recently finished tasks.
      CREATE INDEX IF NOT EXISTS idx_reports_task ON reports(task_id, created_at);
    `
  },
  {
    version: 11,
    sql: `
      -- Task dependencies: ids of tasks that must be done first (JSON array). The scheduler skips a task until they are.
      ALTER TABLE tasks ADD COLUMN depends_on TEXT NOT NULL DEFAULT '[]';
    `
  },
  {
    version: 12,
    sql: `
      -- How CLI agents work in the project folder: all in the folder itself, or each task in its own git worktree.
      ALTER TABLE projects ADD COLUMN isolation TEXT NOT NULL DEFAULT 'shared' CHECK (isolation IN ('shared','worktree'));
    `
  },
  {
    version: 13,
    sql: `
      -- OpenAI provider on an OpenAI-compatible endpoint (Gemini, Ollama, LM Studio…); '' = OpenAI itself.
      ALTER TABLE providers ADD COLUMN base_url TEXT NOT NULL DEFAULT '';
    `
  },
  {
    version: 14,
    sql: `
      -- Race mode: a challenger copy points at the original task; the lead's comparison marks the winner and the loser.
      ALTER TABLE tasks ADD COLUMN race_of TEXT;
      ALTER TABLE tasks ADD COLUMN race_result TEXT CHECK (race_result IN ('won','lost'));
      CREATE INDEX IF NOT EXISTS idx_tasks_race ON tasks(race_of);
    `
  },
  {
    version: 15,
    sql: `
      -- Semantic memory (optional): one embedding per memory, for the model it was made with (another model = re-embed).
      CREATE TABLE IF NOT EXISTS memory_vectors (
        memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
        model TEXT NOT NULL,
        vec BLOB NOT NULL
      );
    `
  },
  {
    version: 16,
    sql: `
      -- Acceptance criteria (one per line) and the lead's check of each at the last review (JSON [{text, met, note}]).
      ALTER TABLE tasks ADD COLUMN acceptance TEXT NOT NULL DEFAULT '';
      ALTER TABLE tasks ADD COLUMN acceptance_check TEXT;
    `
  },
  {
    version: 17,
    sql: `
      -- Graph memory: a memory replaced by a newer one stays as history but never reaches agents.
      ALTER TABLE memories ADD COLUMN superseded_by TEXT;
      -- Topics (graph nodes) and a memory's links: 'about' → topic:<id>, 'learned' → chat:<projectId>|<channel>.
      CREATE TABLE IF NOT EXISTS memory_topics (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );
      CREATE TABLE IF NOT EXISTS memory_links (
        memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        target TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('about','learned')),
        PRIMARY KEY (memory_id, target, kind)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target);
      -- What an agent learned from the user's chat message, waiting for the user's yes.
      CREATE TABLE IF NOT EXISTS memory_suggestions (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('preference','fact')),
        topics TEXT NOT NULL DEFAULT '[]',
        replaces TEXT,
        project_id TEXT,
        channel TEXT NOT NULL,
        agent_id TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      -- Memories that went into a run's prompt (JSON snapshot), for "What did this task know?".
      ALTER TABLE runs ADD COLUMN recalled TEXT;
    `
  },
  {
    version: 18,
    sql: `
      -- A database reached through an SSH connection (the app opens the tunnel), and the user's yes to a
      -- production database without TLS (audited; see ADR-029).
      ALTER TABLE connections ADD COLUMN via_ssh_id TEXT;
      ALTER TABLE connections ADD COLUMN allow_plaintext INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    version: 19,
    sql: `
      -- The target (route|host:port) an unencrypted yes was given for; another target = no yes (v18 yeses are asked again).
      ALTER TABLE connections ADD COLUMN plaintext_target TEXT;
    `
  },
  {
    version: 20,
    sql: `
      -- Project memory folder (<project>/.agentbits/memory): on for every project unless the user turns it off.
      ALTER TABLE projects ADD COLUMN project_memory INTEGER NOT NULL DEFAULT 1;
      -- A suggestion can be a note for a project memory file instead of a memory row: which file, what is done to it
      -- ('append' only) and, for a new file, the guide line saying when to read it.
      ALTER TABLE memory_suggestions ADD COLUMN target_file TEXT;
      ALTER TABLE memory_suggestions ADD COLUMN target_op TEXT;
      ALTER TABLE memory_suggestions ADD COLUMN target_note TEXT;
    `
  },
  {
    version: 21,
    sql: `
      -- Who marked a done task done: 'lead' (its review approved it / won the race) or 'user' (moved it by hand,
      -- without the lead's review). NULL = not done, or done before this column existed.
      ALTER TABLE tasks ADD COLUMN completed_by TEXT;
    `
  },
  {
    version: 22,
    sql: `
      -- Unsent message drafts, one per project + channel: the text and the ids of attachments whose upload finished
      -- (the files themselves stay in files). Kept across restarts; removed with the project.
      CREATE TABLE message_drafts (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        channel    TEXT NOT NULL,
        text       TEXT NOT NULL DEFAULT '',
        files      TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, channel)
      );
    `
  }
]

/** Newest schema version this build knows (backups from a newer build can't be restored). */
export const LATEST_SCHEMA = MIGRATIONS[MIGRATIONS.length - 1].version

/** The database's schema version (0 = new, empty file). */
export function schemaVersion(db: Database.Database): number {
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
  return has ? ((db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null }).v ?? 0) : 0
}

export function migrate(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`)
  const current = schemaVersion(db)
  // All pending steps in one transaction: a failure leaves the file at the version it had (the version its pre-upgrade
  // backup has), never halfway. No migration may use a statement SQLite refuses inside a transaction (VACUUM, some PRAGMAs).
  db.transaction(() => {
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(m.version)
    }
  })()
}
