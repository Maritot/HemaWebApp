import { getSupabase, isSupabaseConfigured } from './supabase';
import { 
  initDB, 
  getTransactions, 
  getDebts, 
  getGifts, 
  getPeople, 
  HemaDB, 
  DebtRecordItem, 
  GiftTransaction, 
  PersonRecord 
} from './db';

export interface SyncState {
  status: 'idle' | 'syncing' | 'synced' | 'error' | 'offline';
  lastSyncedAt: number | null;
  errorMessage?: string;
  itemsUploaded: number;
  itemsDownloaded: number;
}

const STORAGE_KEY_LAST_SYNC = 'hema_cloud_last_synced_at';

let currentSyncState: SyncState = {
  status: 'idle',
  lastSyncedAt: typeof window !== 'undefined' ? Number(localStorage.getItem(STORAGE_KEY_LAST_SYNC) || 0) || null : null,
  itemsUploaded: 0,
  itemsDownloaded: 0
};

function updateSyncState(newState: Partial<SyncState>) {
  currentSyncState = { ...currentSyncState, ...newState };
  if (newState.lastSyncedAt) {
    localStorage.setItem(STORAGE_KEY_LAST_SYNC, String(newState.lastSyncedAt));
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('hema:sync-state-changed', { detail: currentSyncState }));
  }
}

export function getSyncState(): SyncState {
  return currentSyncState;
}

/**
 * Uploads all local records in HemaDB_{userId} to Supabase cloud database
 */
export async function uploadLocalDataToCloud(userId: string): Promise<{ success: boolean; uploadedCount: number; error?: string }> {
  const supabase = getSupabase();
  if (!supabase || !isSupabaseConfigured()) {
    return { success: false, uploadedCount: 0, error: 'Supabase is not configured' };
  }

  try {
    const localDb = await initDB(userId);
    const [transactions, debts, gifts, people] = await Promise.all([
      localDb.getAll('transactions').catch(() => []),
      localDb.getAll('debts').catch(() => []),
      localDb.getAll('gifts').catch(() => []),
      localDb.getAll('people').catch(() => [])
    ]);

    let count = 0;

    // 1. Upload People
    if (people.length > 0) {
      const payload = people.map(p => ({
        id: p.id,
        user_id: userId,
        name: p.name,
        relationship: p.relationship || 'Family',
        phone: p.phone || null,
        avatar_url: p.avatarUrl || null,
        notes: p.notes || '',
        created_at: p.createdAt || Date.now(),
        updated_at: new Date().toISOString()
      }));
      const { error } = await supabase.from('people').upsert(payload, { onConflict: 'id' });
      if (error) console.warn('[Sync] Upload people error:', error);
      else count += people.length;
    }

    // 2. Upload Transactions
    if (transactions.length > 0) {
      const payload = transactions.map(t => ({
        id: t.id,
        user_id: userId,
        amount: t.amount,
        category_id: t.categoryId,
        label: t.label || null,
        type: t.type,
        date: t.date,
        notes: t.notes || '',
        updated_at: new Date().toISOString()
      }));
      const { error } = await supabase.from('transactions').upsert(payload, { onConflict: 'id' });
      if (error) console.warn('[Sync] Upload transactions error:', error);
      else count += transactions.length;
    }

    // 3. Upload Debts & Payments
    if (debts.length > 0) {
      const debtPayload = debts.map(d => ({
        id: d.id,
        user_id: userId,
        person: d.person,
        avatar_url: d.avatarUrl || null,
        principal_amount: d.principalAmount || d.amount,
        amount: d.amount,
        type: d.type,
        status: d.status,
        interest_type: d.interestType || 'NONE',
        interest_rate: d.interestRate || 0,
        custom_formula: d.customFormula || null,
        tenure_months: d.tenureMonths || 0,
        interest_amount: d.interestAmount || 0,
        due_date: d.dueDate,
        date_created: d.dateCreated,
        notes: d.notes || '',
        updated_at: new Date().toISOString()
      }));
      const { error: debtErr } = await supabase.from('debts').upsert(debtPayload, { onConflict: 'id' });
      if (debtErr) console.warn('[Sync] Upload debts error:', debtErr);
      else count += debts.length;

      // Extract and upload individual payments
      const paymentsPayload: any[] = [];
      debts.forEach(d => {
        if (d.payments && d.payments.length > 0) {
          d.payments.forEach(p => {
            paymentsPayload.push({
              id: p.id,
              debt_id: d.id,
              user_id: userId,
              amount: p.amount,
              date: p.date,
              mode: p.mode || 'Cash',
              notes: p.notes || '',
              proof_photo: p.proofPhoto || null,
              location: p.location || null,
              timestamp_verified: p.timestampVerified || null,
              updated_at: new Date().toISOString()
            });
          });
        }
      });

      if (paymentsPayload.length > 0) {
        const { error: payErr } = await supabase.from('debt_payments').upsert(paymentsPayload, { onConflict: 'id' });
        if (payErr) console.warn('[Sync] Upload payments error:', payErr);
        else count += paymentsPayload.length;
      }
    }

    // 4. Upload Gifts
    if (gifts.length > 0) {
      const payload = gifts.map(g => ({
        id: g.id,
        user_id: userId,
        person_id: g.personId || null,
        person: g.person,
        occasion: g.occasion,
        type: g.type,
        category: g.category,
        item: g.item,
        amount: g.amount,
        weight_grams: g.weightGrams || null,
        purity: g.purity || null,
        date: g.date,
        notes: g.notes || '',
        photo_url: g.photoUrl || null,
        updated_at: new Date().toISOString()
      }));
      const { error } = await supabase.from('gifts').upsert(payload, { onConflict: 'id' });
      if (error) console.warn('[Sync] Upload gifts error:', error);
      else count += gifts.length;
    }

    return { success: true, uploadedCount: count };
  } catch (err: any) {
    console.error('[Sync] Upload local data threw:', err);
    return { success: false, uploadedCount: 0, error: err.message };
  }
}

