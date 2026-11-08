const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec("create virtual table t using fts5(x, tokenize='trigram')");
db.exec("insert into t values('今天我和鸽鸽讨论了记忆系统的架构')");
const r = db.prepare('select * from t where t match ?').all('记忆系统');
console.log('OK', JSON.stringify(r));
console.log('sqlite', JSON.stringify(db.prepare('select sqlite_version() v').get()));
console.log('json', JSON.stringify(db.prepare("select json_extract('{\"a\":1}','$.a') v").get()));
