import { openDB, DBSchema, IDBPDatabase } from 'idb';

export type GiftCategory = 'CASH' | 'GOLD' | 'SILVER' | 'CLOTHES' | 'OTHER';

export interface PersonRecord {
  id: string;
  userId?: string; // Multi-tenant user owner
  name: string;
  relationship?: string; // e.g. "Uncle", "In-laws", "Neighbour", "Colleague"
  phone?: string;
  avatarUrl?: string; // photo data URI or custom avatar
  notes?: string;
  createdAt: number;
}

export interface GiftTransaction {
  id: string;
  userId?: string; // Multi-tenant user owner
  personId?: string; // Links to PersonRecord
  person: string;
  occasion: string; // "Wedding", "Housewarming", "Birthday", "Baby Shower", etc.
  type: 'GIVEN' | 'RECEIVED';
  category: GiftCategory; // "CASH", "GOLD", "SILVER", "CLOTHES", "OTHER"
  item: string; // e.g. "Gold Chain", "Silver Lamp", "Silk Saree", "Cash Envelop"
  amount: number; // Value in INR
  weightGrams?: number; // e.g., 8 grams (1 Tola / Savaran)
  purity?: string; // "22K", "24K", "18K", "92.5 Sterling"
  date: number;
  notes?: string;
  photoUrl?: string; // Photo of gift, jewelry hallmark, or envelope receipt
}

export interface DebtPayment {
  id: string;
  amount: number;
  date: number;
  mode?: string; // UPI, Cash, Bank Transfer, Cheque
  notes?: string;
  proofPhoto?: string; // Compressed watermarked image data URI
  location?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    addressText?: string;
  };
  timestampVerified?: number; // Exact epoch when captured
}

export interface DebtRecordItem {
  id: string;
  userId?: string; // Multi-tenant user owner
  person: string;
  avatarUrl?: string; // Photo data URI or avatar
  principalAmount: number; // Original loan amount
  amount: number; // Total repayable amount (Principal + Interest)
  type: 'WE_OWE' | 'OWED_TO_US';
  status: 'PENDING' | 'SETTLED' | 'OVERDUE';
  interestType?: 'NONE' | 'VADDI_MONTHLY' | 'SIMPLE_ANNUAL' | 'COMPOUND_ANNUAL' | 'CUSTOM';
  interestRate?: number; // e.g. 2 for 2 rupees vaddi, or 12 for 12% p.a.
  customFormula?: string; // Optional custom expression or note
  tenureMonths?: number; // Duration in months
  interestAmount?: number; // Total calculated interest
  dueDate: number;
  dateCreated: number;
  notes?: string;
  payments?: DebtPayment[]; // Partial repayments logged
}

export type IncomeClassification = 'REGULAR' | 'DEBT_RECOVERY';

export type CashflowClassification = 
  | 'EARNED_INCOME'           // Salary, business net profit
  | 'ASSET_PROFIT'            // Rental income, dividends, harvest proceeds
  | 'DEBT_INTEREST_RECEIVED'  // Vaddi/interest earned from lending
  | 'DEBT_RECOVERY_PRINCIPAL' // Debtor repaid principal (Asset recovery)
  | 'DEBT_INFLOW_BORROWED'    // Loan taken from external party (Liability)
  | 'LIVING_EXPENSE'          // Daily life, food, fuel, bills
  | 'DEBT_INTEREST_PAID'      // Vaddi/interest paid to creditor
  | 'LOAN_GIVEN_OUTFLOW'      // Money lent to someone (Loan asset created)
  | 'DEBT_REPAYMENT_OUTFLOW'; // Principal repaid on loans taken (Liability reduced)

export const MAX_CLOCK_SKEW_MS = 5000;

export function validateTimestampInvariant(timestamp: number): number {
  const now = Date.now();
  if (typeof timestamp !== 'number' || isNaN(timestamp) || timestamp <= 0) {
    return now;
  }
  if (timestamp > now + MAX_CLOCK_SKEW_MS) {
    return now; // Clamps to current time
  }
  return timestamp;
}

export type AssetCategory = 'REAL_ESTATE' | 'GOLD_SILVER' | 'FINANCIAL' | 'VEHICLE' | 'OTHER';

