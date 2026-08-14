// 云函数：kid
// 孩子档案 CRUD
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const COL = 'kids'

exports.main = async (event, context) => {
	const { action, data, id } = event
	const wxContext = cloud.getWXContext()
	const openid = wxContext.OPENID

	try {
		switch (action) {
			case 'add': {
				const res = await db.collection(COL).add({
					data: {
						_openid: openid,
						name: data.name,
						birth: data.birth || '',
						avatar: data.avatar || '',
						created_at: Date.now(),
						updated_at: Date.now()
					}
				})
				return { ok: true, data: { _id: res._id } }
			}
			case 'update': {
				if (!id) return { ok: false, error: 'missing id' }
				await db.collection(COL).doc(id).update({
					data: {
						name: data.name,
						birth: data.birth,
						avatar: data.avatar,
						updated_at: Date.now()
					}
				})
				return { ok: true }
			}
			case 'remove': {
				if (!id) return { ok: false, error: 'missing id' }
				// 检查是否还有课程
				const cnt = await db.collection('courses').where({ _openid: openid, kid_id: id }).count()
				if (cnt.total > 0) {
					return { ok: false, error: `该孩子下还有 ${cnt.total} 门课程，请先删除课程` }
				}
				await db.collection(COL).doc(id).remove()
				return { ok: true }
			}
			case 'list': {
				const res = await db.collection(COL).where({ _openid: openid }).orderBy('created_at', 'asc').limit(50).get()
				return { ok: true, data: res.data }
			}
			case 'get': {
				if (!id) return { ok: false, error: 'missing id' }
				const res = await db.collection(COL).doc(id).get()
				return { ok: true, data: res.data }
			}
			default:
				return { ok: false, error: `unknown action: ${action}` }
		}
	} catch (e) {
		console.error('[kid] error', e)
		return { ok: false, error: e.message }
	}
}
