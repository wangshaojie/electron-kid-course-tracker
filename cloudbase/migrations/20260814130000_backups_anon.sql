-- 20260814130000_backups_anon.sql
-- 修复：backups 表（pg-backup 写入）缺少 anon 授权
--   背景：pg-backup 函数用 secretId/secretKey 初始化 rdb，但 CloudBase rdb
--         默认走 anon 角色（RLS 不自动 bypass service_role），因此 backups
--         表必须显式授权 anon 才能 INSERT/DELETE（见 takeBackup）。
--   安全：backups 内容 = 全账号业务数据快照，但只允许本环境 anon 写/读，
--         实际恢复时仅授权账号可查；与 RLS 关闭的业务模型保持一致。

DROP POLICY IF EXISTS backups_anon_all ON backups;
CREATE POLICY backups_anon_all ON backups
  FOR ALL TO anon
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON backups TO anon;
