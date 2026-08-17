-- 20260817000000_business_anon_harden.sql
-- 业务数据收口到 data-api（service role, BYPASSRLS）后，收紧 anon 权限：
--   1) 删除 5 张表的 anon 全权 policy（USING(true) / WITH CHECK(true)）
--   2) REVOKE anon 对业务表 + email_otps 的全部权限（双保险）
--
-- 背景：
--   - 前端已改走 data-api /b/* HTTP API（owner_id 由服务端从 JWT 注入）
--   - data-api 用 service role 直连 PG（rolbypassrls=true，不受 RLS 影响）
--   - anon publishable key 即使被拆包提取，直连 PostgREST 也读不到任何数据
--
-- ⚠️ 执行顺序：必须先完成 ① data-api 新代码部署 ② 前端新代码构建，
--    否则前端（还在直连的旧版）会立即全部失败。
--
-- 幂等：DROP POLICY IF EXISTS / REVOKE 均幂等，可重复执行。

DROP POLICY IF EXISTS children_anon_all ON children;
DROP POLICY IF EXISTS courses_anon_all ON courses;
DROP POLICY IF EXISTS checkins_anon_all ON checkins;
DROP POLICY IF EXISTS user_prefs_anon_all ON user_prefs;
DROP POLICY IF EXISTS backups_anon_all ON backups;

REVOKE ALL PRIVILEGES ON TABLE public.children FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.courses FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.checkins FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.user_prefs FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.backups FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.email_otps FROM anon;
