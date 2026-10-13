# HEMA FINANCE — COMPREHENSIVE ARCHITECTURAL & CONTEXT HANDOVER

> **Document Type:** AI Agent Context & Handover Blueprint  
> **Repository:** `https://github.com/Maritot/HemaWebApp`  
> **Workspace Path:** `C:\Users\LAB2_PC14\Desktop\TharunAvula\HemaWebApp`  
> **Primary Technology Stack:** React 18 (Vite, TypeScript), Tailwind CSS, IndexedDB (`idb`), Capacitor Android Native, Vite PWA Plugin, Google Gemini API, Web Speech API, Geolocation API, HTML5 Canvas, React-i18next.  
> **Target Demographic:** Middle-aged / elderly non-technical Indian parents and households. Minimalist, high contrast, warm "Hema Gold" theme (`#d97706`), localized (EN / HI / TE), vernacular-friendly, 100% offline-first.

---

## 1. PAST STATUS: PROJECT GENESIS & PIVOTS

### 1.1 Original Native Android Project (Deprecated)
- **Path:** `C:\Users\LAB2_PC14\Desktop\TharunAvula\Daddy`
- **Original Stack:** Kotlin, Jetpack Compose, Hilt, Room, ViewModel.
- **Why it was changed:** The user requested a complete tech-stack pivot: build a modern, rapid-iteration **Web App** first with full capabilities, polish UX, verify user flow, and eventually wrap it as an Android mobile app.

### 1.2 Web App & Progressive Hybrid Architecture
- Scaffolded `HemaWebApp` inside `C:\Users\LAB2_PC14\Desktop\TharunAvula\HemaWebApp`.
- Established a single, elegant color palette centered on **Hema Gold** (`#d97706`, with warm amber accents).
- Configured offline database schema, speech recognition, vernacular autocorrect, and PWA capabilities.

---

## 2. CURRENT STATUS: ALL 5 MILESTONES COMPLETED (OCTOBER 2026)

### 2.1 📱 Native Android App Built (`android/` & `Hema-v1.0.apk`)
- **Capacitor Integration:** Fully initialized with `@capacitor/core`, `@capacitor/cli`, and `@capacitor/android` (`appId: com.hema.app`).
- **Native Android Manifest Permissions Configured:**
  - `android.permission.CAMERA`
  - `android.permission.ACCESS_FINE_LOCATION` & `ACCESS_COARSE_LOCATION`
  - `android.permission.RECORD_AUDIO` & `MODIFY_AUDIO_SETTINGS`
  - `android.permission.INTERNET` & `ACCESS_NETWORK_STATE`
- **App Launcher Icons:** Branded Hema Gold rounded icons placed in all mipmap density buckets (`hdpi`, `mdpi`, `xhdpi`, `xxhdpi`, `xxxhdpi`).
- **Java 17 Gradle Toolchain:** Configured Gradle 8.14.3 and Android Gradle Plugin 8.13.0 with `JavaVersion.VERSION_17` compatibility.
- **APK Successfully Compiled:**
  - Build output: `C:\Users\LAB2_PC14\Desktop\TharunAvula\HemaWebApp\android\app\build\outputs\apk\debug\app-debug.apk`
  - Root convenience copy: `C:\Users\LAB2_PC14\Desktop\TharunAvula\HemaWebApp\Hema-v1.0.apk` (4.4 MB). Ready to install directly on any Android smartphone.

### 2.2 🧠 Real Google Gemini AI Integration (`src/pages/Assistant.tsx` & `src/lib/gemini.ts`)
- **Direct Gemini API Connection:** Integrated Google Gemini REST endpoint (`gemini-1.5-flash`) via `queryGemini()`.
- **Live Household Context Awareness:** Before answering, the assistant pulls real-time user metrics from IndexedDB (Total Income, Total Expenses, Current Net, Active Loans/Vaddi, and Shagun count) and passes them into the prompt.
- **API Key Management:** Built-in connection modal lets the user save, update, or clear their free Google Gemini API key from AI Studio.
- **Local Financial Intelligence Fallback:** If offline or no key is configured, provides expert household advice on Gold (making charges vs SGBs), Vaddi interest calculation rules, 50-30-20 family budgets, and SEBI compliance guidelines.
- **Speech-to-Text Input:** Vernacular voice recognition via Web Speech API (`useSpeechToText.ts`).

