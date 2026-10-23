-- =============================================================
-- 一寸光阴 · 收口 backup_snapshot() 的执行权限
-- -------------------------------------------------------------
-- 背景：
--   20260908000003_daily_backup_cron.sql 建的 backup_snapshot() 是
--   SECURITY DEFINER（需要跨表读权限），而 CREATE FUNCTION 默认把
--   EXECUTE 授予 PUBLIC → 任何能连上库的角色都能反复调用它。
--
-- 后果：
--   · 每次调用都会把 4 张业务表全量聚合写进 backups（写放大）
--   · 函数里只保留最近 30 份 → 匿名反复触发会**挤掉 pg_cron 的每日备份历史**
--   · backups 表存的是全量 JSONB，单次写入不小
--
-- 修法：REVOKE EXECUTE FROM PUBLIC。
--   · pg_cron 的 job 以 postgres 角色执行（超级用户）→ 不受影响
--   · 应用侧（data-api 用 service role 直连）本来也不调这个函数
--   · 手动验证仍可用：postgres 角色执行 SELECT public.backup_snapshot();
--
-- 依赖：20260908000003_daily_backup_cron.sql 已建好 backup_snapshot()
-- =============================================================

REVOKE ALL ON FUNCTION public.backup_snapshot() FROM PUBLIC;

-- 确认结果（应该只看到 postgres / pg_database_owner 之类）：
--   SELECT grantee, privilege_type
--     FROM information_schema.routine_privileges
--    WHERE routine_name = 'backup_snapshot';
-- =============================================================
-- 完成。
-- =============================================================
