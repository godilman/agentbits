# Agentbits — Veritabanı

Tek dosyalık gömülü SQLite (`better-sqlite3`). Kaynaklar: bağlantı `src/main/db/index.ts`, şema
`src/main/db/schema.ts`, sorgu katmanı `src/main/db/repos.ts`. Başlangıç verisi (seed) yoktur.

> Şema değiştiğinde (yeni migration, tablo, sütun, ayar anahtarı) bu belgeyi güncelleyin.

## 1. Dosyanın yeri

| Durum | Yol |
|---|---|
| Varsayılan (Windows) | `%APPDATA%\Agentbits\agentbits.db` (Electron `app.getPath('userData')`) |
| macOS / Linux | `~/Library/Application Support/Agentbits/` · `~/.config/Agentbits/` |
| Geçersiz kılma | `AGENTBITS_DATA_DIR` ortam değişkeni → `<dir>\agentbits.db` (klasör yoksa oluşturulur) |

WAL modu nedeniyle yanında `agentbits.db-wal` ve `agentbits.db-shm` dosyaları da bulunur. Yedek / sıfırlama
için uygulama **kapalıyken** üçünü birlikte kopyalayın / silin. Çalışan uygulamada yol Ayarlar → Genel'in
altında (`app:info` → `dbPath`) görünür.

Kurulum paketiyle yeni sürüm kurmak ya da uygulamayı kaldırmak bu klasöre dokunmaz (`nsis.deleteAppDataOnUninstall: false`);
yeni sürüm açılışta bekleyen migration'ları uygular. Yükseltilmiş bir DB'yi eski sürümle açmak desteklenmez.

**Pragmalar** (`openDb`): `journal_mode = WAL`, `foreign_keys = ON`, `synchronous = NORMAL`,
`busy_timeout = 5000`. Zaman damgaları ISO-8601 UTC metindir (`strftime('%Y-%m-%dT%H:%M:%fZ','now')` ya da
JS `new Date().toISOString()`).

## 2. Migration kuralları

```ts
const MIGRATIONS: { version: number; sql: string }[] = [ { version: 1, sql: `...` } ]
```

- `migrate(db)` önce `schema_migrations` tablosunu oluşturur, `MAX(version)`'dan büyük her migration'ı
  **kendi transaction'ında** çalıştırıp sürümünü kaydeder.
- **Yalnızca ekleyin.** Uygulanmış bir migration'ı (bugün: v1–v9) asla düzenlemeyin, silmeyin, yeniden
  numaralandırmayın — kullanıcı makinelerindeki DB'ler onu zaten çalıştırdı ve değişiklik oraya ulaşmaz.
- Yeni değişiklik = dizinin sonuna `{ version: N+1, sql: ... }`. SQLite'ta tipik olarak
  `ALTER TABLE x ADD COLUMN y ... NOT NULL DEFAULT ...`; sütun silme/CHECK değiştirme için tabloyu yeniden
  oluşturup veriyi kopyalayın. `CHECK (kind IN (...))` gibi kısıtları genişletmek de tablo yeniden kurmayı
  gerektirir.
- Migration sonrası eşzamanlı güncellenecekler: `src/shared/types.ts` (tip), `repos.ts` (`mapX`, `save` /
  `update` sütun haritaları, INSERT) ve bu belge.
- Başlangıç verisi yoktur; mevcut DB'lere veri eklemek gerekiyorsa bunu migration içinde yapın.

### Migration geçmişi

