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

export interface HemaDB extends DBSchema {
  transactions: {
    key: string;
    value: {
      id: string;
      userId?: string;
      amount: number;
      categoryId: string;
      label?: string;
      type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
      date: number;
      notes: string;
    };
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
    dbPromise = openDB<HemaDB>(dbName, 5, {
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
      },
    });
  }
  return dbPromise;
};

/**
 * Seamless Migration for Existing Offline Data:
 * When the first user creates an account, this migrates any existing
 * transactions/debts/gifts from the legacy unpartitioned HemaWebAppDB
 * to the new authenticated user's isolated partition so no prior records are lost.
 */
export async function migrateLegacyDataToUser(targetUserId: string): Promise<boolean> {
  const migrationKey = `hema_migrated_legacy_${targetUserId}`;
  if (localStorage.getItem(migrationKey)) {
    return false; // Already migrated
  }

  try {
    const legacyDB = await openDB<HemaDB>('HemaWebAppDB', 4);
    const [txs, gifts, debts, people] = await Promise.all([
      legacyDB.getAll('transactions').catch(() => []),
      legacyDB.getAll('gifts').catch(() => []),
      legacyDB.getAll('debts').catch(() => []),
      legacyDB.getAll('people').catch(() => [])
    ]);

    if (txs.length === 0 && gifts.length === 0 && debts.length === 0 && people.length === 0) {
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

    localStorage.setItem(migrationKey, 'true');
    console.log(`[Migration] Migrated ${txs.length} txs, ${debts.length} debts, ${gifts.length} gifts to user ${targetUserId}`);
    return true;
  } catch (err) {
    console.warn('[Migration] No legacy database found or migration skipped:', err);
    localStorage.setItem(migrationKey, 'true');
    return false;
  }
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
  const safeTx = { ...tx, userId: getActiveUserId() };
  await db.put('transactions', safeTx);
};

export const getTransactions = async () => {
  const db = await initDB();
  const txs = await db.getAllFromIndex('transactions', 'by-date');
  const userId = getActiveUserId();
  return txs.filter(t => !t.userId || t.userId === userId);
};

export const deleteTransaction = async (id: string) => {
  const db = await initDB();
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
  try {
    const db = await initDB();
    if (db.objectStoreNames.contains('people')) {
      const dbList = await db.getAll('people');
      const filteredDbList = dbList.filter(p => !p.userId || p.userId === userId);
      const map = new Map<string, PersonRecord>();
      filteredDbList.forEach(p => map.set(p.id, p));
      localList.forEach(p => map.set(p.id, p));
      return Array.from(map.values());
    }
  } catch (err) {
    console.warn('IndexedDB getPeople fallback to localStorage:', err);
  }
  return localList.filter(p => !p.userId || p.userId === userId);
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
  return gifts.filter(g => !g.userId || g.userId === userId);
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
  return debts.filter(d => !d.userId || d.userId === userId);
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

// --- Full JSON Backup & Restore (Scoped strictly to Active User) ---
export interface HemaBackupPayload {
  version: number;
  exportedAt: string;
  userId?: string;
  transactions: HemaDB['transactions']['value'][];
  people: PersonRecord[];
  gifts: GiftTransaction[];
  debts: DebtRecordItem[];
}

export const exportFullBackup = async (): Promise<HemaBackupPayload> => {
  const userId = getActiveUserId();
  const [transactions, people, gifts, debts] = await Promise.all([
    getTransactions(),
    getPeople(),
    getGifts(),
    getDebts()
  ]);

  return {
    version: 5,
    exportedAt: new Date().toISOString(),
    userId,
    transactions,
    people,
    gifts,
    debts
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

  return true;
};
