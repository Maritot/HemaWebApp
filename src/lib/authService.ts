/**
 * Hema Universal Authentication & Authorization Service
 * Dual-identity architecture:
 * 1. Supports seamless sign-in with either Email OR 10-Digit Mobile Number + Password.
 * 2. Guaranteed user-level data isolation: both identifiers map to the EXACT same user profile and DB partition.
 * 3. Embedded Cryptographic Engine (PBKDF2-SHA256, 100k iterations) for 100% offline continuity on Android APK.
 * 4. Supabase Cloud Identity (PostgreSQL RLS, Google OAuth, Email/Password) when cloud is configured.
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

/**
 * Normalizes Indian phone numbers to canonical 10 digits
 */
export function normalizePhone(raw?: string): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Detects whether an identifier input is a mobile phone number
 */
export function isPhoneIdentifier(identifier: string): boolean {
  if (!identifier) return false;
  const clean = identifier.replace(/[\s\-\+\(\)]/g, '');
  return /^\d{10,15}$/.test(clean);
}

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

/**
 * Self-healing: reconciles any duplicate synthetic accounts created earlier
 * with the user's primary registered account.
 */
export function reconcileDuplicatePhoneAccounts(): void {
  try {
    const accounts = getLocalAccounts();
    const mainAccounts = accounts.filter(a => !a.id.startsWith('usr_m_'));
    const syntheticAccounts = accounts.filter(a => a.id.startsWith('usr_m_'));

    if (syntheticAccounts.length === 0) return;

    const filtered = accounts.filter(a => {
      if (a.id.startsWith('usr_m_')) {
        const phone = normalizePhone(a.phone);
        const hasRealAccount = mainAccounts.some(m => normalizePhone(m.phone) === phone);
        return !hasRealAccount;
      }
      return true;
    });

    saveLocalAccounts(filtered);
  } catch (e) {
    console.warn('[AuthService] Reconcile error:', e);
  }
}

