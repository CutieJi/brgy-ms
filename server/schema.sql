-- Barangay management system schema for Supabase/PostgreSQL.
-- Run this file in the Supabase SQL Editor. The seed logins below are for local
-- development only; change their passwords before using a deployed system.

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    users_id TEXT UNIQUE,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "middleName" TEXT,
    "middleInitial" TEXT,
    "lastName" TEXT NOT NULL,
    suffix TEXT,
    role TEXT NOT NULL CHECK (role IN (
        'resident', 'kagawad', 'treasurer', 'secretary', 'tanod',
        'captain', 'superadmin'
    )),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'suspended')),
    sex TEXT,
    gender TEXT,
    "dateOfBirth" DATE,
    birthplace TEXT,
    "houseNo" TEXT,
    street TEXT,
    "barangayNo" TEXT,
    city TEXT,
    "isPwd" BOOLEAN NOT NULL DEFAULT FALSE,
    "isSoloParent" BOOLEAN NOT NULL DEFAULT FALSE,
    "is4ps" BOOLEAN NOT NULL DEFAULT FALSE,
    "registeredVoter" BOOLEAN NOT NULL DEFAULT FALSE,
    "voterIdNumber" TEXT,
    "mobile" TEXT,
    "householdId" TEXT,
    "adminId" TEXT,
    "isHeadAdmin" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdBy" TEXT,
    "photoURL" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT voter_id_required_when_registered
        CHECK (NOT "registeredVoter" OR NULLIF(BTRIM("voterIdNumber"), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS users_role_status_idx ON users (role, status);

-- Upgrade existing MISLend user tables without deleting account records.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD COLUMN IF NOT EXISTS users_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastName" TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE users ADD COLUMN IF NOT EXISTS mobile TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "adminId" TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "isHeadAdmin" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "photoURL" TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS "middleName" TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suffix TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sex TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "dateOfBirth" DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthplace TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "houseNo" TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS street TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "barangayNo" TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "isPwd" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "isSoloParent" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "is4ps" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "registeredVoter" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "voterIdNumber" TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "householdId" TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS "adminType" TEXT;

CREATE INDEX IF NOT EXISTS users_household_id_idx ON users ("householdId");
UPDATE users
SET username = LOWER(COALESCE(NULLIF(SPLIT_PART(email, '@', 1), ''), 'resident')) || '-' || id::TEXT
WHERE username IS NULL OR BTRIM(username) = '';
ALTER TABLE users ALTER COLUMN username SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx ON users (username);
CREATE UNIQUE INDEX IF NOT EXISTS users_users_id_unique_idx ON users (users_id) WHERE users_id IS NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
    'resident', 'kagawad', 'treasurer', 'secretary', 'tanod',
    'captain', 'superadmin', 'student', 'professor', 'admin'
));
UPDATE users SET role = 'resident' WHERE role = 'student';
UPDATE users SET role = 'captain' WHERE role = 'professor';
UPDATE users
SET role = 'superadmin', "isHeadAdmin" = TRUE
WHERE role = 'admin' AND ("isHeadAdmin" = TRUE OR "adminType" = 'head_admin');
UPDATE users SET role = 'captain' WHERE role = 'admin';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
    'resident', 'kagawad', 'treasurer', 'secretary', 'tanod',
    'captain', 'superadmin'
));
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voter_id_required_when_registered') THEN
        ALTER TABLE users ADD CONSTRAINT voter_id_required_when_registered
            CHECK (NOT "registeredVoter" OR NULLIF(BTRIM("voterIdNumber"), '') IS NOT NULL);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS households (
    id BIGSERIAL PRIMARY KEY,
    "householdCode" TEXT UNIQUE,
    "headOfHouseholdId" TEXT,
    "houseNo" TEXT,
    street TEXT,
    "barangayNo" TEXT,
    city TEXT,
    "familySize" INTEGER NOT NULL DEFAULT 1 CHECK ("familySize" > 0),
    notes TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS household_members (
    id BIGSERIAL PRIMARY KEY,
    "householdId" TEXT NOT NULL,
    "userId" TEXT,
    "fullName" TEXT NOT NULL,
    relationship TEXT,
    "dateOfBirth" DATE,
    sex TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS household_members_user_idx ON household_members ("userId");
CREATE INDEX IF NOT EXISTS household_members_household_idx ON household_members ("householdId");

CREATE TABLE IF NOT EXISTS certificate_requests (
    id BIGSERIAL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL CHECK ("requestType" IN (
        'barangay_certificate', 'barangay_clearance', 'business_clearance'
    )),
    purpose TEXT NOT NULL,
    "businessName" TEXT,
    "businessAddress" TEXT,
    "supportingDocument" TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'under_review', 'approved', 'rejected', 'ready_for_pickup', 'released'
    )),
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMPTZ,
    "releaseDate" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS certificate_requests_user_idx ON certificate_requests ("userId", status);

CREATE TABLE IF NOT EXISTS complaints (
    id BIGSERIAL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    location TEXT,
    "respondentName" TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'under_review', 'for_mediation', 'resolved', 'dismissed'
    )),
    "assignedTo" TEXT,
    "reviewedBy" TEXT,
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS complaints_user_idx ON complaints ("userId", status);