export interface AssetRecord {
  id: string;
  userId?: string;
  name: string;
  type: AssetCategory;
  purchaseValue: number;
  currentValue: number;
  quantity: number;
  unit: string; // 'Grams' | 'Tolas' | 'Acres' | 'Guntas' | 'Sq. Yards' | 'Units' | 'Items'
  locationOrLocker?: string;
  notes?: string;
  dateAcquired: string; // YYYY-MM-DD
  createdAt: number;
  updatedAt: number;
}

export interface TransactionRecord {
  id: string;
  userId?: string;
  amount: number;
  categoryId: string;
  label?: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  incomeType?: IncomeClassification;
  cashflowCategory?: CashflowClassification;
  debtId?: string;
  debtorName?: string;
  date: number;
  notes: string;
}

export interface HemaDB extends DBSchema {
  transactions: {
    key: string;
    value: TransactionRecord;
    indexes: { 
      'by-date': number;
      'by-user'?: string;
    };
  };
  gifts: {
    key: string;
    value: GiftTransaction;
    indexes: { 
      'by-date': number;
      'by-person': string;
      'by-user'?: string;
    };
  };
  people: {
    key: string;
    value: PersonRecord;
    indexes: { 
      'by-name': string;
      'by-user'?: string;
    };
  };
  debts: {
    key: string;
    value: DebtRecordItem;
    indexes: { 
      'by-status': string;
      'by-user'?: string;
    };
  };
  assets: {
    key: string;
    value: AssetRecord;
    indexes: {
      'by-type': string;
      'by-date': string;
      'by-user'?: string;
    };
  };
}

// Active multi-tenant user tracking
let currentActiveUserId: string | null = null;
let dbPromise: Promise<IDBPDatabase<HemaDB>> | null = null;

export const getStoredActiveUserId = (): string | null => {
  try {
    const raw = localStorage.getItem('hema_active_session');
    if (raw) {
      const session = JSON.parse(raw);
      if (session?.user?.id) return session.user.id;
    }
  } catch {}
  return null;
};

export const setActiveUserForDB = (userId: string | null) => {
  if (userId !== currentActiveUserId) {
    if (dbPromise) {
      dbPromise.then(db => db.close()).catch(() => {});
      dbPromise = null;
    }
    currentActiveUserId = userId;
  }
};

export const getActiveUserId = (): string => {
  return currentActiveUserId || getStoredActiveUserId() || 'default_user';
};

/**
 * Initializes an isolated database partition for the authenticated user.
 * Even when multiple users log in on the same phone/tablet, their databases
 * are physically distinct (HemaDB_usr_123 vs HemaDB_usr_456).
 */
export const initDB = (explicitUserId?: string) => {
  const userId = explicitUserId || getActiveUserId();
  const dbName = userId === 'default_user' ? 'HemaWebAppDB' : `HemaDB_${userId}`;

  if (!dbPromise || currentActiveUserId !== userId) {
    currentActiveUserId = userId;
    dbPromise = openDB<HemaDB>(dbName, 6, {
      upgrade(db, oldVersion, newVersion, transaction) {
        if (!db.objectStoreNames.contains('transactions')) {
          const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
          txStore.createIndex('by-date', 'date');
        }

        if (!db.objectStoreNames.contains('gifts')) {
          const giftStore = db.createObjectStore('gifts', { keyPath: 'id' });
          giftStore.createIndex('by-date', 'date');
          giftStore.createIndex('by-person', 'person');
        } else {
          const giftStore = transaction.objectStore('gifts');
          if (!giftStore.indexNames.contains('by-person')) {
            giftStore.createIndex('by-person', 'person');
          }
        }

        if (!db.objectStoreNames.contains('debts')) {
          const debtStore = db.createObjectStore('debts', { keyPath: 'id' });
          debtStore.createIndex('by-status', 'status');
        }

        if (!db.objectStoreNames.contains('people')) {
          const peopleStore = db.createObjectStore('people', { keyPath: 'id' });
          peopleStore.createIndex('by-name', 'name');
        }

        if (!db.objectStoreNames.contains('assets')) {
          const assetStore = db.createObjectStore('assets', { keyPath: 'id' });
          assetStore.createIndex('by-type', 'type');
          assetStore.createIndex('by-date', 'dateAcquired');
        }
      },
    });
  }
  return dbPromise;
};

