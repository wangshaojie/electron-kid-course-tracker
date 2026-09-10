-- =============================================================
-- 一寸光阴  · email_otps 加部分索引（管理员后台 /admin/users 用）
-- -------------------------------------------------------------
-- 背景：
--   /admin/users 会跑
--     SELECT email, consumed_at
--       FROM email_otps
--      WHERE consumed_at IS NOT NULL
--      LIMIT 10000
--   现有索引（01_init_schema.sql）：
--     CREATE INDEX idx_email_otps_email_active
--       ON public.email_otps (email, created_at DESC) WHERE consumed_at IS NULL
--   那个索引只覆盖未消耗的 OTP，管理员后台这条查询是反向过滤，会走全表扫。
--   OTP 表随时间累积（每次 send 写一行），跑久了 1w+ 行起，全表扫拖慢整个 handler。
--
-- 修法：加 consumed_at 部分索引，复用 created_at DESC 让 LIMIT 10000 直接走索引扫描
-- =============================================================

CREATE INDEX IF NOT EXISTS idx_email_otps_consumed_recent
  ON public.email_otps (created_at DESC)
  WHERE consumed_at IS NOT NULL;

-- =============================================================
-- 完
-- =============================================================
