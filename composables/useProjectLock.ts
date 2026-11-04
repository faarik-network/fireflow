const RENEW_MS = 30_000 // sunucuda kilit 90 sn geçerli
const IDLE_MS = 10 * 60_000 // bu süre hareketsiz kalınırsa kilit bırakılır
const ACTIVITY = ['pointerdown', 'keydown', 'wheel'] as const

export type LockState = 'none' | 'held' | 'busy' | 'lost' | 'idle'
/** acquire_project_lock dönüşü (jsonb) */
type LockResult = { ok: boolean; required?: boolean; expires_at?: string; holder_name?: string | null }

/**
 * Firma projesi düzenleme kilidi. Asıl denetim veritabanında (RLS + acquire_project_lock);
 * burası kilidi alır, yeniler, hareketsizlikte/ayrılışta bırakır ve kaybedildiğini bildirir.
 */
export function useProjectLock(projectId: string, hooks: { beforeRelease?: () => Promise<void>; onLost?: (s: LockState) => void } = {}) {
  const client = useSupabaseClient()
  const state = ref<LockState>('none')
  const holder = ref('')
  let renewTimer: ReturnType<typeof setInterval> | undefined
  let lastActivity = Date.now()
  const touch = () => { lastActivity = Date.now() }

  function stopRenew() {
    clearInterval(renewTimer); renewTimer = undefined
    if (import.meta.client) ACTIVITY.forEach((e) => window.removeEventListener(e, touch))
  }
  function startRenew() {
    stopRenew()
    touch()
    ACTIVITY.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    renewTimer = setInterval(renew, RENEW_MS)
  }

  /** Kilidi al. Kişisel projede kilit gerekmez ve 'none' döner. */
  async function acquire(force = false): Promise<boolean> {
    const { data: raw, error } = await client.rpc('acquire_project_lock', { p_project: projectId, p_force: force })
    const data = raw as LockResult | null
    if (error || !data) { holder.value = ''; state.value = 'busy'; return false }
    if (data.ok) {
      holder.value = ''
      state.value = data.required ? 'held' : 'none'
      if (data.required) startRenew()
      return true
    }
    holder.value = data.holder_name ?? 'Başka bir kullanıcı'
    state.value = 'busy'
    return false
  }

  async function renew() {
    if (state.value !== 'held') return
    if (Date.now() - lastActivity > IDLE_MS) { await release('idle'); hooks.onLost?.('idle'); return }
    const { data: raw, error } = await client.rpc('acquire_project_lock', { p_project: projectId, p_force: false })
    const data = raw as LockResult | null
    if (error) return // ağ hatası: bir sonraki turda tekrar dene (kilit 90 sn geçerli)
    if (!data?.ok) lost(data?.holder_name ?? undefined)
  }

  /** Kaydetme sırasında kilidin elden gittiği anlaşılırsa çağrılır */
  function lost(name?: string) {
    if (state.value !== 'held') return
    stopRenew()
    holder.value = name ?? ''
    state.value = 'lost'
    hooks.onLost?.('lost')
  }

  async function release(next: LockState = 'none') {
    const had = state.value === 'held'
    stopRenew()
    if (!had) return
    await hooks.beforeRelease?.()
    if (state.value !== 'held') return // son kayıt sırasında kilidin kaybedildiği anlaşıldı
    state.value = next
    await client.rpc('release_project_lock', { p_project: projectId })
  }

  /** Salt okunurken: kilit şu an kimde? (süresi dolmuş kilitler RLS'te görünmez) */
  async function peek(): Promise<string | null> {
    const { data } = await client.from('project_locks')
      .select('user_id, holder:profiles!user_id(full_name,email)').eq('project_id', projectId).maybeSingle()
    if (!data) return null
    const h = data.holder as unknown as { full_name: string | null; email: string } | null
    return h?.full_name || h?.email || 'Başka bir kullanıcı'
  }

  onBeforeUnmount(stopRenew)

  return { state, holder, acquire, release, lost, peek }
}
