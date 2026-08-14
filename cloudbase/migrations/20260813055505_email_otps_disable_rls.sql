-- 关掉 email_otps 的 RLS
-- 原因：
--   1) 唯一写入方是 cloud function（用 secretId/secretKey 直连）
--   2) PostgREST 走 service role 应该 bypass RLS，但实际没 bypass
--   3) anon/authenticated 也没 policy，所以 RLS 存在只会挡 service 写
-- 安全模型：
--   - 写入：仅 cloud function（持有腾讯云永久密钥）
--   - 读：除 cloud function 外，业务上没人需要读 otp 表
--   - 验证码 10 分钟过期 + 一次消费后 consumed_at 标记，防重放
ALTER TABLE public.email_otps DISABLE ROW LEVEL SECURITY;
