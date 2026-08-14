-- 邮箱验证码表
-- 用 Resend 自建 OTP，验证码存这里（不存明文 code，存 sha256(code+salt)）
-- 字段说明：
--   email        : 目标邮箱（小写）
--   code_hash    : sha256(code + salt)，不存明文
--   salt         : 16 字节随机盐
--   expires_at   : 过期时间（默认 10 分钟）
--   consumed_at  : 验证成功时间（防重放）
--   attempts     : 尝试验证次数（防爆破，到 5 次就废）
--   ip           : 请求来源 IP（审计用，可空）

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

-- 定时清理：每 1 小时清理一次已消费/已过期 1 小时以上的记录
-- （用 pg_cron 没装就先用客户端在 cloud function 里 DELETE，下次再补 cron extension）

-- RLS：email_otps 只允许 service role 读写（HTTP Function 用 @cloudbase/node-sdk 带 env id + secret key）
-- anon/authenticated 都不应直接读写
ALTER TABLE public.email_otps ENABLE ROW LEVEL SECURITY;

-- 不给 anon/authenticated 任何 policy，service role 走 Bypass RLS
DROP POLICY IF EXISTS "service_role_all" ON public.email_otps;
-- service role 自身已 bypass RLS，无需 policy

GRANT ALL ON public.email_otps TO authenticated;
GRANT ALL ON public.email_otps TO anon;
-- 但因为没 anon/authenticated 的 policy，所以他们的请求会全被拒。
-- 只有 service role 能读写。
