-- 20260814100000_backups.sql
-- 备份表：pg-backup HTTP Function 每日把 children/courses/checkins/user_prefs 快照写到本表
-- 30 天滚动（pg-backup 函数里 DELETE 旧行）

CREATE TABLE IF NOT EXISTS backups (
  id              BIGSERIAL PRIMARY KEY,
  taken_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload         JSONB NOT NULL,
  schema_version  INT NOT NULL DEFAULT 1,
  row_counts      JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_backups_taken_at ON backups (taken_at DESC);

GRANT SELECT, INSERT, DELETE ON backups TO authenticated;

-- 同业务表：disable RLS，让 service role 通道直接读写
ALTER TABLE backups DISABLE ROW LEVEL SECURITY;
