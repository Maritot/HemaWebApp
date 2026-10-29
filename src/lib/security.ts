// App PIN Lock and Security Helper

const PIN_KEY = 'hema_security_pin';
const PIN_ENABLED_KEY = 'hema_pin_enabled';
const SESSION_UNLOCKED_KEY = 'hema_session_unlocked';

export const isPinSet = (): boolean => {
  return !!localStorage.getItem(PIN_KEY);
};

export const isPinEnabled = (): boolean => {
  return localStorage.getItem(PIN_ENABLED_KEY) === 'true' && isPinSet();
};

export const setPin = (pin: string): boolean => {
  if (pin.length === 4 && /^\d{4}$/.test(pin)) {
    localStorage.setItem(PIN_KEY, pin);
    localStorage.setItem(PIN_ENABLED_KEY, 'true');
    sessionStorage.setItem(SESSION_UNLOCKED_KEY, 'true');
    return true;
  }
  return false;
};

export const disablePin = (currentPin: string): boolean => {
  if (verifyPin(currentPin)) {
    localStorage.removeItem(PIN_KEY);
    localStorage.setItem(PIN_ENABLED_KEY, 'false');
    sessionStorage.removeItem(SESSION_UNLOCKED_KEY);
    return true;
  }
  return false;
};

export const verifyPin = (pin: string): boolean => {
  const saved = localStorage.getItem(PIN_KEY);
  if (saved === pin) {
    sessionStorage.setItem(SESSION_UNLOCKED_KEY, 'true');
    return true;
  }
  return false;
};

export const isSessionUnlocked = (): boolean => {
  if (!isPinEnabled()) return true;
  return sessionStorage.getItem(SESSION_UNLOCKED_KEY) === 'true';
};

export const lockSession = (): void => {
  sessionStorage.removeItem(SESSION_UNLOCKED_KEY);
};

