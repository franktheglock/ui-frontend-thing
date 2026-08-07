import crypto from 'crypto'

const SALT_BYTES = 16
const KEYLEN = 64

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex')
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, (err, key) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
  return `scrypt:${salt}:${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algo, salt, hashHex] = stored.split(':')
    if (algo !== 'scrypt' || !salt || !hashHex) return false
    const derived = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, KEYLEN, (err, key) => {
        if (err) reject(err)
        else resolve(key)
      })
    })
    const a = Buffer.from(hashHex, 'hex')
    const b = derived
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
