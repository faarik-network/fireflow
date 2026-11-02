export type CompanyRole = 'OWNER' | 'ADMIN' | 'MEMBER'
export interface Member { id: string; email: string; full_name: string | null; company_role: CompanyRole }
export interface Invite { id: string; email: string; role: 'ADMIN' | 'MEMBER'; created_at: string }

/** Kullanıcının firması, üyeleri ve davetleri. Yetki kararlarını veritabanı (RLS) verir; buradaki rol yalnızca arayüzü şekillendirir. */
export function useCompany() {
  const client = useSupabaseClient<any>()
  const user = useSupabaseUser()

  const loaded = useState('company:loaded', () => false)
  const company = useState<{ id: string; name: string } | null>('company:data', () => null)
  const role = useState<CompanyRole | null>('company:role', () => null)
  const members = useState<Member[]>('company:members', () => [])
  const invites = useState<Invite[]>('company:invites', () => [])
  const error = useState('company:error', () => '')

  const isAdmin = computed(() => role.value === 'OWNER' || role.value === 'ADMIN')
  const isOwner = computed(() => role.value === 'OWNER')

  async function refresh() {
    const uid = user.value?.id
    if (!uid) return
    error.value = ''
    const { data: me, error: e1 } = await client.from('profiles').select('company_id, company_role').eq('id', uid).single()
    if (e1) { error.value = e1.message; return }
    if (!me.company_id) {
      company.value = null; role.value = null; members.value = []; invites.value = []
      loaded.value = true
      return
    }
    role.value = me.company_role as CompanyRole
    const [c, m] = await Promise.all([
      client.from('companies').select('id, name').eq('id', me.company_id).single(),
      client.from('profiles').select('id, email, full_name, company_role').eq('company_id', me.company_id).order('created_at')
    ])
    company.value = c.data
    members.value = (m.data ?? []) as Member[]
    if (isAdmin.value) {
      const { data } = await client.from('company_invites').select('id, email, role, created_at').is('accepted_at', null).order('created_at', { ascending: false })
      invites.value = (data ?? []) as Invite[]
    } else invites.value = []
    loaded.value = true
  }

  /** Bir işlemi çalıştır, hatayı mesaja çevir, başarıda yenile */
  async function run(fn: () => PromiseLike<{ error: { message: string; code?: string } | null }>, map: Record<string, string> = {}) {
    error.value = ''
    const { error: e } = await fn()
    if (e) { error.value = (e.code && map[e.code]) || e.message; return false }
    await refresh()
    return true
  }

  /** Giriş sonrası: e-postama gelmiş bir davet varsa kabul et. Katıldıysa true. */
  async function acceptInvites() {
    const { data } = await client.rpc('accept_invite')
    if (data) { await refresh(); return true }
    return false
  }

  const createCompany = (name: string) => run(() => client.rpc('create_company', { p_name: name.trim() }))
  const rename = (name: string) => run(() => client.from('companies').update({ name: name.trim() }).eq('id', company.value!.id))
  const invite = (email: string, r: 'ADMIN' | 'MEMBER') =>
    run(() => client.from('company_invites').insert({ company_id: company.value!.id, email: email.trim().toLowerCase(), role: r, created_by: user.value!.id }),
      { '23505': 'Bu e-posta için bekleyen bir davet zaten var.' })
  const cancelInvite = (id: string) => run(() => client.from('company_invites').delete().eq('id', id))
  const setRole = (id: string, r: 'ADMIN' | 'MEMBER') => run(() => client.rpc('set_member_role', { p_member: id, p_role: r }))
  const removeMember = (id: string) => run(() => client.rpc('remove_member', { p_member: id }))
  const transferOwnership = (id: string) => run(() => client.rpc('transfer_ownership', { p_member: id }))
  const leave = () => run(() => client.rpc('leave_company'))

  return { loaded, company, role, members, invites, error, isAdmin, isOwner, refresh, acceptInvites, createCompany, rename, invite, cancelInvite, setRole, removeMember, transferOwnership, leave }
}
