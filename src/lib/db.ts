import { openDB, DBSchema, IDBPDatabase } from 'idb';

export type GiftCategory = 'CASH' | 'GOLD' | 'SILVER' | 'CLOTHES' | 'OTHER';

export interface PersonRecord {
  id: string;
  name: string;
  relationship?: string; // e.g. "Uncle", "In-laws", "Neighbour", "Colleague"
  phone?: string;
  avatarUrl?: string; // photo data URI or custom avatar
  notes?: string;
  createdAt: number;
}

export interface GiftTransaction {
  id: string;
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
}

export interface HemaDB extends DBSchema {
  transactions: {
    key: string;
    value: {
      id: string;
      amount: number;
      categoryId: string;
      type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
      date: number;
      notes: string;
    };
    indexes: { 'by-date': number };
  };
  gifts: {
    key: string;
    value: GiftTransaction;
    indexes: { 
      'by-date': number;
      'by-person': string;
    };
  };
  people: {
    key: string;
    value: PersonRecord;
    indexes: { 'by-name': string };
  };
  debts: {
    key: string;
    value: DebtRecordItem;
    indexes: { 'by-status': string };
  };
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
  person: string;
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

let dbPromise: Promise<IDBPDatabase<HemaDB>> | null = null;

export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<HemaDB>('HemaWebAppDB', 4, {
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

// --- Fallback localStorage Helpers in case of browser quota or DB versioning edge cases ---
const LOCAL_PEOPLE_KEY = 'hema_fallback_people';

const getLocalPeople = (): PersonRecord[] => {
  try {
    const raw = localStorage.getItem(LOCAL_PEOPLE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveLocalPerson = (person: PersonRecord) => {
  try {
    const existing = getLocalPeople();
    const filtered = existing.filter(p => p.id !== person.id);
    filtered.push(person);
    localStorage.setItem(LOCAL_PEOPLE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('LocalStorage write failed:', e);
  }
};

const deleteLocalPerson = (id: string) => {
  try {
    const existing = getLocalPeople();
    const filtered = existing.filter(p => p.id !== id);
    localStorage.setItem(LOCAL_PEOPLE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('LocalStorage delete failed:', e);
  }
};

// --- Transactions ---
export const addTransaction = async (tx: HemaDB['transactions']['value']) => {
  const db = await initDB();
  await db.put('transactions', tx);
};
export const getTransactions = async () => {
  const db = await initDB();
  return db.getAllFromIndex('transactions', 'by-date');
};
export const deleteTransaction = async (id: string) => {
  const db = await initDB();
  await db.delete('transactions', id);
};

// --- People (Relationship Ledger) ---
export const addPerson = async (person: PersonRecord) => {
  saveLocalPerson(person); // Safe immediate sync
  try {
    const db = await initDB();
    if (db.objectStoreNames.contains('people')) {
      await db.put('people', person);
    }
  } catch (err) {
    console.warn('IndexedDB addPerson fallback to localStorage:', err);
  }
};

export const getPeople = async (): Promise<PersonRecord[]> => {
  const localList = getLocalPeople();
  try {
    const db = await initDB();
    if (db.objectStoreNames.contains('people')) {
      const dbList = await db.getAll('people');
      // Merge unique by ID
      const map = new Map<string, PersonRecord>();
      dbList.forEach(p => map.set(p.id, p));
      localList.forEach(p => map.set(p.id, p));
      return Array.from(map.values());
    }
  } catch (err) {
    console.warn('IndexedDB getPeople fallback to localStorage:', err);
  }
  return localList;
};

export const deletePerson = async (id: string) => {
  deleteLocalPerson(id);
  try {
    const db = await initDB();
    if (db.objectStoreNames.contains('people')) {
      await db.delete('people', id);
    }
  } catch (err) {
    console.warn('IndexedDB deletePerson fallback:', err);
  }
};

// --- Gifts ---
export const addGift = async (gift: GiftTransaction) => {
  const db = await initDB();
  await db.put('gifts', gift);
};
export const getGifts = async (): Promise<GiftTransaction[]> => {
  const db = await initDB();
  return db.getAllFromIndex('gifts', 'by-date');
};
export const deleteGift = async (id: string) => {
  const db = await initDB();
  await db.delete('gifts', id);
};

// --- Debts ---
export const addDebt = async (debt: HemaDB['debts']['value']) => {
  const db = await initDB();
  await db.put('debts', debt);
};
export const getDebts = async () => {
  const db = await initDB();
  return db.getAll('debts');
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
  await db.put('debts', debt);
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
    
    // Calculate total paid so far
    const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
    const totalDue = debt.amount || debt.principalAmount;
    if (totalPaid >= totalDue) {
      debt.status = 'SETTLED';
    }
    await db.put('debts', debt);
  }
};
