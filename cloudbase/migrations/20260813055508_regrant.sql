-- 重新 GRANT，确保 anon 角色有 INSERT 权限

-- 显式 grant anon 角色
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.children TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.courses TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkins TO anon;

-- 同样给 authenticated
GRANT SELECT, INSERT, UPDATE, DELETE ON public.children TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.courses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.checkins TO authenticated;