| Sürüm | Tarih | İçerik |
|---|---|---|
| 1 | 2026-10-12 | İlk şema: aşağıdaki tüm tablolar, FTS5 sanal tablosu ve trigger'lar |
| 2 | 2026-10-12 | `agents.job_description TEXT NOT NULL DEFAULT ''`, `agents.skills TEXT NOT NULL DEFAULT '[]'` (`ALTER TABLE ... ADD COLUMN`; mevcut v1 DB'ler sorunsuz yükseltilir) |
| 3 | 2026-10-12 | Organizasyon ve projeler: `units`, `unit_members`, `projects`, `project_units` tabloları; `tasks`, `runs`, `messages`, `decisions`, `reports`, `memories` tablolarına `project_id` + indeksler. Eski satırların bağlanması migration'da değil, her açılışta çalışan idempotent `ensureOrgDefaults()`'ta (§4). v2→v3 hem mevcut hem boş DB'de doğrulandı |
| 4 | 2026-10-13 | `projects.last_opened_at TEXT` (NULL = hiç açılmadı) — açılış proje seçicisinin "son açılan" sıralaması |
| 5 | 2026-10-13 | `agent_logs` yeniden kuruldu (CHECK değişikliği SQLite'ta ALTER ile yapılamaz; id'ler korunur): yeni seviyeler `prompt`, `instruction`, `status`; yeni sütunlar `project_id` (çalışma/görevden doldurulur) ve `meta`; indeksler `idx_logs_agent`, `idx_logs_created`. Yeni tablolar `token_usage` (v5 öncesi çalışmaların token/maliyeti `provider = 'legacy'` olarak taşındı) ve `agent_instructions` |
| 6 | 2026-10-13 | Bağlantılar (Faz 2): `connections`, `connection_permissions` (varsayılan hepsini reddet), `audit_log` |
| 7 | 2026-10-13 | Dosya ekleri (Faz 3): `files`, `file_chunks` + FTS5 `file_chunks_fts` (+ ai/ad trigger'ları), `file_links`, `file_access` (varsayılan reddet). Orijinaller DB'de değil, `<veri klasörü>/files/`'ta |
| 8 | 2026-10-13 | Skill'ler: `skills`, `skill_files` (dosyalar BLOB), `skill_assignments` (ajan / birim) + `idx_skill_assign_target`; ajan ya da birim silinince atamayı silen trigger'lar `skill_assign_agent_gone`, `skill_assign_unit_gone` |
| 9 | 2026-10-13 | Uygulamalar (MCP): `mcp_servers` (env/başlık/OAuth şifreli), `mcp_tool_policies`, `mcp_permissions` (varsayılan reddet) + `idx_mcp_perm_agent` |

## 3. Tablolar

### `schema_migrations`
| Sütun | Tip | Not |
|---|---|---|
| `version` | INTEGER PK | Uygulanan migration sürümü |
| `applied_at` | TEXT | Uygulanma zamanı |

### `settings`
Anahtar/değer; değerler **JSON kodlu** metindir (`JSON.stringify`). Bilinmeyen anahtarlar yok sayılır.

| Sütun | Tip |
|---|---|
| `key` | TEXT PK |
| `value` | TEXT NOT NULL |

Kullanılan anahtarlar (`AppSettings`, varsayılanlar `repos.ts` → `DEFAULT_SETTINGS`):

| Anahtar | Tip | Varsayılan | Anlam |
|---|---|---|---|
| `onboarded` | boolean | `false` | İlk açılış sihirbazı tamamlandı mı |
| `workspaceRoot` | string | `''` | **Eski ayar.** v3'ten beri klasör proje başınadır (`projects.root_path`). İlk v3 açılışında varsayılan projenin klasörü bundan alınır; sonra varsayılan projenin `rootPath`'i kaydedildikçe (`projects:save`, Onboarding) bununla senkron tutulur |
| `autopilot` | boolean | `true` | Boştaki ajanlar `todo` görevleri kendiliğinden alır |
| `reviewByLead` | boolean | `true` | Biten görevleri lider inceler |
| `language` | `string` | `'auto'` | Arayüz dili: `'auto'` (işletim sistemi dili; desteklenmiyorsa İngilizce) ya da dil kodu (`'en'`, `'tr'`). Ayarlar → Genel → Dil ve Onboarding ilk adımı yazar; değişince main dokunulmamış varsayılan adları yeni dile çevirir (`relabelDefaults`) |
| `startupProjects` | `'ask' \| 'restore'` | `'ask'` | Açılışta proje seçiciyi göster (`ask`) ya da son oturumun sekmelerini doğrudan aç (`restore`; geçerli sekme yoksa yine seçici). Seçicideki "Açılışta sorma…" kutusu ve Ayarlar → Genel → "Açılışta" yazar |
| `orchestrator.held` | string[] (JSON) | `[]` | İç durum (`AppSettings`'te yok): otopilotun almayacağı görevler — reddedilen, durdurulan, iki kez hata veren, uygulama kapanırken yarıda kalan, 4 inceleme turunu dolduran. Elle başlatma / "Yapılacak"a taşıma kaldırır; fabrika sıfırlaması temizler |
| `orchestrator.paused` | boolean | `false` | İç durum: "Tümünü duraklat" yeniden açılışta da geçerli |
| `logRetentionDays` | number | `30` | Bu kadar günden eski `agent_logs` satırları açılışta ve 6 saatte bir silinir (`startMaintenance`); `0` = süresiz |

### `providers`
| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID |
| `kind` | TEXT NOT NULL | CHECK `anthropic, openai, claude-cli, codex-cli, mock` |
| `label` | TEXT NOT NULL | Varsayılan etiketler `DEFAULT_LABELS` |
| `model` | TEXT NOT NULL DEFAULT `''` | Varsayılanlar: anthropic `claude-sonnet-5-5`, openai `gpt-5`, claude-cli `sonnet`, codex-cli `''`, mock `simulated` |
| `api_key_enc` | BLOB | `safeStorage` ile şifreli anahtar (bkz. §6) |
| `cli_path` | TEXT | Boşsa PATH'ten bulunur |
| `is_default` | INTEGER 0/1 | İlk eklenen otomatik varsayılan; `isDefault: true` kaydı diğerlerini 0'lar |
| `created_at` | TEXT | |

### `agents`
| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID |
| `name` | TEXT NOT NULL UNIQUE | `agentsRepo.save` büyük/küçük harf duyarsız çakışma kontrolü yapar ("Bu isimde bir ajan zaten var: <ad>"); UNIQUE kısıtı yedek güvence |
| `role` | TEXT DEFAULT `''` | Yeni ajanda `Engineer` |
| `persona` | TEXT DEFAULT `''` | "Çalışma tarzı" / kişilik (prompt'a girer) |
| `job_description` | TEXT NOT NULL DEFAULT `''` | *(v2)* İş tanımı: sorumluluklar, kapsam, çıktılar → `Agent.jobDescription` |
| `skills` | TEXT NOT NULL DEFAULT `'[]'` | *(v2)* Yetenek etiketleri, JSON string dizisi → `Agent.skills`; kayıtta kırpılır + tekilleştirilir |
| `provider_id` | TEXT FK → `providers(id)` ON DELETE SET NULL | NULL = varsayılan sağlayıcı |
| `model` | TEXT | NULL = sağlayıcının modeli |
| `color`, `hair`, `skin` | TEXT | Sprite renkleri (kıyafet `#6366f1`, saç `#3f2a1d`, ten `#f1c27d` varsayılan) |
| `desk_index` | INTEGER DEFAULT 0 | Yeni ajanda `MAX(desk_index)+1`; ofiste masa sırası |
| `status` | TEXT | CHECK `idle, working, break, error, offline` |
| `status_note` | TEXT | "TA-7", "Yazıyor…", "İnceleme · TA-3", "Onay bekliyor · TA-4", hata metni… |
| `is_lead` | INTEGER 0/1 | `isLead: true` kaydı diğerlerini 0'lar (tek lider) |
| `enabled` | INTEGER 0/1 | 0 → `offline` |
| `created_at`, `updated_at` | TEXT | |

Ajan oluşturulunca aynı transaction'da varsayılan `agent_permissions` satırı eklenir; `agents:save`'e üçüncü
argüman olarak `PermissionsPatch` verilirse (yeni ajan modalındaki yetki şablonu) izinler de aynı
transaction'da yazılır.

### `agent_permissions`
| Sütun | Tip | Varsayılan |
|---|---|---|
| `agent_id` | TEXT PK FK → `agents(id)` ON DELETE CASCADE | |
| `fs_read` | INTEGER 0/1 | 1 |
| `fs_write` | INTEGER 0/1 | 0 |
| `terminal` | INTEGER 0/1 | 0 |
| `network` | INTEGER 0/1 | 0 |
| `browser` | INTEGER 0/1 | 0 |
| `require_approval` | INTEGER 0/1 | 1 |
| `allowed_paths` | TEXT (JSON dizi) | `'[]'` |
| `updated_at` | TEXT | |

`permissionsRepo.get()` satır yoksa varsayılanla oluşturur. CLI bayraklarına eşleme için
[ARCHITECTURE.md §8.1](ARCHITECTURE.md#81-izin-matrisi--cli-bayrakları).

### `tasks`
| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID |
| `seq` | INTEGER NOT NULL UNIQUE | `MAX(seq)+1` |
| `key` | TEXT NOT NULL UNIQUE | `TA-<seq>` |
| `title` | TEXT NOT NULL | |
| `description` | TEXT DEFAULT `''` | |
| `status` | TEXT | CHECK `todo, in_progress, in_review, done` |
| `priority` | INTEGER DEFAULT 1 | CHECK 0–3 (Düşük/Normal/Yüksek/Acil) |
| `assignee_id` | TEXT FK → `agents(id)` ON DELETE SET NULL | NULL = otomatik |
| `progress` | INTEGER DEFAULT 0 | CHECK 0–100 |
| `sort_order` | REAL DEFAULT 0 | Sütun içi sıra; sürükle-bırakta komşuların ortalaması |
| `created_by` | TEXT DEFAULT `'user'` | `user` ya da ajan adı |
| `review_note` | TEXT | Liderin son inceleme notu |
| `created_at`, `updated_at`, `started_at`, `completed_at` | TEXT | |
| `project_id` | TEXT FK → `projects(id)` ON DELETE CASCADE | *(v3)* Görevin projesi. `TaskInput.projectId` verilmezse varsayılan proje. `seq`/`key` tüm projelerde ortak artar |

İndeksler: `idx_tasks_status (status, sort_order)`, `idx_tasks_assignee (assignee_id)`, `idx_tasks_project (project_id, status)`.
`tasksRepo.nextFor(agentId, exclude, assignedIn, unassignedIn)` — ajana atanmış görevleri `assignedIn`
projelerinden, atanmamışları yalnızca `unassignedIn` projelerinden seçer.
`tasksRepo.list(opts)` **cursor sayfalıdır**: sıralama `status, sort_order, seq`; `limit` varsayılan 50,
en fazla 200; `projectId` ve `status` ile süzülebilir; cursor `{status, sortOrder, seq}`'in base64url JSON'u; dönüş `{ items, nextCursor, total }`.
Main içi tam liste için `tasksRepo.listAll()`.

### `runs`
| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID |
| `task_id` | TEXT NOT NULL FK → `tasks(id)` ON DELETE CASCADE | |
| `agent_id` | TEXT NOT NULL FK → `agents(id)` ON DELETE CASCADE | |
| `status` | TEXT | CHECK `awaiting_approval, running, paused, succeeded, failed, cancelled` |
| `output` | TEXT | Nihai ajan çıktısı (inceleme bunu okur) |
| `error` | TEXT | |
| `tokens_in`, `tokens_out` | INTEGER DEFAULT 0 | |
| `cost_usd` | REAL DEFAULT 0 | Yalnızca Claude Code raporlar |
| `started_at`, `ended_at` | TEXT | |
| `project_id` | TEXT | *(v3, FK yok)* `runsRepo.create(taskId, agentId, status, projectId)` |

İndeksler: `idx_runs_status`, `idx_runs_task`. Açılışta yarım kalanlar `cancelled` yapılır (`cancelStale`).

### `messages`
| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID |
| `channel` | TEXT NOT NULL | `general` · `task:<taskId>` · `agent:<agentId>` |
| `sender_type` | TEXT | CHECK `user, agent, system` |
| `sender_id` | TEXT | Ajan id'si (kullanıcı/sistemde NULL) |
| `content` | TEXT NOT NULL | Markdown |
| `meta` | TEXT (JSON) | Şu an kullanılmıyor |
| `created_at` | TEXT | |
| `project_id` | TEXT | *(v3, FK yok)* Kanallar (`general`, `agent:<id>`, `task:<id>`) proje başınadır: aynı kanal adı her projede ayrı akıştır. `messagesRepo.create(channel, senderType, senderId, content, projectId, meta?)` |

İndeksler: `idx_messages_channel (channel, created_at)`, `idx_messages_project (project_id, channel, created_at)`.

### `agent_logs`
| Sütun | Tip | Not |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | Renderer tekilleştirme için artan id'ye güvenir |
| `run_id`, `agent_id`, `task_id` | TEXT | FK yok (log kalıcıdır) |
| `project_id` | TEXT | *(v5)* Transkriptin projesi; v5'te `runs`/`tasks`'tan dolduruldu |
| `level` | TEXT | CHECK `debug, info, warn, error, tool, output, prompt, instruction, status` (*v5*: `prompt` = ajana gönderilen prompt ve gönderen — lider/kullanıcı/sistem, inceleme kararları, sohbet; `instruction` = kullanıcının doğrudan talimatı; `status` = başladı/yönlendirildi/duraklatıldı/durduruldu/bitti işaretleri) |
| `message` | TEXT NOT NULL | Terminalde görünen satır |
| `meta` | TEXT (JSON) | *(v5)* Yapılandırılmış ek bilgi: `prompt` satırlarında tam `prompt` ve `system`, talimatta `mode` / `note` vb. |
| `created_at` | TEXT | |

İndeksler: `idx_logs_run`, `idx_logs_task`, `idx_logs_agent (agent_id, id)`, `idx_logs_created`. `agent_logs` ajan
terminallerinin **kalıcı transkriptidir**; `logRetentionDays` budaması bunları da siler. `logs:list` `beforeId` ile geriye sayfalar.

### `token_usage` *(v5)*
Model çağrısı / çalışma segmenti başına token kullanımı (`src/main/db/usage.ts` → `usageRepo`).

| Sütun | Tip | Not |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `agent_id` | TEXT NOT NULL | FK yok (ajan silinse de geçmiş kalır) |
| `run_id`, `task_id`, `project_id` | TEXT | Sohbet çağrılarında `run_id`/`task_id` boş olabilir |
| `mode` | TEXT | CHECK `task, chat, review` |
| `provider` | TEXT NOT NULL | Sağlayıcı türü; v5 öncesi taşınan satırlarda `legacy` |
| `model` | TEXT DEFAULT `''` | |
| `input`, `output`, `cache_read`, `cache_write` | INTEGER DEFAULT 0 | Codex yalnızca toplam bildirir → `input` |
| `cost_usd` | REAL DEFAULT 0 | Yalnızca Claude Code bildirir |
| `estimated` | INTEGER 0/1 | Demo sağlayıcının tahmini değerleri |
| `session_id` | TEXT NOT NULL | Uygulamanın bu açılışı (`APP_SESSION_ID`); taşınan satırlarda `legacy` |
| `created_at` | TEXT | |

İndeksler: `idx_usage_agent (agent_id, created_at)`, `idx_usage_task`, `idx_usage_session`, `idx_usage_project`.
`getStats` token sayıları bu tablodan gelir. Proje silinince **silinmez** (ajanların tüketim geçmişi; tüm zamanlar
toplamı doğru kalır); fabrika sıfırlaması siler.

### `agent_instructions` *(v5)*
Kullanıcının ajanlara doğrudan talimatları — geçmiş, kuyruk ve denetim kaydı (`instructionsRepo`).

| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID |
| `agent_id` | TEXT NOT NULL FK → `agents(id)` ON DELETE CASCADE | |
| `project_id`, `task_id`, `run_id` | TEXT | FK yok |
| `text` | TEXT NOT NULL | En fazla 8000 karakter (orkestratörde) |
| `mode` | TEXT | CHECK `redirect, queue, task` |
| `status` | TEXT | CHECK `queued, applied, started_task, cancelled, rejected` |
| `note` | TEXT | Neden/ne zaman ("İlk prompta eklendi", "Adım bitince uygulandı", "Çalışma durduruldu"…) |
| `created_at`, `applied_at` | TEXT | |

İndeksler: `idx_instructions_agent (agent_id, created_at)`, `idx_instructions_run (run_id, status)`. Açılışta
`queued` olanlar `cancelled` yapılır (`cancelStale`).

### `memories`
| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID |
| `agent_id` | TEXT FK → `agents(id)` ON DELETE CASCADE | NULL = ortak hafıza |
| `scope` | TEXT | CHECK `global, agent, task` (verilmezse: `task_id` → task, `agent_id` → agent, değilse global) |
| `kind` | TEXT | CHECK `fact, decision, context, preference, summary` |
| `content` | TEXT NOT NULL | En fazla 4000 karakter (`remember`) |
| `importance` | REAL DEFAULT 0.5 | 0–1; ≥0.9 olanlar her geri çağırmada sabitlenir |
| `source` | TEXT | `user`, `chat`, `review`, `run:<id>`, `decision:<id>` |
| `task_id` | TEXT | FK yok |
| `access_count` | INTEGER DEFAULT 0 | `recall` her seçişte artırır |
| `created_at`, `last_accessed_at` | TEXT | |
| `project_id` | TEXT | *(v3, FK yok)* NULL = **organizasyon geneli** (tüm projelerde geri çağrılır); dolu = yalnızca o proje. Geri çağırma: `project_id IS NULL OR project_id = <aktif proje>` |

İndeksler: `idx_memories_agent`, `idx_memories_project`.

### `memories_fts` (FTS5) ve trigger'lar
```sql
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
```
Harici içerikli (external content) FTS tablosudur: metin `memories`'te durur, indeks trigger'larla senkron
tutulur. `remove_diacritics 2` sayesinde "karar" / "kârar" gibi aksan farkları eşleşir. Skorlama için
[ARCHITECTURE.md §7](ARCHITECTURE.md#7-hafıza-motoru-srcmaincorememoryts).

### `decisions`
| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID |
| `seq` | INTEGER NOT NULL UNIQUE | `ADR-<seq>` |
| `title` | TEXT NOT NULL | |
| `context`, `decision`, `rationale` | TEXT DEFAULT `''` | |
| `status` | TEXT | CHECK `proposed, accepted, rejected, superseded` |
| `decided_by` | TEXT | Ajan adı ya da `Sen` |
| `task_id` | TEXT | FK yok |
| `created_at`, `updated_at` | TEXT | |
| `project_id` | TEXT | *(v3, FK yok)* Kararın projesi; `seq` (ADR numarası) tüm projelerde ortak |

İndeks: `idx_decisions_project`. `accepted`'a geçişte `decisions:save` handler'ı karar metnini önem **1.0** ile
kararın **projesinin** hafızasına yazar (`projectId` NULL ise organizasyon geneli).

### `reports`
| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID |
| `title` | TEXT NOT NULL | |
| `kind` | TEXT | CHECK `task, daily, custom` (`custom` henüz üretilmiyor) |
| `body_md` | TEXT NOT NULL | Markdown |
| `agent_id`, `task_id` | TEXT | FK yok |
| `created_at` | TEXT | |
| `project_id` | TEXT | *(v3, FK yok)* Günlük rapor proje bazlıdır (`reports:generateDaily(projectId)`) |

İndeks: `idx_reports_project`.

### `units` *(v3)*
Organizasyon ağacı; sınırsız iç içe.

| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID |
| `parent_id` | TEXT FK → `units(id)` ON DELETE CASCADE | NULL = kök ("Organizasyon"). Birim silinince alt birimleri de silinir (ajanlar kalır) |
| `name` | TEXT NOT NULL | Boş ad reddedilir |
| `kind` | TEXT DEFAULT `'team'` | CHECK `organization, company, department, team` |
| `description` | TEXT DEFAULT `''` | |
| `color` | TEXT DEFAULT `'#6366f1'` | |
| `lead_agent_id` | TEXT FK → `agents(id)` ON DELETE SET NULL | Lider atanınca üyelik otomatik eklenir; üyelikten çıkarılan lider temizlenir |
| `sort_order` | REAL DEFAULT 0 | Kardeşler arası sıra (`MAX+1`) |
| `created_at`, `updated_at` | TEXT | |

İndeks: `idx_units_parent`. Kurallar (`src/main/ipc.ts`): kök silinemez ve başka birimin altına taşınamaz;
bir birim kendi alt birimine taşınamaz (`wouldCycle`, `src/shared/org.ts`).

### `unit_members` *(v3)*
Çoka-çok: bir ajan birden çok birimde olabilir.

| Sütun | Tip | Not |
|---|---|---|
| `unit_id` | TEXT FK → `units(id)` ON DELETE CASCADE | PK (`unit_id`, `agent_id`) |
| `agent_id` | TEXT FK → `agents(id)` ON DELETE CASCADE | |
| `title` | TEXT DEFAULT `''` | Birim içi unvan ("Takım lideri", "Kıdemli analist"…); `addMember` mevcut üyede yalnızca unvanı günceller |
| `created_at` | TEXT | |

İndeks: `idx_unit_members_agent`.

### `projects` *(v3)*
| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID |
| `name` | TEXT NOT NULL | Boş ad reddedilir |
| `description` | TEXT DEFAULT `''` | |
| `root_path` | TEXT DEFAULT `''` | Proje klasörü = CLI ajanlarının çalışma dizini; boşsa CLI görevleri reddedilir. `projects:save` değiştiğinde doğrular (`assertUsableFolder`: var olmalı, klasör olmalı, Agentbits uygulama/depo klasörü olmamalı, başka projede kullanılmamalı); normalize edilmiş yol yazılır. DB düzeyinde benzersizlik kısıtı yok |
| `color` | TEXT DEFAULT `'#6366f1'` | Sekme noktası |
| `lead_agent_id` | TEXT FK → `agents(id)` ON DELETE SET NULL | Açık proje lideri (NULL = otomatik çözüm, bkz. ARCHITECTURE) |
| `status` | TEXT DEFAULT `'active'` | CHECK `active, archived`; otopilot yalnızca `active` projelerde çalışır |
| `is_default` | INTEGER 0/1 | Varsayılan proje (proje belirtilmeyen kayıtların düştüğü yer); `projectsRepo.defaultId()`, `projectsRepo.setDefault()`. Silinirse bayrak en son açılan diğer projeye geçer; tek kalan proje silinemez. Açılışta otomatik açılmaz (ADR-015) |
| `sort_order` | REAL DEFAULT 0 | |
| `last_opened_at` | TEXT | *(v4)* Projenin son açıldığı zaman; `projectsRepo.touch(ids)` / `projects:touch` (sekme açma, oturum geri yükleme) |
| `created_at`, `updated_at` | TEXT | |

Proje silme (`projectsRepo.delete`, tek transaction): projenin `runs`, `agent_logs` (proje ya da görevlerine ait),
`agent_instructions`, `tasks`, `messages`, `decisions`, `reports` ve `memories` satırları, ardından proje silinir;
`files` (ve basamaklanan `file_chunks` / `file_links` / `file_access`) FK ile silinir, sonra orijinaller için GC çalışır.
`token_usage` geçmiş olarak **korunur**.

### `project_units` *(v3)*
| Sütun | Tip | Not |
|---|---|---|
| `project_id` | TEXT FK → `projects(id)` ON DELETE CASCADE | PK (`project_id`, `unit_id`) |
| `unit_id` | TEXT FK → `units(id)` ON DELETE CASCADE | Atanan birimin **alt birimleri de** projeye dahildir |

`projects:save` `unitIds` verilirse bu tabloyu tamamen yeniden yazar. Proje üyeleri = atanan birimlerin ve
tüm alt birimlerinin üyeleri (`projectMemberIds`, `src/shared/org.ts`).

### `connections` *(v6)*
Ajanların kullanabileceği sunucular ve veritabanları — **organizasyon geneli** (projeler paylaşır). Erişim
`src/main/connections/repo.ts` + `service.ts` üzerinden.

| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID |
| `name` | TEXT NOT NULL | Uygulamada büyük/küçük harf duyarsız benzersiz (DB kısıtı yok) |
| `kind` | TEXT | CHECK `ssh, postgres, mysql, mssql`; oluşturulduktan sonra değiştirilemez |
| `env` | TEXT DEFAULT `'development'` | CHECK `development, staging, production`; Production'da `read` dışı işlemler kullanıcı onayı ister |
| `description`, `purpose`, `notes` | TEXT DEFAULT `''` | Açıklama, "Kullanım amacı", veri/sistem/servis notları — izinli ajanların prompt'una girer |
| `host`, `port`, `username`, `database` | TEXT / INTEGER | Port 0 = türün varsayılanı |
| `ssh_auth` | TEXT DEFAULT `'key-file'` | CHECK `key-file, key, password, agent` |
| `key_path` | TEXT | SSH anahtar dosyası yolu (dosya içeriği DB'ye yazılmaz) |
| `ssl`, `trust_server_cert` | INTEGER 0/1 | SSL / encrypt; sunucu sertifikasına güven |
| `ro_username` | TEXT | Salt-okunur DB girişi; ajan okumaları yalnızca bununla bağlanır (boşsa ajan okuması reddedilir) |
| `ssh_read`, `ssh_write`, `ssh_execute` | TEXT (JSON dizi) | Seviye başına SSH komut izin listeleri (`*` joker) |
| `secret_enc`, `ro_secret_enc` | TEXT | `safeStorage` ile şifreli sır (parola / yapıştırılmış anahtar / passphrase; salt-okunur parola), **base64** metin. Renderer'a gitmez (`hasSecret` bayrakları) |
| `host_key` | TEXT | SSH ana bilgisayar anahtarı parmak izi (SHA256, TOFU); değişirse bağlantı "Sıfırla"ya kadar reddedilir |
| `last_test_at`, `last_test_ok`, `last_test_message` | TEXT / INTEGER / TEXT | Son "Test" sonucu |
| `schema_json`, `schema_fetched_at` | TEXT | Şema önbelleği (`information_schema`, en fazla 4000 sütun) |
| `created_at`, `updated_at` | TEXT | |

### `connection_permissions` *(v6)*
Ajan × bağlantı erişim seviyesi. **Satır yoksa erişim yok** (deny-all).

| Sütun | Tip | Not |
|---|---|---|
| `connection_id` | TEXT FK → `connections(id)` ON DELETE CASCADE | PK (`connection_id`, `agent_id`) |
| `agent_id` | TEXT FK → `agents(id)` ON DELETE CASCADE | |
| `level` | TEXT | CHECK `none, read, write, execute, admin` (anlamları: [ARCHITECTURE §9b](ARCHITECTURE.md)) |
| `updated_at` | TEXT | |

İndeks: `idx_connperm_agent`.

### `audit_log` *(v6)*
Her bağlantı erişimi ve kritik değişiklik — kim, ne zaman, hangi görev, ne, sonuç.

| Sütun | Tip | Not |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | `audit:list` `beforeId` ile geriye sayfalar |
| `at` | TEXT | |
| `actor_type`, `actor_id`, `actor_name` | TEXT | CHECK `agent, user, system` |
| `connection_id`, `connection_name` | TEXT | FK yok — bağlantı silinse de kayıt adıyla kalır |
| `project_id`, `task_id`, `run_id` | TEXT | Ajan erişimlerinde bağlam |
| `action` | TEXT NOT NULL | ör. `list`, `schema`, `query`, `exec`, `query:approval`, bağlantı oluştur/güncelle/sil, `test`, izin değişikliği. Uygulamalar (v9): ajan çağrısı `app:<araç>`, kullanıcı işlemleri `app:create|update|delete|policy|permission` — `connection_id` o zaman `mcp_servers.id` |
| `detail` | TEXT | SQL / komut / değişen alan adları / eski → yeni seviye. **Sır değeri yazılmaz** (sır değiştiyse yalnızca bayrak) |
| `result` | TEXT | CHECK `ok, error, denied, pending` |
| `message`, `duration_ms` | TEXT / INTEGER | |

İndeksler: `idx_audit_at`, `idx_audit_conn (connection_id, at)`, `idx_audit_actor (actor_id, at)`. **Saklama süresi
yok:** log budaması (`logRetentionDays`), proje temizliği/silmesi ve "Sadece çalışma verisini sil" denetim kaydına
dokunmaz; yalnızca "Her şeyi sıfırla" siler.

### `files` *(v7)*
Projeye ait dosya kayıtları: kullanıcının yüklediği, ajanın kaydettiği (`file_save`) ya da CLI ajanının proje klasöründe
değiştirdiği dosyalar (`src/main/files/repo.ts` → `filesRepo`, erişim `files/service.ts` üzerinden).

| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID; `fileRef` = ilk 8 onaltılık hane |
| `project_id` | TEXT FK → `projects(id)` ON DELETE CASCADE | |
| `name`, `ext`, `mime` | TEXT | Görünen ad (`safeFileName`), uzantı, MIME (varsayılan `application/octet-stream`) |
| `kind` | TEXT | CHECK `pdf, docx, xlsx, pptx, csv, text, markdown, json, image, other` (uzantı + sihirli bayt) |
| `size`, `sha256` | INTEGER / TEXT | Orijinal boyut ve SHA-256 (içerik-adresli depo anahtarı) |
| `origin` | TEXT | CHECK `user, agent, workspace` |
| `created_by_type`, `created_by_id` | TEXT | CHECK `user, agent`; ajan kimliği |
| `rel_path` | TEXT | `workspace` dosyalarında proje klasörüne göre yol (dosya kopyalanmaz) |
| `status`, `status_message` | TEXT | CHECK `processing, ready, partial, unsupported, failed`; açıklama (ör. "Kısmen okundu" — taranmış PDF) |
| `warnings`, `suspicious` | TEXT (JSON dizi) | Çıkarma uyarıları; talimat benzeri satırlar (`findSuspicious`) |
| `pages`, `sheets`, `width`, `height`, `encoding` | INTEGER / TEXT (JSON) / INTEGER / INTEGER / TEXT | PDF/PPTX sayfa, XLSX sayfa adları, görsel boyutu, metin kodlaması |
| `chars`, `chunk_count` | INTEGER | Çıkarılan karakter ve parça sayısı |
| `project_shared` | INTEGER 0/1 | 1 = projenin tüm ajanları okuyabilir (klasör dosyalarında 1) |
| `created_at`, `updated_at` | TEXT | |

İndeksler: `idx_files_project (project_id, created_at)`, `idx_files_sha`, benzersiz `idx_files_workspace (project_id,
rel_path) WHERE origin = 'workspace'`.

### `file_chunks` *(v7)* ve `file_chunks_fts`
| Sütun | Tip | Not |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | FTS `content_rowid` |
| `file_id` | TEXT FK → `files(id)` ON DELETE CASCADE | |
| `idx` | INTEGER | Parça sırası; UNIQUE (`file_id`, `idx`) |
| `label` | TEXT | "Sayfa 3", "Sayfa1 · satır 1–120", başlık… |
| `text` | TEXT NOT NULL | ~3500 karakterlik parça |

`file_chunks_fts`: harici içerikli FTS5 (`content='file_chunks'`, `unicode61 remove_diacritics 2`), `file_chunks_ai` /
`file_chunks_ad` trigger'larıyla senkron (parçalar güncellenmez, silinip yeniden yazılır). Arama `«…»` vurgulu snippet döner.

### `file_links` *(v7)*
Dosyanın nerede kullanıldığı (önizlemedeki "Kullanım" sekmesi; görev bağı erişim de verir).

| Sütun | Tip | Not |
|---|---|---|
| `file_id` | TEXT FK → `files(id)` ON DELETE CASCADE | PK (`file_id`, `target_type`, `target_id`, `role`) |
| `target_type` | TEXT | CHECK `message, task, run, instruction` |
| `target_id` | TEXT | FK yok |
| `role` | TEXT | CHECK `attached` (Eklendi), `given` (Prompta verildi), `read` (Okundu), `generated` (Üretildi) |
| `created_at` | TEXT | |

İndeks: `idx_file_links_target (target_type, target_id)`.

### `file_access` *(v7)*
Açık okuma izni — **varsayılan reddet**: ajan dosyayı yalnızca bu tablodaki satırla, `files.project_shared = 1` ile ya da
çalıştığı görevin `file_links` bağıyla okur.

| Sütun | Tip | Not |
|---|---|---|
| `file_id` | TEXT FK → `files(id)` ON DELETE CASCADE | PK (`file_id`, `agent_id`) |
| `agent_id` | TEXT FK → `agents(id)` ON DELETE CASCADE | |
| `granted_by` | TEXT DEFAULT `'user'` | İzni veren (kullanıcı ya da paylaşım akışı) |
| `created_at` | TEXT | |

İndeks: `idx_file_access_agent`.

### `skills` *(v8)*
Kurulu skill'ler (talimat paketleri). Ajanların `skills` sütunundaki yetenek etiketleriyle ilgisi yoktur.

| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID |
| `name` | TEXT NOT NULL UNIQUE COLLATE NOCASE | `SKILL.md` ön bilgisindeki `name` (yoksa türetilir, küçük harf + tire) |
| `description` | TEXT | Ajanın prompt'unda görünen açıklama |
| `source` | TEXT (JSON) | `SkillSource { type: 'github' \| 'zip' \| 'folder' \| 'md' \| 'created', location, subpath, ref }` — "Kaynaktan güncelle" bunu kullanır |
| `enabled`, `modified`, `has_scripts` | INTEGER 0/1 | Devre dışı skill kimseye gitmez; `modified` = kurulumdan sonra uygulamada düzenlendi |
| `file_count`, `size` | INTEGER | |
| `warnings` | TEXT (JSON dizi) | Kurulumdaki uyarılar (betik var, talimata benzeyen satırlar, atlanan dosyalar) |
| `installed_at`, `updated_at` | TEXT | |

### `skill_files` *(v8)*
`(skill_id, path)` PK; `path` göreli, `/` ayraçlı (`SKILL.md` kökte); `data` BLOB, `size`. Skill silinince basamaklanır.
Yedekler skill dosyalarını kendiliğinden içerir.

### `skill_assignments` *(v8)*
`(skill_id, target_type, target_id)` PK; `target_type` CHECK `agent, unit`. Birime atama alt birimlerin üyelerine de
ulaşır; kök birim = herkes. Ajan/birim silinince trigger'lar satırı siler.

### `mcp_servers` *(v9)*
Bağlı uygulamalar (MCP sunucuları).

| Sütun | Tip | Not |
|---|---|---|
| `id` | TEXT PK | UUID |
| `name` | TEXT NOT NULL UNIQUE COLLATE NOCASE | Araç adlarının öneki buradan türetilir (`app_<ad>__<araç>`) |
| `description` | TEXT | Ajanların gördüğü "ne için" açıklaması |
| `transport` | TEXT | CHECK `stdio, http` |
| `command`, `args` (JSON), `cwd` | TEXT | stdio |
| `env_keys` (JSON) / `env_enc` (BLOB) | | Ortam değişkeni **adları** açık, değerleri `safeStorage` ile şifreli (JSON nesne) |
| `url` | TEXT | http (Streamable HTTP; gerekirse SSE) |
| `header_keys` (JSON) / `headers_enc` (BLOB) | | Ek HTTP başlıkları; değerler şifreli |
| `oauth` | INTEGER 0/1 | Tarayıcıda OAuth girişi |
| `oauth_enc` | BLOB | Şifreli OAuth durumu: istemci kaydı, token'lar, PKCE doğrulayıcı, geri dönüş adresi |
| `enabled` | INTEGER 0/1 | Kapalıysa hiçbir ajan kullanamaz |
| `tools` (JSON), `tools_at`, `server_name` | | Son listelenen araçlar (`AppTool`: ad, açıklama, girdi şeması, `readOnly`/`destructive` ipuçları) |
| `last_ok`, `last_message`, `last_at` | | Son bağlantı denemesinin sonucu |
| `created_at`, `updated_at` | TEXT | |

### `mcp_tool_policies` *(v9)*
`(server_id, tool)` PK, `policy` CHECK `auto, approve, block`. Yalnızca varsayılandan farklı seçimler yazılır (varsayılan:
salt-okunur ve yıkıcı olmayan araç `auto`, diğerleri `approve`).

### `mcp_permissions` *(v9)*
`(server_id, agent_id)` PK (ikisi de basamaklı FK), `created_at`. **Varsayılan reddet:** satır yoksa ajan uygulamayı görmez.

### Dosya orijinalleri (DB dışı)
- Yüklenen ve `file_save` ile kaydedilen dosyaların baytları **içerik-adresli** saklanır:
  `<veri klasörü>/files/<sha256[0:2]>/<sha256>` (aynı içerik bir kez). `workspace` dosyaları kopyalanmaz (proje klasöründe
  kalır; yalnızca kayıt + çıkarılmış metin).
- Geçici klasörler: `<veri klasörü>/tmp/run-<id>` (Codex için görsel kopyaları, çalışma sonunda silinir),
  `<veri klasörü>/tmp/open` ("Aç" için adlı kopyalar). `startFiles()` açılışta `tmp`'yi temizler ve `processing`
  kalmış dosyaları yeniden işler.
- **Çöp toplama (`gcBlobs`):** canlı DB'de **ya da** `backups/` içindeki herhangi bir yedekte (salt-okunur açılır)
  başvurulan SHA'lar korunur, diğer orijinaller silinir. Proje silme, proje temizliğinde "Dosyalar", fabrika sıfırlaması,
  yedek silme ve yedek dönüşü (`deleteBackup` / en yeni 10 kuralı) sonrası çalışır.

## 4. İlk kurulum ve `ensureOrgDefaults()`

**Başlangıç verisi (seed) yoktur** (2026-10-13'te `seed.ts` kaldırıldı). Yeni bir DB'de ajan, takım, görev, karar ya da
mesaj oluşturulmaz; yalnızca aşağıdaki `ensureOrgDefaults()` kök birimi ve tek boş "Varsayılan Proje"yi kurar. Onboarding
bu projenin adını ve klasörünü sorar, ardından Kılavuz açılır. Eski sürümlerden kalan veritabanlarında `renameLegacyDefne()` (`core/legacy.ts`) açılışta **bir kez** "Defne" adlı
ajanı "Zeynep" yapar ve adı saklanan metinlerde (`messages`, `tasks`, `runs`, `agent_logs`, `memories`, `decisions`,
`reports`, `agent_instructions`, ajanın kendi alanları) değiştirir; Türkçe ekler uyarlanır ("Defne'ye" → "Zeynep'e"),
"Defneler" gibi başka kelimelere dokunulmaz. Dosyalar ve denetim kaydı değişmez. Zaten "Zeynep" adlı bir ajan varsa
yapılmaz. Bayrak: `settings` satırı `legacy.defneRenamed` (`AppSettings`'te görünmez); sonradan "Defne" adıyla
oluşturulan ajanlara dokunulmaz. Eski başlangıç ekibi (Atlas lider, Nehir, Zeki, Zeynep —
eski adıyla Defne —, Kaan) artık isteğe bağlı **"Çekirdek Ekip"** şablonudur (`templates.ts` → `core`). Eskiden seed'le
oluşturulmuş mevcut DB'lerdeki veriler olduğu gibi kalır.

**`ensureOrgDefaults()`** (`src/main/core/org.ts`) her açılışta çalışır, idempotenttir, tek
transaction'dır:

1. Kök birim yoksa "Organizasyon" (`kind = 'organization'`) oluşturur.
2. Hiç proje yoksa (v3'e ilk geçiş ya da boş DB): kök dışında bir birim varsa ilkini kullanır; yoksa ve ajan
   varsa **"Çekirdek Ekip"** takımını (lideri organizasyon lideri, üyeleri tüm mevcut ajanlar) kurar; ardından bu takımın atandığı
   **"Varsayılan Proje"**yi (`is_default = 1`, klasörü eski `settings.workspaceRoot`, lideri organizasyon
   lideri) oluşturur.
3. `tasks`, `runs`, `messages`, `decisions`, `reports` içinde `project_id IS NULL` olan satırları varsayılan
   projeye bağlar.
4. Göreve bağlı hafızalar (`task_id` dolu) görevin projesini alır; serbest hafızalar **organizasyon geneli**
   (`project_id = NULL`) kalır.

Bu yüzden v3 sonrası eski verinin bağlanması migration SQL'inde değil burada yapılır; aynı deseni ileride
"mevcut veriyi yeni yapıya taşıma" işlerinde kullanın.

## 5. Yedekler, geri yükleme ve sıfırlama (`src/main/core/maintenance.ts`)

**Yedek klasörü:** `<veri klasörü>\backups\` — yani varsayılan olarak `%APPDATA%\Agentbits\backups\`, ya da
`AGENTBITS_DATA_DIR\backups\`. Dosya adı `agentbits-<etiket>-<YYYY-MM-DD-HH-MM-SS>.db`. Etiketler: `yedek`
(elle), `geri-yukleme-oncesi`, `temizlik-oncesi`, `sifirlama-oncesi`. Klasördeki **her `*.db` dosyası** (adından
bağımsız) listelenir, geri yüklenebilir ve 10'luk sınır sayımına dahildir. En yeni **10** yedek tutulur, eskileri
her yeni yedekte silinir. Yedek `VACUUM INTO` ile açık DB'den alınır: tutarlı, sıkıştırılmış, tek dosya (WAL
gerekmez). Yedekler yalnızca veritabanını içerir — dosya kayıtları ve **çıkarılmış metin** dahil, ama dosya orijinallerinin
baytları değil: onlar `<veri klasörü>/files`'ta kalır ve bir yedek başvurduğu sürece GC tarafından silinmez (yedek
silinince serbest kalır). Proje klasörlerindeki dosyalar yedeklenmez.

**Geri yükleme** (`restoreBackup(name)`, `data:restoreBackup`):
1. Ad doğrulanır (`basename` ile aynı olmalı, `.db` ile bitmeli — yol geçişi yok) ve dosyanın ilk 16 baytı
   `SQLite format 3\0` olmalı.
2. Seçilen yedek `agentbits.db.restore` olarak kopyalanır (sonraki yedek dönüşü onu silebileceği için önce) ve
   doğrulanır: `PRAGMA integrity_check` = `ok`, `schema_migrations` / `settings` / `agents` / `tasks` tabloları var,
   şema sürümü bu sürümün bildiğinden yeni değil. Bozuk ya da daha yeni sürümden gelen yedek reddedilir (kopya silinir).
   Kopya yeniden başlatmaya kadar dosya orijinallerini çöp toplamadan korur.
3. Mevcut durum `geri-yukleme-oncesi` olarak yedeklenir (geri yükleme de geri alınabilir).
4. `stopMaintenance()`, `orchestrator.shutdown()`, `terminals.killAll()`, `closeDb()`; `-wal` ve `-shm` silinir,
   hazırlanan kopya `agentbits.db` yapılır.
5. `app.relaunch()` + `app.exit(0)`. Açılışta migration'lar çalışır; eski sürüm yedekler (ör. v2) otomatik
   yükseltilir ve `ensureOrgDefaults()` eksikleri tamamlar.

Elle geri yükleme (uygulama kapalıyken): `backups\` içindeki dosyayı `agentbits.db` adıyla veri klasörüne
kopyalayın ve yanındaki `agentbits.db-wal` / `agentbits.db-shm` dosyalarını silin.

**Temizlik** (açık DB içinde, tek transaction, ardından `wal_checkpoint(TRUNCATE)` + `VACUUM`):

| İşlem | Silinen |
|---|---|
| `clearProject(p, ['memories'])` | `memories WHERE project_id = p` (isteğe bağlı `kind = 'decision'` korunur) |
| `… ['messages']` | `messages WHERE project_id = p` |
| `… ['reports']` / `['decisions']` | projenin `reports` / `decisions` satırları |
| `… ['logs']` | projenin transkriptleri (`agent_logs`: proje, görev ya da çalışma eşleşmesi) + `queued` olmayan `agent_instructions` + bitmiş `runs` (projede koşan işler önce durdurulur) |
| `… ['tasks']` | yukarıdaki log/çalışma silmesi + `task:%` kanal mesajları + projenin `tasks` (kalan `runs` basamaklanır) |
| `… ['files']` | projenin `files` kayıtları (parçalar, bağlar, izinler basamaklanır) + GC; proje klasöründeki dosyalara dokunulmaz |
| `clearOrgMemory({ keepDecisions })` | `memories WHERE project_id IS NULL` (isteğe bağlı kararlar hariç) |
| `pruneLogs(days)` | `agent_logs WHERE created_at < şimdi − days` (`0` = tümü; yalnızca elle) |

**Sıfırlama** (`factoryReset`, önce otomatik yedek, sonra `orchestrator.resetRuntime()`):

| Mod | Silinen | Korunan |
|---|---|---|
| `work` ("Sadece çalışma verisini sil") | `agent_logs`, `agent_instructions`, `token_usage`, `file_access`, `file_links`, `file_chunks`, `files` (+ FTS rebuild, GC), `runs`, `messages`, `memories`, `decisions`, `reports`, `tasks`; ajan durumları `idle`/`offline`'a, `status_note` NULL | ajanlar, izinler, sağlayıcılar + API anahtarları, birimler, projeler, ayarlar, **bağlantılar, bağlantı izinleri, denetim kaydı, skill'ler ve atamaları, uygulamalar (MCP) ve izinleri** |
| `all` ("Her şeyi sıfırla") | `work`'tekilere ek olarak `mcp_permissions`, `mcp_tool_policies`, `mcp_servers` (şifreli değerleri ve OAuth token'larıyla), `skill_assignments`, `skill_files`, `skills`, `connection_permissions`, `connections` (şifreli sırlarıyla), `audit_log`, `project_units`, `projects`, `unit_members`, `units`, `agent_permissions`, `agents`, `providers` (API anahtarları), `settings`; terminaller kapatılır; ardından `ensureOrgDefaults()` → boş organizasyon + tek boş proje, Onboarding ve Kılavuz yeniden (proje klasörlerindeki dosyalara dokunulmaz) | `schema_migrations`, `backups\` klasörü |

Her iki modda `memories_fts` `'rebuild'` ile yeniden kurulur, `VACUUM` yapılır, tüm `*:changed` olayları
yayınlanır ve renderer pencereleri yeniden yüklenir.

## 6. API anahtarlarının ve bağlantı sırlarının saklanması

- `src/main/secrets.ts`: `encryptSecret()` → `safeStorage.encryptString()` (Windows DPAPI, macOS Keychain,
  Linux libsecret / kwallet). Gerçek şifreleme yoksa (`isEncryptionAvailable()` false ya da Linux `basic_text` /
  `unknown` arka ucu) **sır kaydedilmez**: kayıt "güvenli anahtar deposu yok" hatasıyla reddedilir. Eski sürümlerin
  `plain:` önekli base64 değerleri hâlâ okunur ve anahtar zinciri çalıştığında açılışta şifrelenir
  (`upgradePlainSecrets`, `core/legacy.ts`: `providers.api_key_enc`, `connections.secret_enc / ro_secret_enc`,
  `mcp_servers.env_enc / headers_enc / oauth_enc`). Testler için `AGENTBITS_ALLOW_PLAIN_SECRETS=1` eski base64'e izin
  verir (gerçek anahtarlarla kullanmayın).
- `decryptSecret()` yalnızca main'de, `providersRepo.getApiKey(id)` üzerinden çağrılır. Renderer'a giden
  `Provider` nesnesinde anahtar yoktur, yalnızca `hasKey: boolean`.
- Anahtar CLI sağlayıcılarına ortam değişkeni olarak (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`), HTTP
  sağlayıcılarına başlık olarak geçer. DPAPI kullanıcıya/makineye bağlıdır: DB dosyası başka bir
  makineye/kullanıcıya kopyalanırsa anahtarlar çözülemez (`null`) ve yeniden girilmelidir.
- **Bağlantı sırları** (parola, yapıştırılmış SSH anahtarı, passphrase, salt-okunur DB parolası) aynı
  `encryptSecret()` ile şifrelenip base64 metin olarak `connections.secret_enc` / `ro_secret_enc`'e yazılır; yalnızca
  `connections/service.ts` sürücüye verirken çözer. Renderer yalnızca `hasSecret` görür; UI'dan `''` siler,
  `undefined` korur. Sırlar prompt'lara, transkriptlere, denetim kaydına ve loglara yazılmaz; sürücü hataları
  `••••` ile maskelenir. Yedeklerde de şifreli durur (DPAPI: başka kullanıcı/makinede çözülemez).
- **Uygulama (MCP) sırları** — ortam değişkeni ve HTTP başlığı değerleri (`mcp_servers.env_enc` / `headers_enc`, JSON nesne)
  ve OAuth durumu (`oauth_enc`) — aynı `encryptSecret()` ile; yalnızca `apps/client.ts` bağlanırken çözer. Renderer yalnızca
  anahtar adlarını ve `signedIn` bayrağını görür; UI'da boş bırakılan değer eskisini korur.

## 7. İnceleme ipuçları

- DB'yi uygulama kapalıyken `sqlite3` CLI ya da *DB Browser for SQLite* ile açabilirsiniz.
- Temiz bir başlangıç için farklı bir `AGENTBITS_DATA_DIR` kullanmak, mevcut DB'yi silmekten daha güvenlidir.
- Uygulama içinden: Ayarlar → Veri yönetimi (kullanım, temizlik, yedek, sıfırlama) ve "Klasörü aç" (`data:openFolder`).
