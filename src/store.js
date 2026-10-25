// sqlite: the replay ledger and the payment log. A key is "pending" while a call is in flight and
// "used" once its payment settled; a second use of either state is refused.
import Database from 'better-sqlite3';

export function openStore(path) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS replay (key TEXT PRIMARY KEY, state TEXT NOT NULL, ts INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, route TEXT NOT NULL, scheme TEXT NOT NULL,
      payer TEXT NOT NULL, amount_wei TEXT NOT NULL, nonce TEXT NOT NULL UNIQUE,
      permit_tx TEXT, tx_hash TEXT NOT NULL, upstream_ms INTEGER, total_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS payments_ts ON payments(ts);
  `);
  db.prepare("DELETE FROM replay WHERE state = 'pending'").run(); // a crash mid-call leaves nothing charged

  const sel = db.prepare('SELECT state FROM replay WHERE key = ?');
  const ins = db.prepare("INSERT INTO replay (key, state, ts) VALUES (?, 'pending', ?)");
  const del = db.prepare("DELETE FROM replay WHERE key = ? AND state = 'pending'");
  const use = db.prepare("UPDATE replay SET state = 'used' WHERE key = ?");

  const reserve = db.transaction((keys) => {
    for (const k of keys) if (sel.get(k)) return false;
    const ts = Math.floor(Date.now() / 1000);
    for (const k of keys) ins.run(k, ts);
    return true;
  });

  return {
    db,
    // true if every key was free and is now reserved; false if any was already pending or used
    reserve: (keys) => reserve(keys),
    release: (keys) => keys.forEach((k) => del.run(k)),
    commit: db.transaction((keys, p) => {
      keys.forEach((k) => use.run(k));
      db.prepare(`INSERT INTO payments (ts, route, scheme, payer, amount_wei, nonce, permit_tx, tx_hash, upstream_ms, total_ms)
                  VALUES (@ts, @route, @scheme, @payer, @amount_wei, @nonce, @permit_tx, @tx_hash, @upstream_ms, @total_ms)`).run(p);
    }),
    isUsed: (key) => !!sel.get(key),
    stats() {
      const rows = db.prepare('SELECT amount_wei FROM payments').all();
      const t = { n: rows.length, wei: rows.reduce((a, r) => a + BigInt(r.amount_wei), 0n) };
      const byRoute = db.prepare('SELECT route, COUNT(*) n FROM payments GROUP BY route ORDER BY n DESC').all();
      const byScheme = db.prepare('SELECT scheme, COUNT(*) n FROM payments GROUP BY scheme').all();
      const payers = db.prepare('SELECT COUNT(DISTINCT payer) n FROM payments').get().n;
      const day = db.prepare('SELECT COUNT(*) n FROM payments WHERE ts > ?').get(Math.floor(Date.now() / 1000) - 86400).n;
      return { settled: t.n, musdWei: t.wei, byRoute, byScheme, payers, last24h: day };
    },
    recent: (limit = 20) => db.prepare('SELECT * FROM payments ORDER BY id DESC LIMIT ?').all(limit),
    all: () => db.prepare('SELECT * FROM payments ORDER BY id ASC').all(),
    close: () => db.close(),
  };
}
