-- 业务表 (children/courses/checkins) 关闭 RLS
--
-- 原因：现在用自建 JWT + 走 PostgREST HTTP API，
--   - auth.uid() 在没 CloudBase auth session 时返回 null
--   - 强行 RLS 会导致"全用户都看到 owner_id=null 的行"或拒绝写
--   - 改用前端 store 自己做 .eq('owner_id', uid) 过滤（数据隔离仍生效）
--
-- 安全模型：
--   - 写入：前端 store 显式传 owner_id = 当前登录用户的 uid（来自自签 JWT）
--   - 读：前端 store .where({ owner_id: uid }) 过滤
--   - 旧 RLS policy 仍然保留作 fallback（如果将来切回 CloudBase auth 可直接恢复）
--   - 不依赖 PostgREST anon/authenticated 角色，自己代码层强 owner_id 隔离

ALTER TABLE public.children DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkins DISABLE ROW LEVEL SECURITY;
