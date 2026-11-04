-- Sürüm geçmişi: otomatik sürüm, birleştirme, görünürlük, geri yükleme yetkisi
begin;
\ir setup.psql
select plan(11);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select public.acquire_project_lock('10000000-0000-0000-0000-000000000001');
update public.projects set grid_data = '{"nodes":[1],"view":{"zoom":1}}' where id = '10000000-0000-0000-0000-000000000001';
select results_eq($$select reason from public.project_versions where project_id = '10000000-0000-0000-0000-000000000001' order by created_at$$,
  array['baseline', 'edit'], 'ilk düzenleme başlangıç + düzenleme sürümü oluşturur');

update public.projects set grid_data = '{"nodes":[1,2],"view":{"zoom":1}}' where id = '10000000-0000-0000-0000-000000000001';
select is((select count(*) from public.project_versions where project_id = '10000000-0000-0000-0000-000000000001'), 2::bigint, 'aynı kişinin 10 dk içindeki düzenlemesi birleşir');
select is((select grid_data -> 'nodes' from public.project_versions where reason = 'edit'), '[1,2]'::jsonb, 'birleşen sürüm son hâli tutar');

update public.projects set grid_data = '{"nodes":[1,2],"view":{"zoom":3}}' where id = '10000000-0000-0000-0000-000000000001';
select is((select grid_data -> 'view' from public.project_versions where reason = 'edit'), '{"zoom":1}'::jsonb, 'yalnızca görünüm değişikliği sürüm oluşturmaz');

select isnt(public.save_project_version('10000000-0000-0000-0000-000000000001', 'Teklif'), null, 'adlandırılmış sürüm kaydedilir');
select throws_ok($$select public.save_project_version('10000000-0000-0000-0000-000000000001', '  ')$$, 'Sürüm adı 1–80 karakter olmalı', 'boş sürüm adı reddedilir');
select throws_ok($$insert into public.project_versions (project_id, grid_data, reason) values ('10000000-0000-0000-0000-000000000001', '{}', 'manual')$$,
  '42501', null, 'sürüm tablosuna doğrudan yazılamaz');

-- Kilit sahibi olmayan geri yükleyemez
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok(format('select public.restore_project_version(%L)', (select id from public.project_versions where reason = 'baseline')),
  'Bu projeyi şu anda düzenleyemezsiniz (düzenleme kilidi sizde değil)', 'kilitsiz geri yükleme reddedilir');
select is((select count(*) from public.project_versions), 3::bigint, 'firma üyesi sürümleri görür');

-- Kilit sahibi geri yükler; görünüm korunur
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select public.restore_project_version((select id from public.project_versions where reason = 'baseline'));
select is((select grid_data from public.projects where id = '10000000-0000-0000-0000-000000000001'), '{"nodes":[],"view":{"zoom":3}}'::jsonb, 'geri yükleme veriyi döndürür, görünümü korur');

select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select is((select count(*) from public.project_versions), 0::bigint, 'firma dışındaki sürümleri görmez');

select * from finish();
rollback;