export const GLOBAL_LEGACY_CLAIMED_KEY = 'hema_legacy_data_already_claimed_by_user';

/**
 * Seamless Migration for Existing Offline Data:
 * When the FIRST user creates an account on a device that already has offline data,
 * this migrates the existing transactions/debts/gifts from legacy HemaWebAppDB
 * into that primary user's isolated partition so their records are preserved.
 *
 * CRITICAL MULTI-TENANT GUARD:
 * - Legacy data can only ever be claimed once by the primary device owner.
 * - Subsequent accounts (e.g. spouse, child, other family members) MUST start
 *   with an empty ledger and never clone or inherit someone else's legacy records.
 * - Once migrated, the legacy unpartitioned HemaWebAppDB is emptied.
 */
export async function migrateLegacyDataToUser(targetUserId: string): Promise<boolean> {
  if (!targetUserId || targetUserId === 'default_user') return false;

  const migrationKey = `hema_migrated_legacy_${targetUserId}`;
  const alreadyClaimedBy = localStorage.getItem(GLOBAL_LEGACY_CLAIMED_KEY);

  // If another user already claimed legacy data, strictly reject copying to this new user!
  if (alreadyClaimedBy && alreadyClaimedBy !== targetUserId) {
    console.log(`[Migration] Legacy offline data is already owned by primary user ${alreadyClaimedBy}. New account ${targetUserId} starts fresh.`);
    return false;
  }

  if (localStorage.getItem(migrationKey)) {
    return false; // Already migrated for this user
  }

  try {
    const legacyDB = await openDB<HemaDB>('HemaWebAppDB', 5).catch(() => null);
    if (!legacyDB) {
      localStorage.setItem(GLOBAL_LEGACY_CLAIMED_KEY, targetUserId);
      localStorage.setItem(migrationKey, 'true');
      return false;
    }

    const [txs, gifts, debts, people] = await Promise.all([
      legacyDB.getAll('transactions').catch(() => []),
      legacyDB.getAll('gifts').catch(() => []),
      legacyDB.getAll('debts').catch(() => []),
      legacyDB.getAll('people').catch(() => [])
    ]);

    if (txs.length === 0 && gifts.length === 0 && debts.length === 0 && people.length === 0) {
      localStorage.setItem(GLOBAL_LEGACY_CLAIMED_KEY, targetUserId);
      localStorage.setItem(migrationKey, 'true');
      return false;
    }

    const targetDB = await initDB(targetUserId);

    for (const tx of txs) {
      await targetDB.put('transactions', { ...tx, userId: targetUserId });
    }
    for (const g of gifts) {
      await targetDB.put('gifts', { ...g, userId: targetUserId });
    }
    for (const d of debts) {
      await targetDB.put('debts', { ...d, userId: targetUserId });
    }
    for (const p of people) {
      await targetDB.put('people', { ...p, userId: targetUserId });
    }

    // Erase the unpartitioned legacy database so no subsequent user can ever clone it
    try {
      const stores = ['transactions', 'gifts', 'debts', 'people'].filter(s => legacyDB.objectStoreNames.contains(s as any));
      if (stores.length > 0) {
        const tx = legacyDB.transaction(stores as any, 'readwrite');
        await Promise.all([
          ...stores.map(s => tx.objectStore(s as any).clear().catch(() => {})),
          tx.done
        ]);
        console.log('[Migration] Cleared unpartitioned legacy HemaWebAppDB after successful transfer.');
      }
    } catch (clearErr) {
      console.warn('[Migration] Note clearing legacy db:', clearErr);
    }

    localStorage.setItem(GLOBAL_LEGACY_CLAIMED_KEY, targetUserId);
    localStorage.setItem(migrationKey, 'true');
    console.log(`[Migration] Migrated ${txs.length} txs, ${debts.length} debts, ${gifts.length} gifts to user ${targetUserId}`);
    return true;
  } catch (err) {
    console.warn('[Migration] No legacy database found or migration skipped:', err);
    localStorage.setItem(GLOBAL_LEGACY_CLAIMED_KEY, targetUserId);
    localStorage.setItem(migrationKey, 'true');
    return false;
  }
}

