// SQL / SSH command classification (the core of connection permission checks).
// Run: npm run test:unit   (Node 22+, no test framework needed)
import { classifySql, classifyCommand, DEFAULT_SSH_READ } from '../src/shared/connectionRules.ts'
const cases: [string, string][] = [
  ['SELECT * FROM orders LIMIT 10', 'read'],
  ["select 'drop table x' as s", 'read'],
  ['WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d', 'write'],
  ['SELECT * INTO backup FROM t', 'admin'],
  ['SELECT * FROM t FOR UPDATE', 'write'],
  ['EXPLAIN SELECT 1', 'read'],
  ['EXPLAIN ANALYZE DELETE FROM t', 'write'],
  ['UPDATE stock SET qty = 0 WHERE id = 1', 'write'],
  ['DELETE FROM t', 'write'],
  ['CALL refresh_stats()', 'execute'],
  ['EXEC sp_who', 'execute'],
  ['DROP TABLE orders', 'admin'],
  ['SET TRANSACTION READ WRITE', 'admin'],
  ['SELECT 1; DROP TABLE x', 'admin'],
  ['COMMIT', 'admin'],
  ['/* x */ -- y\n SELECT 1', 'read'],
  ['SHOW TABLES', 'read'],
  ["SELECT $$; drop$$", 'read'],
  ['TRUNCATE t', 'admin'],
  ['INSERT INTO a SELECT * FROM b', 'write'],
  ['', 'read'],
  // security review 2026-10-13: side effects hidden in "reads"
  ['WITH x AS (SELECT 1 AS n) SELECT n INTO audit_probe FROM x', 'admin'],
  ['SELECT 1 /*!50000 INTO OUTFILE "/tmp/audit_probe" */', 'admin'],
  ['SELECT 1 /*M!100000 INTO OUTFILE "/tmp/p" */', 'admin'],
  ["SELECT * FROM t INTO OUTFILE '/tmp/x'", 'admin'],
  ['SELECT id INTO @v FROM t LIMIT 1', 'admin'],
  ["SELECT pg_read_file('/etc/passwd')", 'admin'],
  ["SELECT lo_export(1234, '/tmp/x')", 'admin'],
  ["SELECT * FROM dblink('host=x', 'delete from t') AS r(a int)", 'admin'],
  ["SELECT query_to_xml('delete from t', true, true, '')", 'admin'],
  ["SELECT LOAD_FILE('/etc/passwd')", 'admin'],
  ["SELECT * FROM OPENROWSET('SQLNCLI', 'Server=x;', 'select 1')", 'admin'],
  ['SELECT pg_terminate_backend(123)', 'admin'],
  ["SELECT set_config('x', 'y', false)", 'admin'],
  ["SELECT nextval('s')", 'write'],
  ['SELECT NEXT VALUE FOR dbo.seq', 'write'],
  ['SELECT * FROM t LOCK IN SHARE MODE', 'write'],
  ['WITH c AS (SELECT 1) INSERT INTO t SELECT * FROM c', 'write'],
  ["SELECT 'pg_read_file(x)' AS s", 'read'],
  ['SELECT count(*) FROM orders WHERE created_at > now() - interval \'7 days\'', 'read'],
  // 2nd pass: quoted function names and backslash readings
  ['SELECT "pg_read_file"(\'/etc/passwd\')', 'admin'],
  ['SELECT pg_catalog."pg_read_file"(\'/etc/passwd\')', 'admin'],
  ['SELECT `load_file`(\'/etc/passwd\')', 'admin'],
  ['SELECT [xp_cmdshell](\'dir\')', 'admin'],
  ['SELECT * FROM [dbo].[orders]', 'read'],
  ['SELECT U&"\\0070g_read_file"(\'/etc/passwd\')', 'admin'],
  ["SELECT '\\' , pg_read_file('/etc/passwd') -- '", 'admin'],
  ["SELECT 'it\\'s' AS s", 'read'],
  ['SELECT "drop table x" AS label FROM t', 'read'],
  ['SELECT "nextval"(\'s\')', 'write']
]
let bad = 0
for (const [sql, want] of cases) { const got = classifySql(sql).cls; if (got !== want) { bad++; console.log('SQL FAIL', JSON.stringify(sql), got, '!=', want) } }
const lists = { read: DEFAULT_SSH_READ, write: ['cp /opt/app/*'], execute: ['systemctl restart erp-api'] }
const cmds: [string, string][] = [
  ['ls -la /var/log', 'read'], ['ps aux | grep java', 'read'], ['cat /etc/hosts; rm -rf /', 'admin'],
  ['systemctl restart erp-api', 'execute'], ['cp /opt/app/a /opt/app/b', 'write'], ['rm -rf /tmp/x', 'admin'],
  ['find / -name x -delete', 'admin'], ['echo $(whoami)', 'admin'], ['tail -n 100 app.log > out', 'admin'], ['uptime', 'read'],
  // security review 2026-10-13: read-listed programs that can run commands or write
  [`awk 'BEGIN {system("true")}'`, 'admin'], [`sed -n '1e true' /dev/null`, 'admin'], ['sort --compress-program=true /dev/null', 'admin'],
  ['ip address flush dev dummy0', 'admin'], ['ip a', 'read'], ['ip addr show dev eth0', 'read'], ['ip route', 'read'],
  ["sed -n '1,20p' /var/log/syslog", 'read'], ["sed -n '/ERROR/p' app.log", 'read'], ["sed -i 's/a/b/' f", 'admin'], ["sed -n 'w /tmp/x' f", 'admin'],
  ['sort -o /etc/passwd x', 'admin'], ['sort -rn sizes.txt', 'read'], ['uniq a.txt b.txt', 'admin'], ['uniq -c a.txt', 'read'],
  ['ss -K dst 1.2.3.4', 'admin'], ['ss -tlnp', 'read'], ['journalctl --vacuum-time=1s', 'admin'], ['journalctl -u nginx -n 50', 'read'],
  ['find /var -fprint /tmp/x', 'admin'], ['date -s 2020-01-01', 'admin'], ['tail -f app.log', 'admin'], ['docker ps -a', 'read'],
  ['docker rm -f web', 'admin'], ['systemctl status nginx', 'read'], ['ps aux | awk {print}', 'admin'], ['cat /etc/os-release | sort | uniq -c', 'read'],
  // 2nd pass: every sed script counts
  ["sed -n -e '1p' -e '1e true' /etc/hostname", 'admin'], ["sed -n -e '1p' --expression='w /tmp/x' f", 'admin'],
  ["sed -n --expression=1p -e 2p f", 'read'], ["sed -ne '1e true' f", 'admin'], ["sed '1p' f", 'admin'], ["sed -n -- '1e true' f", 'admin']
]
// the read list alone is never a boundary: interpreters added to it by the user are still refused at read level
for (const [c, want] of [['python3 -c 1', 'admin'], ['perl -e 1', 'admin'], ['xargs rm', 'admin']] as [string, string][]) {
  const got = classifyCommand(c, { read: ['*'], write: [], execute: [] }).needs
  if (got !== want) { bad++; console.log('CMD FAIL (wide read list)', c, got, '!=', want) }
}
for (const [c, want] of cmds) { const got = classifyCommand(c, lists).needs; if (got !== want) { bad++; console.log('CMD FAIL', c, got, '!=', want) } }
console.log(bad ? `${bad} failures` : 'all classifier cases pass')
if (bad) process.exit(1)
