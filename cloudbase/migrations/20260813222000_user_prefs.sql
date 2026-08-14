-- 20260813222000_user_prefs.sql
-- 账号偏好表 —— 一个账号一行，存激活孩子、以后还能扩（默认排序、主题、提醒等）
--
-- 设计：
--   - owner_id 既是 PK 又是 owner_id（一个账号一行，天然不重复）
--   - active_child_id 不加 FK：跟 children 同套逻辑，RLS 隔离已够用
--   - RLS 关闭、GRANT 业务表同款（与 children/courses/checkins 保持一致）
--   - updated_at 自动维护

CREATE TABLE IF NOT EXISTS user_prefs (
  owner_id         TEXT PRIMARY KEY,
  active_child_id  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_prefs_active_child
  ON user_prefs (active_child_id);

ALTER TABLE user_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_prefs_all ON user_prefs;

CREATE POLICY user_prefs_all ON user_prefs
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON user_prefs TO authenticated;

-- 跟业务表同款：disable RLS，让 SDK 走 service role 直写
-- （和 children/courses/checkins 一致，原因见 20260813055506）
ALTER TABLE user_prefs DISABLE ROW LEVEL SECURITY;
