import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import type { Api, ApiMethod } from '@shared/ipc'
import { getDbPath } from './db'
import {
  agentsRepo,
  decisionsRepo,
  getStats,
  logsRepo,
  memoriesRepo,
  messagesRepo,
  permissionsRepo,
  projectsRepo,
  providersRepo,
  reportsRepo,
  runsRepo,
  settingsRepo,
  tasksRepo,
  unitsRepo
} from './db/repos'
import { wouldCycle } from '@shared/org'
import { instantiateTemplate, listTemplates } from './core/templates'
import { assertUsableFolder, folderStatus, inspectFolder } from './core/folders'
import {
  clearOrgMemory,
  clearProject,
  createBackup,
  dataUsage,
  deleteBackup,
  factoryReset,
  listBackups,
  openDataFolder,
  pruneLogs,
  restoreBackup
} from './core/maintenance'
import { emit } from './events'
import { applyLanguageSetting, currentLanguage, t } from './i18n'
import { FEEDBACK_EMAIL, FEEDBACK_KINDS, SUPPORT_URL, type FeedbackKind } from '@shared/support'
import { release } from 'os'
import { relabelDefaults } from './core/org'
import { memoryEngine } from './core/memory'
import { orchestrator } from './core/orchestrator'
import { usageSummary } from './core/usage'
import { auditRepo, connectionsRepo, connPermsRepo } from './connections/repo'
import { auditUser, listApprovals, refreshSchema, rejectApprovalsWhere, resolveApproval, testConnection } from './connections/service'
import { DEFAULT_PORT, LEVEL_LABEL, LEVEL_ORDER } from '@shared/connections'
import { instructionsRepo, usageRepo } from './db/usage'
import { getAdapter } from './providers'
import { which } from './providers/cli'
import { fetchLiveModels } from './providers/models'
import { skillsRepo } from './skills/repo'
import { installSkills, previewSkills, saveSkillMd, updateSkillFromSource } from './skills/source'
import { skillsForAgent } from './skills/service'
import { appsRepo } from './apps/repo'
import { auditAppUser, importCandidates, testApp } from './apps/service'
import { closeApp, signIn as signInApp, signOut as signOutApp } from './apps/client'
import { decodeText } from './files/extract'
import { terminals } from './terminal/manager'
import { filesRepo, originalPath } from './files/repo'
import { gcBlobs } from './files/storage'
import {
  addFromBytes,
  addFromPaths,
  attachToTask,
  deleteFile,
  detachFromTask,
  fileDetail,
  preview,
  setAccess,
  setProjectShared,
  shareFiles
} from './files/service'
import { MAX_FILES_PER_SEND, SAFE_OPEN_EXT, safeFileName } from '@shared/files'
import type { FileShare } from '@shared/types'

const focusedDialogWindow = (): BrowserWindow | undefined => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]

