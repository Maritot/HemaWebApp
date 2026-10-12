# HEMA FINANCE — COMPREHENSIVE ARCHITECTURAL & CONTEXT HANDOVER

> **Document Type:** AI Agent Context & Handover Blueprint  
> **Repository:** `https://github.com/Maritot/HemaWebApp`  
> **Workspace Path:** `C:\Users\LAB2_PC14\Desktop\TharunAvula\HemaWebApp`  
> **Primary Technology Stack:** React 18 (Vite, TypeScript), Tailwind CSS, IndexedDB (`idb`), Vite PWA Plugin, Web Speech API, Geolocation API, HTML5 Canvas, React-i18next.  
> **Target Demographic:** Middle-aged / elderly non-technical Indian parents and households. Minimalist, high contrast, warm "Hema Gold" theme (`#d97706`), localized, vernacular-friendly, 100% offline-first.

---

## 1. PAST STATUS: PROJECT GENESIS & PIVOTS

### 1.1 Original Native Android Project (Deprecated)
- **Path:** `C:\Users\LAB2_PC14\Desktop\TharunAvula\Daddy`
- **Original Stack:** Kotlin, Jetpack Compose, Hilt, Room, ViewModel.
- **Why it was changed:** The user requested a complete tech-stack pivot: build a modern, rapid-iteration **Web App** first with full capabilities, polish UX, verify user flow, and eventually wrap it as an Android mobile app (via PWA / Capacitor).

### 1.2 Pivot to Vite React SPA
- Scaffolded `HemaWebApp` inside `C:\Users\LAB2_PC14\Desktop\TharunAvula\HemaWebApp`.
- Resolved ESM loader issues by setting `"type": "module"` in `package.json`, fixing `vite.config.ts`, and configuring PostCSS / Tailwind CommonJS configurations.
- Established a single, elegant color palette centered on **Hema Gold** (`#d97706`, with amber accents).

---

## 2. CURRENT STATUS: FULL FEATURE IMPLEMENTATION (WHAT WORKS TODAY)

The app is completely operational and running locally via `npm run dev` at `http://localhost:5173/`.

### 2.1 Offline Storage Architecture (`src/lib/db.ts`)
- Powered by `idb` wrapping browser **IndexedDB** (Database: `HemaWebAppDB`, version 4).
- **Stores:**
  1. `transactions`: ID, amount, categoryId, type (`EXPENSE` | `INCOME`), date, notes.
  2. `people`: Relationship face cards (id, name, relationship, phone, avatarUrl, createdAt). Includes an automated fallback to `localStorage` for maximum resilience.
  3. `gifts`: ID, person, occasion, type (`GIVEN` | `RECEIVED`), category (`CASH` | `GOLD` | `SILVER` | `CLOTHES` | `OTHER`), item, amount, weightGrams, purity, date, notes.
  4. `debts`: ID, person, principalAmount, amount, type (`WE_OWE` | `OWED_TO_US`), status (`PENDING` | `SETTLED` | `OVERDUE`), interestType, interestRate, customFormula, tenureMonths, interestAmount, dueDate, dateCreated, notes, and `payments` array.

### 2.2 Expenses & Income Module (`src/pages/Expenses.tsx`)
- **Available Balance Indicator:** Real-time computation of `Total Income - Total Expenses` displayed in a prominent gold banner before recording a transaction.
- **Dynamic Context-Aware Inputs:**
  - In *Expense* mode: prompts "What was this for?" with smart suggestions (`kiranam`, `milk`, `bijli`).
  - In *Income* mode: prompts "Source of Income" with appropriate hints (`Salary`, `Pension`, `Rent`).
- **Vernacular Auto-Correction Engine (`src/lib/AutoCorrectEngine.ts`):**
  - Uses Levenshtein distance matching (`FuzzyMatcher.ts`) to map common transliterated Indian terms to structured categories (e.g., `kirana` $\rightarrow$ `Groceries`, `bijli` $\rightarrow$ `Utilities`).
- **Voice Entry (Web Speech API):**
  - Integrated via `src/hooks/useSpeechToText.ts`. Clicking the mic icon automatically fills the input with spoken vernacular terms.
- **Custom Date Picker:**
  - Allows backdating or future-dating transactions; defaults to current date.
