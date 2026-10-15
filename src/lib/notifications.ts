import { LocalNotifications } from '@capacitor/local-notifications';

export const NOTIFICATION_CHANNEL_ID = 'hema_financial_alerts';

/**
 * Initialize native Android notification channel
 */
export async function initNotifications(): Promise<void> {
  try {
    await LocalNotifications.createChannel({
      id: NOTIFICATION_CHANNEL_ID,
      name: 'Hema Financial Alerts',
      description: 'Loan repayments, budget reminders, and household alerts',
      importance: 5, // High importance (heads-up banner with sound & vibration)
      visibility: 1, // Public
      vibration: true,
      sound: 'default'
    });
  } catch (e) {
    console.warn('[Notifications] Could not create notification channel:', e);
  }
}

/**
 * Request notification permissions natively on Android (and web fallback)
 */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const perm = await LocalNotifications.requestPermissions();
    if (perm.display === 'granted') {
      await initNotifications();
      return true;
    }
  } catch (e) {
    console.warn('[Notifications] LocalNotifications.requestPermissions error:', e);
  }

  // Web fallback for desktop browsers
  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      const res = await Notification.requestPermission();
      return res === 'granted';
    } catch (e) {}
  }

  return false;
}

/**
 * Check if notification permissions are already granted
 */
export async function checkNotificationPermission(): Promise<boolean> {
  try {
    const perm = await LocalNotifications.checkPermissions();
    return perm.display === 'granted';
  } catch (e) {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission === 'granted';
    }
    return false;
  }
}

/**
 * Trigger an immediate native Android system notification
 * Appears in the Android status bar and notification tray outside the app.
 */
export async function triggerSystemNotification(options: {
  title: string;
  body: string;
  id?: number;
}): Promise<boolean> {
  const notifId = options.id || Math.floor(Math.random() * 1000000) + 1;

  // Native vibration
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate([100, 50, 100, 50, 200]);
  }

  try {
    await initNotifications();
    await LocalNotifications.schedule({
      notifications: [
        {
          id: notifId,
          title: options.title,
          body: options.body,
          channelId: NOTIFICATION_CHANNEL_ID,
          schedule: { at: new Date(Date.now() + 500) }, // 500ms in future
          sound: 'default',
          extra: { source: 'hema_app' }
        }
      ]
    });
    return true;
  } catch (err) {
    console.warn('[Notifications] LocalNotifications.schedule failed, trying Web Notification:', err);
  }

  // Web fallback
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(options.title, {
        body: options.body,
        icon: '/pwa-192x192.png'
      });
      return true;
    } catch (e) {}
  }

  return false;
}
