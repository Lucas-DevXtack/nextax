-- Índices adicionados após auditoria de produção.
-- IF NOT EXISTS evita falha em ambientes onde os índices já tenham sido criados manualmente.

CREATE INDEX IF NOT EXISTS "RefreshToken_expiresAt_revokedAt_idx" ON "RefreshToken"("expiresAt", "revokedAt");
CREATE INDEX IF NOT EXISTS "Tenant_planExpiresAt_idx" ON "Tenant"("planExpiresAt");
CREATE INDEX IF NOT EXISTS "TaxObligation_tenantId_competenceYear_competenceMonth_status_idx" ON "TaxObligation"("tenantId", "competenceYear", "competenceMonth", "status");
CREATE INDEX IF NOT EXISTS "FiscalDocument_tenantId_deletedAt_createdAt_idx" ON "FiscalDocument"("tenantId", "deletedAt", "createdAt");
CREATE INDEX IF NOT EXISTS "FiscalDocument_tenantId_deletedAt_competenceYear_competenceMonth_idx" ON "FiscalDocument"("tenantId", "deletedAt", "competenceYear", "competenceMonth");
CREATE INDEX IF NOT EXISTS "BillingCheckout_tenantId_itemType_status_periodEnd_idx" ON "BillingCheckout"("tenantId", "itemType", "status", "periodEnd");
