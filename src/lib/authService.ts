/**
 * Hema Universal Authentication & Authorization Service
 * Dual-tier architecture:
 * 1. Communicates with Node/Express Backend (/api/auth) when online with JWT Bearer tokens.
 * 2. Employs embedded Cryptographic Engine (PBKDF2-SHA256) when offline on native Android APK.
 * 3. Enforces strict multi-tenant isolation by wiring active user IDs to partitioned databases.
 */

import { 
  hashPassword, 
  verifyPassword, 
  hashSecurityAnswer, 
  generateSalt, 
  generateSecureToken 
} from './cryptoAuth';
import { setActiveUserForDB, migrateLegacyDataToUser } from './db';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  securityQuestion?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
}

export interface StoredUserAccount extends UserProfile {
  passwordHash: string;
  salt: string;
  securityQuestion: string;
  securityAnswerHash: string;
}

export interface AuthSession {
  token: string;
  user: UserProfile;
  expiresAt: number;
}

const STORAGE_KEY_ACCOUNTS = 'hema_vault_accounts';
const STORAGE_KEY_SESSION = 'hema_active_session';
const STORAGE_KEY_RESET_TOKENS = 'hema_reset_tokens';

// Helper to check if backend API is reachable
async function isBackendReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const res = await fetch('/api/health', { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

// --- Local Vault Storage Helpers (Offline-First) ---
function getLocalAccounts(): StoredUserAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACCOUNTS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalAccounts(accounts: StoredUserAccount[]) {
  try {
    localStorage.setItem(STORAGE_KEY_ACCOUNTS, JSON.stringify(accounts));
  } catch (e) {
    console.error('[AuthService] Failed to save accounts to vault:', e);
  }
}

function sanitizeUser(user: StoredUserAccount): UserProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    securityQuestion: user.securityQuestion,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt
  };
}

// Save active session
function persistSession(session: AuthSession | null) {
  if (session) {
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
    setActiveUserForDB(session.user.id);
  } else {
    localStorage.removeItem(STORAGE_KEY_SESSION);
    setActiveUserForDB(null);
  }
  // Dispatch notification for UI updates
  window.dispatchEvent(new CustomEvent('hema:auth-changed', { detail: session?.user || null }));
}

