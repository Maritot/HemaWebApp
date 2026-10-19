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
   * Prioritizes the local PBKDF2 cryptographic vault to guarantee 100% offline access
   * and prevent cloud rate limits or unconfirmed email statuses from locking users out.
   */
  static async login(identifier: string, password: string): Promise<{ user: UserProfile; token: string }> {
    const rawInput = identifier.trim();
    if (!rawInput) {
      throw new Error('Please enter your email address or 10-digit mobile number.');
    }

    const isPhone = isPhoneIdentifier(rawInput);
    const normalizedPhone = isPhone ? normalizePhone(rawInput) : '';
    const cleanEmail = !isPhone ? rawInput.toLowerCase() : '';

    // Look up matching account in the local cryptographic vault
    const accounts = getLocalAccounts();
    const matchedAccount = accounts.find(a => {
      if (isPhone && a.phone) {
        return normalizePhone(a.phone) === normalizedPhone;
      }
      return a.email.toLowerCase() === cleanEmail;
    });

    const targetEmail = matchedAccount ? matchedAccount.email : cleanEmail;

    // 1. If account is saved in local vault, verify password with PBKDF2-SHA256 FIRST
    if (matchedAccount) {
      const isLocalValid = await verifyPassword(password, matchedAccount.salt, matchedAccount.passwordHash);
      if (isLocalValid) {
        // Authenticated successfully via device cryptographic vault!
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

        // In background (non-blocking): attempt cloud session establishment & sync
        if (isSupabaseConfigured() && targetEmail) {
          getSupabase()?.auth.signInWithPassword({
            email: targetEmail,
            password
          }).then(res => {
            if (res.data?.session?.access_token) {
              session.token = res.data.session.access_token;
              persistSession(session);
              syncWithCloud(matchedAccount.id).catch(() => {});
            }
          }).catch(err => {
            console.warn('[AuthService] Non-blocking cloud session sync note:', err.message);
          });
        }

        return { user: sanitizeUser(matchedAccount), token };
      }
    }

    // 2. If not found in local vault (e.g. user on a new device), check Supabase Cloud Auth
    if (isSupabaseConfigured() && targetEmail) {
      const supabase = getSupabase();
      if (supabase) {
        try {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: targetEmail,
            password
          });

          if (!error && data.user && data.session) {
            const userId = data.user.id;
            const nowIso = new Date().toISOString();

            let name = data.user.user_metadata?.full_name || 'Family Member';
            let phone = data.user.user_metadata?.phone || (isPhone ? normalizedPhone : '');
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

            const token = data.session.access_token || generateSecureToken();
            const session: AuthSession = {
              token,
              user: userProfile,
              expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
            };

            // Cache downloaded profile in local vault with PBKDF2 hash
            const salt = generateSalt();
            const { hash } = await hashPassword(password, salt);
            const localUser: StoredUserAccount = {
              ...userProfile,
              passwordHash: hash,
              salt,
              securityQuestion: "What is your favorite family traditional festival?",
              securityAnswerHash: ""
            };
            const updatedAccounts = accounts.filter(a => a.id !== userId && a.email !== targetEmail);
            updatedAccounts.push(localUser);
            saveLocalAccounts(updatedAccounts);

            persistSession(session);
            syncWithCloud(userId).catch(e => console.warn('[AuthService] Post-login sync error:', e));

            return { user: userProfile, token };
          }
        } catch (err: any) {
          console.warn('[AuthService] Cloud login query error:', err.message);
        }
      }
    }

    // 3. Neither matched
    if (matchedAccount) {
      throw new Error('Incorrect password. Please verify your password or tap "Forgot Password?" below.');
    } else {
      throw new Error(
        isPhone 
          ? `No account registered with mobile number ${rawInput}. Please check the number or tap "Create Account".`
          : `No account registered with email ${rawInput}. Please check the email or tap "Create Account".`
      );
    }
  }

  /**
   * Google OAuth Sign-In with proper native Capacitor Browser & deep linking scheme
   */
  static async signInWithGoogle(): Promise<void> {
    if (!isSupabaseConfigured()) {
      throw new Error('Cloud database not configured. Please use Email or Mobile Number to sign in.');
    }

    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase client unavailable');

    const isNative = typeof window !== 'undefined' && 
      ((window as any).Capacitor?.isNativePlatform?.() || 
       window.location.protocol === 'capacitor:' || 
       (window.location.protocol === 'https:' && window.location.hostname === 'localhost'));

    // On native Android APK, use custom app scheme deep link so Android brings Hema to the foreground
    const redirectUri = isNative ? 'com.hema.app://auth/callback' : window.location.origin;

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUri,
          skipBrowserRedirect: isNative
        }
      });

      if (error) {
        if (error.message.includes('not enabled') || error.message.includes('Unsupported provider')) {
          throw new Error('Google Sign-In is not currently enabled in the cloud dashboard. Please sign in or create an account with your Email or Mobile Number.');
        }
        throw new Error(error.message);
      }

      if (isNative && data?.url) {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: data.url, windowName: '_system' });
      }
    } catch (err: any) {
      if (err.message.includes('not enabled') || err.message.includes('Unsupported provider')) {
        throw new Error('Google Sign-In is not currently enabled in the cloud dashboard. Please sign in or create an account with your Email or Mobile Number.');
      }
      throw err;
    }
  }

  /**
   * Processes a successful Supabase OAuth session, caches the user profile in the local vault,
   * activates the DB partition, and starts cloud sync.
   */
  static async handleCloudUserLogin(supabaseSession: any): Promise<UserProfile> {
    const sbUser = supabaseSession.user;
    const userId = sbUser.id;
    const nowIso = new Date().toISOString();

    const email = sbUser.email || '';
    const name = sbUser.user_metadata?.full_name || sbUser.user_metadata?.name || 'Google User';
    const phone = normalizePhone(sbUser.user_metadata?.phone || sbUser.phone || '');

    const userProfile: UserProfile = {
      id: userId,
      name,
      email,
      phone,
      createdAt: sbUser.created_at || nowIso,
      updatedAt: nowIso,
      lastLoginAt: nowIso,
      provider: 'supabase'
    };

    const token = supabaseSession.access_token || generateSecureToken();
    const session: AuthSession = {
      token,
      user: userProfile,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    };

    // Cache in local vault
    const accounts = getLocalAccounts();
    const existingIdx = accounts.findIndex(a => a.id === userId || (email && a.email.toLowerCase() === email.toLowerCase()));
    if (existingIdx !== -1) {
      accounts[existingIdx].name = name;
      accounts[existingIdx].lastLoginAt = nowIso;
      if (phone) accounts[existingIdx].phone = phone;
    } else {
      const salt = generateSalt();
      const { hash } = await hashPassword(generateSecureToken(), salt);
      accounts.push({
        ...userProfile,
        passwordHash: hash,
        salt,
        securityQuestion: "What is your favorite family traditional festival?",
        securityAnswerHash: ""
      });
    }
    saveLocalAccounts(accounts);
    persistSession(session);
    await migrateLegacyDataToUser(userId);
    syncWithCloud(userId).catch(e => console.warn('[AuthService] Cloud sync error:', e));

    return userProfile;
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

    if (!account) {
      throw new Error(
        isPhone 
          ? `No account found with mobile number ${raw}.`
          : `No account found with email ${raw}.`
      );
    }

    return account.securityQuestion || "What is your mother's maiden name?";
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

    // If account was created with a security answer, verify it
    if (account.securityAnswerHash) {
      const answerHash = await hashSecurityAnswer(answer, account.salt);
      if (answerHash !== account.securityAnswerHash) {
        throw new Error('Incorrect answer to security question. Please try again.');
      }
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
    if (newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }

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

    // Update cloud password if session active
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        await supabase?.auth.updateUser({ password: newPassword });
      } catch {}
    }

    this.logout();
  }

  /**
   * Direct password reset for accounts saved on this device.
   * Provides immediate recovery for trusted personal device owners.
   */
  static async resetPasswordForDeviceAccount(identifier: string, newPassword: string): Promise<void> {
    if (newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }
    const raw = identifier.trim();
    const isPhone = isPhoneIdentifier(raw);
    const normalizedPhone = isPhone ? normalizePhone(raw) : '';
    const cleanEmail = !isPhone ? raw.toLowerCase() : '';

    const accounts = getLocalAccounts();
    const account = accounts.find(a => {
      if (isPhone && a.phone) return normalizePhone(a.phone) === normalizedPhone;
      return a.email.toLowerCase() === cleanEmail || a.id === raw;
    });

    if (!account) {
      throw new Error('No saved account found on this device with the provided details.');
    }

    const newSalt = generateSalt();
    const { hash: newHash } = await hashPassword(newPassword, newSalt);
    account.salt = newSalt;
    account.passwordHash = newHash;
    account.updatedAt = new Date().toISOString();
    saveLocalAccounts(accounts);

    if (isSupabaseConfigured() && account.email) {
      try {
        const supabase = getSupabase();
        await supabase?.auth.updateUser({ password: newPassword });
      } catch {}
    }

    this.logout();
  }

  /**
   * Returns list of real user profiles registered on this device for one-tap account switching
   */
  static listKnownUsersOnDevice(): UserProfile[] {
    const accounts = getLocalAccounts();
    return accounts.filter(a => !a.id.startsWith('usr_m_')).map(sanitizeUser);
  }

  /**
   * Password Recovery Step 1 (Real Email OTP):
   * Sends a real 6-digit verification code to the user's registered email inbox via Supabase.
   */
  static async sendPasswordResetOtp(identifier: string): Promise<{ success: boolean; maskedEmail: string; email: string }> {
    const raw = identifier.trim();
    const isPhone = isPhoneIdentifier(raw);
    const normalizedPhone = isPhone ? normalizePhone(raw) : '';
    const cleanEmail = !isPhone ? raw.toLowerCase() : '';

    const accounts = getLocalAccounts();
    let account = accounts.find(a => {
      if (isPhone && a.phone) {
        return normalizePhone(a.phone) === normalizedPhone;
      }
      return a.email.toLowerCase() === cleanEmail;
    });

    let targetEmail = account ? account.email : cleanEmail;

    // If not found locally, query Supabase profiles
    if (!targetEmail && isPhone && isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        if (supabase) {
          const { data } = await supabase.from('profiles').select('email').ilike('phone', `%${normalizedPhone}%`).limit(1).single();
          if (data?.email) targetEmail = data.email;
        }
      } catch {}
    }

    if (!targetEmail) {
      throw new Error(
        isPhone 
          ? `No account found with mobile number ${raw}. Please check the number or create an account.`
          : `No account found with email ${raw}. Please check the email or create an account.`
      );
    }

    // Call Supabase to send real 6-digit OTP code to the user's email
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      if (supabase) {
        const { error } = await supabase.auth.signInWithOtp({
          email: targetEmail,
          options: {
            shouldCreateUser: false
          }
        });
        if (error) {
          if (error.message.includes('rate limit')) {
            throw new Error('Cloud email service rate limit reached. Please use your Security Recovery Question below to reset your password instantly.');
          }
          throw new Error(error.message);
        }
      }
    } else {
      throw new Error('Cloud email service not configured. Please use your Security Recovery Question to reset offline.');
    }

    const masked = maskEmail(targetEmail);
    return { success: true, maskedEmail: masked, email: targetEmail };
  }

  /**
   * Password Recovery Step 2 (Real Email OTP):
   * Verifies the 6-digit OTP code sent to email and securely updates the user's password.
   */
  static async verifyPasswordResetOtp(email: string, otpCode: string, newPassword: string): Promise<void> {
    if (newPassword.length < 6) {
      throw new Error('New password must be at least 6 characters.');
    }
    if (!otpCode || otpCode.trim().length < 6) {
      throw new Error('Please enter the complete 6-digit verification code.');
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanToken = otpCode.trim();

    // 1. Verify OTP with Supabase
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      if (supabase) {
        const { data, error } = await supabase.auth.verifyOtp({
          email: cleanEmail,
          token: cleanToken,
          type: 'email'
        });

        if (error) {
          throw new Error(error.message || 'Invalid or expired verification code. Please check your email and try again.');
        }

        // Update password on Supabase
        const { error: updateErr } = await supabase.auth.updateUser({
          password: newPassword
        });
        if (updateErr) {
          console.warn('[AuthService] Supabase updateUser password error:', updateErr.message);
        }
      }
    }

    // 2. Update password hash in local vault
    const accounts = getLocalAccounts();
    const account = accounts.find(a => a.email.toLowerCase() === cleanEmail);
    if (account) {
      const newSalt = generateSalt();
      const { hash: newHash } = await hashPassword(newPassword, newSalt);
      account.salt = newSalt;
      account.passwordHash = newHash;
      account.updatedAt = new Date().toISOString();
      saveLocalAccounts(accounts);
    }

    this.logout();
  }

  // Deprecated shim kept for backwards compatibility
  static async loginWithPhoneOtp(rawPhone: string) {
    return { success: true, message: `Use your mobile number and password to sign in.` };
  }
  static async verifyPhoneOtp(rawPhone: string, token: string) {
    throw new Error('Please sign in using your mobile number and password.');
  }
}

/**
 * Masks an email address for secure, privacy-safe display (e.g. th****un@gmail.com)
 */
export function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length !== 2) return email;
  const [user, domain] = parts;
  if (user.length <= 2) return `${user[0]}*@${domain}`;
  const start = user.slice(0, 2);
  const end = user.slice(-2);
  return `${start}****${end}@${domain}`;
}
