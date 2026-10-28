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

/**
 * Trigger an alert for an actual debt due date using the real person's name and amount.
 * Never uses hardcoded or placeholder names.
 */
export async function triggerDueDateAlert(debt: {
  person: string;
  amount: number;
  type: string;
  dueDate: number;
}): Promise<boolean> {
  const isIncoming = debt.type === 'OWED_TO_US';
  const dueDateStr = new Date(debt.dueDate).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  const title = isIncoming 
    ? `💰 Incoming Loan Due: ${debt.person}`
    : `⚠️ Outgoing Due: Repay to ${debt.person}`;

  const body = isIncoming
    ? `Collection Reminder: ${debt.person} repayment of ₹${debt.amount.toLocaleString('en-IN')} is due on ${dueDateStr}.`
    : `Due Date Reminder: Your payment of ₹${debt.amount.toLocaleString('en-IN')} to ${debt.person} is due on ${dueDateStr}.`;

  return triggerSystemNotification({ title, body });
}

/**
 * Scan active debts and dispatch status bar notifications for actual upcoming or overdue debts.
 */
export async function checkAndNotifyDueDebts(
  debts: Array<{ person: string; amount: number; type: string; dueDate: number; status: string }>,
  userName?: string
): Promise<{ sentCount: number; message: string }> {
  const now = Date.now();
  const threeDaysFromNow = now + 3 * 86400000;
  
  const urgentDebts = debts.filter(d => 
    d.status !== 'SETTLED' && (d.status === 'OVERDUE' || d.dueDate <= threeDaysFromNow)
  );

  if (urgentDebts.length === 0) {
    const greetingName = userName ? userName : 'Family Member';
    const sent = await triggerSystemNotification({
      title: 'Hema Loans Status: All Up to Date',
      body: `Hello ${greetingName}, all your recorded loan dues and repayments are currently up to date!`
    });
    return {
      sentCount: sent ? 1 : 0,
      message: `All loans are up to date. Confirmation alert sent to ${greetingName}.`
    };
  }

  // Trigger alert for the most urgent debt with their real name
  const topUrgent = urgentDebts[0];
  const sent = await triggerDueDateAlert(topUrgent);
  const extraCount = urgentDebts.length - 1;
  const extraText = extraCount > 0 ? ` (and ${extraCount} other pending dues)` : '';

  return {
    sentCount: sent ? 1 : 0,
    message: `Alert sent for ${topUrgent.person}${extraText}!`
  };
}
