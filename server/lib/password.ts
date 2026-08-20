import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const keyLength = 64

export const hashPassword = async (password: string) => {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, keyLength) as Buffer
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export const verifyPassword = async (password: string, encoded: string) => {
  const [algorithm, saltValue, hashValue] = encoded.split('$')
  if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false
  const expected = Buffer.from(hashValue, 'base64url')
  const actual = await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length) as Buffer
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
