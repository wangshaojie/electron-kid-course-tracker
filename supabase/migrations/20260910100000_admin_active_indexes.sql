-- =============================================================
-- 一寸光阴 · 管理员后台 /active 趋势查询优化索引
-- -------------------------------------------------------------
-- 背景：管理员后台「活跃度 + 留存」模块（/admin/active）按
--       created_at 范围扫 children 表，按 owner_id 范围扫
--       login_events 表。现有索引：
--         - idx_children_owner (owner_id, sort_order)
--         - idx_login_events_created_at (created_at DESC)
--         - idx_login_events_owner_recent (owner_id, created_at DESC)
--       缺一个 children.created_at 倒序索引，加一个。
--       login_events 的 (created_at DESC) 已存在，无需重复。
--
-- 幂等：IF NOT EXISTS，可重复执行。
-- =============================================================

-- children：管理员后台活跃度查询按 created_at 倒序扫
CREATE INDEX IF NOT EXISTS idx_children_created_at
  ON public.children (created_at DESC);

-- =============================================================
-- 完成
-- =============================================================
