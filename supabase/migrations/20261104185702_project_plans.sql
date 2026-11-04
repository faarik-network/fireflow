-- FireFlow: proje arka plan planı (PDF/görsel → tarayıcıda görsele çevrilip Storage'a yüklenir)
-- Önkoşul: project_locks migration'ı.
--
-- Kurallar:
--  * Dosyalar özel (private) 'project-plans' bucket'ında, yol: <project_id>/<rastgele>.<uzantı>
--  * Projeyi görebilen herkes planı görür (imzalı URL ile).
--  * Yükleme projeyi şu an yazabilene açık: kişisel projede sahibi, firma projesinde kilidi tutan.
--  * Dosyalar değiştirilemez ve silinemez: grid_data yalnızca yolu tutar, eski sürümler eski planı göstermeye devam eder.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-plans', 'project-plans', false, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Nesne yolundan proje kimliği; biçim uymazsa null (politikada eşleşme olmaz)
create or replace function public.plan_project_id(p_name text) returns uuid
language sql immutable set search_path = public as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
              then split_part(p_name, '/', 1)::uuid end
$$;

-- Projeyi şu an yazabilir mi? (projects_update politikasıyla aynı kural)
create or replace function public.can_write_project(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = pid
      and (p.user_id = auth.uid() or (p.company_id is not null and p.company_id = public.current_company_id()))
      and (p.company_id is null or public.holds_project_lock(p.id))
  )
$$;

create policy "Plan files readable by project viewers" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-plans' and exists (select 1 from public.projects p where p.id = public.plan_project_id(name)));

create policy "Plan files uploadable by project writer" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-plans' and public.can_write_project(public.plan_project_id(name)));

revoke all on function public.plan_project_id(text) from public, anon;
revoke all on function public.can_write_project(uuid) from public, anon;
grant execute on function public.plan_project_id(text) to authenticated;
grant execute on function public.can_write_project(uuid) to authenticated;

commit;
