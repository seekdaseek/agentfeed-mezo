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
  // Wave 2: the ledger is per network. Rows written before the column existed are Mezo testnet payments.
  try { db.exec("ALTER TABLE payments ADD COLUMN network TEXT NOT NULL DEFAULT 'eip155:31611'"); } catch { /* column already there */ }
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
      db.prepare(`INSERT INTO payments (ts, route, scheme, payer, amount_wei, nonce, permit_tx, tx_hash, upstream_ms, total_ms, network)
                  VALUES (@ts, @route, @scheme, @payer, @amount_wei, @nonce, @permit_tx, @tx_hash, @upstream_ms, @total_ms, @network)`).run({ network: 'eip155:31611', ...p });
    }),
    isUsed: (key) => !!sel.get(key),
    // The next permit nonce this ledger knows an owner must be on: one above the highest nonce it has settled for them.
    // The public RPC can lag a block behind, so a freshly used nonce can still read as current; the ledger cannot.
    nextPermitNonce(prefix, owner) {
      const rows = db.prepare("SELECT key FROM replay WHERE state = 'used' AND key LIKE ?").all(`pn:${prefix}${owner.toLowerCase()}:%`);
      let next = 0n;
      for (const r of rows) { const n = BigInt(r.key.slice(r.key.lastIndexOf(':') + 1)) + 1n; if (n > next) next = n; }
      return next;
    },
    stats() {
      const rows = db.prepare('SELECT amount_wei, network, payer FROM payments').all();
      const t = { n: rows.length, wei: rows.reduce((a, r) => a + BigInt(r.amount_wei), 0n) };
      const byNet = {};
      for (const r of rows) { const x = (byNet[r.network] ||= { n: 0, wei: 0n, payers: new Set() }); x.n++; x.wei += BigInt(r.amount_wei); x.payers.add(r.payer.toLowerCase()); }
      const byRoute = db.prepare('SELECT route, COUNT(*) n FROM payments GROUP BY route ORDER BY n DESC').all();
      const byScheme = db.prepare('SELECT scheme, COUNT(*) n FROM payments GROUP BY scheme').all();
      const payers = db.prepare('SELECT COUNT(DISTINCT payer) n FROM payments').get().n;
      const day = db.prepare('SELECT COUNT(*) n FROM payments WHERE ts > ?').get(Math.floor(Date.now() / 1000) - 86400).n;
      return { settled: t.n, musdWei: t.wei, byRoute, byScheme, payers, last24h: day, byNet };
    },
    recent: (limit = 20) => db.prepare('SELECT * FROM payments ORDER BY id DESC LIMIT ?').all(limit),
    all: () => db.prepare('SELECT * FROM payments ORDER BY id ASC').all(),
    close: () => db.close(),
  };
}
