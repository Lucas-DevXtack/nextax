CREATE TYPE "AccountOrigin" AS ENUM ('NEXTAX', 'NEXCORE');
CREATE TYPE "NextaxPlan" AS ENUM ('FREE', 'STARTER', 'PRO', 'BUSINESS');
CREATE TYPE "IntegrationKey" AS ENUM ('NEXFINANCE', 'NEXSTOCK', 'NEXCRM');

ALTER TABLE "User" ADD COLUMN "origin" "AccountOrigin" NOT NULL DEFAULT 'NEXTAX';

ALTER TABLE "Tenant" ADD COLUMN "plan" "NextaxPlan" NOT NULL DEFAULT 'FREE';
ALTER TABLE "Tenant" ADD COLUMN "origin" "AccountOrigin" NOT NULL DEFAULT 'NEXTAX';
ALTER TABLE "Tenant" ADD COLUMN "enabledIntegrations" "IntegrationKey"[] NOT NULL DEFAULT ARRAY[]::"IntegrationKey"[];
ALTER TABLE "Tenant" ADD COLUMN "integrationAddons" "IntegrationKey"[] NOT NULL DEFAULT ARRAY[]::"IntegrationKey"[];

UPDATE "User"
SET "origin" = 'NEXCORE'
WHERE EXISTS (
  SELECT 1 FROM "AuditLog"
  WHERE "AuditLog"."userId" = "User"."id"
    AND "AuditLog"."action" IN ('SSO_SIGNUP', 'NEXCORE_SSO_SIGNUP')
);

UPDATE "Tenant"
SET "origin" = 'NEXCORE'
WHERE EXISTS (
  SELECT 1 FROM "AuditLog"
  WHERE "AuditLog"."tenantId" = "Tenant"."id"
    AND "AuditLog"."action" IN ('SSO_SIGNUP', 'NEXCORE_SSO_SIGNUP')
);

CREATE INDEX "Tenant_plan_idx" ON "Tenant"("plan");
