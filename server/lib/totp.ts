import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export const generateTotpSecret = () => {
  const bytes = randomBytes(20)
  let bits = ''
  let secret = ''
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0')
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5)
    if (chunk.length === 5) secret += base32Alphabet[Number.parseInt(chunk, 2)]
  }
  return secret
}

const decodeBase32 = (secret: string) => {
  const normalized = secret.replace(/=+$/,'').replace(/\s/g,'').toUpperCase()
  let bits = ''
  for (const char of normalized) {
    const index = base32Alphabet.indexOf(char)
    if (index === -1) throw new Error('INVALID_TOTP_SECRET')
    bits += index.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

const hotp = (key: Buffer, counter: number) => {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

export const generateTotp = (secret: string, timestamp = Date.now()) => {
  const counter = Math.floor(timestamp / 30_000)
  return hotp(decodeBase32(secret), counter)
}

export const verifyTotp = (token: string, secret: string, timestamp = Date.now(), window = 1) => {
  const normalized = token.replace(/\s/g,'')
  if (!/^\d{6}$/.test(normalized)) return false
  const counter = Math.floor(timestamp / 30_000)
  const key = decodeBase32(secret)
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = hotp(key, counter + offset)
    if (expected.length === normalized.length && timingSafeEqual(Buffer.from(expected), Buffer.from(normalized))) return true
  }
  return false
}

export const getTotpOtpauth = (email: string, secret: string, issuer = 'Sondara') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
