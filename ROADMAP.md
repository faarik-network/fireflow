# FireFlow yol haritası

Son güncelleme: 2026-11-07

## Tamamlananlar

| # | Özellik | Commit | Not |
|---|---------|--------|-----|
| 1 | Firma yapısı (OWNER/ADMIN/MEMBER, davet, RLS) | f353aac | |
| 2 | Proje düzenleme kilidi (aynı anda tek kişi, devralma) | 15502d7 | 90 sn kilit, 30 sn yenileme, 10 dk hareketsizlikte bırakma |
| 3 | Sürüm geçmişi + geri al/yinele, 1–8 araç kısayolları | 0e8ce35 | Tetikleyiciyle otomatik sürüm, 10 dk birleştirme, son 100 sürüm |
| 4 | Supabase Realtime (15 sn polling yerine) | 2840ac8 | Kilit/kayıt anında; salt okunur izleyici canlı görür; 60 sn yedek polling. Test edildi (kilit süresinin kendiliğinden dolması hariç). |
| 5 | Migration düzeni + tip güvenliği | 0cd30bd, 74651a5 | Supabase CLI, zaman damgalı migration'lar (uzak geçmişle eşli), üretilmiş TS tipleri, pgTAP testleri |
| 6 | Arka plan planı – 1. aşama (PDF/görsel) | 33dc016 | Özel `project-plans` bucket + Storage RLS, iki noktayla ölçekleme, taşı/kilitle/gizle/saydamlık. **Uzak DB'ye uygulandı; arayüz henüz elle test edilmedi.** |

## Sıradaki

1. **Arka plan planı 1. aşama – elle test.** Kontrol listesi:
   - Çok sayfalı PDF'de sayfa seçimi.
   - İki noktayla ölçekleme.
   - Taşı, kilitle, gizle, saydamlık ve Ctrl+Z.
   - Koyu temada renk çevirme.
   - Salt okunur izleyicide canlı görünüm.
   - Rapor (PDF) içinde plan; CORS veya "tainted canvas" hatası olmamalı.
   - Sürüme dönünce planın da geri gelmesi.
   - "Değiştir" ile yeni revizyon.
2. **Arka plan planı 2. aşama – DXF.**
   - `dxf-parser` ile vektör olarak oku (LINE, LWPOLYLINE, POLYLINE, ARC, CIRCLE; TEXT isteğe bağlı).
   - Ölçeği `$INSUNITS` değerinden otomatik al.
   - Geometriyi Storage'a JSON olarak koy.
   - Çizimi `Path2D` ile önbellekle.
3. **Ürün özellikleri** (sırası kullanıcıyla belirlenecek):
   - **BOM:** malzeme listesi ve maliyet (boru metrajı DN'e göre, fitting, sprinkler, pompa); CSV/PDF çıktısı.
   - **Çok katlı görünüm:** kotlara göre katlar; her kata bir arka plan planı. Bunun için `background` alanı kat başına diziye dönüşecek.
   - **Etkinlik günlüğü:** proje açma, düzenleme, kilit devralma, sürüme dönme.

## Bilinen eksikler / ertelenenler

- **Sahipsiz plan dosyaları:** proje silinince Storage'daki plan dosyaları kalıyor. Storage tablosundan doğrudan silme engelli, bu yüzden temizlik Storage API'siyle yapılmalı (Edge Function veya zamanlanmış iş).
- **Kopya projede plan:** "Kopya oluştur" planı orijinal projenin klasöründen okuyor. Orijinal proje silinirse kopyada plan görünmez. Çözüm: kopyalarken dosyayı da kopyalamak.
- **RLS performansı:** politikalarda `auth.uid()` yerine `(select auth.uid())` kullanmak; eksik FK indekslerini eklemek.
- **Leaked password protection:** Supabase dashboard'dan (Auth → Password security) kullanıcının açması gerekiyor.
- **Advisors uyarıları:** SECURITY DEFINER RPC uyarıları bilerek böyle; RPC'ler yalnızca `authenticated` rolüne açık.
- **Supabase CLI sürümü:** kurulu sürüm 2.122.1, v3 çıktı. Yükseltme denenmedi.
