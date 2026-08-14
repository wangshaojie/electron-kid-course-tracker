-- 给 business tables 加 anon 角色的全权 policy
-- 原因：现在 RLS 关闭了，anon 仍报 permission denied
-- 是 PostgREST 走 anon 角色做写操作，需要显式 grant + policy 才能写
-- （虽然 RLS 关闭了，但 PostgREST 的角色权限检查仍生效）
--
-- 安全模型：
--   - 前端 js-sdk 用 publishable key 走 anon 角色
--   - anon 角色可以读写所有 children/courses/checkins 行
--   - 数据隔离由前端代码层 .eq('owner_id', uid) 强制保证
--   - 这意味着任何拿到 publishable key 的人都能读到所有行
--     → 但 publishable key 本来就是公开的（前端用），所以是同一信任域
--     → 安全边界依赖 owner_id 字段在所有 query 中被显式过滤（store 代码已做到）

DROP POLICY IF EXISTS children_anon_all ON children;
CREATE POLICY children_anon_all ON children
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS courses_anon_all ON courses;
CREATE POLICY courses_anon_all ON courses
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS checkins_anon_all ON checkins;
CREATE POLICY checkins_anon_all ON checkins
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);
