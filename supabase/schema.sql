-- ====================================================================
-- HEMA FINANCE (హేమ / हेमा) — SUPABASE PRODUCTION DATABASE SCHEMA
-- Multi-Tenant Architecture with Strict Row-Level Security (RLS)
-- ====================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ====================================================================
-- 2. USER PROFILES TABLE
-- Extends Supabase auth.users with Indian household profile metadata
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  avatar_url TEXT,
  currency TEXT DEFAULT 'INR',
  locale TEXT DEFAULT 'te', -- 'te' (Telugu), 'hi' (Hindi), 'en' (English)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Trigger to auto-create profile on auth.users signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'Family Member'),
    NEW.email,
    NEW.phone,
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ====================================================================
-- 3. TRANSACTIONS TABLE (Income, Expenses, Transfers)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.transactions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  category_id TEXT NOT NULL,
  label TEXT,
  type TEXT NOT NULL CHECK (type IN ('INCOME', 'EXPENSE', 'TRANSFER')),
  date BIGINT NOT NULL, -- Epoch milliseconds
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON public.transactions(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user_type ON public.transactions(user_id, type);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access only their own transactions"
  ON public.transactions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ====================================================================
-- 4. PEOPLE DIRECTORY TABLE (Relatives, Neighbours, Contacts)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.people (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  relationship TEXT DEFAULT 'Family',
  phone TEXT,
  avatar_url TEXT,
  notes TEXT DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_people_user_name ON public.people(user_id, name);

ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access only their own people directory"
  ON public.people FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ====================================================================
-- 5. DEBTS & INFORMAL CREDIT (₹ Vaddi Engine)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.debts (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person TEXT NOT NULL,
  avatar_url TEXT,
  principal_amount NUMERIC(12, 2) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL, -- Total repayable (Principal + Interest)
  type TEXT NOT NULL CHECK (type IN ('WE_OWE', 'OWED_TO_US')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SETTLED', 'OVERDUE')),
  interest_type TEXT DEFAULT 'NONE' CHECK (interest_type IN ('NONE', 'VADDI_MONTHLY', 'SIMPLE_ANNUAL', 'COMPOUND_ANNUAL', 'CUSTOM')),
  interest_rate NUMERIC(6, 2) DEFAULT 0,
  custom_formula TEXT,
  tenure_months INT DEFAULT 0,
  interest_amount NUMERIC(12, 2) DEFAULT 0,
  due_date BIGINT NOT NULL,
  date_created BIGINT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_debts_user_status ON public.debts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_debts_user_duedate ON public.debts(user_id, due_date ASC);

ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access only their own debts"
  ON public.debts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ====================================================================
-- 6. DEBT PAYMENTS TABLE (Partial & Full Repayments with Proof)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.debt_payments (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  date BIGINT NOT NULL,
  mode TEXT DEFAULT 'Cash',
  notes TEXT DEFAULT '',
  proof_photo TEXT,
  location JSONB,
  timestamp_verified BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_debt_payments_user_debt ON public.debt_payments(user_id, debt_id);

ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access only their own debt payments"
  ON public.debt_payments FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ====================================================================
-- 7. GIFTS & SHAGUN REGISTRY (Cash, Gold, Silver, Sarees)
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.gifts (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id TEXT,
  person TEXT NOT NULL,
  occasion TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('GIVEN', 'RECEIVED')),
  category TEXT NOT NULL CHECK (category IN ('CASH', 'GOLD', 'SILVER', 'CLOTHES', 'OTHER')),
  item TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  weight_grams NUMERIC(8, 2),
  purity TEXT,
  date BIGINT NOT NULL,
  notes TEXT DEFAULT '',
  photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_gifts_user_date ON public.gifts(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_gifts_user_person ON public.gifts(user_id, person);

ALTER TABLE public.gifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users access only their own gifts"
  ON public.gifts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ====================================================================
-- 8. STORAGE BUCKET FOR WATERMARKED RECEIPTS & PROOF PHOTOS
-- ====================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('hema_proof_photos', 'hema_proof_photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users can upload their own proof photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'hema_proof_photos' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view their own proof photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'hema_proof_photos' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own proof photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'hema_proof_photos' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );
