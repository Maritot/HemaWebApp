import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AuthService, UserProfile } from '@/lib/authService';

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  knownUsers: UserProfile[];
  login: (email: string, password: string) => Promise<void>;
  register: (params: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    securityQuestion: string;
    securityAnswer: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  getSecurityQuestion: (email: string) => Promise<string>;
  verifySecurityAnswer: (email: string, answer: string) => Promise<string>;
  resetPassword: (resetToken: string, newPassword: string) => Promise<void>;
  refreshUsers: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(() => AuthService.getCurrentUser());
  const [token, setToken] = useState<string | null>(() => AuthService.getCurrentSession()?.token || null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [knownUsers, setKnownUsers] = useState<UserProfile[]>(() => AuthService.listKnownUsersOnDevice());

  const refreshUsers = () => {
    setKnownUsers(AuthService.listKnownUsersOnDevice());
  };

  useEffect(() => {
    // Initial session validation
    const session = AuthService.getCurrentSession();
    if (session) {
      setUser(session.user);
      setToken(session.token);
    } else {
      setUser(null);
      setToken(null);
    }
    refreshUsers();
    setIsLoading(false);

    // Listen to cross-component auth state changes
    const handleAuthChange = (e: any) => {
      const updatedUser = e.detail as UserProfile | null;
      setUser(updatedUser);
      setToken(AuthService.getCurrentSession()?.token || null);
      refreshUsers();
    };

    window.addEventListener('hema:auth-changed', handleAuthChange);
    return () => window.removeEventListener('hema:auth-changed', handleAuthChange);
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await AuthService.login(email, password);
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
    phone?: string;
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

  const getSecurityQuestion = async (email: string) => {
    return AuthService.getSecurityQuestion(email);
  };

  const verifySecurityAnswer = async (email: string, answer: string) => {
    return AuthService.verifySecurityAnswer(email, answer);
  };

  const resetPassword = async (resetToken: string, newPassword: string) => {
    await AuthService.resetPassword(resetToken, newPassword);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isAuthenticated: !!user && !!token,
        isLoading,
        knownUsers,
        login,
        register,
        logout,
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

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
