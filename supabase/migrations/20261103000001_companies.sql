-- FireFlow: firmalar (çok kiracılı yapı)
-- Önkoşul: initial_schema migration'ı. Bu dosya güvenle bir kez çalıştırılır.
--
-- Kurallar:
--  * Bir kullanıcı en fazla bir firmaya üyedir. Roller: OWNER, ADMIN, MEMBER.
--  * Aynı firmadaki kullanıcılar birbirinin profilini (ad, e-posta, rol) görür.
--  * Firma projelerini tüm üyeler GÖRÜR; düzenleme/silme yalnızca proje sahibi ile OWNER/ADMIN'de.
--    (project_locks migration'ı düzenlemeyi kilitle tüm üyelere açar.)
--  * Firma dışındakiler hiçbir şey göremez.
--  * Firmaya katılım yalnızca e-posta davetiyle (accept_invite), firma oluşturma create_company ile.
--  Davetlerin güvenli olması için Supabase Auth'ta "Confirm email" AÇIK olmalıdır.

begin;

-- ---------- Tablolar ----------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column company_id uuid references public.companies(id) on delete set null,
  add column company_role text not null default 'MEMBER' check (company_role in ('OWNER', 'ADMIN', 'MEMBER'));
create index profiles_company_idx on public.profiles (company_id);

alter table public.projects
  add column company_id uuid references public.companies(id) on delete cascade;
create index projects_company_idx on public.projects (company_id, updated_at desc);

create table public.company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role text not null default 'MEMBER' check (role in ('ADMIN', 'MEMBER')),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create unique index company_invites_open_uq on public.company_invites (company_id, lower(email)) where accepted_at is null;
create index company_invites_email_idx on public.company_invites (lower(email)) where accepted_at is null;

-- ---------- Yardımcı fonksiyonlar (RLS özyinelemesini önlemek için SECURITY DEFINER) ----------
create or replace function public.current_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid()
$$;

create or replace function public.my_company_role(cid uuid) returns text
language sql stable security definer set search_path = public as $$
  select company_role from public.profiles where id = auth.uid() and company_id = cid
$$;

create or replace function public.is_company_admin(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_company_role(cid) in ('OWNER', 'ADMIN'), false)
$$;

-- ---------- RLS: profiles ----------
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Profiles visible to self and company members" on public.profiles
  for select to authenticated
  using (id = auth.uid() or (company_id is not null and company_id = public.current_company_id()));
-- Kullanıcı yalnızca full_name güncelleyebilir (company_id / company_role / role değiştirilemez)
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- ---------- RLS: companies ----------
alter table public.companies enable row level security;
create policy "Members can view their company" on public.companies
  for select to authenticated using (id = public.current_company_id());
create policy "Admins can rename company" on public.companies
  for update to authenticated using (public.is_company_admin(id)) with check (public.is_company_admin(id));
revoke all on public.companies from anon;
revoke insert, update, delete on public.companies from authenticated;
grant update (name) on public.companies to authenticated;

-- ---------- RLS: company_invites ----------
alter table public.company_invites enable row level security;
create policy "Admins view invites" on public.company_invites
  for select to authenticated using (public.is_company_admin(company_id));
create policy "Admins create invites" on public.company_invites
  for insert to authenticated
  with check (
    public.is_company_admin(company_id)
    and created_by = auth.uid()
    and accepted_at is null
    and (role = 'MEMBER' or public.my_company_role(company_id) = 'OWNER')
  );
create policy "Admins cancel pending invites" on public.company_invites
  for delete to authenticated using (public.is_company_admin(company_id) and accepted_at is null);
revoke all on public.company_invites from anon;
revoke update on public.company_invites from authenticated;

-- ---------- RLS: projects ----------
drop policy if exists "Users can view their own projects" on public.projects;
drop policy if exists "Users can insert their own projects" on public.projects;
drop policy if exists "Users can update their own projects" on public.projects;
drop policy if exists "Users can delete their own projects" on public.projects;

create policy "projects_select" on public.projects for select to authenticated
  using (user_id = auth.uid() or (company_id is not null and company_id = public.current_company_id()));
create policy "projects_insert" on public.projects for insert to authenticated
  with check (user_id = auth.uid());
create policy "projects_update" on public.projects for update to authenticated
  using (user_id = auth.uid() or public.is_company_admin(company_id))
  with check (user_id = auth.uid() or public.is_company_admin(company_id));
create policy "projects_delete" on public.projects for delete to authenticated
  using (user_id = auth.uid() or public.is_company_admin(company_id));

-- Yeni projeye sahibinin firmasını yaz; güncellemede sahip ve firma değiştirilemesin
create or replace function public.projects_before_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.company_id := (select company_id from public.profiles where id = new.user_id);
  elsif coalesce(current_setting('app.allow_company_move', true), '') <> '1' then
    new.user_id := old.user_id;
    new.company_id := old.company_id;
  end if;
  return new;
end $$;

create trigger projects_before_write before insert or update on public.projects
  for each row execute function public.projects_before_write();

-- Mevcut projeleri sahiplerinin firmasına bağla (şu an hepsi null; yeniden çalıştırmada zararsız)
select set_config('app.allow_company_move', '1', true);
update public.projects p set company_id = pr.company_id from public.profiles pr where pr.id = p.user_id and p.company_id is distinct from pr.company_id;
select set_config('app.allow_company_move', '', true);

-- ---------- RPC'ler ----------
create or replace function public.create_company(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'Oturum gerekli'; end if;
  if exists (select 1 from public.profiles where id = v_uid and company_id is not null) then
    raise exception 'Zaten bir firmaya bağlısınız';
  end if;
  insert into public.companies (name) values (btrim(p_name)) returning id into v_id;
  update public.profiles set company_id = v_id, company_role = 'OWNER' where id = v_uid;
  -- Kişisel projeleri yeni firmaya taşı
  perform set_config('app.allow_company_move', '1', true);
  update public.projects set company_id = v_id where user_id = v_uid and company_id is null;
  perform set_config('app.allow_company_move', '', true);
  return v_id;
end $$;

-- E-postası doğrulanmış kullanıcı, kendi adresine gelen bekleyen daveti kabul eder
create or replace function public.accept_invite() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_email text; v_confirmed timestamptz; v_inv public.company_invites;
begin
  if v_uid is null then return null; end if;
  select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = v_uid;
  if v_confirmed is null then return null; end if;
  if exists (select 1 from public.profiles where id = v_uid and company_id is not null) then return null; end if;
  select * into v_inv from public.company_invites
    where lower(email) = v_email and accepted_at is null order by created_at limit 1;
  if not found then return null; end if;
  update public.profiles set company_id = v_inv.company_id, company_role = v_inv.role where id = v_uid;
  update public.company_invites set accepted_at = now() where id = v_inv.id;
  return v_inv.company_id;
end $$;

create or replace function public.set_member_role(p_member uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare v_cid uuid;
begin
  if p_role not in ('ADMIN', 'MEMBER') then raise exception 'Geçersiz rol'; end if;
  select company_id into v_cid from public.profiles where id = p_member;
  if v_cid is null or public.my_company_role(v_cid) is distinct from 'OWNER' then raise exception 'Yetkiniz yok'; end if;
  if p_member = auth.uid() then raise exception 'Kendi rolünüzü değiştiremezsiniz'; end if;
  update public.profiles set company_role = p_role where id = p_member and company_role <> 'OWNER';
end $$;

create or replace function public.remove_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_target text; v_me text;
begin
  select company_id, company_role into v_cid, v_target from public.profiles where id = p_member;
  v_me := public.my_company_role(v_cid);
  if v_cid is null or v_me is null or p_member = auth.uid() then raise exception 'Yetkiniz yok'; end if;
  if v_target = 'OWNER' or v_me = 'MEMBER' or (v_me = 'ADMIN' and v_target <> 'MEMBER') then raise exception 'Yetkiniz yok'; end if;
  update public.profiles set company_id = null, company_role = 'MEMBER' where id = p_member;
end $$;

create or replace function public.transfer_ownership(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_cid uuid;
begin
  select company_id into v_cid from public.profiles where id = p_member;
  if v_cid is null or p_member = auth.uid() or public.my_company_role(v_cid) is distinct from 'OWNER' then raise exception 'Yetkiniz yok'; end if;
  update public.profiles set company_role = 'OWNER' where id = p_member;
  update public.profiles set company_role = 'ADMIN' where id = auth.uid();
end $$;

create or replace function public.leave_company() returns void
language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_role text;
begin
  select company_id, company_role into v_cid, v_role from public.profiles where id = auth.uid();
  if v_cid is null then return; end if;
  if v_role = 'OWNER' and exists (select 1 from public.profiles where company_id = v_cid and id <> auth.uid()) then
    raise exception 'Firma sahibi, başka üyeler varken ayrılamaz. Önce sahipliği devredin veya üyeleri çıkarın.';
  end if;
  update public.profiles set company_id = null, company_role = 'MEMBER' where id = auth.uid();
end $$;

-- Yalnızca giriş yapmış kullanıcılar çağırabilir (Supabase varsayılanı anon'a da verir)
do $$
declare f text;
begin
  foreach f in array array[
    'current_company_id()', 'my_company_role(uuid)', 'is_company_admin(uuid)', 'create_company(text)', 'accept_invite()',
    'set_member_role(uuid,text)', 'remove_member(uuid)', 'transfer_ownership(uuid)', 'leave_company()', 'projects_before_write()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    if f <> 'projects_before_write()' then
      execute format('grant execute on function public.%s to authenticated', f);
    end if;
  end loop;
end $$;

commit;
