# Hema Finance (హేమ / हेमा) — Production PWA & Android Mobile App

> **Comprehensive Project Memory & Architectural Blueprint:** See [PROJECT_CONTEXT.md](file:///C:/Users/LAB2_PC14/Desktop/TharunAvula/HemaWebApp/PROJECT_CONTEXT.md) for the single authoritative specification, system architecture, database schemas, cryptographic security model, and development roadmap.

---

## Overview
**Hema Finance** is a 100% offline-first, vernacular-enabled personal and household finance management application designed specifically for Indian household elders, parents, and joint families. It provides informal credit and ₹ Vaddi interest management, traditional Gold (Tola / Savaran) and Shagun gift tracking, multi-user authentication with physical database isolation (`HemaDB_${userId}`), dynamic Google Gemini AI assistance with live household RAG metrics, and executive corporate PDF & Excel reports.

Built with **React 18, TypeScript, Tailwind CSS**, and packaged natively for Android via **Capacitor 8**.

---

## Core Capabilities
- 🔐 **Dual-Tier Multi-User Authentication:** Online Express REST backend + offline cryptographic vault fallback using W3C WebCrypto PBKDF2-SHA256 (100,000 iterations). 1-tap account switching on shared devices.
- 🗄️ **Physical Tenant Partitioning:** Each user account operates in a completely separate IndexedDB partition (`HemaDB_${userId}`).
- 💰 **Informal Credit & ₹ Vaddi Engine:** Indian monthly ₹ vaddi interest, 3-column settled reconciliation (Principal, Interest, Total), camera proof with verified GPS watermark, and future-date prevention.
- 🎁 **Shagun & Gift Registry:** People cards, relationship tracking, cash, gold (grams to tola conversion with 22K/24K purity), silver, and festive silk saree ledgers.
- 🤖 **Dynamic Gemini AI Assistant:** Real-time dynamic RAG data injection with live household metrics, language guardrails (EN, TE, HI), and ChatGPT-style document artifact cards.
- 📊 **Executive Corporate Reports:** Vector PDF generation (`jspdf` + `jspdf-autotable`) and styled corporate Excel workbooks (`xlsx-js-style`) with cleaned headers and custom column widths.
- 📱 **Native Android Integration:** Lively camera capture, local notifications tray alerts, native filesystem writes, and Android Share Sheet integration.
- 💾 **Full Ledger Backup & Restore:** 1-click JSON backup export and schema-validated restore with built-in test ledger loader.

---

## Quickstart

### 1. Installation
```bash
# Windows (cmd.exe recommended to bypass PowerShell script execution policy)
cmd.exe /c "npm install"
```

### 2. Run Development Frontend
```bash
cmd.exe /c "npm run dev"
```
*Vite dev server runs at:* `http://localhost:5173/`

### 3. Run Multi-Tenant Express Backend (Optional)
```bash
cmd.exe /c "npm run server"
```
*Express server runs at:* `http://localhost:3001/`

### 4. Build Production Web Distribution
```bash
cmd.exe /c "npm run build"
```
*Outputs to:* `dist/`

### 5. Compile Android APK & Play Store Bundle
```powershell
cmd.exe /c "npx cap sync android"
$env:JAVA_HOME = "C:\Program Files\Autopsy-4.22.1\jre"; $env:Path = "$env:JAVA_HOME\bin;$env:Path"
cd android
.\gradlew.bat assembleRelease bundleRelease
cd ..
```
*Output Artifacts:*
- `Hema_v2.0_Release.apk` (7.62 MB)
- `android/app/build/outputs/apk/release/app-release.apk`
- `android/app/build/outputs/bundle/release/app-release.aab`

---

## Documentation
For complete technical details, database schemas, cryptographic specifications, and operational instructions, please consult **[PROJECT_CONTEXT.md](file:///C:/Users/LAB2_PC14/Desktop/TharunAvula/HemaWebApp/PROJECT_CONTEXT.md)**.
