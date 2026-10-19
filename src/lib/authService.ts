/**
 * Hema Universal Authentication & Authorization Service
 * Triple-tier architecture:
 * 1. Supabase Cloud Identity (PostgreSQL RLS, Phone OTP, Google OAuth, Email/Password) when configured.
 * 2. Node/Express Backend (/api/auth) when online with JWT Bearer tokens.
 * 3. Embedded Cryptographic Engine (PBKDF2-SHA256, 100k iterations) for 100% offline continuity on Android APK.
 * 4. Enforces strict multi-tenant isolation by wiring active user IDs to partitioned IndexedDB databases (HemaDB_{userId}).
 */

import { 
  hashPassword, 
  verifyPassword, 
  hashSecurityAnswer, 
  generateSalt, 
  generateSecureToken 
} from './cryptoAuth';
import { setActiveUserForDB, migrateLegacyDataToUser, remediatePollutedPartitions } from './db';
import { getSupabase, isSupabaseConfigured } from './supabase';
import { syncWithCloud, uploadLocalDataToCloud } from './syncEngine';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  securityQuestion?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
  provider?: 'supabase' | 'local_vault' | 'express_backend';
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

// Helper to check if local Express backend API is reachable
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
    lastLoginAt: user.lastLoginAt,
    provider: user.provider || 'local_vault'
  };
}

