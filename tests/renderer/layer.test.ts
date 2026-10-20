// Overlay layers: Escape and focus follow what is painted on top, not just the opening order. The real Layer.ts on a
// tiny DOM (tests/renderer/stubs/dom.ts): z-index, focus and key events, no React rendering.
import { El, active, press } from './stubs/dom'
import assert from 'node:assert/strict'
import { openLayer } from '@/components/common/Layer'
import { done, step } from './kit'

/** A layer the way a component uses it: Escape → its onClose → it unmounts (unregisters, leaves the page). */
function layer(root: El, el: El, trap = true): { closed: () => boolean; close: () => void } {
  root.add(el)
  let shut = false
  let dispose = (): void => undefined
  const close = (): void => {
    if (shut) return
    shut = true
    el.connected = false
    dispose()
  }
  dispose = openLayer(el as unknown as HTMLElement, close, trap)
  return { closed: () => shut, close }
}
const dialog = (name: string, z: string): { box: El; panel: El; first: El } => {
  const first = new El(`${name}-close`, 'auto', true)
  const panel = new El(`${name}-panel`).add(first, new El(`${name}-field`, 'auto', true))
  return { box: new El(name, z).add(panel), panel, first }
}

async function main(): Promise<void> {
  await step('Settings open, then F1 opens the guide (under it): focus and the first Escape stay with Settings; then the guide', () => {
    const root = new El('root')
    const gear = new El('settings-button', 'auto', true)
    root.add(gear)
    gear.focus()
    const s = dialog('settings', '40')
    const settings = layer(root, s.box)
    assert.equal(active(), s.first, 'focus went into Settings')
    const g = new El('guide', '30').add(new El('guide-close', 'auto', true))
    const guide = layer(root, g)
    assert.ok(s.box.contains(active()), 'opening the guide under Settings did not take the focus')
    press('Tab')
    assert.ok(s.box.contains(active()), 'Tab stays in Settings')
    press('Escape')
    assert.ok(settings.closed() && !guide.closed(), 'the first Escape closed Settings, not the guide')
    assert.ok(g.contains(active()), 'then the guide (now on top) has the focus')
    press('Escape')
    assert.ok(guide.closed(), 'the second Escape closes the guide')
  })
  await step('guide beside the content, Settings opened, window narrowed (guide becomes an overlay): same order', () => {
    const root = new El('root')
    const gear = new El('settings-button', 'auto', true)
    root.add(gear)
    gear.focus()
    const s = dialog('settings', '40')
    const settings = layer(root, s.box)
    const g = new El('guide', '30').add(new El('guide-close', 'auto', true))
    const guide = layer(root, g) // the guide turning into a dialog under the open Settings
    assert.equal(active(), s.first)
    press('Escape')
    assert.ok(settings.closed() && !guide.closed())
    assert.ok(g.contains(active()))
    guide.close()
  })
  await step('the guide under Settings stops being a layer (window widened): the focus in Settings does not move', () => {
    const root = new El('root')
    const s = dialog('settings', '40')
    const settings = layer(root, s.box)
    const g = new El('guide', '30').add(new El('guide-close', 'auto', true))
    root.add(g)
    const unregister = openLayer(g as unknown as HTMLElement, () => undefined, true)
    const field = s.panel.kids[1]
    field.focus()
    unregister() // beside the content again: still on the page, no longer a layer
    assert.equal(active(), field, 'the user stays where they were in Settings')
    settings.close()
  })
  await step('New task → file preview on top (same level, opened later): Escape closes the preview, focus back on the chip', () => {
    const root = new El('root')
    const btn = new El('new-task-button', 'auto', true)
    root.add(btn)
    btn.focus()
    const m = dialog('new-task', '50')
    const chip = new El('file-chip', 'auto', true)
    m.panel.add(chip)
    const modal = layer(root, m.box)
    chip.focus()
    const p = dialog('preview', '50')
    const preview = layer(root, p.box)
    assert.equal(active(), p.first)
    press('Escape')
    assert.ok(preview.closed() && !modal.closed())
    assert.equal(active(), chip, 'focus back on the chip that opened the preview')
    press('Escape')
    assert.ok(modal.closed())
    assert.equal(active(), btn, 'focus back on "New task"')
  })
  await step('a confirm dialog in Settings and Settings close at once (parent first): focus goes back to the gear', () => {
    const root = new El('root')
    const gear = new El('settings-button', 'auto', true)
    root.add(gear)
    gear.focus()
    const st = dialog('settings', '40')
    const settings = layer(root, st.box)
    const ask = new El('delete-button', 'auto', true)
    st.panel.add(ask)
    ask.focus()
    const c = dialog('confirm', '50')
    const confirm = layer(root, c.box)
    settings.close() // React runs the parent's cleanup first; the dialog inside is going too
    confirm.close()
    assert.equal(active(), gear)
  })
  await step('a layer that only stops being one (the guide back beside the content) hands nothing over', () => {
    const root = new El('root')
    const guideBtn = new El('guide-button', 'auto', true)
    root.add(guideBtn)
    guideBtn.focus()
    const g = new El('guide', '30')
    const stepBtn = new El('project-settings-step', 'auto', true)
    g.add(stepBtn)
    root.add(g)
    const unregister = openLayer(g as unknown as HTMLElement, () => undefined, true)
    stepBtn.focus()
    const m = dialog('project-modal', '50')
    const modal = layer(root, m.box)
    unregister() // the window got wider: the guide is a side panel again, still on the page
    modal.close()
    assert.equal(active(), stepBtn, 'focus back on the step that opened it (still there), not on the guide button')
  })
  await step('a popover inside the top bar (z-20 parent) is under a dialog opened before it', () => {
    const root = new El('root')
    const s = dialog('settings', '40')
    const settings = layer(root, s.box)
    const bar = new El('top-bar', '20')
    root.add(bar)
    const pop = new El('needs-you', '50').add(new El('item', 'auto', true))
    const popover = layer(bar, pop, false)
    press('Escape')
    assert.ok(settings.closed() && !popover.closed(), 'its own z-50 counts as the bar\'s 20')
    popover.close()
  })
  done('layer')
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  }
)
