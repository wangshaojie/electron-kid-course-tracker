// 云函数：stats
// 聚合统计：summary / monthly / group / compare
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function ymd(ts) {
	const d = new Date(ts)
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function rangeStart(type) {
	const now = new Date()
	if (type === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
	if (type === 'year') return new Date(now.getFullYear(), 0, 1).getTime()
	return 0
}

exports.main = async (event, context) => {
	const { type, where, field, months } = event
	const wxContext = cloud.getWXContext()
	const openid = wxContext.OPENID
	const _where = { _openid: openid, ...(where || {}) }
	if (!_where.kid_id) delete _where.kid_id

	try {
		// ============ 1. summary ============
		if (type === 'summary') {
			const monthStart = rangeStart('month')
			const yearStart = rangeStart('year')

			const allRes = await db.collection('courses').where(_where).get()
			const total = (allRes.data || []).reduce((s, c) => s + (c.total_fee || 0), 0)

			const monthRes = await db.collection('courses').where({
				..._where,
				paid_date: _.gte(ymd(monthStart))
			}).get()
			const month = (monthRes.data || []).reduce((s, c) => s + (c.total_fee || 0), 0)

			const yearRes = await db.collection('courses').where({
				..._where,
				paid_date: _.gte(ymd(yearStart))
			}).get()
			const year = (yearRes.data || []).reduce((s, c) => s + (c.total_fee || 0), 0)

			return { ok: true, data: { total, month, year } }
		}

		// ============ 2. monthly ============
		if (type === 'monthly') {
			const list = months || []
			const startDate = list.length ? `${list[0]}-01` : '2000-01-01'
			const res = await db.collection('courses').where({
				..._where,
				paid_date: _.gte(startDate)
			}).get()
			const map = {}
			list.forEach(m => { map[m] = 0 })
			;(res.data || []).forEach(c => {
				if (c.paid_date && c.paid_date >= startDate) {
					const m = c.paid_date.slice(0, 7)
					if (map[m] != null) map[m] += (c.total_fee || 0)
				}
			})
			return { ok: true, data: list.map(m => Number((map[m] || 0).toFixed(2))) }
		}

		// ============ 3. group ============
		if (type === 'group') {
			const f = field || 'org'
			const res = await db.collection('courses').where(_where).get()
			const map = {}
			;(res.data || []).forEach(c => {
				const k = c[f] || '未分类'
				map[k] = (map[k] || 0) + (c.total_fee || 0)
			})
			const data = Object.entries(map)
				.map(([name, value]) => ({ name, value: Number(value.toFixed(2)) }))
				.sort((a, b) => b.value - a.value)
			return { ok: true, data }
		}

		// ============ 4. compare ============
		if (type === 'compare') {
			const kidsRes = await db.collection('kids').where({ _openid: openid }).get()
			const coursesRes = await db.collection('courses').where({ _openid: openid }).get()
			const map = {}
			kidsRes.data.forEach(k => { map[k._id] = 0 })
			;(coursesRes.data || []).forEach(c => {
				if (map[c.kid_id] != null) map[c.kid_id] += (c.total_fee || 0)
			})
			const categories = kidsRes.data.map(k => k.name)
			const data = kidsRes.data.map(k => Number((map[k._id] || 0).toFixed(2)))
			return { ok: true, categories, data }
		}

		return { ok: false, error: `unknown type: ${type}` }
	} catch (e) {
		console.error('[stats] error', e)
		return { ok: false, error: e.message }
	}
}
