import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import type { CookieOptions, Request, Response } from 'express';
import { prepareAdminDirectory, readAdminFile, writeAdminFile } from './link-store.js';

const COOKIE_NAME = 'novelai_admin_session';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1_000;
const FAILURE_WINDOW = 15 * 60 * 1_000;
const MAX_FAILURES = 10;
const MAX_SESSION_FILE_BYTES = 1024 * 1024;
const SESSION_ID = /^[A-Za-z0-9_-]{32}$/;

interface AdminAuthOptions {
  archiveDir?: string;
  adminPassword?: string;
  publicOrigin?: URL;
}

interface SessionPayload {
  sid: string;
  exp: number;
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== 'object') return false;
  const { sid, exp } = value as Partial<SessionPayload>;
  return typeof sid === 'string' && SESSION_ID.test(sid) && Number.isSafeInteger(exp);
}

const passwordHash = (password: string) => createHash('sha256').update(password).digest();

async function readIfPresent(path: string, maxBytes: number): Promise<Buffer | undefined> {
  try {
    return await readAdminFile(path, maxBytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readOrGenerate(path: string, maxBytes: number, generate: () => Buffer): Promise<{ data: Buffer; generated: boolean }> {
  const existing = await readIfPresent(path, maxBytes);
  if (existing) return { data: existing, generated: false };
  const data = generate();
  try {
    await writeAdminFile(path, data, true);
    return { data, generated: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return { data: await readAdminFile(path, maxBytes), generated: false };
  }
}

export class AdminAuth {
  private credentials?: Promise<{ hash: Buffer; secret: Buffer }>;
  private sessionFile?: string;
  private sessions = new Map<string, number>();
  private sessionWrites = Promise.resolve();
  private readonly failures = new Map<string, number[]>();
  private nextFailureSweep = 0;

  constructor(private readonly options: AdminAuthOptions = {}) {}

  async init(): Promise<void> {
    await this.getCredentials();
  }

  private getCredentials() {
    this.credentials ??= this.load().catch(error => {
      this.credentials = undefined;
      throw error;
    });
    return this.credentials;
  }

  private async load(): Promise<{ hash: Buffer; secret: Buffer }> {
    let password = process.env.MCP_ADMIN_PASSWORD || this.options.adminPassword;
    if (!this.options.archiveDir) {
      return { hash: passwordHash(password || randomBytes(24).toString('base64url')), secret: randomBytes(32) };
    }

    const directory = await prepareAdminDirectory(this.options.archiveDir);
    if (!password) {
      const path = join(directory, 'admin-password.txt');
      const { data, generated } = await readOrGenerate(path, 64 * 1024, () => Buffer.from(randomBytes(24).toString('base64url')));
      password = data.toString('utf8').replace(/\r?\n$/, '');
      if (!password) throw new Error('管理员密码文件为空');
      if (generated) console.error(`已自动生成管理员密码并保存至 ${path}`);
    }
    const { data: secret } = await readOrGenerate(join(directory, 'session-secret.key'), 32, () => randomBytes(32));
    if (secret.length !== 32) throw new Error('管理员会话签名密钥格式无效');

    this.sessionFile = join(directory, 'sessions.json');
    const stored = await readIfPresent(this.sessionFile, MAX_SESSION_FILE_BYTES);
    if (stored) {
      const entries: unknown = JSON.parse(stored.toString('utf8'));
      if (!Array.isArray(entries) || !entries.every(isSessionPayload)) throw new Error('管理员会话存储格式无效');
      const now = Date.now();
      this.sessions = new Map(entries.filter(entry => entry.exp > now).map(entry => [entry.sid, entry.exp]));
    }
    return { hash: passwordHash(password), secret };
  }

  private getSession(req: Request, secret: Buffer): SessionPayload | undefined {
    const prefix = `${COOKIE_NAME}=`;
    const field = req.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
    const match = field?.slice(prefix.length).match(/^([A-Za-z0-9_-]{1,256})\.([A-Za-z0-9_-]{43})$/);
    if (!match) return undefined;
    const payload = Buffer.from(match[1], 'base64url');
    const expected = createHmac('sha256', secret).update(payload).digest('base64url');
    if (payload.toString('base64url') !== match[1] || !timingSafeEqual(Buffer.from(expected), Buffer.from(match[2]))) return undefined;
    try {
      const session: unknown = JSON.parse(payload.toString('utf8'));
      if (isSessionPayload(session) && session.exp > Date.now() && this.sessions.get(session.sid) === session.exp) {
        return session;
      }
    } catch {
      return undefined;
    }
  }

  async isAuthenticated(req: Request): Promise<boolean> {
    const { secret } = await this.getCredentials();
    return this.getSession(req, secret) !== undefined;
  }

  private changeSessions(change: (sessions: Map<string, number>) => void): Promise<void> {
    const pending = this.sessionWrites.then(async () => {
      const now = Date.now();
      const sessions = new Map([...this.sessions].filter(([, exp]) => exp > now));
      change(sessions);
      if (this.sessionFile) {
        const data = JSON.stringify([...sessions].map(([sid, exp]) => ({ sid, exp })));
        if (Buffer.byteLength(data) > MAX_SESSION_FILE_BYTES) throw new Error('管理员会话存储超过大小限制');
        await writeAdminFile(this.sessionFile, data);
      }
      this.sessions = sessions;
    });
    this.sessionWrites = pending.catch(() => {});
    return pending;
  }

  private failedAttempts(ip: string, now: number): number[] {
    const cutoff = now - FAILURE_WINDOW;
    if (now >= this.nextFailureSweep) {
      for (const [address, failures] of this.failures) {
        if (failures[failures.length - 1] <= cutoff) this.failures.delete(address);
      }
      this.nextFailureSweep = now + FAILURE_WINDOW;
    }
    return this.failures.get(ip)?.filter(at => at > cutoff) ?? [];
  }

  private sendRateLimit(res: Response, firstFailure: number, now: number): void {
    const retryAfterSeconds = Math.max(1, Math.ceil((firstFailure + FAILURE_WINDOW - now) / 1_000));
    res.set('Retry-After', String(retryAfterSeconds));
    res.status(429).json({ error: '登录失败次数过多，请稍后重试', retryAfterSeconds });
  }

  private cookieOptions(req: Request, publicOrigin = this.options.publicOrigin): CookieOptions {
    return {
      httpOnly: true, sameSite: 'strict', path: '/novelai-admin',
      secure: req.secure || req.get('x-forwarded-proto') === 'https' || publicOrigin?.protocol === 'https:',
    };
  }

  async login(req: Request, res: Response, publicOrigin?: URL): Promise<void> {
    const { hash, secret } = await this.getCredentials();
    const now = Date.now();
    const ip = req.ip ?? '';
    const failures = this.failedAttempts(ip, now);
    if (failures.length >= MAX_FAILURES) {
      this.sendRateLimit(res, failures[0], now);
      return;
    }
    const password: unknown = req.body?.password;
    if (typeof password !== 'string' || !timingSafeEqual(hash, passwordHash(password))) {
      failures.push(now);
      this.failures.set(ip, failures);
      if (failures.length >= MAX_FAILURES) this.sendRateLimit(res, failures[0], now);
      else res.status(401).json({ error: '管理员密码错误' });
      return;
    }

    const sid = randomBytes(24).toString('base64url');
    const exp = now + SESSION_TTL;
    await this.changeSessions(sessions => sessions.set(sid, exp));
    this.failures.delete(ip);
    const payload = Buffer.from(JSON.stringify({ sid, exp }));
    const signature = createHmac('sha256', secret).update(payload).digest('base64url');
    res.cookie(COOKIE_NAME, `${payload.toString('base64url')}.${signature}`, {
      ...this.cookieOptions(req, publicOrigin), maxAge: SESSION_TTL,
    });
    res.json({ ok: true });
  }

  async logout(req: Request, res: Response, publicOrigin?: URL): Promise<void> {
    const { secret } = await this.getCredentials();
    const session = this.getSession(req, secret);
    if (session) await this.changeSessions(sessions => sessions.delete(session.sid));
    res.cookie(COOKIE_NAME, '', { ...this.cookieOptions(req, publicOrigin), maxAge: 0 });
    res.json({ ok: true });
  }
}
