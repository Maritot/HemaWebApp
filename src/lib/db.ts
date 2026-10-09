import { openDB, DBSchema, IDBPDatabase } from 'idb';

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
    value: {
      id: string;
      person: string;
      occasion: string;
      type: 'GIVEN' | 'RECEIVED';
      amount: number;
      item: string;
      date: number;
    };
    indexes: { 'by-date': number };
  };
  debts: {
    key: string;
    value: {
      id: string;
      person: string;
      amount: number;
      type: 'WE_OWE' | 'OWED_TO_US';
      status: 'PENDING' | 'SETTLED' | 'OVERDUE';
      dueDate: number;
      dateCreated: number;
    };
    indexes: { 'by-status': string };
  };
}

let dbPromise: Promise<IDBPDatabase<HemaDB>>;

export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<HemaDB>('HemaWebAppDB', 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
          txStore.createIndex('by-date', 'date');
        }
        if (oldVersion < 2) {
          const giftStore = db.createObjectStore('gifts', { keyPath: 'id' });
          giftStore.createIndex('by-date', 'date');

          const debtStore = db.createObjectStore('debts', { keyPath: 'id' });
          debtStore.createIndex('by-status', 'status');
        }
      },
    });
  }
  return dbPromise;
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

// --- Gifts ---
export const addGift = async (gift: HemaDB['gifts']['value']) => {
  const db = await initDB();
  await db.put('gifts', gift);
};
export const getGifts = async () => {
  const db = await initDB();
  return db.getAllFromIndex('gifts', 'by-date');
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
