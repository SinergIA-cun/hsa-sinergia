import { SignJWT, jwtVerify } from 'jose';

export type UserRole = 'vendedora' | 'admin';

export interface TokenPayload {
  sub: string;
  role: UserRole;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signToken(payload: TokenPayload, secret: string): Promise<string> {
  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key(secret));
}

export async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret));
    const role = payload.role;
    if (typeof payload.sub !== 'string') return null;
    if (role !== 'vendedora' && role !== 'admin') return null;
    return { sub: payload.sub, role };
  } catch {
    return null;
  }
}
