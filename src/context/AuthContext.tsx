import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AuthService, UserProfile } from '@/lib/authService';
import { remediatePollutedPartitions } from '@/lib/db';
import { isSupabaseConfigured, getSupabase } from '@/lib/supabase';
import { syncWithCloud, getSyncState, SyncState } from '@/lib/syncEngine';

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isCloudConfigured: boolean;
  cloudSyncState: SyncState;
  knownUsers: UserProfile[];
  login: (identifier: string, password: string) => Promise<void>;
  register: (params: {
    name: string;
    email: string;
    password: string;
    phone: string;
    securityQuestion: string;
    securityAnswer: string;
  }) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  triggerSync: () => Promise<void>;
  sendPasswordResetOtp: (identifier: string) => Promise<{ success: boolean; maskedEmail: string; email: string }>;
  verifyPasswordResetOtp: (email: string, otpCode: string, newPassword: string) => Promise<void>;
  getSecurityQuestion: (identifier: string) => Promise<string>;
  verifySecurityAnswer: (identifier: string, answer: string) => Promise<string>;
  resetPassword: (resetToken: string, newPassword: string) => Promise<void>;
  resetPasswordForDeviceAccount: (identifier: string, newPassword: string) => Promise<void>;
  refreshUsers: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(() => AuthService.getCurrentUser());
  const [token, setToken] = useState<string | null>(() => AuthService.getCurrentSession()?.token || null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [knownUsers, setKnownUsers] = useState<UserProfile[]>(() => AuthService.listKnownUsersOnDevice());
  const [cloudActive, setCloudActive] = useState<boolean>(() => isSupabaseConfigured());
  const [cloudSyncState, setCloudSyncState] = useState<SyncState>(() => getSyncState());

  const refreshUsers = () => {
    setKnownUsers(AuthService.listKnownUsersOnDevice());
  };

  useEffect(() => {
    // Initial session validation
    const session = AuthService.getCurrentSession();
    if (session) {
      setUser(session.user);
      setToken(session.token);
      remediatePollutedPartitions(session.user.id).catch(() => {});
      if (isSupabaseConfigured()) {
        syncWithCloud(session.user.id).catch(() => {});
      }
    } else {
      setUser(null);
      setToken(null);
    }
    refreshUsers();
    setIsLoading(false);

    // Check for Supabase OAuth redirect session
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      if (supabase) {
        supabase.auth.getSession().then(async ({ data }) => {
          if (data?.session && !session) {
            const profile = await AuthService.handleCloudUserLogin(data.session);
            setUser(profile);
            setToken(data.session.access_token);
            refreshUsers();
          }
        }).catch(() => {});
      }
    }

    // Native Capacitor App deep linking listener for Google OAuth callback
    let removeDeepLink: (() => void) | undefined;
    try {
      import('@capacitor/app').then(({ App }) => {
        App.addListener('appUrlOpen', async ({ url }) => {
          try {
            const { Browser } = await import('@capacitor/browser');
            await Browser.close();
          } catch {}

          if (url && (url.includes('access_token') || url.includes('#') || url.includes('code='))) {
            const supabase = getSupabase();
            if (supabase) {
              if (url.includes('#')) {
                const hash = url.split('#')[1];
                const params = new URLSearchParams(hash);
                const accessToken = params.get('access_token');
                const refreshToken = params.get('refresh_token');
                if (accessToken) {
                  const { data } = await supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken || ''
                  });
                  if (data?.session) {
                    const profile = await AuthService.handleCloudUserLogin(data.session);
                    setUser(profile);
                    setToken(data.session.access_token);
                    refreshUsers();
                  }
                }
              }
            }
          }
        }).then(sub => {
          removeDeepLink = () => sub.remove();
        }).catch(() => {});
      }).catch(() => {});
    } catch {}

    // Listen to cross-component auth state changes
    const handleAuthChange = (e: any) => {
      const updatedUser = e.detail as UserProfile | null;
      setUser(updatedUser);
      setToken(AuthService.getCurrentSession()?.token || null);
      refreshUsers();
    };

    // Listen to cloud config changes
    const handleCloudConfigChange = () => {
      setCloudActive(isSupabaseConfigured());
    };

    // Listen to sync state changes
    const handleSyncChange = (e: any) => {
      if (e.detail) {
        setCloudSyncState(e.detail);
      }
    };

    window.addEventListener('hema:auth-changed', handleAuthChange);
    window.addEventListener('hema:cloud-config-changed', handleCloudConfigChange);
    window.addEventListener('hema:sync-state-changed', handleSyncChange);

    return () => {
      window.removeEventListener('hema:auth-changed', handleAuthChange);
      window.removeEventListener('hema:cloud-config-changed', handleCloudConfigChange);
      window.removeEventListener('hema:sync-state-changed', handleSyncChange);
    };
  }, []);

  const login = async (identifier: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await AuthService.login(identifier, password);
      setUser(res.user);
      setToken(res.token);
      refreshUsers();
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (params: {
    name: string;
    email: string;
    password: string;
    phone: string;
    securityQuestion: string;
    securityAnswer: string;
  }) => {
    setIsLoading(true);
    try {
      const res = await AuthService.register(params);
      setUser(res.user);
      setToken(res.token);
      refreshUsers();
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    await AuthService.signInWithGoogle();
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await AuthService.logout();
      setUser(null);
      setToken(null);
      refreshUsers();
    } finally {
      setIsLoading(false);
    }
  };

  const triggerSync = async () => {
    if (user?.id) {
      await syncWithCloud(user.id);
    }
  };

  const sendPasswordResetOtp = async (identifier: string) => {
    return AuthService.sendPasswordResetOtp(identifier);
  };

  const verifyPasswordResetOtp = async (email: string, otpCode: string, newPassword: string) => {
    setIsLoading(true);
    try {
      await AuthService.verifyPasswordResetOtp(email, otpCode, newPassword);
      refreshUsers();
    } finally {
      setIsLoading(false);
    }
  };

  const getSecurityQuestion = async (identifier: string) => {
    return AuthService.getSecurityQuestion(identifier);
  };

  const verifySecurityAnswer = async (identifier: string, answer: string) => {
    return AuthService.verifySecurityAnswer(identifier, answer);
  };

  const resetPassword = async (resetToken: string, newPassword: string) => {
    await AuthService.resetPassword(resetToken, newPassword);
  };

  const resetPasswordForDeviceAccount = async (identifier: string, newPassword: string) => {
    await AuthService.resetPasswordForDeviceAccount(identifier, newPassword);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user,
        isLoading,
        isCloudConfigured: cloudActive,
        cloudSyncState,
        knownUsers,
        login,
        register,
        signInWithGoogle,
        logout,
        triggerSync,
        sendPasswordResetOtp,
        verifyPasswordResetOtp,
        getSecurityQuestion,
        verifySecurityAnswer,
        resetPassword,
        resetPasswordForDeviceAccount,
        refreshUsers
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
