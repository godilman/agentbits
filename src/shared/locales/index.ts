/**
 * Translation files. One folder per language, one JSON file per area (namespace).
 * English (`en`) is the reference: every other language must have exactly the same keys
 * (checked by `tests/i18n.test.ts`). To add a language: copy `en/` to `<code>/`, translate the values,
 * import the files below and add the language to `LANGUAGES` in `../i18n.ts`. See docs/I18N.md.
 */
import enCommon from './en/common.json'
import enLayout from './en/layout.json'
import enOnboarding from './en/onboarding.json'
import enGuide from './en/guide.json'
import enOrg from './en/org.json'
import enAgents from './en/agents.json'
import enConnections from './en/connections.json'
import enProject from './en/project.json'
import enChat from './en/chat.json'
import enOffice from './en/office.json'
import enTerminal from './en/terminal.json'
import enTasks from './en/tasks.json'
import enReports from './en/reports.json'
import enDecisions from './en/decisions.json'
import enFiles from './en/files.json'
import enSettings from './en/settings.json'
import enMain from './en/main.json'
import enSkills from './en/skills.json'
import enApps from './en/apps.json'
import enOrchestrator from './en/orchestrator.json'
import enTemplates from './en/templates.json'
import enDemo from './en/demo.json'
import trCommon from './tr/common.json'
import trLayout from './tr/layout.json'
import trOnboarding from './tr/onboarding.json'
import trGuide from './tr/guide.json'
import trOrg from './tr/org.json'
import trAgents from './tr/agents.json'
import trConnections from './tr/connections.json'
import trProject from './tr/project.json'
import trChat from './tr/chat.json'
import trOffice from './tr/office.json'
import trTerminal from './tr/terminal.json'
import trTasks from './tr/tasks.json'
import trReports from './tr/reports.json'
import trDecisions from './tr/decisions.json'
import trFiles from './tr/files.json'
import trSettings from './tr/settings.json'
import trMain from './tr/main.json'
import trSkills from './tr/skills.json'
import trApps from './tr/apps.json'
import trOrchestrator from './tr/orchestrator.json'
import trTemplates from './tr/templates.json'
import trDemo from './tr/demo.json'

export const NAMESPACES = ['common', 'layout', 'onboarding', 'guide', 'org', 'agents', 'connections', 'project', 'chat', 'office', 'terminal', 'tasks', 'reports', 'decisions', 'files', 'settings', 'main', 'skills', 'apps', 'orchestrator', 'templates', 'demo'] as const
export type Namespace = (typeof NAMESPACES)[number]

export const en = {
  common: enCommon,
  layout: enLayout,
  onboarding: enOnboarding,
  guide: enGuide,
  org: enOrg,
  agents: enAgents,
  connections: enConnections,
  project: enProject,
  chat: enChat,
  office: enOffice,
  terminal: enTerminal,
  tasks: enTasks,
  reports: enReports,
  decisions: enDecisions,
  files: enFiles,
  settings: enSettings,
  main: enMain,
  skills: enSkills,
  apps: enApps,
  orchestrator: enOrchestrator,
  templates: enTemplates,
  demo: enDemo
}

/** Same shape as `en` (enforced by the test, not the type, so a missing key falls back to English at runtime). */
export const tr: Record<Namespace, object> = {
  common: trCommon,
  layout: trLayout,
  onboarding: trOnboarding,
  guide: trGuide,
  org: trOrg,
  agents: trAgents,
  connections: trConnections,
  project: trProject,
  chat: trChat,
  office: trOffice,
  terminal: trTerminal,
  tasks: trTasks,
  reports: trReports,
  decisions: trDecisions,
  files: trFiles,
  settings: trSettings,
  main: trMain,
  skills: trSkills,
  apps: trApps,
  orchestrator: trOrchestrator,
  templates: trTemplates,
  demo: trDemo
}

export const resources = { en, tr }