/**
 * Bi-directional delta synchronization between Supabase and local IndexedDB (HemaDB_{userId})
 */
export async function syncWithCloud(userId: string): Promise<SyncState> {
  const supabase = getSupabase();
  if (!supabase || !isSupabaseConfigured()) {
    updateSyncState({ status: 'offline', errorMessage: 'Supabase cloud is not configured' });
    return currentSyncState;
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    updateSyncState({ status: 'offline', errorMessage: 'Device is offline' });
    return currentSyncState;
  }

  updateSyncState({ status: 'syncing', errorMessage: undefined });

  try {
    const localDb = await initDB(userId);

    // 1. Fetch remote data from Supabase for this user
    const [txRes, debtRes, payRes, giftRes, peopleRes] = await Promise.all([
      supabase.from('transactions').select('*').eq('user_id', userId),
      supabase.from('debts').select('*').eq('user_id', userId),
      supabase.from('debt_payments').select('*').eq('user_id', userId),
      supabase.from('gifts').select('*').eq('user_id', userId),
      supabase.from('people').select('*').eq('user_id', userId)
    ]);

    let downloadedCount = 0;

    // 2. Download and merge People
    if (peopleRes.data && peopleRes.data.length > 0) {
      for (const row of peopleRes.data) {
        const localPerson: PersonRecord = {
          id: row.id,
          userId: row.user_id,
          name: row.name,
          relationship: row.relationship,
          phone: row.phone,
          avatarUrl: row.avatar_url,
          notes: row.notes,
          createdAt: Number(row.created_at) || Date.now()
        };
        await localDb.put('people', localPerson);
        downloadedCount++;
      }
    }

    // 3. Download and merge Transactions
    if (txRes.data && txRes.data.length > 0) {
      for (const row of txRes.data) {
        await localDb.put('transactions', {
          id: row.id,
          userId: row.user_id,
          amount: Number(row.amount),
          categoryId: row.category_id,
          label: row.label,
          type: row.type,
          date: Number(row.date),
          notes: row.notes || ''
        });
        downloadedCount++;
      }
    }

    // 4. Download and merge Debts & Payments
    if (debtRes.data && debtRes.data.length > 0) {
      const paymentsByDebtId: Record<string, any[]> = {};
      if (payRes.data) {
        payRes.data.forEach(p => {
          if (!paymentsByDebtId[p.debt_id]) paymentsByDebtId[p.debt_id] = [];
          paymentsByDebtId[p.debt_id].push({
            id: p.id,
            amount: Number(p.amount),
            date: Number(p.date),
            mode: p.mode,
            notes: p.notes,
            proofPhoto: p.proof_photo,
            location: p.location,
            timestampVerified: p.timestamp_verified ? Number(p.timestamp_verified) : undefined
          });
        });
      }

      for (const row of debtRes.data) {
        const debtItem: DebtRecordItem = {
          id: row.id,
          userId: row.user_id,
          person: row.person,
          avatarUrl: row.avatar_url,
          principalAmount: Number(row.principal_amount) || Number(row.amount),
          amount: Number(row.amount),
          type: row.type,
          status: row.status,
          interestType: row.interest_type,
          interestRate: row.interest_rate ? Number(row.interest_rate) : undefined,
          customFormula: row.custom_formula,
          tenureMonths: row.tenure_months ? Number(row.tenure_months) : undefined,
          interestAmount: row.interest_amount ? Number(row.interest_amount) : undefined,
          dueDate: Number(row.due_date),
          dateCreated: Number(row.date_created),
          notes: row.notes || '',
          payments: paymentsByDebtId[row.id] || []
        };
        await localDb.put('debts', debtItem);
        downloadedCount++;
      }
    }

    // 5. Download and merge Gifts
    if (giftRes.data && giftRes.data.length > 0) {
      for (const row of giftRes.data) {
        const giftItem: GiftTransaction = {
          id: row.id,
          userId: row.user_id,
          personId: row.person_id,
          person: row.person,
          occasion: row.occasion,
          type: row.type,
          category: row.category,
          item: row.item,
          amount: Number(row.amount),
          weightGrams: row.weight_grams ? Number(row.weight_grams) : undefined,
          purity: row.purity,
          date: Number(row.date),
          notes: row.notes || '',
          photoUrl: row.photo_url
        };
        await localDb.put('gifts', giftItem);
        downloadedCount++;
      }
    }

    // 6. Push local changes back up
    const uploadRes = await uploadLocalDataToCloud(userId);

    const now = Date.now();
    updateSyncState({
      status: 'synced',
      lastSyncedAt: now,
      itemsDownloaded: downloadedCount,
      itemsUploaded: uploadRes.uploadedCount,
      errorMessage: undefined
    });

    return currentSyncState;
  } catch (err: any) {
    console.error('[Sync] syncWithCloud threw:', err);
    updateSyncState({
      status: 'error',
      errorMessage: err.message || 'Sync failed'
    });
    return currentSyncState;
  }
}

// Auto-sync listener when browser reconnects to internet
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    try {
      const rawSession = localStorage.getItem('hema_active_session');
      if (rawSession) {
        const session = JSON.parse(rawSession);
        if (session?.user?.id && isSupabaseConfigured()) {
          syncWithCloud(session.user.id);
        }
      }
    } catch {}
  });
}
