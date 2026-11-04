-- Arka plan planı dosyaları (storage.objects RLS)
begin;
\ir setup.psql
select plan(10);

select is((select public from storage.buckets where id = 'project-plans'), false, 'bucket özel');
select is(public.plan_project_id('10000000-0000-0000-0000-000000000001/x.webp'), '10000000-0000-0000-0000-000000000001'::uuid, 'yoldan proje kimliği');
-- Doğrudan silme Storage tetikleyicisiyle zaten engelli; API üzerinden de silme/güncelleme politikası olmamalı
select is_empty($$select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and cmd in ('DELETE', 'UPDATE', 'ALL') and coalesce(qual, '') || coalesce(with_check, '') like '%project-plans%'$$, 'plan dosyası silinemez/değiştirilemez');
select is(public.plan_project_id('../10000000-0000-0000-0000-000000000001/x.webp'), null, 'geçersiz yol null');

-- Firma projesi: kilitsiz yüklenemez, kilitle yüklenir
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('project-plans', '10000000-0000-0000-0000-000000000001/a.webp')$$,
  '42501', null, 'kilit olmadan plan yüklenemez');
select public.acquire_project_lock('10000000-0000-0000-0000-000000000001');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('project-plans', '10000000-0000-0000-0000-000000000001/a.webp')$$, 'kilit sahibi plan yükler');

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is((select count(*) from storage.objects where bucket_id = 'project-plans'), 1::bigint, 'firma üyesi planı görür');

select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select is((select count(*) from storage.objects where bucket_id = 'project-plans'), 0::bigint, 'firma dışındaki planı görmez');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('project-plans', '10000000-0000-0000-0000-000000000001/b.webp')$$,
  '42501', null, 'firma dışındaki başkasının projesine yükleyemez');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('project-plans', '10000000-0000-0000-0000-000000000002/q.webp')$$, 'kişisel projeye sahibi kilitsiz yükler');

select * from finish();
rollback;
