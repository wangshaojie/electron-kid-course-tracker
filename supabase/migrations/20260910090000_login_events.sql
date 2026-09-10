-- =============================================================
-- 一寸光阴 · login_events（登录/活跃事件流水）
-- -------------------------------------------------------------
-- 目的：管理员后台展示「最近登录时间 / IP / 设备 / 客户端版本」用。
-- 采集时机（auth-otp 内）：/verify、/login、/register 三个"签 JWT 成功"
--   的路径 INSERT 一条；/change-password 重签 JWT 不另写（用原 verify 那一行即可）。
--
-- 字段：
--   id           BIGSERIAL PK
--   owner_id     TEXT  NOT NULL    uid = sha256(email).slice(0,32)
--   email        TEXT               冗余存方便 admin 反查
--   ip           TEXT               x-forwarded-for 最左非 unknown
--   os           TEXT               Windows 10/11 / macOS / Linux ...
--   arch         TEXT               x64 / arm64 / x86
--   client       TEXT               electron-desktop / browser / unknown
--   app_version  TEXT               来自 X-Client-Version（package.json 同步）
--   electron_ver TEXT               Electron 内部版本（仅桌面端）
--   user_agent   TEXT               原始 UA，备用
--   auth_method  TEXT               'otp-verify' | 'password-login' | 'register'
--   created_at   TIMESTAMPTZ        默认 now()
--
-- 安全：
--   - 不开 RLS policy（无 policy = 全拒）。函数侧用 postgres 角色（service_role）
--     直连，BYPASSRLS 不受影响。
--   - 不存任何敏感凭据。只 IP / UA / 版本号。
-- =============================================================

CREATE TABLE IF NOT EXISTS public.login_events (
  id            BIGSERIAL PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  email         TEXT NOT NULL,
  ip            TEXT,
  os            TEXT,
  arch          TEXT,
  client        TEXT,
  app_version   TEXT,
  electron_ver  TEXT,
  user_agent    TEXT,
  auth_method   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 主索引：admin/users 查"每个 owner_id 最近一条"必须走 (owner_id, created_at DESC)
CREATE INDEX IF NOT EXISTS idx_login_events_owner_recent
  ON public.login_events (owner_id, created_at DESC);

-- 辅助：admin/stats 不需要这里；admin/users 聚合用
CREATE INDEX IF NOT EXISTS idx_login_events_created_at
  ON public.login_events (created_at DESC);

-- 收紧权限（沿用 02 文件策略：业务表 anon/authenticated 全拒）
REVOKE ALL PRIVILEGES ON public.login_events FROM anon, authenticated;
ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_events FORCE ROW LEVEL SECURITY;

-- =============================================================
-- 完成
-- =============================================================
