# FireFlow – Yangın Hidrolik Simülatörü (Nuxt 3 + Supabase)

1. Veritabanı: `supabase/migrations/` altındaki dosyaları sırayla uygulayın (bkz. **Veritabanı geliştirme**).
2. `.env.example` → `.env` ve değerleri doldurun (anon key kullanın, service_role asla).
3. Geliştirme: `npm install && npm run dev`
4. Üretim: `docker compose up -d --build` → http://localhost:3000
5. Çözücü testi: `npm run test:solver`

Model varsayımları:
- Koyu tema (assets/css/main.css + tailwind.config.ts değişkenleri). Rapor: “Rapor (PDF)” yazdırma penceresini açar, “PDF olarak kaydet” seçin; CSV Excel (TR) uyumlu, ayraç `;`.

Plan 1 kare = 1 m; her düğümün kotu (z, m) var. Toplam yük H = P + z·0.0981 bar/m; boru boyu 3B (√(plan²+Δz²)).
- Sprinkler q = K·√P, hidrant sabit debi, su kaynağı sabit basınç (depo için 0 bar + kendi kotu).
- Pompa: from (emme) → to (basma) yönlü, çek valfli. Eğri H(Q) = h0 − r·Q², tasarım noktasından (Qd, Hd) ve kapalı vana basıncından (h0) türetilir.

## NFPA 13 kontrolü ve pompa eğrisi
- Sağ panelde tehlike sınıfı seçilir (yoğunluk mm/dk, tasarım alanı m², sprinkler alanı, hortum payı hazır gelir, “Özel” ile değişir).
- Kontroller: açık sprinkler alanı ≥ tasarım alanı, her açık sprinklerde q/alan ≥ yoğunluk, toplam talep (sprinkler + hortum payı).
- “Uzak alanı aç”: kaynağa en uzak sprinkler + en yakın komşuları (yaklaşık öneri). “Talep noktası”: pompasız sistemde gereken kaynak basıncını ve marjı hesaplar.
- Pompa: 2 nokta (n=2) veya 3 nokta (kapalı vana + tasarım + aşırı yük; n eğriden bulunur). NFPA 20 uyarıları: churn ≤ %140, %150 debide ≥ %65 basınç.
- Testler: `npm run test:solver`

