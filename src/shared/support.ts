/**
 * Developer contact points. Fixed on purpose: not settings, never taken from the renderer
 * (main builds the URLs it opens from these constants only).
 */
export const SUPPORT_URL = 'https://buymeacoffee.com/godilman'
export const FEEDBACK_EMAIL = 'dilmangokhan@gmail.com'

export type FeedbackKind = 'idea' | 'bug' | 'thanks'
export const FEEDBACK_KINDS: FeedbackKind[] = ['idea', 'bug', 'thanks']
