-- =============================================================
-- 一寸光阴 · user_prefs.theme 语义修正：NULL = "用户还没选过"
-- -------------------------------------------------------------
-- 背景：
--   theme 列原来是 TEXT NOT NULL DEFAULT 'system'。
--   于是「写激活孩子」（PATCH /b/user_prefs 只带 active_child_id）在**新建**行时，
--   theme 会拿到列默认值 'system' —— 但这个 'system' 用户从没选过，
--   它只是个列默认值。
--   随后 syncFromCloud() 把云端值当成"用户的明确选择"，
--   于是本地显式选的 dark / light 会被这个假 'system' 覆盖（P2 #9）。
--
-- 修法：
--   · theme 改成可空、默认值 NULL
--     → NULL 明确表示"用户还没在云端选过"，客户端读不到明确值就不覆盖本地
--     → 新建 user_prefs 行时 theme 保持 NULL，不再伪造一个 'system'
--   · 历史上所有 theme='system' 的行都是列默认值自动填的（用户从没主动选过，
--     线上 3 行全是这种），清成 NULL：
--       - 视觉上完全一样（'system' 与 NULL 都是"跟随操作系统"）
--       - 但不再被当成"云端的明确选择"去覆盖本地显式选择
--     真正由用户主动选的 'system' 会在下次 persistRemote 时重新写回。
--
-- 幂等：可重复执行。
-- =============================================================

-- 1) 允许 NULL
ALTER TABLE public.user_prefs
  ALTER COLUMN theme DROP NOT NULL;

-- 2) 默认值改成 NULL（新建行不再伪造 'system'）
ALTER TABLE public.user_prefs
  ALTER COLUMN theme SET DEFAULT NULL;

-- 3) 清掉历史假 'system'
UPDATE public.user_prefs
   SET theme = NULL
 WHERE theme = 'system';

-- 自检：应该只剩 NULL 或 dark/light/system（用户主动选的）
-- SELECT theme, count(*) FROM public.user_prefs GROUP BY theme;