## Şebeke test eğrisi ve tema
- Su kaynağı düğümünde “Şebeke testi” açılırsa kaynak basıncı debiyle düşer: P(Q) = Ps − (Ps − Pr)·(Q/Qt)^1.85 (Ps statik, Pr test debisi Qt'deki artık basınç). Test debisi aşılırsa eğri ekstrapole edilir ve uyarı verilir.
- Açık/koyu tema: başlıktaki güneş/ay düğmesi; tercih tarayıcıda saklanır (varsayılan koyu).

## Firmalar (çok kiracılı)
1. Şema `supabase/migrations/` altındaki migration'larla kurulur (firma, kilit, sürüm, realtime dahil).
2. Supabase Auth ayarlarında **Confirm email açık kalmalı** (davetler yalnızca doğrulanmış e-postaya uygulanır).
3. Roller: **OWNER** (her şey, rol/sahiplik), **ADMIN** (üye davet/çıkarma, firma projelerini düzenleme), **MEMBER**.
4. Firma üyeleri birbirinin profilini ve firma projelerini görür. Silme yalnızca proje sahibi ile OWNER/ADMIN'dedir.
5. **Proje kilidi** (`supabase/migrations/20261103212314_project_locks.sql`): firma projesini her üye düzenleyebilir, ama aynı anda yalnızca bir kişi. Projeyi açan kilidi alır (90 sn geçerli, açıkken 30 sn'de bir yenilenir; 10 dk hareketsizlikte bırakılır). Diğerleri salt okunur görür, kilit boşalınca “Düzenlemeye başla” ile devam eder; proje sahibi ve OWNER/ADMIN “Kilidi devral” diyebilir. Kilidini kaybeden kullanıcı kaydedilmemiş çalışmasını “Kopya oluştur” ile saklayabilir.
6. Tüm kurallar veritabanında RLS + SECURITY DEFINER fonksiyonlarla uygulanır; arayüz yalnızca yansıtır.

## Sürüm geçmişi, geri alma ve kısayollar
- **Sürüm geçmişi** (`20261103213426_project_versions.sql`, başlıktaki “Geçmiş”): her kayıtta veritabanı tetikleyicisi sürüm tutar. Aynı kişinin 10 dk içindeki düzenlemeleri tek sürümde birleşir, yalnızca yakınlaştırma/kaydırma sürüm oluşturmaz. Son 100 otomatik sürüm saklanır; “adlandırarak kaydet” ile oluşturulanlar silinmez. “Geri dön” şimdiki hâli de geçmişte bırakır (firma projesinde kilit gerekir).
- **Geri al / yinele**: Ctrl+Z, Ctrl+Y (veya Ctrl+Shift+Z); son 100 adım, oturum içinde. Sürüklemeler tek adım sayılır.
- **Araç kısayolları**: 1 Seç · 2 Boru · 3 Su kaynağı · 4 Pompa · 5 Bağlantı · 6 Sprinkler · 7 Hidrant · 8 Sil · Esc: çizimi bitir · Del: seçiliyi sil.
- **Etiketler**: çakışan etiketler önceliğe göre gizlenir (ad > basınç > debi > boru); yakınlaştırdıkça görünür. Seçili öğenin etiketleri her zaman gösterilir.

## Arka plan planı
- Başlıktaki “Plan”: PDF (sayfa seçilir), PNG, JPG veya WebP kat planı tuvalin altına yerleşir. Dosya tarayıcıda görsele çevrilir (en uzun kenar 4096 px, en çok 10 MB) ve özel `project-plans` Storage bucket'ına yüklenir; `grid_data` yalnızca yolu ve yerleşimi tutar.
- “Ölçekle”: ölçüsünü bildiğiniz iki noktaya tıklayıp gerçek mesafeyi (m) girin. “Taşı”, “Kilitle”, “Gizle”, saydamlık; “Değiştir” yeni revizyonu aynı yere aynı genişlikte koyar. Koyu temada plan renkleri ters çevrilir. Plan değişiklikleri Ctrl+Z ile geri alınır ve sürüm geçmişine girer.
- Yetki (`20261104185702_project_plans.sql`): planı projeyi görebilen herkes görür; yalnızca projeyi şu an yazabilen (kişisel projede sahibi, firma projesinde kilit sahibi) yükler. Dosyalar silinmez/değiştirilmez ki eski sürümler eski planı göstersin.

## Veritabanı geliştirme (Supabase CLI)
Gereken: Docker. CLI devDependency olarak gelir (`npx supabase`).
- `npm run db:start` — yerel Postgres + Auth + REST (portlar 554xx; başka yerel Supabase projesiyle çakışmaz), tüm migration'ları uygular.
- `npm run db:test` — `supabase/tests/database/*.test.sql` pgTAP testleri (firma RLS, düzenleme kilidi, sürüm geçmişi). Her dosya kendi işleminde çalışıp geri alınır; ortak kullanıcı/proje kurulumu `setup.psql`.
- `npm run db:reset` — yerel veritabanını sıfırdan kurar.
- `npm run db:types` — `types/database.types.ts` dosyasını yerel şemadan üretir; `useSupabaseClient()` bu tiplerle tiplidir. Migration ekledikten sonra çalıştırın.
- Yeni migration: `npx supabase migration new <ad>` → SQL'i yazın → `npm run db:reset && npm run db:test && npm run db:types`.
- Uzak projeye uygulama: `npx supabase login && npx supabase link --project-ref <ref>` → `npx supabase db push`.
