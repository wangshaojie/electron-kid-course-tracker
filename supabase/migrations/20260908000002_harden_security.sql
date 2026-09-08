-- =============================================================
-- 一寸光阴 · Supabase 安全收紧（02/03）
-- -------------------------------------------------------------
-- 目标：即使 anon key 被打进 app.asar 拆包拿到、直接请求 PostgREST，
--       也拿不到 / 写不了 public 下的任何业务数据。
--
-- 手段（双保险，与 CloudBase 版"删 anon policy + revoke"一脉相承）：
--   1. 业务表 / 序列全部 REVOKE 掉 anon、authenticated 的权限
--      （未来新建表也会被 default privileges 默认封掉）
--   2. 业务表开启 RLS + FORCE（无任何 policy = 默认全拒），
--      函数侧用 postgres（superuser / service_role）直连，BYPASSRLS 不受影响
-- =============================================================

-- ---------- 1) 显式回收现存对象权限 ----------
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- ---------- 2) 未来在 public 新建对象默认也不给 anon/auth ----------
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- ---------- 3) RLS 兜底（无 policy = 全拒） ----------
ALTER TABLE public.children      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkins      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_otps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_prefs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_passwords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backups       ENABLE ROW LEVEL SECURITY;

-- FORCE：对表 owner 也生效（postgres 是 superuser 仍绕过；防未来用非 superuser 当 owner）
ALTER TABLE public.children      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.courses       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.checkins      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.email_otps    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_prefs    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_passwords FORCE ROW LEVEL SECURITY;
ALTER TABLE public.backups       FORCE ROW LEVEL SECURITY;

-- 显式声明：不建任何 policy。postgres/service_role 直连函数读写，
-- 安全靠 data-api 的 owner_id 强制注入 + 表名/列名白名单（沿用现状）。
-- 如果将来要开直连 PostgREST，需要重新设计 policy 并放开上述权限。

-- ---------- 4) 验证辅助 ----------
-- 下面三条可直接跑来看封禁是否生效（返回 0 行/报权限错都算正常）：
--   SET ROLE anon;
--   SELECT count(*) FROM public.children;   -- 应报 permission denied
--   RESET ROLE;
-- =============================================================
-- 完成。
-- =============================================================
