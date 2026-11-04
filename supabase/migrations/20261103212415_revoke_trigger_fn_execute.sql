-- Tetikleyici fonksiyonları API'den (/rest/v1/rpc) çağrılamaz yap; tetikleyiciler etkilenmez.
-- (Supabase güvenlik denetimi: anon/authenticated SECURITY DEFINER fonksiyon çalıştırabiliyor uyarısı)
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.projects_before_write() from public, anon, authenticated;
