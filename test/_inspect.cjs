const { DatabaseSync } = require('node:sqlite')
const path = 'C:\\Users\\一门鸽鸽\\.dsh\\deepmemory\\memory.db'
const db = new DatabaseSync(path)
const tables = db.prepare("select name from sqlite_master where type='table' order by name").all().map((r) => r.name)
console.log('tables:', tables.join(','))
for (const name of ['facts', 'episodes', 'diary', 'meta']) {
  try {
    console.log(name, db.prepare(`select count(*) c from ${name}`).get().c)
  } catch (error) {
    console.log(name, 'ERR', String(error))
  }
}
db.close()
