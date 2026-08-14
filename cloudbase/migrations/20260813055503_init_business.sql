-- 20260813055503_init_business.sql
-- 一寸光阴 · 业务表 (PG 模式) + RLS
--
-- 设计：
--   1) 每个业务表都有 owner_id (text)，由 DEFAULT auth.uid() 填充
--      auth.uid() 返回 text，参考 CloudBase PG 文档
--   2) RLS Policy 用 USING (owner_id = auth.uid()) 严格隔离多用户
--   3) GRANT authenticated 全权；anon 只读（虽然 anon 没什么意义）
--   4) child_id 在 courses/checkins 上是 text（不是 FK）
--      因为 CloudBase PG 的 RLS 隔离基于 owner_id，跨表 FK 在 RLS 环境下经常被绕过

-- ============================================================
-- 启用扩展
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- children  孩子档案
-- ============================================================
CREATE TABLE IF NOT EXISTS children (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id    TEXT NOT NULL DEFAULT auth.uid(),
  name        TEXT NOT NULL CHECK (length(name) > 0),
  emoji       TEXT NOT NULL DEFAULT '🧒',
  color       TEXT NOT NULL DEFAULT '#3FB87A',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_children_owner
  ON children (owner_id, sort_order);

ALTER TABLE children ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS children_select ON children;
DROP POLICY IF EXISTS children_insert ON children;
DROP POLICY IF EXISTS children_update ON children;
DROP POLICY IF EXISTS children_delete ON children;

CREATE POLICY children_select ON children
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY children_insert ON children
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY children_update ON children
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY children_delete ON children
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON children TO authenticated;

-- ============================================================
-- courses  课程
-- ============================================================
CREATE TABLE IF NOT EXISTS courses (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id      TEXT NOT NULL DEFAULT auth.uid(),
  child_id      TEXT NOT NULL,
  name          TEXT NOT NULL CHECK (length(name) > 0),
  institution   TEXT NOT NULL DEFAULT '',
  total_amount  NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  total_hours   NUMERIC(10,2) NOT NULL CHECK (total_hours > 0),
  paid_at       DATE NOT NULL,
  expires_at    DATE,
  tags          TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_courses_owner    ON courses (owner_id);
CREATE INDEX IF NOT EXISTS idx_courses_child   ON courses (child_id);
CREATE INDEX IF NOT EXISTS idx_courses_paid_at ON courses (paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_courses_expires ON courses (expires_at);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS courses_select ON courses;
DROP POLICY IF EXISTS courses_insert ON courses;
DROP POLICY IF EXISTS courses_update ON courses;
DROP POLICY IF EXISTS courses_delete ON courses;

CREATE POLICY courses_select ON courses
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY courses_insert ON courses
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY courses_update ON courses
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY courses_delete ON courses
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON courses TO authenticated;

-- ============================================================
-- checkins  打卡
-- ============================================================
CREATE TABLE IF NOT EXISTS checkins (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id    TEXT NOT NULL DEFAULT auth.uid(),
  child_id    TEXT NOT NULL,
  course_id   TEXT NOT NULL,
  date        DATE NOT NULL,
  hours       NUMERIC(10,2) NOT NULL CHECK (hours > 0),
  feedback    TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkins_owner   ON checkins (owner_id);
CREATE INDEX IF NOT EXISTS idx_checkins_child   ON checkins (child_id);
CREATE INDEX IF NOT EXISTS idx_checkins_course  ON checkins (course_id);
CREATE INDEX IF NOT EXISTS idx_checkins_date    ON checkins (date DESC);

ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checkins_select ON checkins;
DROP POLICY IF EXISTS checkins_insert ON checkins;
DROP POLICY IF EXISTS checkins_update ON checkins;
DROP POLICY IF EXISTS checkins_delete ON checkins;

CREATE POLICY checkins_select ON checkins
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY checkins_insert ON checkins
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY checkins_update ON checkins
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY checkins_delete ON checkins
  FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON checkins TO authenticated;
