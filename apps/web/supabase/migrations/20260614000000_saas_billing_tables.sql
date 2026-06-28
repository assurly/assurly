-- B2B SaaS Tenancy, Billing, and Scans Schema
-- Upgrades ShipReady database to support Organizations, Memberships, Repositories, Scans, and Stripe billing.

-- Create organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  billing_plan TEXT NOT NULL DEFAULT 'free', -- 'free' | 'pro'
  stripe_customer_id TEXT UNIQUE,
  github_org_id INTEGER UNIQUE,
  github_installation_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on organizations
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Create memberships table
CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL, -- Corresponds to user's GitHub ID or authentication UUID
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- 'admin' | 'member'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (user_id, organization_id)
);

-- Enable RLS on memberships
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;

-- Create repositories table
CREATE TABLE IF NOT EXISTS repositories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  github_repo_id INTEGER UNIQUE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on repositories
ALTER TABLE repositories ENABLE ROW LEVEL SECURITY;

-- Create scans table
CREATE TABLE IF NOT EXISTS scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repository_id UUID REFERENCES repositories(id) ON DELETE CASCADE NOT NULL,
  commit_sha TEXT NOT NULL,
  branch TEXT NOT NULL,
  status TEXT NOT NULL, -- 'success' | 'failed'
  error_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on scans
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;

-- Create scan_findings table
CREATE TABLE IF NOT EXISTS scan_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID REFERENCES scans(id) ON DELETE CASCADE NOT NULL,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL, -- 'error' | 'warning'
  file_path TEXT NOT NULL,
  line_number INTEGER,
  message TEXT NOT NULL,
  suggestion TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on scan_findings
ALTER TABLE scan_findings ENABLE ROW LEVEL SECURITY;


-- =========================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================================

-- Organizations: users can view organizations they are members of
CREATE POLICY select_org_member ON organizations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = organizations.id
      AND memberships.user_id = auth.uid()::text
    )
  );

-- Memberships: users can view memberships in organizations they belong to
CREATE POLICY select_membership_member ON memberships
  FOR SELECT
  USING (
    organization_id IN (
      SELECT m.organization_id FROM memberships m
      WHERE m.user_id = auth.uid()::text
    )
  );

-- Repositories: users can view repositories of organizations they belong to
CREATE POLICY select_repository_member ON repositories
  FOR SELECT
  USING (
    organization_id IN (
      SELECT m.organization_id FROM memberships m
      WHERE m.user_id = auth.uid()::text
    )
  );

-- Scans: users can view scans of repositories they have access to
CREATE POLICY select_scan_member ON scans
  FOR SELECT
  USING (
    repository_id IN (
      SELECT r.id FROM repositories r
      JOIN memberships m ON r.organization_id = m.organization_id
      WHERE m.user_id = auth.uid()::text
    )
  );

-- Scan Findings: users can view findings of scans they have access to
CREATE POLICY select_finding_member ON scan_findings
  FOR SELECT
  USING (
    scan_id IN (
      SELECT s.id FROM scans s
      JOIN repositories r ON s.repository_id = r.id
      JOIN memberships m ON r.organization_id = m.organization_id
      WHERE m.user_id = auth.uid()::text
    )
  );
