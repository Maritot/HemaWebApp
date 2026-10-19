import React, { useState } from 'react';
import { 
  Lock, 
  Mail, 
  User, 
  Phone, 
  Key, 
  HelpCircle, 
  Eye, 
  EyeOff, 
  ShieldCheck, 
  ArrowRight, 
  CheckCircle2, 
  AlertCircle,
  Users,
  RefreshCw,
  Send
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

const SECURITY_QUESTIONS = [
  "What is your mother's maiden name?",
  "What was the name of your first school?",
  "In what city or town was your first job?",
  "What was your childhood nickname?",
  "What is your favorite family traditional festival?"
];

export const AuthScreen: React.FC = () => {
  const { 
    login, 
    register, 
    signInWithGoogle, 
    sendPasswordResetOtp,
    verifyPasswordResetOtp,
    getSecurityQuestion, 
    verifySecurityAnswer, 
    resetPassword, 
    knownUsers,
    isCloudConfigured 
  } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>('signin');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Show/Hide Password
  const [showPassword, setShowPassword] = useState(false);

  // Sign In State (Accepts either Email Address or 10-Digit Mobile Number)
  const [signInIdentifier, setSignInIdentifier] = useState('');
  const [signInPassword, setSignInPassword] = useState('');

  // Sign Up State
  const [signUpName, setSignUpName] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPhone, setSignUpPhone] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [signUpConfirmPassword, setSignUpConfirmPassword] = useState('');
  const [signUpQuestion, setSignUpQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [signUpAnswer, setSignUpAnswer] = useState('');

  // Forgot Password State
  const [forgotMethod, setForgotMethod] = useState<'email_otp' | 'security_question'>('email_otp');
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  
  // Real Email OTP State
  const [forgotOtpSent, setForgotOtpSent] = useState(false);
  const [targetEmail, setTargetEmail] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [forgotOtpCode, setForgotOtpCode] = useState('');
  const [newOtpPassword, setNewOtpPassword] = useState('');
  const [confirmNewOtpPassword, setConfirmNewOtpPassword] = useState('');

  // Security Question Fallback State
  const [forgotStep, setForgotStep] = useState<1 | 2 | 3>(1);
  const [retrievedQuestion, setRetrievedQuestion] = useState('');
  const [forgotAnswer, setForgotAnswer] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const clearAlerts = () => {
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAlerts();

    if (!signInIdentifier.trim() || !signInPassword) {
      setErrorMessage('Please enter your email or mobile number, and your password.');
      return;
    }

    setLoading(true);
    try {
      await login(signInIdentifier.trim(), signInPassword);
      setSuccessMessage('Welcome back! Loading your secure personal ledger...');
    } catch (err: any) {
      setErrorMessage(err.message || 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAlerts();

    if (!signUpName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }
    if (!signUpEmail.trim()) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    const cleanPhone = signUpPhone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setErrorMessage('Please enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (signUpPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }
    if (signUpPassword !== signUpConfirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }
    if (!signUpAnswer.trim()) {
      setErrorMessage('Please provide an answer to your security question for account recovery.');
      return;
    }

    setLoading(true);
    try {
      await register({
        name: signUpName.trim(),
        email: signUpEmail.trim(),
        phone: cleanPhone,
        password: signUpPassword,
        securityQuestion: signUpQuestion,
        securityAnswer: signUpAnswer.trim()
      });
      setSuccessMessage('Account created successfully! Initializing your private ledger...');
    } catch (err: any) {
      setErrorMessage(err.message || 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    clearAlerts();
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not initiate Google Sign-In.');
      setLoading(false);
    }
  };

  // --- Real Product Email OTP Password Recovery ---
  const handleSendResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAlerts();

    if (!forgotIdentifier.trim()) {
      setErrorMessage('Please enter your registered email address or 10-digit mobile number.');
      return;
    }

    setLoading(true);
    try {
      const res = await sendPasswordResetOtp(forgotIdentifier.trim());
      setTargetEmail(res.email);
      setMaskedEmail(res.maskedEmail);
      setForgotOtpSent(true);
      setSuccessMessage(`Verification code sent to ${res.maskedEmail}. Please check your inbox or spam folder.`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to send verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAlerts();

    if (forgotOtpCode.trim().length < 6) {
      setErrorMessage('Please enter the 6-digit code sent to your email.');
      return;
    }
    if (newOtpPassword.length < 6) {
      setErrorMessage('New password must be at least 6 characters.');
      return;
    }
    if (newOtpPassword !== confirmNewOtpPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await verifyPasswordResetOtp(targetEmail, forgotOtpCode.trim(), newOtpPassword);
      setSuccessMessage('Password reset successfully! Please sign in with your new password.');
      setMode('signin');
      setSignInIdentifier(targetEmail);
      setSignInPassword('');
      setForgotOtpSent(false);
      setForgotOtpCode('');
      setNewOtpPassword('');
      setConfirmNewOtpPassword('');
    } catch (err: any) {
      setErrorMessage(err.message || 'Verification failed. Please check the code and try again.');
    } finally {
      setLoading(false);
    }
  };

  // --- Security Question Fallback Recovery ---
  const handleForgotStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAlerts();
    if (!forgotIdentifier.trim()) {
      setErrorMessage('Please enter your registered email address or mobile number.');
      return;
    }

    setLoading(true);
    try {
      const q = await getSecurityQuestion(forgotIdentifier.trim());
      setRetrievedQuestion(q);
      setForgotStep(2);
    } catch (err: any) {
      setErrorMessage(err.message || 'No account found with this email or mobile number.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAlerts();
    if (!forgotAnswer.trim()) {
      setErrorMessage('Please enter your answer.');
      return;
    }

    setLoading(true);
    try {
      const token = await verifySecurityAnswer(forgotIdentifier.trim(), forgotAnswer.trim());
      setResetToken(token);
      setForgotStep(3);
    } catch (err: any) {
      setErrorMessage(err.message || 'Incorrect answer to security question.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotStep3 = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAlerts();
    if (newPassword.length < 6) {
      setErrorMessage('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await resetPassword(resetToken, newPassword);
      setSuccessMessage('Password has been reset successfully! Please sign in with your new password.');
      setMode('signin');
      setSignInIdentifier(forgotIdentifier);
      setSignInPassword('');
      setForgotStep(1);
    } catch (err: any) {
      setErrorMessage(err.message || 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4 sm:p-6 text-slate-800 antialiased selection:bg-amber-500 selection:text-white">
      {/* Background Glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-96 h-96 bg-amber-600/15 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden relative z-10 animate-in fade-in zoom-in-95 duration-200">
        {/* Header Branding */}
        <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white p-6 sm:p-7 text-center relative border-b-2 border-amber-500">
          <div className="flex justify-center mb-3">
            <div className="w-16 h-16 rounded-2xl bg-slate-800/80 border border-amber-500/40 p-2 shadow-inner flex items-center justify-center">
              <img 
                src="/hema-logo.gif" 
                alt="Hema Finance" 
                className="w-full h-full object-contain rounded-xl"
              />
            </div>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">
            Hema <span className="bg-gradient-to-r from-amber-400 to-amber-200 bg-clip-text text-transparent">Finance</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 font-medium">
            Personal Household Ledger · Multi-User Secured
          </p>
          
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-bold tracking-wider uppercase mt-3">
            <ShieldCheck size={12} className="text-amber-400" />
            Strict User-Level Data Isolation
          </div>
        </div>

        {/* Mode Selector Tabs */}
        {mode !== 'forgot' && (
          <div className="flex border-b border-slate-100 bg-slate-50/70 p-1.5 gap-1.5">
            <button
              type="button"
              onClick={() => { setMode('signin'); clearAlerts(); }}
              className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                mode === 'signin' 
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => { setMode('signup'); clearAlerts(); }}
              className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                mode === 'signup' 
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80' 
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              Create Account
            </button>
          </div>
        )}

        <div className="p-6 sm:p-7">
          {/* Status Alerts */}
          {errorMessage && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-start space-x-2">
              <AlertCircle size={16} className="text-red-600 shrink-0 mt-0.5" />
              <span className="font-semibold leading-relaxed">{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start space-x-2">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
              <span className="font-semibold leading-relaxed">{successMessage}</span>
            </div>
          )}

          {/* Quick Account Switcher (if saved accounts exist on this device) */}
          {mode === 'signin' && knownUsers.length > 0 && (
            <div className="mb-5 p-3 rounded-2xl bg-amber-50/60 border border-amber-200/70">
              <div className="flex items-center space-x-1.5 text-[11px] font-bold text-amber-950 mb-2">
                <Users size={13} className="text-amber-600" />
                <span>Saved Accounts on this Device:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {knownUsers.map(u => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setSignInIdentifier(u.email || u.phone || '');
                      clearAlerts();
                    }}
                    className={`inline-flex items-center space-x-2 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      signInIdentifier === u.email || (u.phone && signInIdentifier === u.phone)
                        ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                        : 'bg-white text-slate-800 border-amber-300 hover:bg-amber-100/50'
                    }`}
                  >
                    <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-900 flex items-center justify-center text-[10px]">
                      {u.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span>{u.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* --- UNIFIED SIGN IN FORM (EMAIL OR MOBILE + PASSWORD) --- */}
          {mode === 'signin' && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Email Address or Mobile Number
                </label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    autoComplete="username"
                    value={signInIdentifier}
                    onChange={e => setSignInIdentifier(e.target.value)}
                    placeholder="name@family.com or 9876543210"
                    className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-bold text-slate-700">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => { 
                      setMode('forgot'); 
                      clearAlerts(); 
                      setForgotIdentifier(signInIdentifier);
                      setForgotMethod('email_otp');
                      setForgotOtpSent(false);
                    }}
                    className="text-[11px] font-semibold text-amber-700 hover:text-amber-800 hover:underline cursor-pointer"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={signInPassword}
                    onChange={e => setSignInPassword(e.target.value)}
                    placeholder="Enter your secure password"
                    className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-2 py-3 px-4 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-bold rounded-xl text-xs sm:text-sm shadow-md transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center space-x-2 cursor-pointer"
              >
                <span>{loading ? 'Authenticating...' : 'Sign In to Ledger'}</span>
                {!loading && <ArrowRight size={16} />}
              </button>

              {/* Google OAuth Option */}
              {isCloudConfigured && (
                <div className="pt-2">
                  <div className="relative my-3">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
                    <div className="relative flex justify-center text-[10px] uppercase font-bold text-slate-400"><span className="bg-white px-2">Or continue with</span></div>
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleGoogleSignIn}
                    className="w-full py-2.5 px-4 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                    </svg>
                    <span>Sign in with Google</span>
                  </button>
                </div>
              )}
            </form>
          )}

          {/* --- CREATE ACCOUNT FORM --- */}
          {mode === 'signup' && (
            <form onSubmit={handleSignUp} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Full Name
                </label>
                <div className="relative">
                  <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={signUpName}
                    onChange={e => setSignUpName(e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Email Address
                </label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    required
                    value={signUpEmail}
                    onChange={e => setSignUpEmail(e.target.value)}
                    placeholder="yourname@family.com"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Mobile Number (10 Digits)
                </label>
                <div className="relative flex">
                  <div className="flex items-center justify-center px-2.5 bg-slate-100 border border-r-0 border-slate-200 rounded-l-xl text-xs font-bold text-slate-700">
                    🇮🇳 +91
                  </div>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    autoComplete="tel"
                    inputMode="tel"
                    value={signUpPhone}
                    onChange={e => setSignUpPhone(e.target.value.replace(/\D/g, ''))}
                    placeholder="98765 43210"
                    className="w-full pl-3 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-r-xl text-xs sm:text-sm font-semibold tracking-wide focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                  />
                </div>
                <p className="text-[10px] text-slate-500 mt-1">
                  You can use either this mobile number or your email to sign in anytime.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Password (min 6)
                  </label>
                  <div className="relative">
                    <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      value={signUpPassword}
                      onChange={e => setSignUpPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <Key size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      value={signUpConfirmPassword}
                      onChange={e => setSignUpConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-1">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Security Recovery Question (Offline Reset)
                </label>
                <select
                  value={signUpQuestion}
                  onChange={e => setSignUpQuestion(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
                >
                  {SECURITY_QUESTIONS.map(q => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Answer
                </label>
                <div className="relative">
                  <HelpCircle size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={signUpAnswer}
                    onChange={e => setSignUpAnswer(e.target.value)}
                    placeholder="Your secret answer"
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full mt-3 py-3 px-4 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-bold rounded-xl text-xs sm:text-sm shadow-md transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center space-x-2 cursor-pointer"
              >
                <span>{loading ? 'Creating Secured Account...' : 'Create Secured Account'}</span>
                {!loading && <ArrowRight size={16} />}
              </button>

              {/* Google OAuth Option on Create Account */}
              {isCloudConfigured && (
                <div className="pt-2">
                  <div className="relative my-3">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200" /></div>
                    <div className="relative flex justify-center text-[10px] uppercase font-bold text-slate-400"><span className="bg-white px-2">Or continue with</span></div>
                  </div>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleGoogleSignIn}
                    className="w-full py-2.5 px-4 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                    </svg>
                    <span>Sign up with Google</span>
                  </button>
                </div>
              )}
            </form>
          )}

          {/* --- FORGOT PASSWORD WIZARD (REAL EMAIL OTP + OFFLINE RECOVERY) --- */}
          {mode === 'forgot' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div className="flex items-center space-x-2">
                  <Key size={16} className="text-amber-600" />
                  <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                    Reset Your Password
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => { 
                    setMode('signin'); 
                    clearAlerts(); 
                    setForgotStep(1); 
                    setForgotOtpSent(false); 
                  }}
                  className="text-xs text-slate-500 hover:text-slate-800 font-semibold cursor-pointer"
                >
                  ← Back to Sign In
                </button>
              </div>

              {/* Recovery Method Tabs */}
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setForgotMethod('security_question');
                    clearAlerts();
                    setForgotStep(1);
                  }}
                  className={`py-2 px-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center space-x-1.5 ${
                    forgotMethod === 'security_question'
                      ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <HelpCircle size={13} className={forgotMethod === 'security_question' ? 'text-amber-600' : ''} />
                  <span>Security Question</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setForgotMethod('email_otp');
                    clearAlerts();
                    setForgotOtpSent(false);
                  }}
                  className={`py-2 px-2 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center space-x-1.5 ${
                    forgotMethod === 'email_otp'
                      ? 'bg-white text-slate-900 shadow-xs border border-slate-200'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Mail size={13} className={forgotMethod === 'email_otp' ? 'text-amber-600' : ''} />
                  <span>Email Code (OTP)</span>
                </button>
              </div>

              {/* METHOD 1: REAL 6-DIGIT EMAIL OTP FLOW */}
              {forgotMethod === 'email_otp' && (
                <>
                  {!forgotOtpSent ? (
                    <form onSubmit={handleSendResetOtp} className="space-y-3.5">
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Enter your registered Email Address or 10-digit Mobile Number. We will dispatch a 6-digit verification code directly to your email inbox.
                      </p>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          Email Address or Mobile Number
                        </label>
                        <div className="relative">
                          <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            required
                            autoComplete="username"
                            value={forgotIdentifier}
                            onChange={e => setForgotIdentifier(e.target.value)}
                            placeholder="name@family.com or 9876543210"
                            className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={loading || !forgotIdentifier.trim()}
                        className="w-full py-3 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-bold rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-60"
                      >
                        <Send size={15} />
                        <span>{loading ? 'Sending Code...' : 'Send 6-Digit Verification Code'}</span>
                      </button>

                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 text-center">
                        <p className="text-[11px] text-slate-500 mb-1.5">No internet or email rate limit reached?</p>
                        <button
                          type="button"
                          onClick={() => {
                            clearAlerts();
                            setForgotMethod('security_question');
                            setForgotStep(1);
                          }}
                          className="text-xs font-bold text-amber-700 hover:text-amber-800 hover:underline cursor-pointer"
                        >
                          Use Security Question for Instant Reset →
                        </button>
                      </div>
                    </form>
                  ) : (
                    <form onSubmit={handleVerifyResetOtp} className="space-y-3.5">
                      <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl text-xs">
                        <p className="font-semibold text-amber-950">
                          📧 Verification code sent to <span className="font-mono font-bold text-amber-800">{maskedEmail}</span>
                        </p>
                        <p className="text-[11px] text-amber-700 mt-0.5">
                          Open your Gmail or email app, copy the 6-digit code, and enter it below.
                        </p>
                      </div>

                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="text-xs font-bold text-slate-700">
                            6-Digit Verification Code
                          </label>
                          <button
                            type="button"
                            onClick={() => { setForgotOtpSent(false); setForgotOtpCode(''); }}
                            className="text-[11px] font-semibold text-amber-700 hover:underline cursor-pointer"
                          >
                            Change Email
                          </button>
                        </div>
                        <input
                          type="text"
                          required
                          maxLength={6}
                          autoFocus
                          inputMode="numeric"
                          value={forgotOtpCode}
                          onChange={e => setForgotOtpCode(e.target.value.replace(/\D/g, ''))}
                          placeholder="• • • • • •"
                          className="w-full text-center py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-lg font-black tracking-widest focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          New Password (min 6)
                        </label>
                        <div className="relative">
                          <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            required
                            autoComplete="new-password"
                            value={newOtpPassword}
                            onChange={e => setNewOtpPassword(e.target.value)}
                            placeholder="Enter new password"
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          Confirm New Password
                        </label>
                        <div className="relative">
                          <Key size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            required
                            autoComplete="new-password"
                            value={confirmNewOtpPassword}
                            onChange={e => setConfirmNewOtpPassword(e.target.value)}
                            placeholder="Re-enter new password"
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={loading || forgotOtpCode.length < 6 || newOtpPassword.length < 6}
                        className="w-full py-3 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-bold rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-60"
                      >
                        <CheckCircle2 size={16} />
                        <span>{loading ? 'Verifying & Saving...' : 'Verify Code & Reset Password'}</span>
                      </button>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                        <button
                          type="button"
                          disabled={loading}
                          onClick={handleSendResetOtp}
                          className="font-bold text-slate-500 hover:text-amber-700 flex items-center gap-1 cursor-pointer"
                        >
                          <RefreshCw size={12} />
                          <span>Resend Email Code</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            clearAlerts();
                            setForgotMethod('security_question');
                            setForgotStep(1);
                          }}
                          className="font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                        >
                          Use Security Question instead
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}

              {/* METHOD 2: OFFLINE SECURITY QUESTION RECOVERY */}
              {forgotMethod === 'security_question' && (
                <>
                  {forgotStep === 1 && (
                    <form onSubmit={handleForgotStep1} className="space-y-3.5">
                      <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900">
                        <span className="font-bold block mb-0.5">🔒 Instant Offline Recovery</span>
                        Answer your secret recovery question to unlock and reset your password immediately.
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          Email or Mobile Number
                        </label>
                        <input
                          type="text"
                          required
                          autoComplete="username"
                          value={forgotIdentifier}
                          onChange={e => setForgotIdentifier(e.target.value)}
                          placeholder="name@family.com or 9876543210"
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loading || !forgotIdentifier.trim()}
                        className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors cursor-pointer"
                      >
                        {loading ? 'Looking up...' : 'Next: Retrieve Question →'}
                      </button>

                      <div className="text-center pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            clearAlerts();
                            setForgotMethod('email_otp');
                            setForgotOtpSent(false);
                          }}
                          className="text-xs font-semibold text-amber-700 hover:underline cursor-pointer"
                        >
                          Prefer an email code? Switch to Email OTP
                        </button>
                      </div>
                    </form>
                  )}

                  {forgotStep === 2 && (
                    <form onSubmit={handleForgotStep2} className="space-y-3.5">
                      <p className="text-xs text-slate-500">
                        Answer the security question you configured during registration.
                      </p>
                      <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl">
                        <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider block mb-1">Your Question:</span>
                        <p className="text-xs sm:text-sm font-bold text-slate-900">{retrievedQuestion}</p>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Your Answer</label>
                        <input
                          type="text"
                          required
                          autoFocus
                          value={forgotAnswer}
                          onChange={e => setForgotAnswer(e.target.value)}
                          placeholder="Type your secret answer"
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors cursor-pointer"
                      >
                        {loading ? 'Verifying...' : 'Next: Verify Answer'}
                      </button>
                    </form>
                  )}

                  {forgotStep === 3 && (
                    <form onSubmit={handleForgotStep3} className="space-y-3.5">
                      <p className="text-xs text-slate-500">
                        Verification passed! Choose a new secure password.
                      </p>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">New Password (min 6)</label>
                        <input
                          type="password"
                          required
                          value={newPassword}
                          onChange={e => setNewPassword(e.target.value)}
                          placeholder="New password"
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Confirm New Password</label>
                        <input
                          type="password"
                          required
                          value={confirmNewPassword}
                          onChange={e => setConfirmNewPassword(e.target.value)}
                          placeholder="Confirm new password"
                          className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-xs transition-colors cursor-pointer"
                      >
                        {loading ? 'Updating Password...' : 'Reset & Save Password'}
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
