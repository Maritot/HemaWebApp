import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'hema_database.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-Memory & File-backed Database Structure
const initialDb = {
  users: [],
  sessions: [],
  resetTokens: [],
  transactions: [],
  debts: [],
  gifts: [],
  people: []
};

// Safe Database File Loader & Atomic Writer
function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      return { ...initialDb, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.error('[DB] Error loading database, initializing fresh:', err);
  }
  return { ...initialDb };
}

function saveDatabase(db) {
  try {
    const tempFile = `${DB_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err) {
    console.error('[DB] Error saving database:', err);
  }
}

let db = loadDatabase();

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '15mb' }));

// Security Response Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// --- Cryptographic Security Utilities ---
function pbkdf2Hash(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 32, 'sha256', (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey.toString('hex'));
    });
  });
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function generateSecureToken() {
  return `${crypto.randomUUID()}_${crypto.randomBytes(24).toString('hex')}`;
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, salt, securityAnswerHash, ...safeUser } = user;
  return safeUser;
}

// Authentication & Server-Side Authorization Middleware
async function authenticateUser(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. No bearer token provided.' });
  }

  const token = authHeader.split(' ')[1];
  const session = db.sessions.find(s => s.token === token && s.expiresAt > Date.now());

  if (!session) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }

  const user = db.users.find(u => u.id === session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User account no longer exists.' });
  }

  req.user = sanitizeUser(user);
  req.session = session;
  next();
}

// --- Routes ---

// Health & Status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '2.0.0',
    service: 'Hema Finance Multi-Tenant Auth Service',
    time: new Date().toISOString()
  });
});

// Register New User
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, phone, securityQuestion, securityAnswer } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Invalid email address format.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    }

    // Check duplicate
    if (db.users.some(u => u.email === cleanEmail)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const salt = generateSalt();
    const passwordHash = await pbkdf2Hash(password, salt);

    let securityAnswerHash = null;
    if (securityAnswer) {
      const cleanAnswer = securityAnswer.trim().toLowerCase();
      securityAnswerHash = await pbkdf2Hash(cleanAnswer, salt);
    }

    const userId = `usr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const newUser = {
      id: userId,
      name: name.trim(),
      email: cleanEmail,
      phone: phone ? phone.trim() : '',
      passwordHash,
      salt,
      securityQuestion: securityQuestion || 'What was your first childhood pet name?',
      securityAnswerHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString()
    };

    db.users.push(newUser);

    // Create 30-day session
    const token = generateSecureToken();
    db.sessions.push({
      token,
      userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    });

    saveDatabase(db);

    return res.status(201).json({
      message: 'User registered successfully',
      user: sanitizeUser(newUser),
      token
    });
  } catch (err) {
    console.error('[Register Error]:', err);
    return res.status(500).json({ error: 'Registration failed due to a server error.' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = db.users.find(u => u.email === cleanEmail);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const computedHash = await pbkdf2Hash(password, user.salt);
    const hashMatches = crypto.timingSafeEqual(
      Buffer.from(computedHash, 'hex'),
      Buffer.from(user.passwordHash, 'hex')
    );

    if (!hashMatches) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Update last login
    user.lastLoginAt = new Date().toISOString();

    // Create 30-day session
    const token = generateSecureToken();
    db.sessions.push({
      token,
      userId: user.id,
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
    });

    saveDatabase(db);

    return res.json({
      message: 'Login successful',
      user: sanitizeUser(user),
      token
    });
  } catch (err) {
    console.error('[Login Error]:', err);
    return res.status(500).json({ error: 'Login failed due to a server error.' });
  }
});

// Logout
app.post('/api/auth/logout', authenticateUser, (req, res) => {
  try {
    db.sessions = db.sessions.filter(s => s.token !== req.session.token);
    saveDatabase(db);
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed.' });
  }
});

// Get Current User Profile
app.get('/api/auth/me', authenticateUser, (req, res) => {
  res.json({ user: req.user });
});

// Password Recovery Step 1: Request Security Question
app.post('/api/auth/forgot-password/question', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const user = db.users.find(u => u.email === cleanEmail);

  if (!user || !user.securityQuestion) {
    return res.status(404).json({ error: 'No account found with this email or no security question set.' });
  }

  res.json({
    email: cleanEmail,
    question: user.securityQuestion
  });
});

