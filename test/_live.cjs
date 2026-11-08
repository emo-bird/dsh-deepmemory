const { DatabaseSync } = require('node:sqlite')
const path = 'C:\\Users\\一门鸽鸽\\.dsh\\deepmemory\\memory.db'
const db = new DatabaseSync(path)
db.exec('PRAGMA journal_mode=WAL')

const now = Date.now()
const id = `probe-${now}`
db.prepare('INSERT INTO facts (id, scope, subject, text, weight, source_session, source_preset, created_at, updated_at, last_used_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
  .run(id, 'global', 'probe', '深度记忆面板的自检：这条事实用于验证写入与检索链路是否通畅。', 1, null, null, now, now, null)
db.prepare('INSERT INTO facts_fts (rowid, text) VALUES ((SELECT rowid FROM facts WHERE id = ?), ?)')
  .run(id, '深度记忆面板的自检：这条事实用于验证写入与检索链路是否通畅。')

const hit = db.prepare("SELECT rowid AS rid, bm25(facts_fts) AS rank FROM facts_fts WHERE facts_fts MATCH ? ORDER BY rank LIMIT 5").all('记忆面板')
console.log('fts hits:', hit.length)
for (const row of hit) {
  const fact = db.prepare('SELECT id, text FROM facts WHERE rowid = ?').get(row.rid)
  console.log(' -', fact.id, fact.text.slice(0, 30))
}

db.prepare('DELETE FROM facts_fts WHERE rowid = (SELECT rowid FROM facts WHERE id = ?)').run(id)
db.prepare('DELETE FROM facts WHERE id = ?').run(id)
console.log('cleanup ok, facts left =', db.prepare('SELECT count(*) c FROM facts').get().c)
db.close()
