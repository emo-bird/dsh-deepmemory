const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync(':memory:')
db.exec("create virtual table t using fts5(text, tokenize='trigram')")
db.exec("insert into t(text) values('鸽鸽在做 DeepSeek Harness 的记忆插件')")
const q = (label, expr) => {
  try {
    console.log(label, JSON.stringify(db.prepare('select rowid, bm25(t) r from t where t match ?').all(expr)))
  } catch (e) {
    console.log(label, 'ERR', e.message)
  }
}
q('quoted-记忆系统', '"记忆系统"')
q('quoted-记忆', '"记忆"')
q('quoted-鸽鸽在做', '"鸽鸽在做"')
q('bare-记忆系统', '记忆系统')
q('quoted-DeepSeek', '"DeepSeek"')
