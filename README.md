# FireFlow – Yangın Hidrolik Simülatörü (Nuxt 3 + Supabase)

1. Supabase SQL Editor'de `supabase/schema.sql` dosyasını çalıştırın.
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
1. `supabase/schema.sql` → ardından sırayla `supabase/migrations/002_companies.sql` ve `003_project_locks.sql` dosyalarını SQL Editor'de çalıştırın.
2. Supabase Auth ayarlarında **Confirm email açık kalmalı** (davetler yalnızca doğrulanmış e-postaya uygulanır).
3. Roller: **OWNER** (her şey, rol/sahiplik), **ADMIN** (üye davet/çıkarma, firma projelerini düzenleme), **MEMBER**.
4. Firma üyeleri birbirinin profilini ve firma projelerini görür. Silme yalnızca proje sahibi ile OWNER/ADMIN'dedir.
5. **Proje kilidi** (`supabase/migrations/003_project_locks.sql`): firma projesini her üye düzenleyebilir, ama aynı anda yalnızca bir kişi. Projeyi açan kilidi alır (90 sn geçerli, açıkken 30 sn'de bir yenilenir; 10 dk hareketsizlikte bırakılır). Diğerleri salt okunur görür, kilit boşalınca “Düzenlemeye başla” ile devam eder; proje sahibi ve OWNER/ADMIN “Kilidi devral” diyebilir. Kilidini kaybeden kullanıcı kaydedilmemiş çalışmasını “Kopya oluştur” ile saklayabilir.
6. Tüm kurallar veritabanında RLS + SECURITY DEFINER fonksiyonlarla uygulanır; arayüz yalnızca yansıtır.
