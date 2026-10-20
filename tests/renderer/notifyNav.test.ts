// Where a clicked notification goes; what changed since is said. Only screens open — the plan has no action field.
import './stubs/window'
import assert from 'node:assert/strict'
import { applyNav, planNav, type NavStore } from '@/lib/notifyNav'
import { done, step } from './kit'

const state = {
  projects: [
    { id: 'p1', status: 'active' },
    { id: 'old', status: 'archived' }
  ],
  tasks: [{ id: 't1', projectId: 'p1' }],
  agents: [{ id: 'a2' }],
  approvals: [{ id: 'ap1' }],
  activeRuns: [{ id: 'r1', status: 'awaiting_approval' }, { id: 'r2', status: 'running' }]
}

async function main(): Promise<void> {
  await step('one event opens its place: the task details, or the chat channel', () => {
    assert.deepEqual(planNav({ projectId: 'p1', view: 'task', taskId: 't1' }, state), { projectId: 'p1', tab: 'tasks', taskId: 't1' })
    assert.deepEqual(planNav({ projectId: 'p1', view: 'chat', channel: 'agent:a2' }, state), { projectId: 'p1', tab: 'chat', channel: 'agent:a2' })
  })
  await step("a group opens the project's list", () => {
    assert.deepEqual(planNav({ projectId: 'p1', view: 'tasks' }, state), { projectId: 'p1', tab: 'tasks' })
  })
  await step('approval still waiting: the task, no notice; answered meanwhile: the task and a notice', () => {
    assert.equal(planNav({ projectId: 'p1', view: 'task', taskId: 't1', approvalId: 'ap1' }, state).notice, undefined)
    assert.equal(planNav({ projectId: 'p1', view: 'task', taskId: 't1', runId: 'r1' }, state).notice, undefined)
    assert.deepEqual(planNav({ projectId: 'p1', view: 'task', taskId: 't1', approvalId: 'gone' }, state), { projectId: 'p1', tab: 'tasks', taskId: 't1', notice: 'approvalDone' })
    assert.equal(planNav({ projectId: 'p1', view: 'task', taskId: 't1', runId: 'r2' }, state).notice, 'approvalDone', 'the run started (approved) meanwhile')
    assert.deepEqual(planNav({ projectId: 'p1', view: 'tasks', approvalId: 'gone' }, state), { projectId: 'p1', tab: 'tasks', notice: 'approvalDone' }, 'an approval without a task')
    assert.deepEqual(planNav({ projectId: 'p1', view: 'tasks', approvalId: 'ap1' }, state), { projectId: 'p1', tab: 'tasks' })
  })
  await step('task deleted: the board and a notice; project deleted: nothing opens, a notice', () => {
    assert.deepEqual(planNav({ projectId: 'p1', view: 'task', taskId: 'x' }, state), { projectId: 'p1', tab: 'tasks', notice: 'taskGone' })
    assert.deepEqual(planNav({ projectId: 'gone', view: 'task', taskId: 't1' }, state), { projectId: null, notice: 'projectGone' })
  })
  await step('archived project: nothing opens on another project, a notice; a chat with a deleted agent → #general + a notice', () => {
    assert.deepEqual(planNav({ projectId: 'old', view: 'task', taskId: 't1' }, state), { projectId: null, notice: 'projectArchived' })
    assert.deepEqual(planNav({ projectId: 'p1', view: 'chat', channel: 'agent:gone' }, state), { projectId: 'p1', tab: 'chat', channel: 'general', notice: 'agentGone' })
  })
  await step('a click only opens screens (no field that could start, retry, approve or merge)', () => {
    const keys = new Set(['projectId', 'tab', 'taskId', 'channel', 'notice'])
    for (const plan of [planNav({ projectId: 'p1', view: 'task', taskId: 't1', runId: 'r1' }, state), planNav({ projectId: 'p1', view: 'tasks' }, state)])
      for (const k of Object.keys(plan)) assert.ok(keys.has(k), k)
  })
  // The handler, with a fake store: what it calls, in order.
  const fake = (over: Partial<NavStore> = {}): { store: NavStore; calls: string[] } => {
    const calls: string[] = []
    const store: NavStore = {
      ...state,
      activeProjectId: 'other',
      newTaskOpen: false,
      projectModal: { open: false },
      settingsOpen: false,
      closeSettings: () => void calls.push('closeSettings'),
      openProject: (id) => {
        calls.push(`openProject ${id}`)
        store.activeProjectId = id
      },
      setTab: (x) => void calls.push(`setTab ${x}`),
      setChatChannel: (c) => void calls.push(`setChatChannel ${c}`),
      selectTask: (id) => void calls.push(`selectTask ${id}`),
      toast: (_l, text) => void calls.push(`toast ${text}`),
      ...over
    }
    return { store, calls }
  }
  await step('the handler: Settings closes, the project opens, then its tab and the task (the project first: it resets them)', () => {
    const f = fake()
    applyNav({ projectId: 'p1', view: 'task', taskId: 't1' }, () => f.store)
    assert.deepEqual(f.calls, ['closeSettings', 'openProject p1', 'setTab tasks', 'selectTask t1'])
  })
  await step('a new-task or project dialog open: nothing switches under it (what was typed stays), a notice says why', () => {
    for (const over of [{ newTaskOpen: true }, { projectModal: { open: true } }]) {
      const f = fake(over)
      applyNav({ projectId: 'p1', view: 'task', taskId: 't1' }, () => f.store)
      assert.deepEqual(f.calls, ['toast layout:notifyNav.dialogOpen'])
    }
  })
  await step('Settings open (an unsaved provider form): nothing closes or switches, from the same project or another; nothing saved or tested', () => {
    for (const active of ['p1', 'other']) {
      // The form's input lives in the open Settings: closing Settings or switching the project would drop it.
      const draft = { apiKey: 'sk-typed', model: 'typed-model' }
      const f = fake({ settingsOpen: true, activeProjectId: active })
      f.store.closeSettings = () => void (f.calls.push('closeSettings'), (draft.apiKey = ''), (draft.model = ''))
      for (const target of [
        { projectId: 'p1', view: 'task', taskId: 't1' },
        { projectId: 'p1', view: 'chat', channel: 'general' },
        { projectId: 'p1', view: 'tasks' }
      ] as const)
        applyNav(target, () => f.store)
      assert.deepEqual(f.calls, Array(3).fill('toast layout:notifyNav.settingsOpen'), active)
      assert.equal(f.store.activeProjectId, active)
      assert.deepEqual(draft, { apiKey: 'sk-typed', model: 'typed-model' }, 'what was typed stays')
    }
  })
  await step('openProject refused (the project changed meanwhile): no tab or task opens on another project', () => {
    const f = fake()
    f.store.openProject = (id) => void f.calls.push(`openProject ${id}`) // refuses: the active project stays
    applyNav({ projectId: 'p1', view: 'chat', channel: 'general' }, () => f.store)
    assert.deepEqual(f.calls, ['closeSettings', 'openProject p1'])
  })
  done('notifyNav')
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
