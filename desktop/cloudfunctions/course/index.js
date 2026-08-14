// 云函数：course
// 课程 CRUD
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const COL = 'courses'

exports.main = async (event, context) => {
	const { action, data, id, kid_id } = event
	const wxContext = cloud.getWXContext()
	const openid = wxContext.OPENID

	try {
		switch (action) {
			case 'add': {
				const payload = {
					_openid: openid,
					kid_id: data.kid_id,
					org: data.org,
					subject: data.subject,
					mode: data.mode,
					total_count: data.mode === 'count' ? Number(data.total_count || 0) : 0,
					used_count: 0,
					start_date: data.start_date || '',
					expire_date: data.expire_date || '',
					total_fee: Number(data.total_fee || 0),
					paid_date: data.paid_date || '',
					note: data.note || '',
					status: 'active',
					created_at: Date.now(),
					updated_at: Date.now()
				}
				const res = await db.collection(COL).add({ data: payload })
				return { ok: true, data: { _id: res._id } }
			}
			case 'update': {
				if (!id) return { ok: false, error: 'missing id' }
				const payload = {
					org: data.org,
					subject: data.subject,
					mode: data.mode,
					total_count: data.mode === 'count' ? Number(data.total_count || 0) : 0,
					start_date: data.start_date,
					expire_date: data.expire_date,
					total_fee: Number(data.total_fee || 0),
					paid_date: data.paid_date,
					note: data.note,
					updated_at: Date.now()
				}
				await db.collection(COL).doc(id).update({ data: payload })
				return { ok: true }
			}
			case 'remove': {
				if (!id) return { ok: false, error: 'missing id' }
				// 联动删打卡记录
				await db.collection('attendance').where({ _openid: openid, course_id: id }).remove()
				await db.collection(COL).doc(id).remove()
				return { ok: true }
			}
			case 'list': {
				const where = { _openid: openid }
				if (kid_id) where.kid_id = kid_id
				if (data && data.status) where.status = data.status
				const res = await db.collection(COL).where(where).orderBy('created_at', 'desc').limit(200).get()
				return { ok: true, data: res.data }
			}
			case 'get': {
				if (!id) return { ok: false, error: 'missing id' }
				const res = await db.collection(COL).doc(id).get()
				return { ok: true, data: res.data }
			}
			case 'setStatus': {
				if (!id) return { ok: false, error: 'missing id' }
				await db.collection(COL).doc(id).update({
					data: { status: data.status, updated_at: Date.now() }
				})
				return { ok: true }
			}
			default:
				return { ok: false, error: `unknown action: ${action}` }
		}
	} catch (e) {
		console.error('[course] error', e)
		return { ok: false, error: e.message }
	}
}