// Password Recovery Step 2: Verify Security Answer
app.post('/api/auth/forgot-password/verify', async (req, res) => {
  try {
    const { email, answer } = req.body;
    if (!email || !answer) {
      return res.status(400).json({ error: 'Email and answer are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = db.users.find(u => u.email === cleanEmail);

    if (!user || !user.securityAnswerHash) {
      return res.status(400).json({ error: 'Account recovery not configured for this user.' });
    }

    const cleanAnswer = answer.trim().toLowerCase();
    const computedHash = await pbkdf2Hash(cleanAnswer, user.salt);

    const isMatch = crypto.timingSafeEqual(
      Buffer.from(computedHash, 'hex'),
      Buffer.from(user.securityAnswerHash, 'hex')
    );

    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect answer to the security question.' });
    }

    // Issue single-use 15-minute reset token
    const resetToken = `rst_${generateSecureToken()}`;
    db.resetTokens.push({
      token: resetToken,
      userId: user.id,
      expiresAt: Date.now() + 15 * 60 * 1000,
      used: false
    });
    saveDatabase(db);

    res.json({
      success: true,
      resetToken,
      message: 'Identity verified. You may now set a new password.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Verification failed.' });
  }
});

// Password Recovery Step 3: Reset Password
app.post('/api/auth/forgot-password/reset', async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: 'Reset token and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const tokenEntry = db.resetTokens.find(r => r.token === resetToken && !r.used && r.expiresAt > Date.now());
    if (!tokenEntry) {
      return res.status(400).json({ error: 'Password reset link has expired or has already been used.' });
    }

    const user = db.users.find(u => u.id === tokenEntry.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Re-hash with fresh salt
    const newSalt = generateSalt();
    user.salt = newSalt;
    user.passwordHash = await pbkdf2Hash(newPassword, newSalt);
    user.updatedAt = new Date().toISOString();

    // Mark reset token used and invalidate old sessions for security
    tokenEntry.used = true;
    db.sessions = db.sessions.filter(s => s.userId !== user.id);

    saveDatabase(db);

    res.json({ success: true, message: 'Password has been securely reset. Please log in with your new password.' });
  } catch (err) {
    res.status(500).json({ error: 'Reset failed.' });
  }
});

// --- Server-Side Data Isolation & Synchronization Routes ---

// Fetch All Isolated Financials for Authenticated User
app.get('/api/financials', authenticateUser, (req, res) => {
  const userId = req.user.id;

  // Strict tenant filtering: only return rows matching req.user.id
  const userTransactions = db.transactions.filter(t => t.userId === userId);
  const userDebts = db.debts.filter(d => d.userId === userId);
  const userGifts = db.gifts.filter(g => g.userId === userId);
  const userPeople = db.people.filter(p => p.userId === userId);

  res.json({
    userId,
    transactions: userTransactions,
    debts: userDebts,
    gifts: userGifts,
    people: userPeople
  });
});

// Bi-Directional Batch Sync with Server-Side Authorization Checks
app.post('/api/financials/sync', authenticateUser, (req, res) => {
  try {
    const userId = req.user.id;
    const { transactions = [], debts = [], gifts = [], people = [] } = req.body;

    // 1. Upsert transactions (strictly enforcing userId = req.user.id)
    transactions.forEach(tx => {
      const index = db.transactions.findIndex(t => t.id === tx.id);
      const safeTx = { ...tx, userId };
      if (index >= 0) {
        if (db.transactions[index].userId === userId) {
          db.transactions[index] = safeTx;
        }
      } else {
        db.transactions.push(safeTx);
      }
    });

    // 2. Upsert debts
    debts.forEach(debt => {
      const index = db.debts.findIndex(d => d.id === debt.id);
      const safeDebt = { ...debt, userId };
      if (index >= 0) {
        if (db.debts[index].userId === userId) {
          db.debts[index] = safeDebt;
        }
      } else {
        db.debts.push(safeDebt);
      }
    });

    // 3. Upsert gifts
    gifts.forEach(gift => {
      const index = db.gifts.findIndex(g => g.id === gift.id);
      const safeGift = { ...gift, userId };
      if (index >= 0) {
        if (db.gifts[index].userId === userId) {
          db.gifts[index] = safeGift;
        }
      } else {
        db.gifts.push(safeGift);
      }
    });

    // 4. Upsert people
    people.forEach(person => {
      const index = db.people.findIndex(p => p.id === person.id);
      const safePerson = { ...person, userId };
      if (index >= 0) {
        if (db.people[index].userId === userId) {
          db.people[index] = safePerson;
        }
      } else {
        db.people.push(safePerson);
      }
    });

    saveDatabase(db);

    res.json({
      success: true,
      syncedAt: new Date().toISOString(),
      counts: {
        transactions: db.transactions.filter(t => t.userId === userId).length,
        debts: db.debts.filter(d => d.userId === userId).length,
        gifts: db.gifts.filter(g => g.userId === userId).length,
        people: db.people.filter(p => p.userId === userId).length
      }
    });
  } catch (err) {
    console.error('[Sync Error]:', err);
    res.status(500).json({ error: 'Synchronization failed.' });
  }
});

// Auto-start listener when run directly
app.listen(PORT, () => {
  console.log(`[Hema Auth Server] Running on http://localhost:${PORT}`);
});

export default app;