CREATE TABLE IF NOT EXISTS incidents (
    id BIGSERIAL PRIMARY KEY,
    incidents_id TEXT UNIQUE,
    "userId" TEXT,
    "reporterId" TEXT,
    "reportedBy" TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT,
    location TEXT,
    "incidentDate" TIMESTAMPTZ,
    "involvedPeople" TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'under_review', 'referred', 'resolved', 'closed'
    )),
    "assignedTo" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS incidents_user_idx ON incidents ("userId", status);

CREATE TABLE IF NOT EXISTS blotter_records (
    id BIGSERIAL PRIMARY KEY,
    "blotterNumber" TEXT UNIQUE,
    "complainantId" TEXT,
    "complainantName" TEXT NOT NULL,
    "respondentName" TEXT,
    subject TEXT NOT NULL,
    narrative TEXT NOT NULL,
    location TEXT,
    "incidentDate" TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
        'open', 'for_mediation', 'referred', 'resolved', 'closed'
    )),
    "recordedBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patrol_logs (
    id BIGSERIAL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "patrolScheduleId" TEXT,
    "patrolDate" DATE NOT NULL DEFAULT CURRENT_DATE,
    shift TEXT,
    area TEXT NOT NULL,
    observations TEXT,
    "incidentsReported" INTEGER NOT NULL DEFAULT 0 CHECK ("incidentsReported" >= 0),
    status TEXT NOT NULL DEFAULT 'completed',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS patrol_schedules (
    id BIGSERIAL PRIMARY KEY,
    "assignedTo" TEXT NOT NULL,
    "patrolDate" DATE NOT NULL,
    shift TEXT NOT NULL,
    area TEXT NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emergency_reports (
    id BIGSERIAL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    location TEXT NOT NULL,
    "emergencyType" TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'responding', 'resolved', 'closed')),
    "assignedTo" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS community_projects (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    committee TEXT,
    budget NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (budget >= 0),
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'ongoing', 'completed', 'cancelled')),
    "startDate" DATE,
    "endDate" DATE,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS committee_assignments (
    id BIGSERIAL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    committee TEXT NOT NULL,
    position TEXT,
    description TEXT,
    "startDate" DATE,
    "endDate" DATE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGSERIAL PRIMARY KEY,
    "userId" TEXT,
    activity TEXT NOT NULL,
    category TEXT,
    details TEXT,
    "activityDate" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS income_records (
    id BIGSERIAL PRIMARY KEY,
    reference TEXT,
    description TEXT NOT NULL,
    category TEXT,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
    "receivedFrom" TEXT,
    "transactionDate" DATE NOT NULL DEFAULT CURRENT_DATE,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expense_records (
    id BIGSERIAL PRIMARY KEY,
    reference TEXT,
    description TEXT NOT NULL,
    category TEXT,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
    "paidTo" TEXT,
    "transactionDate" DATE NOT NULL DEFAULT CURRENT_DATE,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budgets (
    id BIGSERIAL PRIMARY KEY,
    fiscal_year INTEGER NOT NULL,
    category TEXT NOT NULL,
    allocated_amount NUMERIC(14, 2) NOT NULL CHECK (allocated_amount >= 0),
    notes TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fiscal_year, category)
);

CREATE TABLE IF NOT EXISTS collection_records (
    id BIGSERIAL PRIMARY KEY,
    "residentId" TEXT,
    "residentName" TEXT NOT NULL,
    description TEXT NOT NULL,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
    "collectionDate" DATE NOT NULL DEFAULT CURRENT_DATE,
    "receivedBy" TEXT,
    status TEXT NOT NULL DEFAULT 'collected' CHECK (status IN ('due', 'collected', 'void')),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_transactions (
    id BIGSERIAL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "requestId" TEXT,
    "requestType" TEXT,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
    method TEXT,
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
    "paidAt" TIMESTAMPTZ,
    "recordedBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payment_transactions_user_idx ON payment_transactions ("userId", status);

CREATE TABLE IF NOT EXISTS audit_records (
    id BIGSERIAL PRIMARY KEY,
    "userId" TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    "entityId" TEXT,
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    category TEXT,
    "publishAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "expiresAt" TIMESTAMPTZ,
    "createdBy" TEXT,
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meetings (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    agenda TEXT,
    location TEXT,
    "meetingDate" TIMESTAMPTZ NOT NULL,
    "createdBy" TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meeting_minutes (
    id BIGSERIAL PRIMARY KEY,
    "meetingId" TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    "recordedBy" TEXT,
    "meetingDate" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_records (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT,
    description TEXT,
    "fileUrl" TEXT,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointments (
    id BIGSERIAL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    purpose TEXT NOT NULL,
    "appointmentDate" TIMESTAMPTZ NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'completed', 'cancelled')),
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS appointments_user_idx ON appointments ("userId", status);

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    "targetUrl" TEXT,
    "readAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications ("userId", "createdAt" DESC);

-- Example development logins:
-- Resident: resident.demo@barangay.local / Resident123!
-- Superadmin: superadmin.demo@barangay.local / Barangay123!
INSERT INTO users (
    users_id, email, username, password, name, "firstName", "middleName", "lastName",
    role, status, sex, "dateOfBirth", birthplace, "houseNo", street, "barangayNo",
    city, "mobile", "registeredVoter", "voterIdNumber"
) VALUES (
    'usr_seed_resident_001', 'resident.demo@barangay.local', 'residentdemo',
    '$2a$10$dT0Y31O5tOufmtKbvtA52Osub6CbMtjVlXfHH5t9MUt26HgFDiqZ2',
    'Maria Santos', 'Maria', 'Dela Cruz', 'Santos', 'resident', 'approved',
    'Female', '1995-06-15', 'Quezon City', '12', 'Rizal Street', '1',
    'Quezon City', '09171234567', TRUE, 'VOTER-0001'
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO users (
    users_id, email, username, password, name, "firstName", "lastName",
    role, status, sex, "houseNo", street, "barangayNo", city, "mobile",
    "adminId", "isHeadAdmin"
) VALUES (
    'usr_seed_superadmin_001', 'superadmin.demo@barangay.local', 'superadmin',
    '$2a$10$b0WX9mvgsDUBF3zUAmOKlerY25rK6LTgMegbbJTomBxYOESszBks6',
    'Barangay Super Admin', 'Barangay', 'Super Admin', 'superadmin', 'approved',
    'Other', '1', 'Barangay Hall Road', '1', 'Quezon City', '09170000000',
    'BRGY-ADMIN-001', TRUE
)
ON CONFLICT (email) DO NOTHING;
