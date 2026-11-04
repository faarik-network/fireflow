-- Firma RLS: görünürlük, rol yükseltme, proje taşıma, davetler
begin;
\ir setup.psql
select plan(12);

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*) from public.profiles), 4::bigint, 'üye firmadaki profilleri görür');
select is((select count(*) from public.companies), 1::bigint, 'üye kendi firmasını görür');
select throws_ok($$update public.profiles set company_role = 'OWNER' where id = auth.uid()$$, '42501', null, 'üye kendi rolünü yükseltemez');
select lives_ok($$update public.profiles set full_name = 'B yeni' where id = auth.uid()$$, 'üye kendi adını değiştirebilir');
select throws_ok($$select public.set_member_role('00000000-0000-0000-0000-00000000000c', 'ADMIN')$$, 'Yetkiniz yok', 'üye rol atayamaz');
select throws_ok($$select public.remove_member('00000000-0000-0000-0000-00000000000c')$$, 'Yetkiniz yok', 'üye üye çıkaramaz');
select throws_ok($$insert into public.company_invites (company_id, email, created_by) values (public.current_company_id(), 'x@test.local', auth.uid())$$,
  '42501', null, 'üye davet gönderemez');

-- Proje sahibi/firması güncellemeyle değiştirilemez
select public.acquire_project_lock('10000000-0000-0000-0000-000000000001');
update public.projects set user_id = auth.uid(), company_id = null where id = '10000000-0000-0000-0000-000000000001';
select is((select user_id from public.projects where id = '10000000-0000-0000-0000-000000000001'), '00000000-0000-0000-0000-00000000000a'::uuid, 'proje sahibi değiştirilemez');
select is_empty($$delete from public.projects where id = '10000000-0000-0000-0000-000000000001' returning id$$, 'üye başkasının projesini silemez');

-- ADMIN yalnızca MEMBER daveti gönderir
select pg_temp.login('00000000-0000-0000-0000-00000000000e');
select lives_ok($$insert into public.company_invites (company_id, email, created_by) values (public.current_company_id(), 'x@test.local', auth.uid())$$, 'ADMIN üye davet eder');
select throws_ok($$insert into public.company_invites (company_id, email, role, created_by) values (public.current_company_id(), 'y@test.local', 'ADMIN', auth.uid())$$,
  '42501', null, 'ADMIN, ADMIN daveti gönderemez');

select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select is((select count(*) from public.profiles), 1::bigint, 'firma dışındaki yalnızca kendi profilini görür');

select * from finish();
rollback;
