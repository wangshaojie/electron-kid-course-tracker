// 云函数：checkin
// 打卡 + 课时扣减 + 查询 + 撤销
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const COL = 'attendance'

exports.main = async (event, context) => {
	const { action, data } = event
	const wxContext = cloud.getWXContext()
	const openid = wxContext.OPENID

	try {
		switch (action) {
			case 'add': {
				const { course_id, count = 1, date, note = '' } = data
				if (!course_id) return { ok: false, error: 'missing course_id' }

				// 查课程
				const cRes = await db.collection('courses').doc(course_id).get()
				const course = cRes.data
				if (!course) return { ok: false, error: '课程不存在' }
				if (course.status !== 'active') return { ok: false, error: '课程已停用' }

				// 写打卡记录
				const attRes = await db.collection(COL).add({
					data: {
						_openid: openid,
						kid_id: course.kid_id,
						course_id,
						date: date || new Date().toISOString().slice(0, 10),
						count,
						note,
						created_at: Date.now()
					}
				})

				// 扣减课时（仅按次模式）
				if (course.mode === 'count') {
					await db.collection('courses').doc(course_id).update({
						data: {
							used_count: _.inc(count),
							updated_at: Date.now()
						}
					})
				}

				return { ok: true, data: { _id: attRes._id } }
			}
			case 'remove': {
				const { id } = data
				if (!id) return { ok: false, error: 'missing id' }
				const aRes = await db.collection(COL).doc(id).get()
				const att = aRes.data
				if (!att) return { ok: false, error: '记录不存在' }
				await db.collection(COL).doc(id).remove()
				const cRes = await db.collection('courses').doc(att.course_id).get()
				if (cRes.data && cRes.data.mode === 'count') {
					await db.collection('courses').doc(att.course_id).update({
						data: {
							used_count: _.inc(-att.count),
							updated_at: Date.now()
						}
					})
				}
				return { ok: true }
			}
			case 'listByCourse': {
				const { course_id, limit = 100 } = data
				if (!course_id) return { ok: false, error: 'missing course_id' }
				const res = await db.collection(COL)
					.where({ _openid: openid, course_id })
					.orderBy('date', 'desc')
					.limit(limit)
					.get()
				return { ok: true, data: res.data }
			}
			case 'listByKid': {
				const { kid_id, limit = 100 } = data
				const where = { _openid: openid }
				if (kid_id) where.kid_id = kid_id
				const res = await db.collection(COL)
					.where(where)
					.orderBy('date', 'desc')
					.limit(limit)
					.get()
				return { ok: true, data: res.data }
			}
			default:
				return { ok: false, error: `unknown action: ${action}` }
		}
	} catch (e) {
		console.error('[checkin] error', e)
		return { ok: false, error: e.message }
	}
}
