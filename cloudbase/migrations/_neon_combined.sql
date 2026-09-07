-- =============================================================
-- 一寸光阴 · Neon 一次性建表脚本
-- -------------------------------------------------------------
-- 来源：把 cloudbase/migrations/ 下 12 个 SQL 按时间序合并，
--       去掉 CloudBase 特有的部分（auth.uid()、anon/authenticated 角色、policy），
--       保留最终态的 schema（RLS off、owner_id NOT NULL、CHECK 完整）。
--
-- 适用：Neon Postgres（标准 PG 14+）
-- 角色：连接串里的 owner 用户（创建时自动拿到 superuser 权限），
--       后续所有表都归这个用户所有，Vercel Functions 直连即可。
--
-- 使用：psql "$DATABASE_URL" -f _neon_combined.sql
--        或：psql "postgresql://..." < _neon_combined.sql
--
-- ⚠️ 幂等：所有 CREATE 用 IF NOT EXISTS，可重复跑。
-- ⚠️ 业务安全：Neon 端不开 RLS，由 data-api 服务端强制注入 owner_id（沿用现状）。
-- =============================================================

-- ====== 1) 扩展（Neon 默认装 pgcrypto；保险起见再 if not exists）======
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ====== 2) children ======
CREATE TABLE IF NOT EXISTS children (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id    TEXT NOT NULL,
  name        TEXT NOT NULL CHECK (length(name) > 0),
  emoji       TEXT NOT NULL DEFAULT '🧒',
  color       TEXT NOT NULL DEFAULT '#3FB87A',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_children_owner
  ON children (owner_id, sort_order);

-- ====== 3) courses ======
CREATE TABLE IF NOT EXISTS courses (
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

CREATE INDEX IF NOT EXISTS idx_courses_owner    ON courses (owner_id);
CREATE INDEX IF NOT EXISTS idx_courses_child   ON courses (child_id);
CREATE INDEX IF NOT EXISTS idx_courses_paid_at ON courses (paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_courses_expires ON courses (expires_at);

-- ====== 4) checkins ======
CREATE TABLE IF NOT EXISTS checkins (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  owner_id    TEXT NOT NULL,
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

-- ====== 5) email_otps（不设 RLS，service-only）======
CREATE TABLE IF NOT EXISTS email_otps (
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
  ON email_otps (email, created_at DESC)
  WHERE consumed_at IS NULL;

-- ====== 6) user_prefs ======
CREATE TABLE IF NOT EXISTS user_prefs (
  owner_id         TEXT PRIMARY KEY,
  active_child_id  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_prefs_active_child
  ON user_prefs (active_child_id);

-- ====== 7) backups（每日 PG 备份）======
CREATE TABLE IF NOT EXISTS backups (
  id              BIGSERIAL PRIMARY KEY,
  taken_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload         JSONB NOT NULL,
  schema_version  INT NOT NULL DEFAULT 1,
  row_counts      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_backups_taken_at ON backups (taken_at DESC);

-- ====== 8) user_passwords（scrypt 哈希，可选登录）======
CREATE TABLE IF NOT EXISTS user_passwords (
  email         TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================
-- 完成。
-- 不开 RLS：不依赖 anon/authenticated 角色，不写 policy。
-- 安全完全由 data-api 服务端 owner_id 强制注入保证。
-- =============================================================
