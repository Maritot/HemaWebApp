import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { BrowserRouter as Router, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { Home, IndianRupee, Users, Gift, Bot, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Keyboard } from '@capacitor/keyboard';
import Dashboard from './pages/Dashboard';
import Expenses from './pages/Expenses';
import Debts from './pages/Debts';
import Gifts from './pages/Gifts';
import Assistant from './pages/Assistant';
import SettingsPage from './pages/Settings';
import { LockScreen } from './components/LockScreen';
import { isSessionUnlocked, lockSession, isPinEnabled } from './lib/security';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AuthScreen } from './components/AuthScreen';

const AppContent: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const isAssistantPage = location.pathname === '/assistant';
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const { user, isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    let showListener: any;
    let hideListener: any;

    try {
      showListener = Keyboard.addListener('keyboardWillShow', () => setIsKeyboardOpen(true));
      hideListener = Keyboard.addListener('keyboardWillHide', () => setIsKeyboardOpen(false));
    } catch (e) {}

    const handleResize = () => {
      if (window.visualViewport) {
        // When soft keyboard opens on mobile, visualViewport height shrinks significantly
        const isShrunk = window.visualViewport.height < window.innerHeight * 0.82;
        setIsKeyboardOpen(isShrunk);
      }
    };

    window.visualViewport?.addEventListener('resize', handleResize);
    window.addEventListener('resize', handleResize);

    return () => {
      showListener?.remove?.();
      hideListener?.remove?.();
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-900 text-white font-sans">
        <div className="flex flex-col items-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-amber-500/40 p-2 shadow-inner flex items-center justify-center animate-pulse">
            <img src="/hema-logo.gif" alt="Hema" className="w-full h-full object-contain rounded-xl" />
          </div>
          <p className="text-xs font-bold text-amber-400 tracking-wider uppercase">Loading Secured Ledger...</p>
        </div>
      </div>
    );
  }

  // Protected Route Guard: If not authenticated, force AuthScreen
  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  return (
    <div className="flex flex-col h-screen bg-background text-textMain font-sans overflow-hidden">
      {/* Header */}
      <header className="bg-surface shadow-xs py-3 px-5 sm:px-6 flex justify-between items-center z-10 shrink-0 border-b border-borderLight">
        <NavLink
          to="/"
          className="flex items-center space-x-2.5 group cursor-pointer focus:outline-none select-none text-left"
          title="Hema Finance"
        >
          <img 
            src="/hema-logo.gif" 
            alt="Hema Finance" 
            className="w-8 h-8 rounded-full object-contain shadow-xs group-hover:scale-105 transition-transform" 
          />
          <span className="text-xl sm:text-2xl font-bold bg-gradient-to-r from-amber-600 via-primary-600 to-amber-700 bg-clip-text text-transparent tracking-tight">
            Hema
          </span>
        </NavLink>
        <div className="flex items-center space-x-2">
          {isPinEnabled() && (
            <button
              onClick={() => {
                lockSession();
                window.dispatchEvent(new Event('hema:lock'));
              }}
              className="p-1.5 rounded-full hover:bg-slate-100 text-textMuted"
              title="Lock App"
            >
              <Lock size={18} />
            </button>
          )}
          
          {/* Active User Avatar & Profile Badge */}
          <NavLink 
            to="/settings" 
            className="h-8 px-2 sm:px-2.5 rounded-full bg-amber-50 border border-amber-300/80 text-amber-950 flex items-center space-x-1.5 font-bold text-xs shadow-2xs hover:bg-amber-100 transition-colors cursor-pointer"
            title={`Logged in as ${user?.name} (${user?.email})`}
          >
            <span className="w-5 h-5 rounded-full bg-amber-600 text-white flex items-center justify-center text-[10px] font-black">
              {user?.name ? user.name.slice(0, 2).toUpperCase() : 'ME'}
            </span>
            <span className="max-w-[80px] truncate hidden sm:inline text-[11px] font-bold">
              {user?.name?.split(' ')[0] || 'Account'}
            </span>
          </NavLink>
        </div>
      </header>

      {/* Main Content Area */}
      <main className={cn(
        "flex-1 min-h-0",
        isAssistantPage 
          ? "flex flex-col overflow-hidden px-2.5 sm:px-4 pt-1 sm:pt-2 pb-0 lg:max-w-3xl lg:mx-auto lg:w-full"
          : "overflow-y-auto pb-24 p-4 md:p-6 lg:max-w-3xl lg:mx-auto lg:w-full"
      )}>
        <Routes key={user?.id || 'guest'}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/debts" element={<Debts />} />
          <Route path="/gifts" element={<Gifts />} />
          <Route path="/assistant" element={<Assistant isKeyboardOpen={isKeyboardOpen} />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      {/* Bottom Navigation (Hidden on Soft Keyboard) */}
      <nav className={cn(
        "w-full bg-surface border-t border-borderLight shadow-[0_-4px_20px_-2px_rgba(0,0,0,0.05)] pb-safe z-20 transition-all duration-150",
        isAssistantPage ? "relative shrink-0" : "absolute bottom-0",
        isKeyboardOpen ? "hidden" : "block"
      )}>
        <div className="flex justify-around items-center h-14 sm:h-16 max-w-md mx-auto">
          <NavItem to="/" icon={<Home size={20} />} label={t('nav.home')} />
          <NavItem to="/expenses" icon={<IndianRupee size={20} />} label={t('nav.expenses')} />
          <NavItem to="/debts" icon={<Users size={20} />} label={t('nav.debts')} />
          <NavItem to="/gifts" icon={<Gift size={20} />} label={t('nav.gifts')} />
          <NavItem to="/assistant" icon={<Bot size={20} />} label={t('nav.ai')} />
        </div>
      </nav>
    </div>
  );
};

const App: React.FC = () => {
  const [isLocked, setIsLocked] = useState(!isSessionUnlocked());

  useEffect(() => {
    const handleLock = () => {
      lockSession();
      setIsLocked(true);
    };
    window.addEventListener('hema:lock', handleLock);
    return () => window.removeEventListener('hema:lock', handleLock);
  }, []);

  if (isLocked && isPinEnabled()) {
    return <LockScreen onUnlock={() => setIsLocked(false)} />;
  }

  return (
    <AuthProvider>
      <Router>
        <AppContent />
      </Router>
    </AuthProvider>
  );
};

function NavItem({ to, icon, label }: { to: string, icon: React.ReactNode, label: string }) {
  return (
    <NavLink 
      to={to} 
      className={({ isActive }) => cn(
        "flex flex-col items-center justify-center w-16 h-full transition-colors duration-200",
        isActive ? "text-primary-600" : "text-textMuted hover:text-primary-400"
      )}
    >
      {icon}
      <span className="text-[10px] mt-1 font-medium">{label}</span>
    </NavLink>
  );
}

export default App;
