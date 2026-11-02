<script setup lang="ts">
import type { Member } from '~/composables/useCompany'
definePageMeta({ middleware: 'auth' })

const c = useCompany()
const user = useSupabaseUser()
const newName = ref(''), inviteEmail = ref(''), inviteRole = ref<'ADMIN' | 'MEMBER'>('MEMBER'), editName = ref('')
const info = ref('')
const busy = ref(false)

onMounted(async () => {
  await c.acceptInvites()
  await c.refresh()
  editName.value = c.company.value?.name ?? ''
})

const ROLE: Record<string, string> = { OWNER: 'Sahip', ADMIN: 'Yönetici', MEMBER: 'Üye' }
const me = computed(() => user.value?.id)
const canRemove = (m: Member) => m.id !== me.value && m.company_role !== 'OWNER' && (c.isOwner.value || (c.isAdmin.value && m.company_role === 'MEMBER'))
const onlyMe = computed(() => c.members.value.length <= 1)

async function act(fn: () => Promise<boolean>, ok = '') { busy.value = true; info.value = ''; if (await fn() && ok) info.value = ok; busy.value = false }
const create = () => act(() => c.createCompany(newName.value))
const doInvite = () => act(async () => { const r = await c.invite(inviteEmail.value, inviteRole.value); if (r) inviteEmail.value = ''; return r }, 'Davet oluşturuldu. Kişi bu e-posta ile kayıt olup giriş yaptığında firmaya otomatik katılır.')
const remove = (m: Member) => confirm(`${m.full_name || m.email} firmadan çıkarılsın mı?`) && act(() => c.removeMember(m.id))
const transfer = (m: Member) => confirm(`Firma sahipliği ${m.full_name || m.email} kişisine devredilsin mi? Siz yönetici olacaksınız.`) && act(() => c.transferOwnership(m.id))
const leave = () => confirm('Firmadan ayrılmak istiyor musunuz? Firma projelerine erişiminiz kalkar.') && act(() => c.leave())
const fmt = (d: string) => new Date(d).toLocaleDateString('tr-TR')
</script>

<template>
  <main class="mx-auto max-w-4xl px-4 py-8">
    <header class="mb-6 flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <NuxtLink to="/dashboard" class="btn" aria-label="Projelere dön"><Icon name="lucide:arrow-left" /></NuxtLink>
        <h1 class="brand text-3xl">Fir<b>ma</b></h1>
      </div>
      <ThemeToggle />
    </header>

    <p v-if="c.error.value" class="mb-4 rounded border border-red-600 px-3 py-2 text-sm text-red-600" role="alert">{{ c.error.value }}</p>
    <p v-if="info" class="mb-4 rounded border border-green-600 px-3 py-2 text-sm text-green-700" role="status">{{ info }}</p>
    <p v-if="!c.loaded.value" class="text-slate-500">Yükleniyor…</p>

    <!-- Firması olmayan kullanıcı -->
    <section v-else-if="!c.company.value" class="space-y-4">
      <form class="rounded-lg border border-slate-200 bg-white p-5" @submit.prevent="create">
        <h2 class="mb-1 font-semibold">Firma oluştur</h2>
        <p class="mb-3 text-sm text-slate-600">Firmayı siz oluşturursanız sahibi olursunuz. Mevcut kişisel projeleriniz firmaya taşınır ve üyeler tarafından görülebilir.</p>
        <div class="flex gap-2">
          <input class="input" v-model="newName" minlength="2" maxlength="100" required placeholder="Firma adı" aria-label="Firma adı" />
          <button class="btn btn-primary" :disabled="busy">Oluştur</button>
        </div>
      </form>
      <div class="rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <h2 class="mb-1 font-semibold">Davet aldınız mı?</h2>
        <p class="mb-3 text-slate-600">Davet, kayıt olduğunuz e-posta adresine tanımlanır ve e-postanız doğrulandıysa giriş yaptığınızda otomatik kabul edilir.</p>
        <button class="btn" :disabled="busy" @click="act(async () => { const ok = await c.acceptInvites(); if (!ok) info = 'Bu e-posta için bekleyen davet bulunamadı.'; return ok })">Daveti kontrol et</button>
      </div>
    </section>

    <!-- Firma -->
    <template v-else>
      <section class="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div v-if="c.isAdmin.value" class="flex items-end gap-2">
            <div><label class="label" for="cn">Firma adı</label><input id="cn" class="input" v-model="editName" minlength="2" maxlength="100" /></div>
            <button class="btn" :disabled="busy || editName.trim() === c.company.value.name" @click="act(() => c.rename(editName), 'Firma adı güncellendi.')">Kaydet</button>
          </div>
          <h2 v-else class="text-xl font-semibold">{{ c.company.value.name }}</h2>
          <button class="btn" :disabled="busy || (c.isOwner.value && !onlyMe)" :title="c.isOwner.value && !onlyMe ? 'Önce sahipliği devredin' : ''" @click="leave">Firmadan ayrıl</button>
        </div>
      </section>

      <section class="mb-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
        <h2 class="border-b border-slate-200 px-4 py-3 font-semibold">Üyeler ({{ c.members.value.length }})</h2>
        <ul class="divide-y divide-slate-200">
          <li v-for="m in c.members.value" :key="m.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium">{{ m.full_name || m.email }}<span v-if="m.id === me" class="ml-2 text-xs font-normal text-slate-500">(siz)</span></div>
              <div v-if="m.full_name" class="truncate text-sm text-slate-500">{{ m.email }}</div>
            </div>
            <template v-if="c.isOwner.value && m.id !== me && m.company_role !== 'OWNER'">
              <select class="input !w-auto" :value="m.company_role" :aria-label="`${m.email} rolü`" @change="act(() => c.setRole(m.id, ($event.target as HTMLSelectElement).value as 'ADMIN' | 'MEMBER'))">
                <option value="MEMBER">Üye</option><option value="ADMIN">Yönetici</option>
              </select>
              <button class="btn" :disabled="busy" @click="transfer(m)">Sahipliği devret</button>
            </template>
            <span v-else class="rounded-full border border-slate-300 px-2.5 py-0.5 text-xs">{{ ROLE[m.company_role] }}</span>
            <button v-if="canRemove(m)" class="btn" :disabled="busy" @click="remove(m)">Çıkar</button>
          </li>
        </ul>
      </section>

      <section v-if="c.isAdmin.value" class="rounded-lg border border-slate-200 bg-white p-5">
        <h2 class="mb-3 font-semibold">Üye davet et</h2>
        <form class="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto]" @submit.prevent="doInvite">
          <input class="input" type="email" v-model="inviteEmail" required placeholder="kisi@firma.com" aria-label="E-posta" />
          <select v-if="c.isOwner.value" class="input !w-auto" v-model="inviteRole" aria-label="Rol"><option value="MEMBER">Üye</option><option value="ADMIN">Yönetici</option></select>
          <button class="btn btn-primary justify-center" :disabled="busy">Davet et</button>
        </form>
        <p v-if="!c.invites.value.length" class="text-sm text-slate-500">Bekleyen davet yok.</p>
        <ul v-else class="divide-y divide-slate-200 text-sm">
          <li v-for="i in c.invites.value" :key="i.id" class="flex items-center gap-3 py-2">
            <span class="min-w-0 flex-1 truncate">{{ i.email }}</span>
            <span class="text-xs text-slate-500">{{ ROLE[i.role] }} · {{ fmt(i.created_at) }}</span>
            <button class="btn" :disabled="busy" @click="act(() => c.cancelInvite(i.id))">İptal</button>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>
