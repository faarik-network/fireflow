export type Theme = 'dark' | 'light'

export function useTheme() {
  const theme = useState<Theme>('theme', () => 'dark')
  function apply(t: Theme) {
    theme.value = t
    if (!import.meta.client) return
    document.documentElement.dataset.theme = t
    try { localStorage.setItem('ff-theme', t) } catch { /* depolama kapalı olabilir */ }
  }
  /** Kayıtlı tercihi uygula (varsayılan koyu) */
  function init() {
    try {
      const s = localStorage.getItem('ff-theme')
      if (s === 'light' || s === 'dark') theme.value = s
    } catch { /* yoksay */ }
    document.documentElement.dataset.theme = theme.value
  }
  const toggle = () => apply(theme.value === 'dark' ? 'light' : 'dark')
  return { theme, toggle, init }
}
