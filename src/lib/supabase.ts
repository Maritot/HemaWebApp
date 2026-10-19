import { createClient, SupabaseClient } from '@supabase/supabase-js';

const STORAGE_KEY_URL = 'hema_cloud_supabase_url';
const STORAGE_KEY_ANON_KEY = 'hema_cloud_supabase_anon_key';

let cachedClient: SupabaseClient | null = null;
let currentConfigKey = '';

/**
 * Retrieves the current Supabase configuration from environment variables or localStorage
 */
export function getSupabaseConfig(): { url: string; anonKey: string } {
  const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  const storedUrl = typeof window !== 'undefined' ? (localStorage.getItem(STORAGE_KEY_URL) || '') : '';
  const storedKey = typeof window !== 'undefined' ? (localStorage.getItem(STORAGE_KEY_ANON_KEY) || '') : '';

  const url = (storedUrl || envUrl).trim();
  const anonKey = (storedKey || envKey).trim();

  return { url, anonKey };
}

/**
 * Checks whether Supabase cloud credentials are configured and validly structured
 */
export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol.startsWith('http') && anonKey.length > 20;
  } catch {
    return false;
  }
}

/**
 * Returns the singleton Supabase client or null if not yet configured
 */
export function getSupabase(): SupabaseClient | null {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) return null;

  const key = `${url}:${anonKey}`;
  if (cachedClient && currentConfigKey === key) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'hema_supabase_auth_token'
      }
    });
    currentConfigKey = key;
    return cachedClient;
  } catch (err) {
    console.warn('[Supabase] Failed to initialize client:', err);
    return null;
  }
}

/**
 * Saves Supabase credentials to localStorage and updates the cached client
 */
export function saveSupabaseCredentials(url: string, anonKey: string): boolean {
  try {
    const cleanUrl = url.trim();
    const cleanKey = anonKey.trim();
    if (!cleanUrl || !cleanKey) return false;

    // Validate URL format
    new URL(cleanUrl);

    localStorage.setItem(STORAGE_KEY_URL, cleanUrl);
    localStorage.setItem(STORAGE_KEY_ANON_KEY, cleanKey);

    cachedClient = null;
    currentConfigKey = '';
    getSupabase(); // Initialize new instance

    window.dispatchEvent(new CustomEvent('hema:cloud-config-changed'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Clears saved Supabase credentials
 */
export function clearSupabaseCredentials(): void {
  localStorage.removeItem(STORAGE_KEY_URL);
  localStorage.removeItem(STORAGE_KEY_ANON_KEY);
  cachedClient = null;
  currentConfigKey = '';
  window.dispatchEvent(new CustomEvent('hema:cloud-config-changed'));
}

/**
 * Tests connection to the configured Supabase instance
 */
export async function testSupabaseConnection(): Promise<{ success: boolean; message: string; latencyMs?: number }> {
  const supabase = getSupabase();
  if (!supabase) {
    return {
      success: false,
      message: 'Supabase credentials not configured. Please supply a valid Project URL and Anon Public Key.'
    };
  }

  const startTime = Date.now();
  try {
    // Attempt a lightweight query against public profiles or ping
    const { error } = await supabase.from('profiles').select('id').limit(1);
    const latencyMs = Date.now() - startTime;

    if (error && error.code !== 'PGRST116') {
      // If table doesn't exist yet, but authentication handshook successfully
      if (error.message.includes('relation "public.profiles" does not exist')) {
        return {
          success: true,
          latencyMs,
          message: 'Connected to Supabase! (Database schema not yet created - run schema.sql in SQL Editor)'
        };
      }
      return {
        success: false,
        latencyMs,
        message: `Supabase Error: ${error.message}`
      };
    }

    return {
      success: true,
      latencyMs,
      message: `Successfully connected to Supabase (${latencyMs}ms response time).`
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Connection failed: ${err.message || 'Network unreachable'}`
    };
  }
}