- **Fluid Large-Number Input:**
  - Removed browser spinners; input expands gracefully without clipping large numbers (e.g. ₹31,089+).

### 2.3 Dashboard Module (`src/pages/Dashboard.tsx`)
- **Real-Time Financial Totals:** Total balance, Total Income, and Total Expense calculated from local IndexedDB data.
- **Dynamic 7-Day Spending Bar Chart:** Groups actual past 7-day expense transactions using `date-fns` and renders via `recharts`.
- **Transaction History & Management:** Lists recent transactions with a one-click deletion option that recalculates all metrics immediately.

### 2.4 Relationship & Shagun Ledger (`src/pages/Gifts.tsx`)
- **People Face Cards:** Visual avatar cards with photos (or initial monogram badges), relationship pills (*Uncle, Aunt, In-laws, Cousin, Friend, Colleague*), and quick counts of gifts received vs given.
- **Canvas-Optimized Photo Upload:** Off-screen canvas resizes camera/gallery photos to a lightweight 200×200 JPEG to avoid quota issues.
- **Drill-Down Person History:** Tapping any person opens their dedicated ledger showing:
  - Total exchange summary (*They gave: ₹X | We gave: ₹Y*).
  - Chronological history with green `Received` and amber `Given` badges.
- **Indian Household Units (Gold & Silver):**
  - **Gold:** Grams input with real-time conversion to **Tola / Savaran** (~8g = 1 Tola), purity selector (`22K`, `24K`, `18K`).
  - **Silver:** Grams input and item names (*Silver Lamp/Diya, Coin*).
  - **Cash:** Traditional Shagun entries (*₹501, ₹1,116*).
  - **Clothes & Other:** Sarees, clothing, appliances.

### 2.5 Debts, Loans & Verified Proof Engine (`src/pages/Debts.tsx`)
- **Summary Cards:** Aggregates real remaining balances for "We Owe" and "Owed to Us".
- **Indian Interest Calculation Engine:**
  1. `VADDI_MONTHLY`: Traditional ₹ per ₹100 per month (e.g., *₹2 Vaddi* = 2% per month: $P \times (R/100) \times M$).
  2. `SIMPLE_ANNUAL`: Standard banking simple interest $P \times R \times (M/12) / 100$.
  3. `COMPOUND_ANNUAL`: Compound annual interest $P \times (1 + R/100)^{M/12} - P$.
  4. `CUSTOM`: User-defined math expression builder evaluating variables `P` (Principal), `R` (Rate), `M` (Months).
  5. `NONE`: Friendly zero-interest loan.
- **Live Calculation Preview:** Dynamically computes and displays the principal, interest, explanation, and final repayable total.
- **Full Editing:** Pencil icon allows editing existing loan terms.
- **Partial Repayment Tracker:**
  - "Record Payment" button to log installments.
  - Keeps chronological repayment history with payment modes (*UPI, Cash, Bank NEFT, Cheque*).
  - Auto-settles loans when balance reaches zero.
- **Camera Proof & Watermarking Engine:**
  - Triggers native mobile camera (`capture="environment"`).
  - HTML5 canvas permanently watermarks the photo with: `HEMA VERIFIED PROOF • [Date & Time]`.
  - Captures device GPS coordinates (`navigator.geolocation`).
  - "View Proof" modal displays the watermarked photo, timestamp, and a clickable Google Maps link to the exact coordinates.
- **Dynamic WhatsApp Reminder:** Pre-drafts a WhatsApp message reflecting only the *remaining* balance.

### 2.6 Localization & Settings (`src/pages/Settings.tsx`, `src/locales/`)
- Multi-language switching between **English**, **Hindi (हिंदी)**, and **Telugu (తెలుగు)** via `react-i18next`.
- Complete coverage across navigation, dashboard, forms, badges, and compliance text.
- **One-Click CSV Export:** Generates and downloads `hema_finance_export.csv` containing all transactions, debts, repayments, and gifts.

### 2.7 AI Assistant (`src/pages/Assistant.tsx`)
- Voice-enabled chat interface with SEBI educational compliance disclaimer.
- Context-aware answers with typing indicators.

---

## 3. PROJECT DIRECTORY MAP