### 2.3 🎨 PWA Polish & Official Vector Branding Assets
- **Custom App Icons:** Generated using HTML5 canvas script (`scripts/generate-icons.js`):
  - `public/hema-icon-192.png` (192×192 PWA maskable)
  - `public/hema-icon-512.png` (512×512 PWA maskable)
  - `public/favicon.svg` & `public/hema-icon.svg` (crisp scalable vector)
- **Manifest & Head:** Updated `vite.config.ts` and `index.html` with apple-touch-icon, mobile viewport lock (`user-scalable=no`), and gold theme color (`#d97706`).

### 2.4 🔒 Settings Upgrades: 4-Digit Security PIN & Alerts (`src/pages/Settings.tsx`)
- **App PIN Lock Engine (`src/lib/security.ts` & `src/components/LockScreen.tsx`):**
  - Users can enable/disable a 4-digit security PIN to protect their household finances.
  - Full-screen keypad lock on launch with shake animation for incorrect attempts.
  - "Lock App Now" instant lock shortcut in the header and settings.
- **Notification & Urgent Loan Alerts:**
  - Integrates browser `Notification.requestPermission()`.
  - Scans IndexedDB for overdue loans or loans due within 3 days and displays active reminder count and alerts.
  - Includes a "Test Device Reminder" button.

### 2.5 💾 Full Ledger Backup, Export & Family Device Sync (`src/lib/db.ts`)
- **One-Click JSON Backup (`exportFullBackup`):** Exports the entire database (`transactions`, `people`, `gifts`, `debts`, `payments`) into a single timestamped `.json` file.
- **Restore from Backup (`restoreFullBackup`):** Upload any previous `.json` backup to restore all data onto a new phone or browser seamlessly.
- **Multi-Device Family Sharing:** Export JSON and share via WhatsApp or Google Drive to other family members.
- **CSV Export:** Kept intact for Excel / Sheets tax calculations.

### 2.6 Core Financial Ledgers (Existing & Fully Functional)
- **Expenses & Income (`Expenses.tsx`):** Available balance banner, context-aware category hints, wide amount inputs, custom date picker, and Levenshtein distance vernacular autocorrect (`kiranam` $\rightarrow$ `Groceries`).
- **Gifts & Shagun Ledger (`Gifts.tsx`):** People face cards, drill-down relationship history, Gold (grams $\rightarrow$ **Tola / Savaran** conversion, 22K/24K purity), Silver, Cash, and Saree categories.
- **Debts & Loans (`Debts.tsx`):** Indian **₹ Vaddi** monthly interest ($P \times R\% \times M$), Simple/Compound interest, custom formula engine, loan editing, partial repayments, and **camera proof with GPS coordinates & verified timestamp watermarking**.

---

## 3. PROJECT DIRECTORY MAP

