-- =============================================================
-- 一寸光阴 · user_prefs 加 theme 列(深/浅/跟随系统)
-- -------------------------------------------------------------
-- 4) 给 user_prefs 加 theme 列
--    允许值: 'dark' | 'light' | 'system'
--    含义:
--      dark   - 强制深色
--      light  - 强制浅色
--      system - 跟随操作系统 prefers-color-scheme
--    默认 'system' —— 首次启动时遵循用户系统的设置
--
-- 跟 CloudBase 那个 20260909140000_user_prefs_theme.sql 同步
-- (CloudBase 版是给 user_prefs 加列,这里是 Supabase PG 的对应版本)
-- =============================================================

ALTER TABLE public.user_prefs
  ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'system';

-- ADD ... DEFAULT 在 PG 里会自动回填,但 IF NOT EXISTS 路径下
-- 旧表没有这个列时,新加的列已经带 default 兜底
-- 这里再显式跑一次 UPDATE 保证保险(幂等)
UPDATE public.user_prefs
   SET theme = 'system'
 WHERE theme IS NULL;
