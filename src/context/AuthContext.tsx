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
  getSecurityQuestion: (identifier: string) => Promise<string>;
  verifySecurityAnswer: (identifier: string, answer: string) => Promise<string>;
  resetPassword: (resetToken: string, newPassword: string) => Promise<void>;
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
        supabase.auth.getSession().then(({ data }) => {
          if (data?.session?.user && !session) {
            const sbUser = data.session.user;
            const userProfile: UserProfile = {
              id: sbUser.id,
              name: sbUser.user_metadata?.full_name || 'Family Member',
              email: sbUser.email || '',
              phone: sbUser.phone || '',
              createdAt: sbUser.created_at,
              updatedAt: new Date().toISOString(),
              lastLoginAt: new Date().toISOString(),
              provider: 'supabase'
            };
            setUser(userProfile);
            setToken(data.session.access_token);
            refreshUsers();
            syncWithCloud(sbUser.id).catch(() => {});
          }
        }).catch(() => {});
      }
    }

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

  const getSecurityQuestion = async (identifier: string) => {
    return AuthService.getSecurityQuestion(identifier);
  };

  const verifySecurityAnswer = async (identifier: string, answer: string) => {
    return AuthService.verifySecurityAnswer(identifier, answer);
  };

  const resetPassword = async (resetToken: string, newPassword: string) => {
    await AuthService.resetPassword(resetToken, newPassword);
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
        getSecurityQuestion,
        verifySecurityAnswer,
        resetPassword,
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