// Auto-run on module load
reconcileDuplicatePhoneAccounts();

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
   * Registers a new user account across Supabase cloud (if configured) or local vault.
   * Mobile number is strictly required (10 digits) and validated for uniqueness.
   */
  static async register(params: {
    name: string;
    email: string;
    password: string;
    phone: string;
    securityQuestion: string;
    securityAnswer: string;
  }): Promise<{ user: UserProfile; token: string }> {
    const { name, email, password, phone, securityQuestion, securityAnswer } = params;
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = normalizePhone(phone);

    if (!cleanPhone || cleanPhone.length !== 10) {
      throw new Error('Please enter a valid 10-digit Indian mobile number.');
    }

    // Check local accounts for duplicate email or mobile number
    const accounts = getLocalAccounts();
    if (accounts.some(a => a.email.toLowerCase() === cleanEmail)) {
      throw new Error('An account with this email address already exists. Please sign in instead.');
    }
    if (accounts.some(a => a.phone && normalizePhone(a.phone) === cleanPhone)) {
      throw new Error('An account with this mobile number already exists. Please sign in instead.');
    }

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
                phone: `+91${cleanPhone}`
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
              phone: `+91${cleanPhone}`,
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
            const updatedAccounts = getLocalAccounts().filter(a => a.email !== cleanEmail && a.id !== userId);
            updatedAccounts.push(localUser);
            saveLocalAccounts(updatedAccounts);

            persistSession(session);
            await migrateLegacyDataToUser(userId);
            uploadLocalDataToCloud(userId).catch(e => console.warn('[AuthService] Initial cloud upload error:', e));

            return { user: userProfile, token };
          }
        } catch (err: any) {
          console.warn('[AuthService] Supabase registration error, falling back to local vault:', err.message);
        }
      }
    }

    // 2. Standalone / Offline Cryptographic Vault Registration (PBKDF2-SHA256)
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
    await migrateLegacyDataToUser(userId);

    return { user: sanitizeUser(newUser), token };
  }

  /**
   * Unified Login: Authenticates with either Email Address OR Mobile Number + Password.
   * Both identifiers resolve to the EXACT SAME user profile and database partition.
   */
  static async login(identifier: string, password: string): Promise<{ user: UserProfile; token: string }> {
    const rawInput = identifier.trim();
    if (!rawInput) {
      throw new Error('Please enter your email address or 10-digit mobile number.');
    }

    const isPhone = isPhoneIdentifier(rawInput);
    const normalizedPhone = isPhone ? normalizePhone(rawInput) : '';
    const cleanEmail = !isPhone ? rawInput.toLowerCase() : '';

    // Look up matching account in the local vault
    const accounts = getLocalAccounts();
    const matchedAccount = accounts.find(a => {
      if (isPhone && a.phone) {
        return normalizePhone(a.phone) === normalizedPhone;
      }
      return a.email.toLowerCase() === cleanEmail;
    });

    const targetEmail = matchedAccount ? matchedAccount.email : cleanEmail;

    // 1. Try Supabase Cloud Auth first if configured and target email is known
    if (isSupabaseConfigured() && targetEmail) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: targetEmail,
            password
          });

          if (!error && data.user) {
            const userId = data.user.id;
            const nowIso = new Date().toISOString();

            let name = data.user.user_metadata?.full_name || matchedAccount?.name || 'Family Member';
            let phone = data.user.user_metadata?.phone || matchedAccount?.phone || (isPhone ? normalizedPhone : '');
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
              email: targetEmail,
              phone: normalizePhone(phone),
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

            // Update or cache in local vault
            const existingIdx = accounts.findIndex(a => a.email === targetEmail || a.id === userId);
            if (existingIdx !== -1) {
              accounts[existingIdx].lastLoginAt = nowIso;
              if (phone) accounts[existingIdx].phone = normalizePhone(phone);
              saveLocalAccounts(accounts);
            } else {
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
            syncWithCloud(userId).catch(e => console.warn('[AuthService] Post-login sync error:', e));

            return { user: userProfile, token };
          } else if (error) {
            if (error.message.includes('Invalid login credentials')) {
              throw new Error('Incorrect password or unregistered account.');
            }
          }
        } catch (err: any) {
          if (err.message.includes('Incorrect') || err.message.includes('unregistered')) throw err;
          console.warn('[AuthService] Cloud login unavailable, checking offline vault:', err.message);
        }
      }
    }

    // 2. Standalone / Offline Cryptographic Vault Login (PBKDF2-SHA256)
    if (!matchedAccount) {
      throw new Error(
        isPhone 
          ? `No account registered with mobile number ${rawInput}. Please create an account first.`
          : `No account registered with email ${rawInput}. Please create an account first.`
      );
    }

    const isValid = await verifyPassword(password, matchedAccount.salt, matchedAccount.passwordHash);
    if (!isValid) {
      throw new Error('Incorrect password. Please try again.');
    }

    const nowIso = new Date().toISOString();
    matchedAccount.lastLoginAt = nowIso;
    saveLocalAccounts(accounts);

    const token = generateSecureToken();
    const session: AuthSession = {
      token,
      user: sanitizeUser(matchedAccount),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    };

    persistSession(session);
    return { user: sanitizeUser(matchedAccount), token };
  }

  /**
   * Google OAuth Sign-In with proper native Capacitor deep linking scheme
   */
  static async signInWithGoogle(): Promise<void> {
    if (!isSupabaseConfigured()) {
      throw new Error('Cloud database not configured. Please use Email/Mobile password login.');
    }

    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase client unavailable');

    const isNative = typeof window !== 'undefined' && 
      ((window as any).Capacitor?.isNativePlatform?.() || 
       window.location.protocol === 'capacitor:' || 
       (window.location.protocol === 'https:' && window.location.hostname === 'localhost'));

    // On native Android APK, use custom app scheme deep link so Android brings Hema to the foreground
    const redirectUri = isNative ? 'com.hema.app://auth/callback' : window.location.origin;

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
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        await supabase?.auth.signOut();
      } catch {}
    }
    persistSession(null);
  }

  /**
   * Password Recovery Step 1: Look up registered security question by Email OR Mobile
   */
  static async getSecurityQuestion(identifier: string): Promise<string> {
    const raw = identifier.trim();
    const isPhone = isPhoneIdentifier(raw);
    const normalizedPhone = isPhone ? normalizePhone(raw) : '';
    const cleanEmail = !isPhone ? raw.toLowerCase() : '';

    const accounts = getLocalAccounts();
    const account = accounts.find(a => {
      if (isPhone && a.phone) {
        return normalizePhone(a.phone) === normalizedPhone;
      }
      return a.email.toLowerCase() === cleanEmail;
    });

    if (!account || !account.securityQuestion) {
      throw new Error('No account found with this email or mobile number.');
    }

    return account.securityQuestion;
  }

  /**
   * Password Recovery Step 2: Verify security answer by Email OR Mobile and issue reset token
   */
  static async verifySecurityAnswer(identifier: string, answer: string): Promise<string> {
    const raw = identifier.trim();
    const isPhone = isPhoneIdentifier(raw);
    const normalizedPhone = isPhone ? normalizePhone(raw) : '';
    const cleanEmail = !isPhone ? raw.toLowerCase() : '';

    const accounts = getLocalAccounts();
    const account = accounts.find(a => {
      if (isPhone && a.phone) {
        return normalizePhone(a.phone) === normalizedPhone;
      }
      return a.email.toLowerCase() === cleanEmail;
    });

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
      email: account.email,
      expiresAt: Date.now() + 15 * 60 * 1000
    });
    localStorage.setItem(STORAGE_KEY_RESET_TOKENS, JSON.stringify(tokens));

    return resetToken;
  }

  /**
   * Password Recovery Step 3: Complete offline reset with new password
   */
  static async resetPassword(resetToken: string, newPassword: string): Promise<void> {
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

    const newSalt = generateSalt();
    const { hash: newHash } = await hashPassword(newPassword, newSalt);

    account.salt = newSalt;
    account.passwordHash = newHash;
    account.updatedAt = new Date().toISOString();

    saveLocalAccounts(accounts);

    // Remove used token
    const remainingTokens = tokens.filter((t: any) => t.token !== resetToken);
    localStorage.setItem(STORAGE_KEY_RESET_TOKENS, JSON.stringify(remainingTokens));

    this.logout();
  }

  /**
   * Returns list of real user profiles registered on this device for one-tap account switching
   */
  static listKnownUsersOnDevice(): UserProfile[] {
    const accounts = getLocalAccounts();
    return accounts.filter(a => !a.id.startsWith('usr_m_')).map(sanitizeUser);
  }

  // Deprecated shim kept for backwards compatibility
  static async loginWithPhoneOtp(rawPhone: string) {
    return { success: true, message: `Use your mobile number and password to sign in.` };
  }
  static async verifyPhoneOtp(rawPhone: string, token: string) {
    throw new Error('Please sign in using your mobile number and password.');
  }
}
