// Append-only record of what the Telegram bot was sent and what it answered, one JSON object per line (mode 600). It exists
// so a demo can be shown from the bot's own words instead of a screenshot of a personal Telegram window.
import fs from 'node:fs';

export function makeTranscript(path) {
  return {
    log(dir, uid, text, ts = Math.floor(Date.now() / 1000)) {
      if (!path) return;
      fs.appendFileSync(path, `${JSON.stringify({ ts, dir, uid, text: String(text) })}\n`, { mode: 0o600 });
    },
  };
}

// The same lines with the Telegram user id replaced, for anything that leaves the box.
export function redact(lines, uid, label = 'owner') {
  const id = String(uid);
  return lines.map((l) => ({ ...l, uid: l.uid === uid ? label : 'other', text: l.text.split(id).join(label) }));
}