/** Feedback mail: subject + body template in the UI language; a bug report carries version, OS and language. */
function feedbackMailUrl(kind: FeedbackKind, rating?: number): string {
  const stars = typeof rating === 'number' && rating >= 1 && rating <= 5 ? Math.round(rating) : 0
  const subject = t(`main:feedback.subject.${kind}`) + (stars ? ` · ${'★'.repeat(stars)}${'☆'.repeat(5 - stars)} (${stars}/5)` : '')
  const env = t('main:feedback.environment', {
    version: app.getVersion(),
    os: `${process.platform} ${release()} (${process.arch})`,
    language: currentLanguage()
  })
  const body = kind === 'thanks' && stars ? t('main:feedback.body.thanksRated', { rating: stars }) : t(`main:feedback.body.${kind}`)
  const text = kind === 'bug' ? `${body}\n\n${env}` : body
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`
}

type Handlers = { [M in ApiMethod]: (...args: Parameters<Api[M]>) => ReturnType<Api[M]> | Promise<ReturnType<Api[M]>> }

const handlers: Handlers = {
  /* settings */
  'settings:get': () => settingsRepo.get(),
  'settings:update': (patch) => {
    const before = settingsRepo.get().language
    const s = settingsRepo.update(patch)
    if (patch.language !== undefined && patch.language !== before) {
      applyLanguageSetting(s.language)
      relabelDefaults()
      emit({ type: 'units:changed' })
      emit({ type: 'projects:changed' })
    }
    emit({ type: 'settings:changed' })
    return s
  },
  'app:pickFolder': async () => {
    const win = BrowserWindow.getFocusedWindow()
    const res = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0] ?? null
  },
  'app:info': () => ({ version: app.getVersion(), dbPath: getDbPath(), platform: process.platform }),
  // Always the system browser; the payment page is never loaded inside the app.
  'app:openSupport': () => shell.openExternal(SUPPORT_URL),
  // Fixed address; only the kind and the rating come from the renderer.
  'app:feedbackMail': (kind, rating) => {
    if (!FEEDBACK_KINDS.includes(kind)) throw new Error(t('main:feedback.badKind'))
    return shell.openExternal(feedbackMailUrl(kind, rating))
  },

  /* providers */
  'providers:list': () => providersRepo.list(),
  'providers:save': (input, id) => {
    const p = providersRepo.save(input, id)
    emit({ type: 'providers:changed' })
    return p
  },
  'providers:delete': (id) => {
    providersRepo.delete(id)
    emit({ type: 'providers:changed' })
    emit({ type: 'agents:changed' })
  },
  'providers:test': async (id) => {
    const p = providersRepo.get(id)
    if (!p) return { ok: false, message: t('main:errors.providerNotFound') }
    return getAdapter(p.kind).test(p, providersRepo.getApiKey(id))
  },
  'providers:detectCli': async () => ({ claude: await which('claude'), codex: await which('codex') }),
  'providers:models': ({ kind, providerId, apiKey }) =>
    fetchLiveModels(kind, apiKey?.trim() || (providerId ? providersRepo.getApiKey(providerId) : null)),

  /* agents */
  'agents:list': () => agentsRepo.list(),
  'agents:save': (input, id, permissions) => {
    const a = agentsRepo.save(input, id, permissions)
    if (input.enabled === false) agentsRepo.setStatus(a.id, 'offline')
    if (input.enabled === true && a.status === 'offline') agentsRepo.setStatus(a.id, 'idle')
    emit({ type: 'agents:changed' })
    emit({ type: 'permissions:changed' })
    return agentsRepo.get(a.id)!
  },
  'agents:delete': (id) => {
    if (agentsRepo.get(id)?.isLead) throw new Error(t('main:errors.leadCannotBeDeleted'))
    rejectApprovalsWhere({ agentId: id })
    agentsRepo.delete(id)
    emit({ type: 'agents:changed' })
    emit({ type: 'tasks:changed' })
    // memberships and unit/project leads cascade in the DB
    emit({ type: 'units:changed' })
    emit({ type: 'projects:changed' })
  },
  'agents:setStatus': (id, status) => {
    agentsRepo.setStatus(id, status)
    emit({ type: 'agents:changed' })
  },
  'permissions:list': () => permissionsRepo.list(),
  'permissions:update': (agentId, patch) => {
    const p = permissionsRepo.update(agentId, patch)
    emit({ type: 'permissions:changed' })
    return p
  },

  /* tasks */
  'tasks:list': (opts) => tasksRepo.list(opts),
  'tasks:create': (input) => {
    const { fileIds, ...rest } = input
    const t = tasksRepo.create(rest)
    if (fileIds?.length) attachToTask(t.id, fileIds)
    emit({ type: 'tasks:changed' })
    return t
  },
  'tasks:update': (id, patch) => {
    const t = tasksRepo.update(id, patch)
    emit({ type: 'tasks:changed' })
    return t
  },
  'tasks:move': (id, status, sortOrder) => {
    const before = tasksRepo.get(id)
    if (before?.status === 'in_progress' && status !== 'in_progress') orchestrator.stopTask(id)
    // Put back in the queue by the user (not a stop): autopilot may take it again.
    else if (status === 'todo' && before && before.status !== 'todo') orchestrator.release(id)
    const t = tasksRepo.move(id, status, sortOrder)
    emit({ type: 'tasks:changed' })
    if (status === 'in_progress' && before?.status !== 'in_progress') {
      tasksRepo.update(id, { status: before?.status ?? 'todo' })
      void orchestrator.startTask(id)
    }
    return tasksRepo.get(id) ?? t
  },
  'tasks:delete': (id) => {
    orchestrator.stopTask(id)
    tasksRepo.delete(id)
    emit({ type: 'tasks:changed' })
  },
  'tasks:start': (id) => {
    void orchestrator.startTask(id)
  },

  /* runs */
  'runs:list': (opts) => runsRepo.list(opts),
  'runs:pause': (id) => orchestrator.pauseRun(id),
  'runs:resume': (id) => orchestrator.resumeRun(id),
  'runs:stop': (id) => orchestrator.stopRun(id),
  'runs:approve': (id, ok) => orchestrator.approve(id, ok),
  'logs:list': (opts) => logsRepo.list(opts),
  'agents:instruct': (input) => orchestrator.instruct(input),

  /* connections */
  'connections:list': () => connectionsRepo.list(),
  'connections:save': (input, id) => {
    const before = id ? connectionsRepo.get(id) : null
    if (id && !before) throw new Error(t('main:connections.errors.notFound'))
    if (input.name !== undefined && !input.name.trim()) throw new Error(t('main:connections.errors.nameEmpty'))
    if (input.kind && !['ssh', 'postgres', 'mysql', 'mssql'].includes(input.kind)) throw new Error(t('main:connections.errors.invalidKind'))
    if (input.kind && before && input.kind !== before.kind) throw new Error(t('main:connections.errors.kindLocked'))
    if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)) throw new Error(t('main:connections.errors.invalidPort'))
    if (input.name) {
      const same = connectionsRepo.findByName(input.name)
      if (same && same.id !== id) throw new Error(t('main:connections.errors.nameTaken', { name: input.name.trim() }))
    }
    // Production databases go over TLS unless the server is on this computer (nothing crosses a network).
    const kind = input.kind ?? before?.kind
    const env = input.env ?? before?.env
    const host = (input.host ?? before?.host ?? '').trim().toLowerCase()
    const ssl = input.ssl ?? before?.ssl ?? false
    if (kind && kind !== 'ssh' && env === 'production' && !ssl && !/^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/.test(host)) {
      throw new Error(t('main:connections.errors.productionNeedsTls'))
    }
    const changed = Object.keys(input).filter((k) => !['secret', 'readOnlySecret'].includes(k))
    if (id) rejectApprovalsWhere({ connectionId: id })
    const c = connectionsRepo.save({ ...input, port: input.port ?? (id ? undefined : DEFAULT_PORT[input.kind ?? 'postgres']) }, id)
    // Host / user / key changes reset the pinned SSH host key only when asked explicitly.
    auditUser(
      c,
      id ? 'connection:update' : 'connection:create',
      [
        changed.length ? t('main:connections.audit.fields', { list: changed.join(', ') }) : '',
        input.secret !== undefined ? t('main:connections.audit.secretChanged') : '',
        input.readOnlySecret !== undefined ? t('main:connections.audit.readOnlySecretChanged') : ''
      ]
        .filter(Boolean)
        .join(' · '),
      'ok'
    )
    emit({ type: 'connections:changed' })
    return c
  },
  'connections:delete': (id) => {
    const c = connectionsRepo.get(id)
    if (!c) return
    rejectApprovalsWhere({ connectionId: id })
    connectionsRepo.delete(id)
    auditUser(c, 'connection:delete', `${c.kind} ${c.host}`, 'ok')
    emit({ type: 'connections:changed' })
  },
  'connections:test': (id) => testConnection(id),
  'connections:schema': (id, refresh) => (refresh ? refreshSchema(id) : connectionsRepo.schema(id)),
  'connections:permissions': () => connPermsRepo.list(),
  'connections:setPermission': (connectionId, agentId, level) => {
    const c = connectionsRepo.get(connectionId)
    const a = agentsRepo.get(agentId)
    if (!c || !a) throw new Error(t('main:connections.errors.connOrAgentNotFound'))
    if (!LEVEL_ORDER.includes(level)) throw new Error(t('main:connections.errors.invalidLevel'))
    const before = connPermsRepo.level(connectionId, agentId)
    if (before === level) return
    if (LEVEL_ORDER.indexOf(level) < LEVEL_ORDER.indexOf(before)) rejectApprovalsWhere({ connectionId, agentId })
    connPermsRepo.set(connectionId, agentId, level)
    auditUser(c, 'permission', `${a.name}: ${LEVEL_LABEL[before]} → ${LEVEL_LABEL[level]}`, 'ok')
    emit({ type: 'connections:changed' })
  },
  'approvals:list': () => listApprovals(),
  'approvals:resolve': (id, ok) => {
    const a = listApprovals().find((x) => x.id === id)
    resolveApproval(id, ok)
    if (a) auditUser(connectionsRepo.get(a.connectionId), ok ? 'approval:granted' : 'approval:denied', `${a.agentName}${a.taskKey ? ' · ' + a.taskKey : ''}: ${a.detail}`, ok ? 'ok' : 'denied')
  },
  'audit:list': (opts) => auditRepo.list(opts),
  /* apps (MCP) */
  'apps:list': () => appsRepo.list(),
  'apps:save': async (input, id) => {
    const name = input.name?.trim()
    if (!id && !name) throw new Error(t('main:apps.errors.nameRequired'))
    if (name !== undefined) {
      if (!name) throw new Error(t('main:apps.errors.nameRequired'))
      const other = appsRepo.byName(name)
      if (other && other.id !== id) throw new Error(t('main:apps.errors.nameTaken', { name }))
    }
    if (input.url !== undefined && input.url.trim() && !/^https?:\/\/[^\s]+$/i.test(input.url.trim())) throw new Error(t('main:apps.errors.badUrl'))
    if (id) {
      rejectApprovalsWhere({ connectionId: id })
      await closeApp(id)
    }
    const before = id ? appsRepo.get(id) : null
    const saved = appsRepo.save(input, id)
    // A different address / program means the old sign-in and tool list may not apply.
    if (before && (before.url !== saved.url || before.transport !== saved.transport)) appsRepo.setOAuth(saved.id, null)
    auditAppUser(saved, id ? 'app:update' : 'app:create', saved.transport === 'stdio' ? `${saved.command} ${saved.args.join(' ')}`.trim() : saved.url)
    emit({ type: 'apps:changed' })
    return saved
  },
  'apps:delete': async (id) => {
    const s = appsRepo.get(id)
    rejectApprovalsWhere({ connectionId: id })
    await closeApp(id)
    appsRepo.delete(id)
    if (s) auditAppUser(s, 'app:delete', s.name)
    emit({ type: 'apps:changed' })
  },
  'apps:test': async (id) => {
    const r = await testApp(id)
    emit({ type: 'apps:changed' })
    return r
  },
  'apps:signIn': async (id) => {
    try {
      await signInApp(id)
    } catch (e) {
      appsRepo.setStatus(id, false, (e as Error).message)
      emit({ type: 'apps:changed' })
      throw e
    }
    const r = await testApp(id)
    emit({ type: 'apps:changed' })
    return r
  },
  'apps:signOut': async (id) => {
    await signOutApp(id)
    emit({ type: 'apps:changed' })
  },
  'apps:setPolicy': (id, tool, policy) => {
    if (policy !== null && !['auto', 'approve', 'block'].includes(policy)) throw new Error(t('main:errors.badRequest'))
    rejectApprovalsWhere({ connectionId: id })
    appsRepo.setPolicy(id, tool, policy)
    const s = appsRepo.get(id)
    if (s) auditAppUser(s, 'app:policy', `${tool} → ${policy ?? 'default'}`)
    emit({ type: 'apps:changed' })
  },
  'apps:setPermission': (id, agentId, on) => {
    const s = appsRepo.get(id)
    const a = agentsRepo.get(agentId)
    if (!s || !a) throw new Error(t('main:apps.errors.notFound'))
    if (!on) rejectApprovalsWhere({ connectionId: id, agentId })
    appsRepo.setPermission(id, agentId, !!on)
    auditAppUser(s, 'app:permission', `${a.name}: ${on ? 'on' : 'off'}`)
    emit({ type: 'apps:changed' })
  },
  'apps:import': (source) => importCandidates(source),

  /* skills */
  'skills:list': () => skillsRepo.list(),
  'skills:get': (id) => {
    const skill = skillsRepo.get(id)
    if (!skill) throw new Error(t('main:skills.errors.notInstalled'))
    const md = skillsRepo.file(id, 'SKILL.md')
    return { skill, files: skillsRepo.files(id), skillMd: md ? decodeText(new Uint8Array(md)).text : '' }
  },
  'skills:file': (id, path) => {
    const f = skillsRepo.files(id).find((x) => x.path === path)
    if (!f || !f.text) throw new Error(t('main:skills.errors.notInstalled'))
    return decodeText(new Uint8Array(skillsRepo.file(id, path) ?? Buffer.alloc(0))).text.slice(0, 400_000)
  },
  'skills:preview': (source) => previewSkills(source),
  'skills:install': (stagingId, keys) => {
    const out = installSkills(stagingId, keys)
    emit({ type: 'skills:changed' })
    return out
  },
  'skills:saveMd': (content, id) => {
    const s = saveSkillMd(content, id)
    emit({ type: 'skills:changed' })
    return s
  },
  'skills:update': async (id) => {
    const s = await updateSkillFromSource(id)
    emit({ type: 'skills:changed' })
    return s
  },
  'skills:setEnabled': (id, enabled) => {
    skillsRepo.setEnabled(id, enabled)
    emit({ type: 'skills:changed' })
  },
  'skills:delete': (id) => {
    skillsRepo.delete(id)
    emit({ type: 'skills:changed' })
  },
  'skills:assign': (id, target, on) => {
    if (target.type === 'agent' ? !agentsRepo.get(target.id) : !unitsRepo.list().some((u) => u.id === target.id)) throw new Error(t('main:skills.errors.notInstalled'))
    skillsRepo.assign(id, target.type, target.id, on)
    emit({ type: 'skills:changed' })
  },
  'skills:forAgent': (agentId) => skillsForAgent(agentId, { includeDisabled: false }),
  'skills:pickSource': async (kind) => {
    const win = BrowserWindow.getFocusedWindow()
    const opts =
      kind === 'folder'
        ? { title: t('main:skills.dialogs.folder'), properties: ['openDirectory' as const] }
        : { title: t('main:skills.dialogs.file'), properties: ['openFile' as const], filters: [{ name: 'Skill', extensions: ['zip', 'md', 'markdown'] }] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  },
  'app:pickFile': async (title) => {
    const win = BrowserWindow.getFocusedWindow()
    const opts = { title: title ?? t('main:dialogs.pickFile'), properties: ['openFile' as const, 'showHiddenFiles' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : res.filePaths[0] ?? null
  },
  'instructions:list': (opts) => instructionsRepo.list(opts),
  'usage:summary': (projectId) => usageSummary(projectId),
  'usage:daily': (days, projectId) => usageRepo.daily(Math.max(1, Math.min(365, days)), projectId),

  /* organization */
  'units:list': () => unitsRepo.list(),
  'units:save': (input, id) => {
    const name = input.name?.trim()
    if (input.name !== undefined && !name) throw new Error(t('main:errors.unitNameEmpty'))
    if (id && input.parentId !== undefined) {
      const unit = unitsRepo.get(id)
      if (unit && !unit.parentId && input.parentId) throw new Error(t('main:errors.rootCannotMove'))
      if (wouldCycle(unitsRepo.list(), id, input.parentId)) throw new Error(t('main:errors.unitCycle'))
    }
    if (id && input.leadAgentId) {
      const unit = unitsRepo.get(id)
      if (unit && !unit.members.some((m) => m.agentId === input.leadAgentId)) unitsRepo.addMember(id, input.leadAgentId, t('main:defaults.teamLead'))
    }
    const u = unitsRepo.save(input, id)
    emit({ type: 'units:changed' })
    emit({ type: 'projects:changed' })
    return u
  },
  'units:delete': (id) => {
    const unit = unitsRepo.get(id)
    if (unit && !unit.parentId) throw new Error(t('main:errors.rootCannotDelete'))
    unitsRepo.delete(id)
    emit({ type: 'units:changed' })
    emit({ type: 'projects:changed' })
  },
  'units:addMember': (unitId, agentId, title) => {
    const u = unitsRepo.addMember(unitId, agentId, title)
    emit({ type: 'units:changed' })
    return u
  },
  'units:removeMember': (unitId, agentId) => {
    const u = unitsRepo.removeMember(unitId, agentId)
    emit({ type: 'units:changed' })
    return u
  },
  'templates:list': () => listTemplates(),
  'templates:instantiate': (templateId, opts) => {
    const r = instantiateTemplate(templateId, opts)
    emit({ type: 'units:changed' })
    emit({ type: 'agents:changed' })
    emit({ type: 'permissions:changed' })
    return r
  },

  /* projects */
  'projects:list': () => projectsRepo.list(),
  'projects:save': (input, id) => {
    if (input.name !== undefined && !input.name.trim()) throw new Error(t('main:errors.projectNameEmpty'))
    if (id && !projectsRepo.get(id)) throw new Error(t('main:errors.projectNotFoundDeleted'))
    // Validate the folder only when it changes (an existing project may point at a folder that is gone).
    if (input.rootPath) {
      const before = id ? projectsRepo.get(id)?.rootPath : undefined
      if (input.rootPath !== before) input = { ...input, rootPath: assertUsableFolder(input.rootPath, id) }
    }
    const p = projectsRepo.save(input, id)
    // Keep the legacy setting in sync for the default project (onboarding, older code paths).
    if (p.isDefault && input.rootPath !== undefined) settingsRepo.update({ workspaceRoot: p.rootPath })
    emit({ type: 'projects:changed' })
    return p
  },
  'projects:delete': async (id) => {
    const p = projectsRepo.get(id)
    if (!p) return
    // The default project can go too, as long as another project takes over its role
    // (records created without a project fall back to the default one).
    let heir: ReturnType<typeof projectsRepo.get> = null
    if (p.isDefault) {
      const others = projectsRepo.list().filter((x) => x.id !== id)
      if (!others.length) throw new Error(t('main:errors.onlyProject'))
      const byRecent = (a: typeof others[number], b: typeof others[number]): number => (b.lastOpenedAt ?? b.createdAt).localeCompare(a.lastOpenedAt ?? a.createdAt)
      heir = others.filter((x) => x.status === 'active').sort(byRecent)[0] ?? others.sort(byRecent)[0]
    }
    // Runs, chat replies and reviews of the project end before its rows go.
    await orchestrator.stopProject(id)
    if (heir) {
      projectsRepo.setDefault(heir.id)
      settingsRepo.update({ workspaceRoot: heir.rootPath })
      emit({ type: 'settings:changed' })
    }
    projectsRepo.delete(id) // attachments cascade; unreferenced originals are removed below
    try {
      gcBlobs()
    } catch {
      /* best effort */
    }
    emit({ type: 'files:changed' })
    emit({ type: 'projects:changed' })
    emit({ type: 'tasks:changed' })
    emit({ type: 'runs:changed' })
    emit({ type: 'decisions:changed' })
    emit({ type: 'reports:changed' })
    emit({ type: 'memory:changed' })
  },

  'projects:touch': (ids) => {
    projectsRepo.touch(ids)
    emit({ type: 'projects:changed' })
  },
  'projects:folderStatus': () => folderStatus(),
  'projects:inspectFolder': (path) => inspectFolder(path),

  /* chat */
  'messages:list': (channel, limit, projectId) => messagesRepo.list(channel, limit, projectId),
  'messages:send': (channel, content, projectId, opts) => {
    const fileIds = [...new Set(opts?.fileIds ?? [])]
    if (fileIds.length > MAX_FILES_PER_SEND) throw new Error(t('main:files.errors.tooManyPerMessage', { max: MAX_FILES_PER_SEND }))
    const files = filesRepo.byIds(fileIds)
    if (files.length !== fileIds.length) throw new Error(t('main:files.errors.attachmentMissing'))
    if (files.some((f) => f.projectId !== projectId)) throw new Error(t('main:files.errors.attachmentOtherProject'))
    const text = content.trim() || (files.length ? t('main:chat.filesOnly', { count: files.length }) : '')
    if (!text) throw new Error(t('main:errors.messageEmpty'))
    // Default recipients follow the channel: #general → lead, DM → that agent, task thread → the task.
    const share: FileShare =
      opts?.share ??
      (channel.startsWith('agent:') ? { type: 'agent', agentId: channel.slice(6) } : channel.startsWith('task:') ? { type: 'task', taskId: channel.slice(5) } : { type: 'lead' })
    const m = messagesRepo.create(
      channel,
      'user',
      null,
      text,
      projectId,
      files.length ? { files: files.map((f) => ({ id: f.id, name: f.name, kind: f.kind, size: f.size })), share } : undefined
    )
    if (files.length) shareFiles(projectId, fileIds, share, { type: 'message', id: m.id })
    emit({ type: 'message:new', message: m })
    orchestrator.handleUserMessage(channel, text, projectId, { messageId: m.id, fileIds })
    return m
  },

  /* attachments */
  'files:list': (opts) => {
    const list = filesRepo.list({ projectId: opts.projectId, origin: opts.origin, limit: opts.limit })
    let out = opts.taskId ? list.filter((f) => filesRepo.linkedTo('task', opts.taskId!).includes(f.id)) : list
    const q = opts.query?.trim().toLocaleLowerCase('tr')
    if (q) {
      const hitIds = new Set(filesRepo.search(q, out.map((f) => f.id), 200).map((h) => h.fileId))
      out = out.filter((f) => f.name.toLocaleLowerCase('tr').includes(q) || hitIds.has(f.id))
    }
    return out
  },
  'files:byIds': (ids) => filesRepo.byIds(ids.slice(0, 500)),
  'files:get': (id) => fileDetail(id),
  'files:pick': async () => {
    const win = focusedDialogWindow()
    const opts = { title: t('main:dialogs.addFiles'), properties: ['openFile' as const, 'multiSelections' as const] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? [] : res.filePaths.slice(0, MAX_FILES_PER_SEND)
  },
  'files:add': (projectId, paths) => addFromPaths(projectId, paths),
  'files:addData': (projectId, name, data) => addFromBytes(projectId, name, data),
  'files:delete': (id) => deleteFile(id),
  'files:preview': (id, offset, limit) => preview(id, offset, limit),
  'files:search': (projectId, query) => {
    const ids = filesRepo.list({ projectId, limit: 2000 }).map((f) => f.id)
    return filesRepo.search(query, ids, 50)
  },
  'files:saveAs': async (id) => {
    const f = filesRepo.get(id)
    if (!f) throw new Error(t('main:files.errors.notFound'))
    const src = originalPath(f)
    if (!src || !existsSync(src)) throw new Error(t('main:files.errors.originalGone'))
    const win = focusedDialogWindow()
    const opts = { title: t('main:dialogs.saveAs'), defaultPath: join(app.getPath('downloads'), safeFileName(f.name)) }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return null
    copyFileSync(src, res.filePath)
    return res.filePath
  },
  'files:open': async (id) => {
    const f = filesRepo.get(id)
    if (!f) throw new Error(t('main:files.errors.notFound'))
    if (!SAFE_OPEN_EXT.has(f.ext)) throw new Error(t('main:files.errors.unsafeOpen', { ext: f.ext || '?' }))
    const src = originalPath(f)
    if (!src || !existsSync(src)) throw new Error(t('main:files.errors.originalGoneShort'))
    let target = src
    if (f.origin !== 'workspace') {
      // Stored originals have no extension: open a named copy.
      const dir = join(dirname(getDbPath()), 'tmp', 'open', f.id)
      mkdirSync(dir, { recursive: true })
      target = join(dir, safeFileName(f.name))
      copyFileSync(src, target)
    }
    const err = await shell.openPath(target)
    if (err) throw new Error(err)
  },
  'files:reveal': (id) => {
    const f = filesRepo.get(id)
    const p = f ? originalPath(f) : null
    if (!f || f.origin !== 'workspace' || !p || !existsSync(p)) throw new Error(t('main:files.errors.revealWorkspaceOnly'))
    shell.showItemInFolder(p)
  },
  'files:setAccess': (id, agentId, allowed) => setAccess(id, agentId, allowed),
  'files:setProjectShared': (id, shared) => setProjectShared(id, shared),
  'files:attachToTask': (taskId, fileIds) => attachToTask(taskId, fileIds),
  'files:detachFromTask': (taskId, fileId) => detachFromTask(taskId, fileId),

  /* memory */
  'memory:list': (opts) =>
    opts?.query
      ? memoryEngine.search(opts.query, opts.limit, opts.projectId)
      : memoriesRepo.list({ agentId: opts?.agentId, limit: opts?.limit, projectId: opts?.projectId }),
  'memory:add': (content, kind, agentId, projectId) => {
    const m = memoryEngine.remember(content, kind, {
      agentId: agentId ?? null,
      projectId: projectId ?? null,
      importance: kind === 'preference' ? 0.9 : 0.6,
      source: 'user'
    })
    emit({ type: 'memory:changed' })
    return m
  },
  'memory:delete': (id) => {
    memoriesRepo.delete(id)
    emit({ type: 'memory:changed' })
  },

  /* decisions */
  'decisions:list': () => decisionsRepo.list(),
  'decisions:save': (input, id) => {
    const before = id ? decisionsRepo.get(id) : null
    const d = decisionsRepo.save(input, id)
    if (d.status === 'accepted' && before?.status !== 'accepted') {
      memoryEngine.remember(t('main:memory.decision', { seq: d.seq, title: d.title, decision: d.decision, rationale: d.rationale }), 'decision', {
        importance: 1,
        projectId: d.projectId,
        source: `decision:${d.id}`
      })
      emit({ type: 'memory:changed' })
    }
    emit({ type: 'decisions:changed' })
    return d
  },
  'decisions:delete': (id) => {
    decisionsRepo.delete(id)
    emit({ type: 'decisions:changed' })
  },

  /* reports */
  'reports:list': () => reportsRepo.list(),
  'reports:generateDaily': (projectId) => orchestrator.generateDailyReport(projectId),
  'reports:delete': (id) => {
    reportsRepo.delete(id)
    emit({ type: 'reports:changed' })
  },
  'stats:get': (projectId) => getStats(projectId),

  /* terminal */
  'terminal:list': () => terminals.list(),
  'terminal:create': (cwd) => terminals.create(cwd || projectsRepo.get(projectsRepo.defaultId())?.rootPath || undefined),
  'terminal:write': (id, data) => terminals.write(id, data),
  'terminal:resize': (id, cols, rows) => terminals.resize(id, cols, rows),
  'terminal:kill': (id) => terminals.kill(id),
  'terminal:buffer': (id) => terminals.buffer(id),

  /* data management */
  'data:usage': () => dataUsage(),
  'data:clearProject': (projectId, parts, opts) => clearProject(projectId, parts, opts),
  'data:clearOrgMemory': (opts) => clearOrgMemory(opts),
  'data:pruneLogs': (days) => {
    const r = pruneLogs(days)
    emit({ type: 'messages:changed' })
    return r
  },
  'data:backup': () => createBackup(),
  'data:listBackups': () => listBackups(),
  'data:deleteBackup': (name) => deleteBackup(name),
  'data:restoreBackup': (name) => {
    // Reply first; the app restarts right after.
    setTimeout(() => {
      try {
        restoreBackup(name)
      } catch (e) {
        emit({ type: 'toast', level: 'error', text: e instanceof Error ? e.message : String(e) })
      }
    }, 150)
  },
  'data:openFolder': () => openDataFolder(),
  'data:factoryReset': (mode) => {
    if (mode !== 'work' && mode !== 'all') throw new Error(t('main:errors.invalidResetMode'))
    return factoryReset(mode)
  },

  /* orchestrator */
  'orchestrator:pauseAll': () => orchestrator.pauseAll(),
  'orchestrator:resumeAll': () => orchestrator.resumeAll(),
  'orchestrator:state': () => ({ paused: orchestrator.isPaused })
}

/**
 * Only the app's own page may call the API: the top frame of an Agentbits window showing the bundled renderer
 * (file://…/renderer/index.html) or, in development, the Vite dev server. Web pages in the Browser section
 * (<webview>, own session, no preload) and sub-frames are refused.
 */
function trustedSender(e: Electron.IpcMainInvokeEvent): boolean {
  const frame = e.senderFrame
  if (!frame || frame !== e.sender.mainFrame) return false
  if (!BrowserWindow.fromWebContents(e.sender)) return false
  const url = frame.url
  if (url.startsWith('file://')) return /\/renderer\/index\.html(?:[?#].*)?$/.test(decodeURIComponent(url).replace(/\\/g, '/'))
  const dev = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && dev) {
    const origin = (u: string): string => new URL(u.replace('//localhost:', '//127.0.0.1:')).origin
    try {
      return origin(url) === origin(dev)
    } catch {
      return false
    }
  }
  return false
}

/** Basic runtime shape checks: TypeScript types don't exist at run time. Strings and arrays are size-limited. */
const MAX_ARG_STRING = 20 * 1024 * 1024
function checkArgs(method: string, args: unknown[]): void {
  if (args.length > 8) throw new Error(t('main:errors.badRequest'))
  const visit = (v: unknown, depth: number): void => {
    if (depth > 12) throw new Error(t('main:errors.badRequest'))
    if (typeof v === 'string') {
      if (v.length > MAX_ARG_STRING) throw new Error(t('main:errors.badRequest'))
    } else if (Array.isArray(v)) {
      if (v.length > 10_000) throw new Error(t('main:errors.badRequest'))
      for (const x of v) visit(x, depth + 1)
    } else if (v && typeof v === 'object' && !(v instanceof Uint8Array)) {
      for (const [k, x] of Object.entries(v)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new Error(t('main:errors.badRequest'))
        visit(x, depth + 1)
      }
    }
  }
  for (const a of args) visit(a, 0)
  // Methods that reach the file system, the shell or wipe data: exact argument types.
  const str = (i: number, optional = false): void => {
    const v = args[i]
    if (optional && (v === undefined || v === null)) return
    if (typeof v !== 'string') throw new Error(t('main:errors.badRequest'))
  }
  switch (method) {
    case 'terminal:create':
      return str(0, true)
    case 'terminal:write':
      str(0)
      str(1)
      if ((args[1] as string).length > 1_000_000) throw new Error(t('main:errors.badRequest'))
      return
    case 'terminal:kill':
    case 'terminal:buffer':
    case 'data:deleteBackup':
    case 'data:restoreBackup':
    case 'projects:inspectFolder':
      return str(0)
    case 'files:add':
      str(0)
      if (!Array.isArray(args[1]) || args[1].length > 50 || !args[1].every((x) => typeof x === 'string')) throw new Error(t('main:errors.badRequest'))
      return
    case 'files:addData':
      str(0)
      str(1)
      if (!(args[2] instanceof Uint8Array)) throw new Error(t('main:errors.badRequest'))
      return
  }
}

export function registerIpc(): void {
  ipcMain.handle('api', async (e, method: ApiMethod, ...args: unknown[]) => {
    if (!trustedSender(e)) throw new Error(t('main:errors.untrustedSender'))
    if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(handlers, method)) throw new Error(`Unknown API method: ${String(method)}`)
    checkArgs(method, args)
    const fn = handlers[method] as (...a: unknown[]) => unknown
    return fn(...args)
  })
}
