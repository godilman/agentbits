// Test stand-in for '@/store/useAppStore': only the toast the drafts module uses.
export const toasts: { level: string; text: string }[] = []
export const useAppStore = { getState: () => ({ toast: (level: string, text: string) => void toasts.push({ level, text }) }) }
