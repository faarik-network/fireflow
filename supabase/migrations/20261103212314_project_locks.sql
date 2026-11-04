-- FireFlow: proje düzenleme kilidi (aynı anda tek kişi düzenler)
-- Önkoşul: initial_schema ve companies migration'ları.
--
-- Kurallar:
--  * Firma projesini firmanın TÜM üyeleri (MEMBER dahil) düzenleyebilir, ama yalnızca aktif kilidi tutan kişi yazabilir.
--  * Kilit 90 sn geçerlidir; istemci düzenlerken periyodik olarak yeniler. Süresi dolan kilit boşta sayılır.
--  * Proje sahibi ve firma OWNER/ADMIN'i başkasının kilidini devralabilir (açık unutulmuş sekme vb.).
--  * Kişisel (firmasız) projelerde kilit gerekmez; yalnızca sahibi düzenler.
--  * Silme yetkisi değişmez: proje sahibi ve OWNER/ADMIN.

begin;

create table public.project_locks (
  project_id uuid primary key references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.project_locks enable row level security;
-- Projeyi görebilen herkes aktif kilidi (kimin düzenlediğini) görür; süresi dolmuşlar görünmez
create policy "Active locks visible to project viewers" on public.project_locks
  for select to authenticated
  using (expires_at > now() and exists (select 1 from public.projects p where p.id = project_id));
revoke all on public.project_locks from anon;
revoke insert, update, delete on public.project_locks from authenticated;
grant select on public.project_locks to authenticated;

-- ---------- Yardımcılar ----------
create or replace function public.can_edit_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid
      and (p.user_id = auth.uid() or (p.company_id is not null and p.company_id = public.current_company_id()))
  )
$$;

create or replace function public.holds_project_lock(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_locks where project_id = pid and user_id = auth.uid() and expires_at > now())
$$;

-- ---------- RLS: projects update ----------
drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects for update to authenticated
  using (
    (user_id = auth.uid() or (company_id is not null and company_id = public.current_company_id()))
    and (company_id is null or public.holds_project_lock(id))
  )
  with check (
    (user_id = auth.uid() or (company_id is not null and company_id = public.current_company_id()))
    and (company_id is null or public.holds_project_lock(id))
  );

-- ---------- RPC'ler ----------
-- Kilidi al / yenile. p_force: sahibi veya OWNER/ADMIN başkasının kilidini devralır.
-- Dönüş: {ok, required, expires_at} ya da {ok:false, holder_name, expires_at}
create or replace function public.acquire_project_lock(p_project uuid, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_cid uuid; v_owner uuid; v_force boolean; v_exp timestamptz; v_lock public.project_locks;
begin
  if v_uid is null then raise exception 'Oturum gerekli'; end if;
  select company_id, user_id into v_cid, v_owner from public.projects where id = p_project;
  if not found or not public.can_edit_project(p_project) then raise exception 'Yetkiniz yok'; end if;
  if v_cid is null then return jsonb_build_object('ok', true, 'required', false); end if;

  v_force := coalesce(p_force, false) and (v_owner = v_uid or public.is_company_admin(v_cid));

  -- Tek atomik adım: boşsa/süresi dolmuşsa/zaten bendeyse/devralma izni varsa yaz
  insert into public.project_locks as l (project_id, user_id, acquired_at, expires_at)
    values (p_project, v_uid, now(), now() + interval '90 seconds')
  on conflict (project_id) do update
    set user_id = excluded.user_id,
        acquired_at = case when l.user_id = excluded.user_id and l.expires_at > now() then l.acquired_at else excluded.acquired_at end,
        expires_at = excluded.expires_at
    where l.user_id = v_uid or l.expires_at <= now() or v_force
  returning l.expires_at into v_exp;

  if v_exp is not null then
    return jsonb_build_object('ok', true, 'required', true, 'expires_at', v_exp);
  end if;

  select * into v_lock from public.project_locks where project_id = p_project;
  return jsonb_build_object(
    'ok', false, 'required', true, 'expires_at', v_lock.expires_at,
    'holder_name', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = v_lock.user_id)
  );
end $$;

create or replace function public.release_project_lock(p_project uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.project_locks where project_id = p_project and user_id = auth.uid()
$$;

-- Listeden yeniden adlandırma: başkası düzenlerken yapılamaz (kilit almadan)
create or replace function public.rename_project(p_project uuid, p_title text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if char_length(btrim(coalesce(p_title, ''))) = 0 then raise exception 'Proje adı boş olamaz'; end if;
  if not public.can_edit_project(p_project) then raise exception 'Yetkiniz yok'; end if;
  if exists (select 1 from public.project_locks where project_id = p_project and user_id <> auth.uid() and expires_at > now()) then
    raise exception 'Proje şu anda başka biri tarafından düzenleniyor';
  end if;
  update public.projects set title = btrim(p_title) where id = p_project;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'can_edit_project(uuid)', 'holds_project_lock(uuid)', 'acquire_project_lock(uuid,boolean)',
    'release_project_lock(uuid)', 'rename_project(uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
