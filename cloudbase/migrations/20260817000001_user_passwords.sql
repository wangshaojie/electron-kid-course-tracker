-- 用户密码表（可选登录方式：邮箱 + 密码）
-- 不建独立用户表 —— 沿用"邮箱即身份"约定（uid = sha256(email).slice(0,32) 不变）
-- 不设密码的用户照常用验证码登录；设了密码的两种方式都能登
-- 字段说明：
--   email         : 小写邮箱（PK，与 email_otps 同 key 约定）
--   password_hash : scrypt 哈希（含盐），格式 scrypt$N$r$p$salt$hash（Node crypto.scryptSync 生成）
--   created_at    : 首次设置时间
--   updated_at    : 最近修改时间（改密码时更新）
--
-- ⚠️ 权限模型与 20260817000000_business_anon_harden 一致：
--   RLS 开启 + REVOKE anon/authenticated → 只有 service role（auth-otp 云函数）能读写。
--   （最初版本误用 GRANT，线上实际执行的是 REVOKE，此文件已修正对齐）
--
-- ⚠️ 执行注意（Windows PowerShell）：多行/含 $ 的 SQL 不要用 --sql "$(cat file)" 传参，
--    $ 会被 PowerShell 当变量插值、多行可能被破坏。建议：
--   tcb db execute -e <envId> --sql "$(Get-Content -Raw -Encoding UTF8 cloudbase/migrations/xxx.sql)"
--   或拆成单条内联执行。

CREATE TABLE IF NOT EXISTS public.user_passwords (
  email         TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_passwords ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.user_passwords FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.user_passwords FROM authenticated;