// Save active session
function persistSession(session: AuthSession | null) {
  if (session) {
    localStorage.setItem(STORAGE_KEY_SESSION, JSON.stringify(session));
    setActiveUserForDB(session.user.id);
    remediatePollutedPartitions(session.user.id).catch(() => {});
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
   * Registers a new user account across Supabase cloud (if configured) or local vault
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
    const cleanPhone = phone ? phone.trim() : '';

    // 1. Try Supabase Cloud Auth first if configured
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
              data: {
                full_name: name.trim(),
                phone: cleanPhone
              }
            }
          });

          if (error) {
            throw new Error(error.message);
          }

          if (data.user) {
            const userId = data.user.id;
            const nowIso = new Date().toISOString();

            // Upsert profile
            await supabase.from('profiles').upsert({
              id: userId,
              full_name: name.trim(),
              email: cleanEmail,
              phone: cleanPhone,
              updated_at: nowIso
            });

            const userProfile: UserProfile = {
              id: userId,
              name: name.trim(),
              email: cleanEmail,
              phone: cleanPhone,
              securityQuestion,
              createdAt: nowIso,
              updatedAt: nowIso,
              lastLoginAt: nowIso,
              provider: 'supabase'
            };

            const token = data.session?.access_token || generateSecureToken();
            const session: AuthSession = {
              token,
              user: userProfile,
              expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
            };

            // Cache in local vault for offline continuity
            const salt = generateSalt();
            const { hash } = await hashPassword(password, salt);
            const ansHash = await hashSecurityAnswer(securityAnswer, salt);
            const localUser: StoredUserAccount = {
              ...userProfile,
              passwordHash: hash,
              salt,
              securityQuestion,
              securityAnswerHash: ansHash
            };
            const accounts = getLocalAccounts().filter(a => a.email !== cleanEmail && a.id !== userId);
            accounts.push(localUser);
            saveLocalAccounts(accounts);

            persistSession(session);
            await migrateLegacyDataToUser(userId);
            // Push initial data to cloud in background
            uploadLocalDataToCloud(userId).catch(e => console.warn('[AuthService] Initial cloud upload error:', e));

            return { user: userProfile, token };
          }
        } catch (err: any) {
          console.warn('[AuthService] Supabase registration threw:', err.message);
          throw err;
        }
      }
    }

    // 2. Try Node/Express Backend if reachable
    if (await isBackendReachable()) {
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email: cleanEmail,
            password,
            phone: cleanPhone,
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
          user: { ...data.user, provider: 'express_backend' },
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
        };

        // Cache in local vault for offline continuity
        const salt = generateSalt();
        const { hash } = await hashPassword(password, salt);
        const ansHash = await hashSecurityAnswer(securityAnswer, salt);
        const localUser: StoredUserAccount = {
          ...data.user,
          provider: 'express_backend',
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

        return { user: session.user, token: data.token };
      } catch (err: any) {
        console.warn('[AuthService] Server registration failed, falling back to local vault:', err.message);
      }
    }

    // 3. Standalone / Offline Cryptographic Vault Registration (PBKDF2-SHA256)
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
      phone: cleanPhone,
      securityQuestion: securityQuestion.trim(),
      securityAnswerHash,
      passwordHash,
      salt,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastLoginAt: nowIso,
      provider: 'local_vault'
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
   * Logs into an existing account with Supabase, Express, or offline cryptographic vault
   */
  static async login(email: string, password: string): Promise<{ user: UserProfile; token: string }> {
    const cleanEmail = email.trim().toLowerCase();

    // 1. Try Supabase Cloud Auth first if configured
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password
          });

          if (!error && data.user) {
            const userId = data.user.id;
            const nowIso = new Date().toISOString();

            // Fetch profile
            let name = data.user.user_metadata?.full_name || 'Family Member';
            let phone = data.user.user_metadata?.phone || '';
            try {
              const { data: prof } = await supabase.from('profiles').select('*').eq('id', userId).single();
              if (prof) {
                if (prof.full_name) name = prof.full_name;
                if (prof.phone) phone = prof.phone;
              }
            } catch {}

            const userProfile: UserProfile = {
              id: userId,
              name,
              email: cleanEmail,
              phone,
              createdAt: data.user.created_at || nowIso,
              updatedAt: nowIso,
              lastLoginAt: nowIso,
              provider: 'supabase'
            };

            const token = data.session?.access_token || generateSecureToken();
            const session: AuthSession = {
              token,
              user: userProfile,
              expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
            };

            // Cache in local vault for offline continuity
            const accounts = getLocalAccounts();
            const existing = accounts.find(a => a.email === cleanEmail || a.id === userId);
            if (!existing) {
              const salt = generateSalt();
              const { hash } = await hashPassword(password, salt);
              const localUser: StoredUserAccount = {
                ...userProfile,
                passwordHash: hash,
                salt,
                securityQuestion: "What is your favorite family traditional festival?",
                securityAnswerHash: ""
              };
              accounts.push(localUser);
              saveLocalAccounts(accounts);
            }

            persistSession(session);

            // Sync delta in background
            syncWithCloud(userId).catch(e => console.warn('[AuthService] Post-login sync error:', e));

            return { user: userProfile, token };
          } else if (error) {
            console.warn('[AuthService] Supabase login error:', error.message);
            // If offline, fall through to local vault
            if (error.message.includes('Invalid login credentials')) {
              throw new Error('Invalid email or password.');
            }
          }
        } catch (err: any) {
          if (err.message === 'Invalid email or password.') throw err;
          console.warn('[AuthService] Cloud login unavailable, checking offline vault:', err.message);
        }
      }
    }

    // 2. Try Express Backend if online
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
            user: { ...data.user, provider: 'express_backend' },
            expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
          };
          persistSession(session);
          return { user: session.user, token: data.token };
        } else if (res.status === 401) {
          throw new Error('Invalid email or password.');
        }
      } catch (err: any) {
        if (err.message === 'Invalid email or password.') throw err;
        console.warn('[AuthService] Server login unavailable, using local vault:', err.message);
      }
    }

    // 3. Standalone / Offline Cryptographic Vault Login
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
   * Phone Number OTP Login (Native Indian Mobile Support via Supabase)
   */
  static async loginWithPhoneOtp(rawPhone: string): Promise<{ success: boolean; message: string }> {
    if (!isSupabaseConfigured()) {
      throw new Error('Cloud database not configured. Please enter your Supabase Project URL and Public Anon Key in Settings.');
    }

    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase client unavailable');

    // Normalize phone number (e.g., ensure +91 prefix for 10-digit Indian numbers)
    let phone = rawPhone.replace(/\s+/g, '').replace(/-/g, '');
    if (/^\d{10}$/.test(phone)) {
      phone = `+91${phone}`;
    } else if (!phone.startsWith('+')) {
      phone = `+${phone}`;
    }

    const { error } = await supabase.auth.signInWithOtp({
      phone
    });

    if (error) {
      throw new Error(error.message);
    }

    return {
      success: true,
      message: `6-digit verification code sent to ${phone}.`
    };
  }

  /**
   * Verify Phone OTP and create/load user session
   */
  static async verifyPhoneOtp(rawPhone: string, token: string): Promise<{ user: UserProfile; token: string }> {
    const supabase = getSupabase();
    if (!supabase || !isSupabaseConfigured()) {
      throw new Error('Supabase cloud service not configured.');
    }

    let phone = rawPhone.replace(/\s+/g, '').replace(/-/g, '');
    if (/^\d{10}$/.test(phone)) {
      phone = `+91${phone}`;
    } else if (!phone.startsWith('+')) {
      phone = `+${phone}`;
    }

    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token: token.trim(),
      type: 'sms'
    });

    if (error || !data.user) {
      throw new Error(error?.message || 'Invalid or expired verification code.');
    }

    const userId = data.user.id;
    const nowIso = new Date().toISOString();
    const userProfile: UserProfile = {
      id: userId,
      name: data.user.user_metadata?.full_name || `Family (${phone.slice(-4)})`,
      email: data.user.email || `${phone.replace('+', '')}@hema.local`,
      phone,
      createdAt: data.user.created_at || nowIso,
      updatedAt: nowIso,
      lastLoginAt: nowIso,
      provider: 'supabase'
    };

    const sessionToken = data.session?.access_token || generateSecureToken();
    const session: AuthSession = {
      token: sessionToken,
      user: userProfile,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    };

    persistSession(session);
    await migrateLegacyDataToUser(userId);

    // Sync in background
    syncWithCloud(userId).catch(e => console.warn('[AuthService] Post-OTP sync error:', e));

    return { user: userProfile, token: sessionToken };
  }

  /**
   * Google OAuth One-Tap Sign-In
   */
  static async signInWithGoogle(): Promise<void> {
    if (!isSupabaseConfigured()) {
      throw new Error('Cloud database not configured. Please enter your Supabase Project URL and Public Anon Key in Settings.');
    }

    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase client unavailable');

    const redirectUri = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUri
      }
    });

    if (error) {
      throw new Error(error.message);
    }
  }

  /**
   * Logs out the current user, clears tokens, closes DB connections
   */
  static async logout(): Promise<void> {
    const session = this.getCurrentSession();

    // 1. Sign out of Supabase if active
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        await supabase?.auth.signOut();
      } catch {}
    }

    // 2. Sign out of Express backend if active
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
