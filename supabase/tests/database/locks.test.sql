-- Proje düzenleme kilidi: aynı anda tek kişi yazar, devralma yetkisi, süre dolması
begin;
\ir setup.psql
select plan(20);

-- Görünürlük
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*) from public.projects where id = '10000000-0000-0000-0000-000000000001'), 1::bigint, 'firma üyesi firma projesini görür');
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select is((select count(*) from public.projects where id = '10000000-0000-0000-0000-000000000001'), 0::bigint, 'firma dışındaki projeyi görmez');
select throws_ok($$select public.acquire_project_lock('10000000-0000-0000-0000-000000000001')$$, 'Yetkiniz yok', 'firma dışındaki kilit alamaz');

-- Kilitsiz yazılamaz
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is_empty($$update public.projects set title = 'x' where id = '10000000-0000-0000-0000-000000000001' returning id$$, 'kilit olmadan güncellenemez');

-- B kilidi alır
select is(public.acquire_project_lock('10000000-0000-0000-0000-000000000001') ->> 'ok', 'true', 'B kilidi alır');
select isnt_empty($$update public.projects set title = 'B' where id = '10000000-0000-0000-0000-000000000001' returning id$$, 'kilit sahibi güncelleyebilir');

-- C bekler
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(public.acquire_project_lock('10000000-0000-0000-0000-000000000001') ->> 'ok', 'false', 'kilit doluyken C alamaz');
select is(public.acquire_project_lock('10000000-0000-0000-0000-000000000001') ->> 'holder_name', 'Burak', 'C kilidin kimde olduğunu görür');
select is((select user_id from public.project_locks where project_id = '10000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-00000000000b'::uuid, 'C aktif kilit satırını görür');
select is_empty($$update public.projects set title = 'C' where id = '10000000-0000-0000-0000-000000000001' returning id$$, 'kilit sahibi olmayan güncelleyemez');
select is(public.acquire_project_lock('10000000-0000-0000-0000-000000000001', true) ->> 'ok', 'false', 'MEMBER kilidi devralamaz');
select lives_ok($$select public.release_project_lock('10000000-0000-0000-0000-000000000001')$$, 'başkasının kilidini bırakma hatasız');
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is(public.acquire_project_lock('10000000-0000-0000-0000-000000000001') ->> 'ok', 'true', '... ama kilidi silmez');
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select throws_ok($$select public.rename_project('10000000-0000-0000-0000-000000000001', 'yeni')$$, 'Proje şu anda başka biri tarafından düzenleniyor', 'başkası düzenlerken yeniden adlandırılamaz');

-- ADMIN devralır
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
select is(public.acquire_project_lock('10000000-0000-0000-0000-000000000001', true) ->> 'ok', 'true', 'ADMIN kilidi devralır');
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is_empty($$update public.projects set title = 'B2' where id = '10000000-0000-0000-0000-000000000001' returning id$$, 'devralınan eski sahip yazamaz');

-- Süresi dolan kilit boşta sayılır
select pg_temp.logout();
update public.project_locks set expires_at = now() - interval '1 second' where project_id = '10000000-0000-0000-0000-000000000001';
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is((select count(*) from public.project_locks), 0::bigint, 'süresi dolan kilit görünmez');
select is(public.acquire_project_lock('10000000-0000-0000-0000-000000000001') ->> 'ok', 'true', 'süresi dolan kilit alınabilir');

-- Kişisel proje kilit gerektirmez
select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select is(public.acquire_project_lock('10000000-0000-0000-0000-000000000002') ->> 'required', 'false', 'kişisel projede kilit gerekmez');
select isnt_empty($$update public.projects set title = 'Q2' where id = '10000000-0000-0000-0000-000000000002' returning id$$, 'sahibi kişisel projesini kilitsiz günceller');

select * from finish();
rollback;
