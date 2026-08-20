import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const keyFile = resolve(process.cwd(), 'data/.master-key')

const loadMasterSecret = () => {
  const configured = process.env.SONDARA_ENCRYPTION_KEY?.trim()
  if (configured) return configured
  mkdirSync(dirname(keyFile), { recursive: true })
  if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('base64'), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  return readFileSync(keyFile, 'utf8').trim()
}

const masterKey = createHash('sha256').update(loadMasterSecret()).digest()

export const encryptSecret = (plaintext: string) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}

export const decryptSecret = (input: { ciphertext: string; iv: string; tag: string }) => {
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(input.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(input.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(input.ciphertext, 'base64')), decipher.final()]).toString('utf8')
}
