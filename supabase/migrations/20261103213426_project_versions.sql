-- FireFlow: proje sürüm geçmişi
-- Önkoşul: project_locks migration'ı
--
-- Kurallar:
--  * grid_data her değiştiğinde (yalnızca görünüm/zoom değişikliği sayılmaz) tetikleyici sürüm kaydeder.
--  * Aynı kişinin 10 dk içindeki düzenlemeleri tek sürümde birleşir (oturum başına bir kayıt, sürekli düzenlemede 10 dk'da bir yeni).
--  * Projenin ilk değişikliğinden önce eski hâli "başlangıç" sürümü olarak saklanır.
--  * Otomatik sürümlerden en yeni 100 tanesi tutulur; adlandırılmış (elle kaydedilen) sürümler silinmez.
--  * Sürümleri projeyi görebilen herkes görür; geri yükleme normal düzenleme yetkisi + kilit ister (RLS).

begin;

create table public.project_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  grid_data jsonb not null,
  title text,
  label text check (label is null or char_length(label) between 1 and 80),
  reason text not null check (reason in ('baseline', 'edit', 'restore', 'manual')),
  created_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index project_versions_project_idx on public.project_versions (project_id, created_at desc);
create index project_versions_created_by_idx on public.project_versions (created_by);

alter table public.project_versions enable row level security;
create policy "Versions visible to project viewers" on public.project_versions
  for select to authenticated
  using (exists (select 1 from public.projects p where p.id = project_id));
revoke all on public.project_versions from anon;
revoke insert, update, delete on public.project_versions from authenticated;
grant select on public.project_versions to authenticated;

-- ---------- Otomatik sürüm ----------
create or replace function public.projects_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := coalesce(nullif(current_setting('app.version_reason', true), ''), 'edit');
  v_last public.project_versions;
  v_has boolean;
begin
  select * into v_last from public.project_versions
    where project_id = new.id and reason <> 'manual' order by created_at desc, id desc limit 1;
  v_has := found;

  if not v_has then
    insert into public.project_versions (project_id, grid_data, title, reason, created_by, started_at, created_at)
      values (new.id, old.grid_data, old.title, 'baseline', old.user_id,
              coalesce(old.updated_at, now()) - interval '1 millisecond', coalesce(old.updated_at, now()) - interval '1 millisecond');
  end if;

  if v_has and v_reason = 'edit' and v_last.reason = 'edit'
     and v_last.created_by is not distinct from v_uid and v_last.started_at > now() - interval '10 minutes' then
    update public.project_versions set grid_data = new.grid_data, title = new.title, created_at = now() where id = v_last.id;
  else
    insert into public.project_versions (project_id, grid_data, title, reason, created_by)
      values (new.id, new.grid_data, new.title, v_reason, v_uid);
  end if;

  delete from public.project_versions
    where project_id = new.id and reason <> 'manual'
      and id not in (select id from public.project_versions where project_id = new.id and reason <> 'manual'
                     order by created_at desc, id desc limit 100);
  return null;
end $$;

create trigger projects_snapshot after update on public.projects
  for each row when ((old.grid_data - 'view') is distinct from (new.grid_data - 'view'))
  execute function public.projects_snapshot();

-- ---------- RPC'ler ----------
-- Sürümü geri yükle: normal güncelleme gibi RLS'ten geçer (firma projesinde kilit gerekir)
create or replace function public.restore_project_version(p_version uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare v public.project_versions; n int;
begin
  select * into v from public.project_versions where id = p_version;
  if not found then raise exception 'Sürüm bulunamadı'; end if;
  perform set_config('app.version_reason', 'restore', true);
  update public.projects set grid_data = v.grid_data || jsonb_build_object('view', grid_data -> 'view') where id = v.project_id;
  get diagnostics n = row_count;
  perform set_config('app.version_reason', '', true);
  if n = 0 then raise exception 'Bu projeyi şu anda düzenleyemezsiniz (düzenleme kilidi sizde değil)'; end if;
end $$;

-- Mevcut hâli adlandırılmış sürüm olarak sakla (otomatik temizlikten etkilenmez)
create or replace function public.save_project_version(p_project uuid, p_label text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_label text := btrim(coalesce(p_label, ''));
begin
  if char_length(v_label) not between 1 and 80 then raise exception 'Sürüm adı 1–80 karakter olmalı'; end if;
  if not public.can_edit_project(p_project) then raise exception 'Yetkiniz yok'; end if;
  insert into public.project_versions (project_id, grid_data, title, label, reason, created_by)
    select id, grid_data, title, v_label, 'manual', auth.uid() from public.projects where id = p_project
    returning id into v_id;
  return v_id;
end $$;

revoke all on function public.projects_snapshot() from public, anon, authenticated;
revoke all on function public.restore_project_version(uuid) from public, anon;
revoke all on function public.save_project_version(uuid, text) from public, anon;
grant execute on function public.restore_project_version(uuid) to authenticated;
grant execute on function public.save_project_version(uuid, text) to authenticated;

commit;