/**
 * Completely purges all records in a user's isolated IndexedDB partition and local fallbacks.
 */
export async function clearUserPartition(targetUserId?: string): Promise<void> {
  const userId = targetUserId || getActiveUserId();
  const db = await initDB(userId);
  const stores = ['transactions', 'gifts', 'debts', 'people'].filter(s => db.objectStoreNames.contains(s as any));
  if (stores.length > 0) {
    const tx = db.transaction(stores as any, 'readwrite');
    await Promise.all([
      ...stores.map(s => tx.objectStore(s as any).clear().catch(() => {})),
      tx.done
    ]);
  }
  localStorage.removeItem(`hema_fallback_people_${userId}`);
  console.log(`[Partition] Cleared all records in partition for user: ${userId}`);
}

/**
 * Auto-Remediation for polluted secondary user accounts:
 * If a secondary user account on this device was mistakenly seeded with the primary
 * user's legacy transactions due to the pre-v2.0 migration flaw, this purges the
 * copied data to guarantee 100% strict data isolation.
 */
export async function remediatePollutedPartitions(activeUserId: string): Promise<boolean> {
  if (!activeUserId || activeUserId === 'default_user') return false;

  // 1. Establish the rightful primary claimant
  let claimedUser = localStorage.getItem(GLOBAL_LEGACY_CLAIMED_KEY);
  if (!claimedUser) {
    try {
      const rawAccounts = localStorage.getItem('hema_vault_accounts');
      if (rawAccounts) {
        const accounts = JSON.parse(rawAccounts);
        if (Array.isArray(accounts) && accounts.length > 0) {
          claimedUser = accounts[0].id;
          localStorage.setItem(GLOBAL_LEGACY_CLAIMED_KEY, claimedUser);
        }
      }
    } catch {}
  }

  // 2. If this active user is NOT the primary claimant:
  if (claimedUser && activeUserId !== claimedUser) {
    const remediationKey = `hema_remediated_pollution_${activeUserId}`;
    if (!localStorage.getItem(remediationKey)) {
      const wasFalselyMigrated = localStorage.getItem(`hema_migrated_legacy_${activeUserId}`) === 'true';
      if (wasFalselyMigrated) {
        console.warn(`[Multi-Tenant Isolation] Secondary account ${activeUserId} was contaminated with legacy clone. Auto-purging partition to enforce strict isolation.`);
        await clearUserPartition(activeUserId);
        localStorage.removeItem(`hema_migrated_legacy_${activeUserId}`);
        localStorage.setItem(remediationKey, 'true');
        return true;
      }
    }
  }

  return false;
}

// --- Fallback localStorage Helpers (Strictly Scoped by User ID) ---
const getLocalPeopleKey = () => `hema_fallback_people_${getActiveUserId()}`;

