/**
 * data/childPool.ts —— 创建孩子时的 emoji / 主题色池
 *
 * 从 schema.ts 拆出（schema.ts 含 sql.js 的 DDL 死代码，不应再被任何模块 import）。
 */

/** 内置 emoji 池 —— 新建孩子时随机 / 选一个 */
export const CHILD_EMOJI_POOL = [
  '🧒', '👧', '👦', '🧒🏻', '👧🏻', '👦🏻', '🧒🏼', '👧🏼', '👦🏼',
  '🧒🏽', '👧🏽', '👦🏽', '🧒🏾', '👧🏾', '👦🏾', '🧒🏿', '👧🏿', '👦🏿',
  '🐯', '🐰', '🐻', '🐶', '🦊', '🐼', '🐨', '🐸', '🐵', '🦁', '🐱', '🐭', '🐹',
] as const

/** 主题色池（孩子头像底色） */
export const CHILD_COLOR_POOL = [
  '#3FB87A', // 薄荷绿
  '#7AC7FF', // 天空蓝
  '#FFB96B', // 暖橘
  '#FF8B96', // 樱粉
  '#A78BFA', // 葡萄紫
  '#FCD34D', // 奶黄
  '#34D399', // 翠绿
  '#F472B6', // 玫粉
  '#60A5FA', // 蓝宝石
] as const
