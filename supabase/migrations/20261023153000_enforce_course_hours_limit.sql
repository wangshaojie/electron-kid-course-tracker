-- =============================================================
-- 一寸光阴 · 累计课时约束（checkins ⇢ courses.total_hours）
-- -------------------------------------------------------------
-- 背景：
--   checkins 表原本只有单行 CHECK (hours > 0)，
--   **没有任何"累计课时不得超过购买课时"的约束**。
--   客户端虽然有预校验（used + hours > total 报错），但：
--     · 多设备同时打卡 → 两个请求各自算都够 → 扣穿
--     · 直调 data-api /b/checkins → 绕过客户端
--   连带后果：UI 的 remain 被 Math.max(0,…) 夹住，
--   但导出的明细行没夹 → 同一份文件里"剩余 -2 节"和"剩余 0 节"自相矛盾。
--
-- 本次加数据库层的最后一道闸：
--   触发器在 INSERT / UPDATE 之后校验该课程的打卡课时合计，
--   超过 total_hours 直接抛 check_violation（SQLSTATE 23514）。
--
-- 兼容性：
--   · 已核对现有数据：**没有任何课程已超课时** → 可直接启用，不会挡住历史写入
--   · 孤儿打卡（course_id 指向已删课程，共 8 条）没有总额可校验 → 放行
--   · 同一课程并发写入：校验时对 courses 行加 FOR UPDATE 锁，
--     让并发插入串行化，避免"两个请求各自算都够"
--
-- 前置：01_init_schema.sql 已建好 courses / checkins
-- =============================================================

-- ---------- 校验辅助函数：某课程累计课时是否已超 ----------
-- 用 RAISE 而不是返回 boolean：报错信息能带上累计值与总额，
-- data-api 再把它翻译成用户看得懂的中文。
CREATE OR REPLACE FUNCTION public.assert_course_hours_ok(p_course_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_total numeric;
  v_used  numeric;
BEGIN
  IF p_course_id IS NULL THEN
    RETURN;
  END IF;

  -- FOR UPDATE：锁住课程行，同一课程的打卡并发写入会在这里串行化
  SELECT total_hours
    INTO v_total
    FROM public.courses
   WHERE id = p_course_id
     FOR UPDATE;

  IF NOT FOUND OR v_total IS NULL THEN
    -- 孤儿打卡（课程已删）没有总额可校验 → 放行
    RETURN;
  END IF;

  SELECT COALESCE(SUM(hours), 0)
    INTO v_used
    FROM public.checkins
   WHERE course_id = p_course_id;

  IF v_used > v_total THEN
    RAISE EXCEPTION
      'course_hours_exceeded: 课程 % 累计已用 % 节，超过购买 % 节', p_course_id, v_used, v_total
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- ---------- 触发器函数 ----------
CREATE OR REPLACE FUNCTION public.enforce_course_hours_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- UPDATE 把打卡挪到别的课程 → 旧课程也要重新校验（此时行已移出旧课程，sum 已正确）
  IF TG_OP = 'UPDATE' AND OLD.course_id IS DISTINCT FROM NEW.course_id THEN
    PERFORM public.assert_course_hours_ok(OLD.course_id);
  END IF;

  PERFORM public.assert_course_hours_ok(NEW.course_id);
  RETURN NEW;
END;
$$;

-- ---------- 挂触发器 ----------
DROP TRIGGER IF EXISTS trg_checkins_course_hours_limit ON public.checkins;

CREATE TRIGGER trg_checkins_course_hours_limit
  AFTER INSERT OR UPDATE ON public.checkins
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_course_hours_limit();

-- ---------- 权限收口 ----------
-- 这两个函数只该被服务端的 postgres 角色调用（data-api 用 service role 直连）。
-- 默认 CREATE FUNCTION 会把 EXECUTE 给 PUBLIC，收回来。
REVOKE ALL ON FUNCTION public.assert_course_hours_ok(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_course_hours_limit() FROM PUBLIC;

-- ---------- 验证 ----------
-- 手动试一次（会抛错 = 约束生效）：
--   INSERT INTO public.checkins (id, owner_id, child_id, course_id, date, hours)
--   SELECT 'test-xxx', owner_id, child_id, id, current_date, total_hours + 1
--     FROM public.courses LIMIT 1;
--
-- 查当前各课程累计（确认没有超限的）：
--   SELECT c.name, c.total_hours, COALESCE(SUM(k.hours),0) AS used
--     FROM courses c LEFT JOIN checkins k ON k.course_id = c.id
--    GROUP BY c.id, c.name, c.total_hours;
-- =============================================================
-- 完成。
-- =============================================================
