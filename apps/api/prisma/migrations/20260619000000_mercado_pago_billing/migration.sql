CREATE TYPE "BillingItemType" AS ENUM ('PLAN', 'INTEGRATION_ADDON');
CREATE TYPE "BillingStatus" AS ENUM ('PENDING', 'APPROVED', 'AUTHORIZED', 'IN_PROCESS', 'REJECTED', 'CANCELLED', 'REFUNDED', 'CHARGED_BACK', 'ERROR');

ALTER TABLE "Tenant" ADD COLUMN "planExpiresAt" TIMESTAMP(3);

CREATE TABLE "BillingCheckout" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "itemType" "BillingItemType" NOT NULL,
  "targetPlan" "NextaxPlan",
  "integrationKey" "IntegrationKey",
  "status" "BillingStatus" NOT NULL DEFAULT 'PENDING',
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BRL',
  "provider" TEXT NOT NULL DEFAULT 'MERCADO_PAGO',
  "providerPreferenceId" TEXT,
  "providerPaymentId" TEXT,
  "externalReference" TEXT NOT NULL,
  "initPoint" TEXT,
  "sandboxInitPoint" TEXT,
  "rawPreference" JSONB,
  "rawPayment" JSONB,
  "paidAt" TIMESTAMP(3),
  "periodStart" TIMESTAMP(3),
  "periodEnd" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BillingCheckout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingCheckout_providerPreferenceId_key" ON "BillingCheckout"("providerPreferenceId");
CREATE UNIQUE INDEX "BillingCheckout_providerPaymentId_key" ON "BillingCheckout"("providerPaymentId");
CREATE UNIQUE INDEX "BillingCheckout_externalReference_key" ON "BillingCheckout"("externalReference");
CREATE INDEX "BillingCheckout_tenantId_createdAt_idx" ON "BillingCheckout"("tenantId", "createdAt");
CREATE INDEX "BillingCheckout_status_idx" ON "BillingCheckout"("status");
CREATE INDEX "BillingCheckout_itemType_idx" ON "BillingCheckout"("itemType");

ALTER TABLE "BillingCheckout" ADD CONSTRAINT "BillingCheckout_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