export class AuthService {
  /**
   * Returns the currently active authenticated session
   */
  static getCurrentSession(): AuthSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SESSION);
      if (!raw) return null;
      const session: AuthSession = JSON.parse(raw);
      if (Date.now() > session.expiresAt) {
        this.logout();
        return null;
      }
      // Ensure DB is linked to this active user
      setActiveUserForDB(session.user.id);
      return session;
    } catch {
      return null;
    }
  }

  /**
   * Returns the currently active user profile
   */
  static getCurrentUser(): UserProfile | null {
    const session = this.getCurrentSession();
    return session ? session.user : null;
  }

  /**
   * Checks if user is authenticated
   */
  static isAuthenticated(): boolean {
    return !!this.getCurrentSession();
  }

  /**
   * Registers a new user account with secure PBKDF2 password hashing
   */
  static async register(params: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    securityQuestion: string;
    securityAnswer: string;
  }): Promise<{ user: UserProfile; token: string }> {
    const { name, email, password, phone, securityQuestion, securityAnswer } = params;
    const cleanEmail = email.trim().toLowerCase();

    // 1. Try Backend API first if reachable
    if (await isBackendReachable()) {
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email: cleanEmail,
            password,
            phone,
            securityQuestion,
            securityAnswer
          })
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Registration failed on server.');
        }

        const session: AuthSession = {
          token: data.token,
          user: data.user,
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
        };

        // Also save to local vault for offline continuity
        const salt = generateSalt();
        const { hash } = await hashPassword(password, salt);
        const ansHash = await hashSecurityAnswer(securityAnswer, salt);
        const localUser: StoredUserAccount = {
          ...data.user,
          passwordHash: hash,
          salt,
          securityQuestion,
          securityAnswerHash: ansHash
        };
        const accounts = getLocalAccounts().filter(a => a.email !== cleanEmail);
        accounts.push(localUser);
        saveLocalAccounts(accounts);

        persistSession(session);
        await migrateLegacyDataToUser(data.user.id);

        return { user: data.user, token: data.token };
      } catch (err: any) {
        console.warn('[AuthService] Server registration failed, falling back to local vault:', err.message);
      }
    }

    // 2. Standalone / Offline Cryptographic Vault Registration
    const accounts = getLocalAccounts();
    if (accounts.some(a => a.email === cleanEmail)) {
      throw new Error('An account with this email already exists on this device.');
    }

    const salt = generateSalt();
    const { hash: passwordHash } = await hashPassword(password, salt);
    const securityAnswerHash = await hashSecurityAnswer(securityAnswer, salt);

    const userId = `usr_${Date.now()}_${generateSecureToken().slice(0, 8)}`;
    const nowIso = new Date().toISOString();

    const newUser: StoredUserAccount = {
      id: userId,
      name: name.trim(),
      email: cleanEmail,
      phone: phone ? phone.trim() : '',
      securityQuestion: securityQuestion.trim(),
      securityAnswerHash,
      passwordHash,
      salt,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastLoginAt: nowIso
    };

    accounts.push(newUser);
    saveLocalAccounts(accounts);

    const token = generateSecureToken();
    const session: AuthSession = {
      token,
      user: sanitizeUser(newUser),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    };

    persistSession(session);

    // Auto-migrate legacy offline data if this is the first account on device
    await migrateLegacyDataToUser(userId);

    return { user: sanitizeUser(newUser), token };
  }

  /**
   * Logs into an existing account with timing-safe password verification
   */
  static async login(email: string, password: string): Promise<{ user: UserProfile; token: string }> {
    const cleanEmail = email.trim().toLowerCase();

    // 1. Try Backend API first if reachable
    if (await isBackendReachable()) {
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail, password })
        });
        const data = await res.json();
        if (res.ok && data.token && data.user) {
          const session: AuthSession = {
            token: data.token,
            user: data.user,
            expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
          };
          persistSession(session);
          return { user: data.user, token: data.token };
        } else if (res.status === 401) {
          throw new Error('Invalid email or password.');
        }
      } catch (err: any) {
        if (err.message === 'Invalid email or password.') throw err;
        console.warn('[AuthService] Server login unavailable, using local vault:', err.message);
      }
    }

    // 2. Standalone / Offline Cryptographic Vault Login
    const accounts = getLocalAccounts();
    const account = accounts.find(a => a.email === cleanEmail);

    if (!account) {
      throw new Error('Invalid email or password.');
    }

    const isValid = await verifyPassword(password, account.salt, account.passwordHash);
    if (!isValid) {
      throw new Error('Invalid email or password.');
    }

    account.lastLoginAt = new Date().toISOString();
    saveLocalAccounts(accounts);

    const token = generateSecureToken();
    const session: AuthSession = {
      token,
      user: sanitizeUser(account),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    };

    persistSession(session);
    return { user: sanitizeUser(account), token };
  }

  /**
   * Logs out the current user, clears tokens, closes DB connections
   */
  static async logout(): Promise<void> {
    const session = this.getCurrentSession();
    if (session && await isBackendReachable()) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.token}`
          }
        });
      } catch (e) {}
    }

    persistSession(null);
  }

  /**
   * Password Recovery Step 1: Look up registered security question
   */
  static async getSecurityQuestion(email: string): Promise<string> {
    const cleanEmail = email.trim().toLowerCase();

    // 1. Check backend if online
    if (await isBackendReachable()) {
      try {
        const res = await fetch('/api/auth/forgot-password/question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail })
        });
        const data = await res.json();
        if (res.ok && data.question) {
          return data.question;
        }
      } catch {}
    }

    // 2. Local vault
    const accounts = getLocalAccounts();
    const account = accounts.find(a => a.email === cleanEmail);
    if (!account || !account.securityQuestion) {
      throw new Error('No account found with this email address.');
    }

    return account.securityQuestion;
  }

  /**
   * Password Recovery Step 2: Verify security answer and issue reset token
   */
  static async verifySecurityAnswer(email: string, answer: string): Promise<string> {
    const cleanEmail = email.trim().toLowerCase();

    // 1. Check backend if online
    if (await isBackendReachable()) {
      try {
        const res = await fetch('/api/auth/forgot-password/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail, answer })
        });
        const data = await res.json();
        if (res.ok && data.resetToken) {
          return data.resetToken;
        } else if (res.status === 401) {
          throw new Error('Incorrect answer to security question.');
        }
      } catch (err: any) {
        if (err.message.includes('Incorrect')) throw err;
      }
    }

    // 2. Local vault
    const accounts = getLocalAccounts();
    const account = accounts.find(a => a.email === cleanEmail);
    if (!account) {
      throw new Error('Account not found.');
    }

    const answerHash = await hashSecurityAnswer(answer, account.salt);
    if (answerHash !== account.securityAnswerHash) {
      throw new Error('Incorrect answer to security question.');
    }

    // Store single-use 15-minute reset token
    const resetToken = `rst_${generateSecureToken()}`;
    const tokens = JSON.parse(localStorage.getItem(STORAGE_KEY_RESET_TOKENS) || '[]');
    tokens.push({
      token: resetToken,
      email: cleanEmail,
      expiresAt: Date.now() + 15 * 60 * 1000
    });
    localStorage.setItem(STORAGE_KEY_RESET_TOKENS, JSON.stringify(tokens));

    return resetToken;
  }

  /**
   * Password Recovery Step 3: Reset password with token
   */
  static async resetPassword(resetToken: string, newPassword: string): Promise<void> {
    if (newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }

    // 1. Check backend if online
    if (await isBackendReachable()) {
      try {
        const res = await fetch('/api/auth/forgot-password/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resetToken, newPassword })
        });
        const data = await res.json();
        if (res.ok) return;
        throw new Error(data.error || 'Password reset failed.');
      } catch (err: any) {
        if (!err.message.includes('failed to fetch')) throw err;
      }
    }

    // 2. Local vault
    const tokens = JSON.parse(localStorage.getItem(STORAGE_KEY_RESET_TOKENS) || '[]');
    const tokenEntry = tokens.find((t: any) => t.token === resetToken && t.expiresAt > Date.now());

    if (!tokenEntry) {
      throw new Error('Password reset session has expired. Please try again.');
    }

    const accounts = getLocalAccounts();
    const account = accounts.find(a => a.email === tokenEntry.email);
    if (!account) {
      throw new Error('Account not found.');
    }

    // Generate fresh salt and new hash
    const newSalt = generateSalt();
    const { hash: newHash } = await hashPassword(newPassword, newSalt);

    account.salt = newSalt;
    account.passwordHash = newHash;
    account.updatedAt = new Date().toISOString();

    saveLocalAccounts(accounts);

    // Remove used token
    const remainingTokens = tokens.filter((t: any) => t.token !== resetToken);
    localStorage.setItem(STORAGE_KEY_RESET_TOKENS, JSON.stringify(remainingTokens));

    // Clear session so user must log in with new password
    this.logout();
  }

  /**
   * Returns list of user profiles registered on this device for one-tap account switching
   */
  static listKnownUsersOnDevice(): UserProfile[] {
    const accounts = getLocalAccounts();
    return accounts.map(sanitizeUser);
  }
}
