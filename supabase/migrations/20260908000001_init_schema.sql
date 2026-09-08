-- =============================================================
-- 一寸光阴 · Supabase 建表脚本（01/03）
-- -------------------------------------------------------------
-- 来源：cloudbase/migrations/_neon_combined.sql（Neon 最终态）
--       表结构 / 列 / 索引与 CloudBase 线上完全一致，保证存量数据可直接搬。
--
-- 适用：Supabase PostgreSQL 15+
-- 执行：Supabase Dashboard → SQL Editor 粘贴执行，或 supabase db push
-- 角色：以 postgres（owner）执行即可；业务函数用同角色直连（superuser，BYPASSRLS）。
--
-- ⚠️ 幂等：全部 CREATE 用 IF NOT EXISTS，可重复执行。
-- ⚠️ 安全：本文件只建结构；anon/authenticated 的封禁见 02 文件。
-- =============================================================

-- ====== 扩展 ======
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ====== children：宝贝档案 ======
CREATE TABLE IF NOT EXISTS public.children (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id    TEXT NOT NULL,
  name        TEXT NOT NULL CHECK (length(name) > 0),
  emoji       TEXT NOT NULL DEFAULT '🧒',
  color       TEXT NOT NULL DEFAULT '#3FB87A',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_children_owner
  ON public.children (owner_id, sort_order);

-- ====== courses：课程 ======
CREATE TABLE IF NOT EXISTS public.courses (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id      TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_courses_owner    ON public.courses (owner_id);
CREATE INDEX IF NOT EXISTS idx_courses_child   ON public.courses (child_id);
CREATE INDEX IF NOT EXISTS idx_courses_paid_at ON public.courses (paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_courses_expires ON public.courses (expires_at);

-- ====== checkins：上课打卡 ======
CREATE TABLE IF NOT EXISTS public.checkins (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id    TEXT NOT NULL,
  child_id    TEXT NOT NULL,
  course_id   TEXT NOT NULL,
  date        DATE NOT NULL,
  hours       NUMERIC(10,2) NOT NULL CHECK (hours > 0),
  feedback    TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkins_owner   ON public.checkins (owner_id);
CREATE INDEX IF NOT EXISTS idx_checkins_child   ON public.checkins (child_id);
CREATE INDEX IF NOT EXISTS idx_checkins_course  ON public.checkins (course_id);
CREATE INDEX IF NOT EXISTS idx_checkins_date    ON public.checkins (date DESC);

-- ====== email_otps：验证码临时存储（service-only） ======
CREATE TABLE IF NOT EXISTS public.email_otps (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL,
  code_hash     TEXT NOT NULL,
  salt          TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  attempts      INT NOT NULL DEFAULT 0,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_otps_email_active
  ON public.email_otps (email, created_at DESC)
  WHERE consumed_at IS NULL;

-- ====== user_prefs：用户偏好（激活宝贝） ======
CREATE TABLE IF NOT EXISTS public.user_prefs (
  owner_id         TEXT PRIMARY KEY,
  active_child_id  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_prefs_active_child
  ON public.user_prefs (active_child_id);

-- ====== user_passwords：scrypt 密码哈希（自建认证） ======
CREATE TABLE IF NOT EXISTS public.user_passwords (
  email         TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ====== backups：每日备份快照（pg_cron 写入，见 03 文件） ======
CREATE TABLE IF NOT EXISTS public.backups (
  id              BIGSERIAL PRIMARY KEY,
  taken_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload         JSONB NOT NULL,
  schema_version  INT NOT NULL DEFAULT 1,
  row_counts      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_backups_taken_at ON public.backups (taken_at DESC);

-- =============================================================
-- 完成。RLS / anon 封禁由 20260908000002_harden_security.sql 处理。
-- =============================================================
