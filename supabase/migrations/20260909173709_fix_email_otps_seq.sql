-- =============================================================
-- 一寸光阴 · 修复 email_otps 序列不同步
-- -------------------------------------------------------------
-- 症状：发码时 /api/auth-otp/send 报
--   duplicate key value violates unique constraint "email_otps_pkey"
-- 根因：email_otps.id 是 BIGSERIAL（背后 sequence email_otps_id_seq），
--       sequence 的 nextval ≤ 表内已有 max(id) → 下次 INSERT 撞主键。
--       常见来源：历史上有人手工 INSERT 用显式 id、setval 调小、
--       老 CloudBase 端点用过非 seq 取值。
-- 修法：把 sequence 拉到 max(id) 之后（空表时设 1）。
-- 安全：setval 不会删数据，只是把序列指针前移；不锁表。
-- =============================================================

SELECT setval(
  pg_get_serial_sequence('public.email_otps', 'id'),
  GREATEST(COALESCE((SELECT MAX(id) FROM public.email_otps), 1), 1)
);