```
C:\Users\LAB2_PC14\Desktop\TharunAvula\HemaWebApp
├── index.html                   # HTML Entry point
├── package.json                 # Dependencies & scripts ("type": "module")
├── postcss.config.cjs           # PostCSS for Tailwind
├── tailwind.config.cjs          # Custom Hema Gold (#d97706) design system
├── tsconfig.json                # TypeScript paths (@/ -> ./src)
├── vite.config.ts               # Vite configuration + VitePWA plugin
├── public/                      # Static assets & PWA manifest icons
└── src/
    ├── App.tsx                  # Main layout & bottom navigation bar
    ├── main.tsx                 # React entry point with i18n
    ├── i18n.ts                  # react-i18next initialization
    ├── index.css                # Tailwind directives & global resets
    ├── components/
    │   └── ui/Card.tsx          # Minimalist Card UI component
    ├── hooks/
    │   └── useSpeechToText.ts   # Custom hook for Web Speech API
    ├── lib/
    │   ├── AutoCorrectEngine.ts # Transliteration dictionary & category resolver
    │   ├── FuzzyMatcher.ts      # Levenshtein distance algorithm
    │   ├── db.ts                # IndexedDB schema (v4) & repository methods
    │   └── utils.ts             # Tailwind class merging utility (cn)
    ├── locales/
    │   ├── en/translation.json  # English strings
    │   ├── hi/translation.json  # Hindi strings
    │   └── te/translation.json  # Telugu strings
    └── pages/
        ├── Assistant.tsx        # AI Assistant chat & voice interface
        ├── Dashboard.tsx        # Overview cards, 7-day spend chart, recent list
        ├── Debts.tsx            # Loan register, Vaddi engine, photo/GPS proof
        ├── Expenses.tsx         # Expense/Income entry, auto-correct, voice, date
        ├── Gifts.tsx            # People cards, Shagun history, Gold/Silver units
        └── Settings.tsx         # Language selection, CSV export, policies
```

---

## 4. FUTURE ROADMAP (NEXT STEPS FOR ANY AGENT)

Any succeeding AI agent should consult this plan to continue development seamlessly:

### Step 1: Capacitor Native Mobile Android Build (Priority #1)
The user has reiterated their intent: *"create it like a web app and at last we shall convert it into a mobile android app"*.
- **Tasks:**
  1. Install Capacitor packages:
     ```bash
     npm install @capacitor/core @capacitor/cli @capacitor/android
     npx cap init "Hema" "com.hema.app" --web-dir dist
     ```
  2. Build the web app: `npm run build`.
  3. Add the Android platform: `npx cap add android`.
  4. Sync changes: `npx cap sync android`.
  5. Open in Android Studio: `npx cap open android` and generate debug/release APK.
  6. Enable native camera & geolocation permissions in `android/app/src/main/AndroidManifest.xml` (`CAMERA`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`).

### Step 2: Advanced AI Chat LLM Integration
- Currently, `src/pages/Assistant.tsx` has simulated responses.
- **Tasks:**
  - Connect to an actual backend or client-side LLM (such as Google Gemini API via `@google/genai` or a local small model) with a customized system prompt specialized in Indian household finance, SEBI disclaimers, and vernacular financial advice.

### Step 3: Cloud / Household Multi-Device Sync (Optional)
- While the offline-first IndexedDB architecture is rock-solid, users may want to share their Shagun gift book or debt register with their spouse or children across devices.
- **Tasks:**
  - Implement optional Google Drive backup or Supabase / Firebase encrypted synchronization using the existing CSV/JSON export schema.

---

## 5. OPERATIONAL INSTRUCTIONS FOR AGENTS

1. **Operating System:** Windows. Shell commands must run via `cmd.exe /c "..."` or PowerShell without interactive prompts.
2. **Coding Standards:** Maintain the clean, minimalist Hema Gold theme. Never introduce heavy third-party UI component libraries that break Vite's bundler. Use existing Tailwind tokens.
3. **Preserve Offline Integrity:** Core operations (Transactions, Gifts, Debts, Proofs) **must never require an internet connection** to function.
4. **Git Remote:** Origin is linked to `https://github.com/Maritot/HemaWebApp.git` on branch `master`. Always commit and push working increments cleanly.