const getLocalPeople = (): PersonRecord[] => {
  try {
    const raw = localStorage.getItem(getLocalPeopleKey());
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveLocalPerson = (person: PersonRecord) => {
  try {
    const existing = getLocalPeople();
    const filtered = existing.filter(p => p.id !== person.id);
    filtered.push({ ...person, userId: getActiveUserId() });
    localStorage.setItem(getLocalPeopleKey(), JSON.stringify(filtered));
  } catch (e) {
    console.error('LocalStorage write failed:', e);
  }
};

const deleteLocalPerson = (id: string) => {
  try {
    const existing = getLocalPeople();
    const filtered = existing.filter(p => p.id !== id);
    localStorage.setItem(getLocalPeopleKey(), JSON.stringify(filtered));
  } catch (e) {
    console.error('LocalStorage delete failed:', e);
  }
};

// --- Transactions (Strict User Isolation) ---
export const addTransaction = async (tx: HemaDB['transactions']['value']) => {
  const db = await initDB();
  const safeDate = validateTimestampInvariant(tx.date);
  const safeTx = { ...tx, date: safeDate, userId: getActiveUserId() };
  await db.put('transactions', safeTx);
};

export const getTransactions = async () => {
  const db = await initDB();
  const txs = await db.getAllFromIndex('transactions', 'by-date');
  const userId = getActiveUserId();
  if (userId === 'default_user') {
    return txs.filter(t => !t.userId || t.userId === 'default_user');
  }
  return txs.filter(t => t.userId === userId);
};

export const deleteTransaction = async (id: string) => {
  const db = await initDB();
  const existing = await db.get('transactions', id);
  if (existing?.debtId) {
    try {
      const debt = await db.get('debts', existing.debtId);
      if (debt) {
        const remainingPayments = (debt.payments || []).filter(
          p => p.id !== existing.id && p.notes !== `Linked to tx: ${existing.id}`
        );
        debt.payments = remainingPayments;
        const totalPaid = remainingPayments.reduce((s, p) => s + p.amount, 0);
        const originalTarget = (debt.amount || debt.principalAmount || 0) + (debt.interestAmount || 0);
        if (totalPaid < originalTarget) {
          debt.status = 'PENDING';
        }
        await db.put('debts', debt);
      }
    } catch (e) {
      console.warn('Could not auto-reverse debt on transaction delete:', e);
    }
  }
  await db.delete('transactions', id);
};

// --- People (Relationship Ledger - Strict User Isolation) ---
export const addPerson = async (person: PersonRecord) => {
  const safePerson = { ...person, userId: getActiveUserId() };
  saveLocalPerson(safePerson);
  try {
    const db = await initDB();
    if (db.objectStoreNames.contains('people')) {
      await db.put('people', safePerson);
    }
  } catch (err) {
    console.warn('IndexedDB addPerson fallback to localStorage:', err);
  }
};

export const getPeople = async (): Promise<PersonRecord[]> => {
  const localList = getLocalPeople();
  const userId = getActiveUserId();
  const isDefault = userId === 'default_user';
  try {
    const db = await initDB();
    if (db.objectStoreNames.contains('people')) {
      const dbList = await db.getAll('people');
      const filteredDbList = isDefault
        ? dbList.filter(p => !p.userId || p.userId === 'default_user')
        : dbList.filter(p => p.userId === userId);
      const map = new Map<string, PersonRecord>();
      filteredDbList.forEach(p => map.set(p.id, p));
      localList.forEach(p => {
        const matches = isDefault ? (!p.userId || p.userId === 'default_user') : p.userId === userId;
        if (matches) map.set(p.id, p);
      });
      return Array.from(map.values());
    }
  } catch (err) {
    console.warn('IndexedDB getPeople fallback to localStorage:', err);
  }
  return isDefault
    ? localList.filter(p => !p.userId || p.userId === 'default_user')
    : localList.filter(p => p.userId === userId);
};

export const updatePerson = async (person: PersonRecord) => {
  const safePerson = { ...person, userId: getActiveUserId() };
  saveLocalPerson(safePerson);
  try {
    const db = await initDB();
    if (db.objectStoreNames.contains('people')) {
      await db.put('people', safePerson);
    }
  } catch (err) {
    console.warn('IndexedDB updatePerson fallback:', err);
  }
};

export const updatePersonAndGifts = async (updatedPerson: PersonRecord, oldName?: string) => {
  await updatePerson(updatedPerson);
  if (oldName && oldName.trim() !== updatedPerson.name.trim()) {
    try {
      const db = await initDB();
      if (db.objectStoreNames.contains('gifts')) {
        const allGifts = await db.getAll('gifts');
        for (const gift of allGifts) {
          if (gift.personId === updatedPerson.id || (gift.person && gift.person.toLowerCase() === oldName.trim().toLowerCase())) {
            gift.person = updatedPerson.name;
            gift.personId = updatedPerson.id;
            await db.put('gifts', gift);
          }
        }
      }
    } catch (e) {
      console.warn('Could not cascade person name to gifts:', e);
    }
  }
};

export const deletePerson = async (id: string, personName?: string) => {
  deleteLocalPerson(id);
  try {
    const db = await initDB();
    if (db.objectStoreNames.contains('people')) {
      await db.delete('people', id);
    }
    if (db.objectStoreNames.contains('gifts')) {
      const allGifts = await db.getAll('gifts');
      for (const g of allGifts) {
        if (g.personId === id || (personName && g.person && g.person.toLowerCase() === personName.toLowerCase())) {
          await db.delete('gifts', g.id);
        }
      }
    }
  } catch (err) {
    console.warn('IndexedDB deletePerson fallback:', err);
  }
};

// --- Gifts (Strict User Isolation) ---
export const addGift = async (gift: GiftTransaction) => {
  const db = await initDB();
  const safeGift = { ...gift, userId: getActiveUserId() };
  await db.put('gifts', safeGift);
};

export const getGifts = async (): Promise<GiftTransaction[]> => {
  const db = await initDB();
  const gifts = await db.getAllFromIndex('gifts', 'by-date');
  const userId = getActiveUserId();
  if (userId === 'default_user') {
    return gifts.filter(g => !g.userId || g.userId === 'default_user');
  }
  return gifts.filter(g => g.userId === userId);
};

export const deleteGift = async (id: string) => {
  const db = await initDB();
  await db.delete('gifts', id);
};

// --- Debts (Strict User Isolation) ---
export const addDebt = async (debt: HemaDB['debts']['value']) => {
  const db = await initDB();
  const safeDebt = { ...debt, userId: getActiveUserId() };
  await db.put('debts', safeDebt);
};

export const getDebts = async () => {
  const db = await initDB();
  const debts = await db.getAll('debts');
  const userId = getActiveUserId();
  if (userId === 'default_user') {
    return debts.filter(d => !d.userId || d.userId === 'default_user');
  }
  return debts.filter(d => d.userId === userId);
};

export const updateDebtStatus = async (id: string, status: 'PENDING' | 'SETTLED' | 'OVERDUE') => {
  const db = await initDB();
  const debt = await db.get('debts', id);
  if (debt) {
    debt.status = status;
    await db.put('debts', debt);
  }
};

export const updateDebt = async (debt: DebtRecordItem) => {
  const db = await initDB();
  const safeDebt = { ...debt, userId: getActiveUserId() };
  await db.put('debts', safeDebt);
};

export const deleteDebt = async (id: string) => {
  const db = await initDB();
  await db.delete('debts', id);
};

export const recordDebtPayment = async (debtId: string, payment: DebtPayment) => {
  const db = await initDB();
  const debt = await db.get('debts', debtId);
  if (debt) {
    const payments = debt.payments || [];
    payments.push(payment);
    debt.payments = payments;
    
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const totalDue = debt.amount || debt.principalAmount;
    if (totalPaid >= totalDue) {
      debt.status = 'SETTLED';
    }
    await db.put('debts', debt);
  }
};

export const deleteDebtPayment = async (debtId: string, paymentId: string) => {
  const db = await initDB();
  const debt = await db.get('debts', debtId);
  if (debt && debt.payments) {
    debt.payments = debt.payments.filter(p => p.id !== paymentId);
    const totalPaid = debt.payments.reduce((sum, p) => sum + p.amount, 0);
    const totalDue = debt.amount || debt.principalAmount;
    if (totalPaid < totalDue && debt.status === 'SETTLED') {
      debt.status = 'PENDING';
    }
    await db.put('debts', debt);
  }
};

/**
 * Atomic Bidirectional Sync between Debts and Cash Movements:
 * Records payment against a debt and atomically logs it in the cash ledger.
 */
export const recordAtomicDebtPaymentAndCashflow = async (options: {
  debtId: string;
  amount: number;
  date: number;
  notes?: string;
  paymentMode?: string;
  syncToCashflow?: boolean;
}) => {
  const db = await initDB();
  const safeDate = validateTimestampInvariant(options.date);
  const debt = await db.get('debts', options.debtId);
  if (!debt) throw new Error('Debt record not found');

  const pmtId = crypto.randomUUID();
  const payment: DebtPayment = {
    id: pmtId,
    amount: options.amount,
    date: safeDate,
    mode: options.paymentMode || 'Cash',
    notes: options.notes || 'Recorded via Khata',
    timestampVerified: safeDate
  };

  const payments = debt.payments || [];
  payments.push(payment);
  debt.payments = payments;

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const targetAmount = (debt.amount || debt.principalAmount || 0) + (debt.interestAmount || 0);

  if (totalPaid >= targetAmount) {
    debt.status = 'SETTLED';
  }

  await db.put('debts', debt);

  // If syncToCashflow is true, log to transactions
  if (options.syncToCashflow !== false) {
    const isIncoming = debt.type === 'OWED_TO_US'; // Debtor returned money to us
    const txRecord: TransactionRecord = {
      id: pmtId,
      userId: getActiveUserId(),
      amount: options.amount,
      categoryId: isIncoming ? 'Debt Recovery' : 'Debt Repayment',
      label: isIncoming ? `Repayment from ${debt.person}` : `Payment to ${debt.person}`,
      type: isIncoming ? 'INCOME' : 'EXPENSE',
      incomeType: isIncoming ? 'DEBT_RECOVERY' : undefined,
      cashflowCategory: isIncoming ? 'DEBT_RECOVERY_PRINCIPAL' : 'DEBT_REPAYMENT_OUTFLOW',
      debtId: debt.id,
      debtorName: debt.person,
      date: safeDate,
      notes: options.notes ? `Khata: ${options.notes}` : `Khata payment: ${debt.person}`
    };
    await db.put('transactions', txRecord);
  }

  return { debt, pmtId };
};

// --- Secret Asset Vault (Strict User Isolation) ---
export const getAssets = async (): Promise<AssetRecord[]> => {
  const db = await initDB();
  if (!db.objectStoreNames.contains('assets')) return [];
  const assets = await db.getAll('assets');
  const userId = getActiveUserId();
  if (userId === 'default_user') {
    return assets.filter(a => !a.userId || a.userId === 'default_user');
  }
  return assets.filter(a => a.userId === userId);
};

export const addAsset = async (asset: Omit<AssetRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<AssetRecord> => {
  const db = await initDB();
  const id = crypto.randomUUID();
  const now = Date.now();
  const record: AssetRecord = {
    ...asset,
    id,
    userId: getActiveUserId(),
    createdAt: now,
    updatedAt: now
  };
  await db.put('assets', record);
  return record;
};

export const updateAsset = async (asset: AssetRecord): Promise<void> => {
  const db = await initDB();
  const record: AssetRecord = {
    ...asset,
    userId: getActiveUserId(),
    updatedAt: Date.now()
  };
  await db.put('assets', record);
};

export const deleteAsset = async (id: string): Promise<void> => {
  const db = await initDB();
  await db.delete('assets', id);
};

// --- Full JSON Backup & Restore (Scoped strictly to Active User) ---
export interface HemaBackupPayload {
  version: number;
  exportedAt: string;
  userId?: string;
  transactions: HemaDB['transactions']['value'][];
  people: PersonRecord[];
  gifts: GiftTransaction[];
  debts: DebtRecordItem[];
  assets?: AssetRecord[];
}

export const exportFullBackup = async (): Promise<HemaBackupPayload> => {
  const userId = getActiveUserId();
  const [transactions, people, gifts, debts, assets] = await Promise.all([
    getTransactions(),
    getPeople(),
    getGifts(),
    getDebts(),
    getAssets()
  ]);

  return {
    version: 6,
    exportedAt: new Date().toISOString(),
    userId,
    transactions,
    people,
    gifts,
    debts,
    assets
  };
};

export const restoreFullBackup = async (payload: HemaBackupPayload): Promise<boolean> => {
  if (!payload || !payload.version) {
    throw new Error('Invalid Hema backup format');
  }

  const userId = getActiveUserId();
  const db = await initDB();

  // Restore transactions
  if (Array.isArray(payload.transactions)) {
    for (const tx of payload.transactions) {
      if (tx.id) await db.put('transactions', { ...tx, userId });
    }
  }

  // Restore people
  if (Array.isArray(payload.people)) {
    for (const p of payload.people) {
      if (p.id) await addPerson({ ...p, userId });
    }
  }

  // Restore gifts
  if (Array.isArray(payload.gifts)) {
    for (const g of payload.gifts) {
      if (g.id) await db.put('gifts', { ...g, userId });
    }
  }

  // Restore debts
  if (Array.isArray(payload.debts)) {
    for (const d of payload.debts) {
      if (d.id) await db.put('debts', { ...d, userId });
    }
  }

  // Restore assets
  if (Array.isArray(payload.assets)) {
    for (const a of payload.assets) {
      if (a.id) await db.put('assets', { ...a, userId });
    }
  }

  return true;
};
