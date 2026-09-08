-- =============================================================
-- 一寸光阴 · Supabase 每日自动备份（03/03 · 可选）
-- -------------------------------------------------------------
-- 替代原 CloudBase pg-backup Event 函数：每天把 4 张业务表全量快照
-- 写进 backups 表（JSONB），类似原实现。
--
-- 前置：启用 pg_cron 扩展（Supabase Dashboard → Database → Extensions
--       勾选 pg_cron，或在 SQL Editor 里执行一次本文件）。
--
-- ⚠️ 若不需要自动备份，跳过本文件即可（backups 表已由 01 建好）。
-- =============================================================

-- 启用 pg_cron
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ---------- 备份函数：快照业务表 → backups ----------
CREATE OR REPLACE FUNCTION public.backup_snapshot()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  payload    JSONB;
  row_counts JSONB;
BEGIN
  -- 分别聚合 4 张业务表（空表用 COALESCE 兜底为 []）
  SELECT jsonb_build_object(
    'children',
    COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.children c), '[]'::jsonb),
    'courses',
    COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.courses c), '[]'::jsonb),
    'checkins',
    COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.checkins c), '[]'::jsonb),
    'user_prefs',
    COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.user_prefs c), '[]'::jsonb)
  )
  INTO payload;

  SELECT jsonb_build_object(
    'children',  (SELECT count(*) FROM public.children),
    'courses',   (SELECT count(*) FROM public.courses),
    'checkins',  (SELECT count(*) FROM public.checkins),
    'user_prefs', (SELECT count(*) FROM public.user_prefs)
  )
  INTO row_counts;

  INSERT INTO public.backups (payload, schema_version, row_counts)
  VALUES (payload, 1, row_counts);

  -- 只保留最近 30 份，避免表无限膨胀
  DELETE FROM public.backups
   WHERE id NOT IN (
     SELECT id FROM public.backups ORDER BY taken_at DESC LIMIT 30
   );
END;
$$;

-- ---------- 调度：每天 02:30（UTC）跑一次 ----------
-- cron.schedule 幂等：先删同名 job 再建
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'kid-course-tracker-backup'
  ) THEN
    PERFORM cron.unschedule('kid-course-tracker-backup');
  END IF;
END;
$$;

SELECT cron.schedule(
  'kid-course-tracker-backup',
  '30 2 * * *',
  $$SELECT public.backup_snapshot()$$
);

-- 手动跑一次可验证：
--   SELECT public.backup_snapshot();
--   SELECT id, taken_at, row_counts FROM public.backups ORDER BY taken_at DESC LIMIT 3;
-- =============================================================
-- 完成。
-- =============================================================
