-- FireFlow: Supabase Realtime (15 sn polling yerine anlık bildirim)
-- Önkoşul: 003_project_locks.sql çalıştırılmış olmalı.
--
--  * project_locks: kilit alındı/yenilendi/bırakıldı/devralındı → salt okunur bekleyen ve dashboard anında görür.
--  * projects: düzenleyen kaydettikçe salt okunur izleyiciler canlı günceller.
-- INSERT/UPDATE olayları RLS'e (select politikalarına) göre her aboneye ayrı süzülür.
-- DELETE olayları RLS ile süzülmez; ama replica identity varsayılan (PK) olduğundan yalnızca
-- birincil anahtar (project_id / id) gönderilir, satır içeriği sızmaz.

alter publication supabase_realtime add table public.project_locks, public.projects;