```
C:\Users\LAB2_PC14\Desktop\TharunAvula\HemaWebApp
├── Hema-v1.0-release.apk        # Signed Production Release APK (3.38 MB, v2 signed)
├── Hema-v1.0-release.aab        # Signed Google Play Store Release Bundle (3.24 MB)
├── Hema-v1.0.apk                # Convenience Debug APK (4.4 MB)
├── capacitor.config.json        # Capacitor configuration (com.hema.app)
├── android/                     # Complete native Android Studio project
│   ├── app/
│   │   ├── build.gradle         # Configured with signingConfigs.release & Java 17
│   │   ├── hema-release.jks     # Production Keystore (RSA 2048, validity 10000 days)
│   │   └── src/main/
│   │       ├── AndroidManifest.xml # Camera, Location, Audio, Internet permissions
│   │       └── res/             # Hema Gold icons in all mipmap buckets
│   ├── build.gradle             # Java 17 subproject enforcement
│   └── local.properties         # Android SDK path
├── public/
│   ├── favicon.svg              # Scalable gold vector icon
│   ├── hema-icon-192.png        # 192x192 PWA icon
│   └── hema-icon-512.png        # 512x512 PWA icon
├── scripts/
│   └── generate-icons.js        # Node canvas/PNG icon generator
└── src/
    ├── App.tsx                  # Root layout, routing, PIN session guard
    ├── components/
    │   ├── LockScreen.tsx       # 4-digit PIN lock screen & numpad
    │   └── ui/Card.tsx          # Minimalist Card UI
    ├── lib/
    │   ├── db.ts                # IndexedDB schema (v4), CRUD, backup/restore
    │   ├── gemini.ts            # Google Gemini API & local household reasoning
    │   ├── security.ts          # PIN setup, verify, and session state
    │   ├── AutoCorrectEngine.ts # Vernacular category auto-correction
    │   └── FuzzyMatcher.ts      # Levenshtein distance algorithm
    ├── pages/
    │   ├── Assistant.tsx        # Gemini AI chat, voice mic, key modal
    │   ├── Dashboard.tsx        # Totals, 7-day spend chart, recent txs
    │   ├── Debts.tsx            # Vaddi engine, partial payments, camera/GPS proof
    │   ├── Expenses.tsx         # Income/Expense entry, voice, balance banner
    │   ├── Gifts.tsx            # People cards, Shagun ledger, Indian units
    │   └── Settings.tsx         # i18n, PIN security, Alerts, Backup/Restore
```

---

## 4. PRODUCTION SIGNING & RELEASE ARTIFACTS

- **Keystore Location:** `android/app/hema-release.jks`
- **Keystore Alias:** `hema_key`
- **Keystore / Key Password:** `hema_release_password_2026`
- **Signer Distinguished Name (DN):** `CN=Hema Finance, OU=Mobile, O=Hema Household, L=Hyderabad, ST=Telangana, C=IN`
- **SHA-256 Digest:** `378433f584112b09fe8ebaa1047fa601b9cd477857e7ee93afa2cc67c5d617b1`
- **Signature Scheme:** APK Signature Scheme v2 (Full signature verification verified via Android SDK `apksigner`).
- **Google Play Store Ready:** `Hema-v1.0-release.aab` meets all modern Play Console requirements (targetSdk 34+, 64-bit native code, app bundle format).

---

## 5. FUTURE ROADMAP (OPTIONAL POLISH)

1. **Receipt OCR:** Use Gemini Vision API to auto-scan paper bills or gold receipts and fill transaction fields automatically.
2. **WhatsApp & Native Share Sheet:** Direct 1-tap sharing of JSON backups via Android native share sheet (`navigator.share`).
3. **Cloud Encrypted Sync (Google Drive / Firebase):** Automated daily sync of the JSON backup payload to Google Drive without manual file exports.

---

## 6. OPERATIONAL INSTRUCTIONS FOR AGENTS

1. **Development Server:** Run `npm run dev` in `C:\Users\LAB2_PC14\Desktop\TharunAvula\HemaWebApp` (listening on `http://localhost:5173/`).
2. **Android Release Build Commands:**
   ```powershell
   cmd.exe /c "npm run build"
   cmd.exe /c "npx cap sync android"
   $env:JAVA_HOME = "C:\Program Files\Autopsy-4.22.1\jre"; $env:Path = "$env:JAVA_HOME\bin;$env:Path"
   cd android; .\gradlew.bat assembleRelease bundleRelease; cd ..
   Copy-Item android/app/build/outputs/apk/release/app-release.apk Hema-v1.0-release.apk
   Copy-Item android/app/build/outputs/bundle/release/app-release.aab Hema-v1.0-release.aab
   ```
3. **Git Remote:** Origin is linked to `https://github.com/Maritot/HemaWebApp.git` on branch `master`.

