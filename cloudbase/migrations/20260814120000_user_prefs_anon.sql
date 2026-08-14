-- 20260814120000_user_prefs_anon.sql
-- 修复：user_prefs 漏了 anon 授权 → 前端 publishable key（PostgREST anon 角色）读 user_prefs 报
--   permission denied for table user_prefs (42501)
--
-- 与其他业务表（children/courses/checkins）对齐：
--   - RLS 已 DISABLE（见 20260813055506）
--   - 但 PostgREST 的 anon 角色仍需显式 GRANT 才能读写
--
-- 安全模型与 20260813055507_anon_policies.sql 一致：
--   数据隔离靠前端 .eq('owner_id', uid) 代码层保证

DROP POLICY IF EXISTS user_prefs_anon_all ON user_prefs;
CREATE POLICY user_prefs_anon_all ON user_prefs
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_prefs TO anon;
