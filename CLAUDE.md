# FireFlow – Claude için proje notları

Yangın söndürme hidrolik simülatörü: Nuxt 3, Pinia, Tailwind, Supabase (Auth, Postgres, RLS, Realtime, Storage). Arayüz ve kod yorumları Türkçe. Yol haritası ve açık işler için: `ROADMAP.md`.

## Çalışma kuralları

- Kullanıcıyla Türkçe konuş.
- **Commit'i kullanıcı atar.** İstemediği sürece commit atma.
- Uzak veritabanında DDL çalıştırmadan veya migration uygulamadan önce onay al.
- Yeni özellikte önce veritabanını (migration + RLS + test), sonra arayüzü yap.

## Komutlar

```bash
npm run dev            # localhost:3000 (uzak Supabase'e bağlanır, .env)
npx nuxi typecheck     # tip kontrolü – her değişiklikten sonra 0 hata olmalı
npm run test:solver    # hidrolik çözücü testleri
npm run db:start       # yerel Supabase (Docker), portlar 554xx
npm run db:test        # pgTAP RLS testleri
npm run db:reset       # yerel DB'yi migration'lardan sıfırdan kur
npm run db:types       # types/database.types.ts'i yerel şemadan üret
```

Yerel portlar bilerek 554xx. Makinedeki başka bir Supabase projesi (edunova) 543xx'i kullanıyor; onu durdurma.

## Yapı

- `stores/simulator.ts`: model (düğüm, boru, tasarım, `background`), geri al/yinele, `serialized` (bu değer `projects.grid_data` olarak saklanır). Ölçek: `GRID = 20` dünya birimi = 1 m.
- `components/HydraulicCanvas.vue`: canvas çizimi ve etkileşim (araçlar, pan/zoom, plan taşıma/ölçekleme).
- `utils/hydraulicSolver.ts`: ağ çözücü. `utils/nfpa.ts`: NFPA 13 tasarım kontrolü. `utils/report.ts`: CSV ve PDF rapor. `utils/planRaster.ts`: PDF/görseli plan görseline çevirir (pdfjs-dist).
- `pages/project/[id].vue`:
  - Yükleme ve 1,5 sn gecikmeli otomatik kayıt.
  - Kilit akışı (`composables/useProjectLock.ts`).
  - Realtime aboneliği.
  - Sürüm ve plan panelleri.
- `pages/dashboard.vue`: proje listesi, canlı "X düzenliyor" rozetleri.
- `middleware/auth.ts`: route koruması (`@nuxtjs/supabase` `redirect: false`).

## Veritabanı

- Migration'lar `supabase/migrations/<timestamp>_<ad>.sql`. Sürüm numaraları uzak projenin geçmişiyle birebir eşli (proje ref `bwtusmiaqaoasiyswpbm`).
- Yeni migration: `npx supabase migration new <ad>` → `npm run db:reset && npm run db:test && npm run db:types` → `npx nuxi typecheck`.
- **Uzağa uygulama (Supabase MCP):**
  1. `apply_migration` çalıştır. MCP kendi zaman damgasını yazar.
  2. Uzak geçmişteki sürümü yerel dosyanın numarasıyla eşle: `update supabase_migrations.schema_migrations set version = '<dosya no>' where name = '<ad>'`.
  3. Ardından `get_advisors` (security) çalıştır.
- **Yetki modeli:**
  - Firma projesini tüm üyeler görür.
  - Yazma koşulu: kişisel projede sahip; firma projesinde aktif kilidi tutan (`holds_project_lock`). Yardımcı fonksiyon: `can_write_project`.
  - Silme: proje sahibi veya OWNER/ADMIN.
  - Kilit RPC'leri: `acquire_project_lock`, `release_project_lock`.
- **SECURITY DEFINER fonksiyonlar:** `revoke ... from public, anon` + `grant ... to authenticated` deseni kullanılır.
- **Tetikleyiciler:**
  - `projects_before_write`: sahip ve firma değiştirilemez.
  - `projects_snapshot`: otomatik sürüm.
  - `projects_touch`: `updated_at`.
- **Storage:** `project-plans` bucket'ı özel. Yol `<project_id>/<uuid>.<ext>`. Yalnızca SELECT ve INSERT politikası var; dosyalar değiştirilmez ve silinmez, eski sürümler eski planı gösterir.
- **Realtime:** `project_locks` ve `projects` tabloları `supabase_realtime` yayınında. DELETE olayları süzülemez ve yalnızca PK taşır.

## Testler (pgTAP)

- `supabase/tests/database/setup.psql`:
  - Ortak kullanıcılar: A OWNER, B/C MEMBER, M ADMIN, D firmasız.
  - Ortak projeler: P firma projesi, Q kişisel.
  - Yardımcılar: `pg_temp.login(uuid)` ve `pg_temp.logout()`.
- Her `*.test.sql` dosyası `begin; \ir setup.psql; select plan(n); … select * from finish(); rollback;` iskeletini izler.
- Storage tablolarından doğrudan DELETE tetikleyiciyle engelli. Silinemezliği politika yokluğuyla test et.
- Testin işe yaradığını doğrulamak için kuralı yerelde geçici bozup testin kırıldığını gör, sonra `npm run db:reset`.

## Tipler

- `useSupabaseClient()` `types/database.types.ts` ile tipli; `<any>` kullanma.
- jsonb alanlar sınırda dönüştürülür: `grid_data` okurken `as Partial<GridData>`, yazarken `as unknown as NonNullable<Json>`.
- RPC jsonb dönüşleri için yerel tip tanımla (ör. `useProjectLock.ts` içindeki `LockResult`).

## Arayüzü görmek

Claude in Chrome bu ortamda çalışmıyor. Ekran görüntüsü için:

1. Kullanıcı `npm run dev` çalıştırır.
2. GEÇİCİ olarak dev'e özel bir `__preview` route'u ekle: `middleware/auth.ts` içinde bypass ve `pages/project/[id].vue` `onMounted` içinde erken dönüş. İkisini de `// GEÇİCİ` diye işaretle.
3. Ekran görüntüsü al: `chromium --headless=new --window-size=W,H --virtual-time-budget=10000 --screenshot=...`
4. Geçici kodu sil.
