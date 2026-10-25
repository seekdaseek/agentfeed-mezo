// Stateless, HMAC-bound challenge nonce:  <issuedAt>.<expiresAt>.<random>.<mac>
// The mac binds the nonce to one route and one price, so a nonce issued for sol-price cannot pay for summarize.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const mac = (secret, iat, exp, rand, routeId, amountWei) =>
  createHmac('sha256', secret).update(`${iat}|${exp}|${rand}|${routeId}|${amountWei}`).digest('hex').slice(0, 32);

export function makeNonce({ secret, routeId, amountWei, now = Math.floor(Date.now() / 1000), ttl = 300 }) {
  const iat = now;
  const exp = now + ttl;
  const rand = randomBytes(8).toString('hex');
  return `${iat}.${exp}.${rand}.${mac(secret, iat, exp, rand, routeId, String(amountWei))}`;
}

export function checkNonce({ secret, nonce, routeId, amountWei, now = Math.floor(Date.now() / 1000) }) {
  const parts = String(nonce || '').split('.');
  if (parts.length !== 4) return { ok: false, code: 'nonce_malformed' };
  const [iat, exp, rand, m] = parts;
  if (!/^\d+$/.test(iat) || !/^\d+$/.test(exp) || !/^[0-9a-f]{16}$/.test(rand) || !/^[0-9a-f]{32}$/.test(m)) {
    return { ok: false, code: 'nonce_malformed' };
  }
  const want = Buffer.from(mac(secret, iat, exp, rand, routeId, String(amountWei)));
  if (!timingSafeEqual(want, Buffer.from(m))) return { ok: false, code: 'nonce_invalid' };
  if (now > Number(exp)) return { ok: false, code: 'nonce_expired' };
  return { ok: true, issuedAt: Number(iat), expiresAt: Number(exp) };
}
