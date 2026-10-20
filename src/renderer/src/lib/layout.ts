/** The task board's four columns side by side (4 × 230 px + gaps + padding, `TasksView`). */
export const MAIN_MIN = 4 * 230 + 3 * 12 + 2 * 16
export const GUIDE_WIDTH = 380 // `GuideDrawer`
export const RAIL = 48

/**
 * Usable window width → layout. The side panel folds to its icon rail when the content beside it (and the guide, if
 * beside it) would get narrower than the board needs. The guide stays beside the content while the board still fits
 * next to it (the panel folded if need be); otherwise it opens over the content. Tests: `tests/renderer/layout.test.ts`.
 */
export function fitLayout(width: number, panelWidth: number, guideOpen: boolean): { folded: boolean; guideOverlay: boolean } {
  const fits = (side: number, guideBeside: boolean): boolean => width - side - (guideBeside ? GUIDE_WIDTH : 0) >= MAIN_MIN
  const guideOverlay = guideOpen && !fits(RAIL, true)
  return { folded: !fits(panelWidth, guideOpen && !guideOverlay), guideOverlay }
}
