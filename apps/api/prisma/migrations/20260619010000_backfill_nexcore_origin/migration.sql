-- Backfill robusto para contas que já entravam pelo NexCore antes da coluna origin existir
-- ou para tenants criados por SSO que ficaram com origin padrão NEXTAX.
UPDATE "User" AS u
SET "origin" = 'NEXCORE'
WHERE u."origin" <> 'NEXCORE'
  AND EXISTS (
    SELECT 1
    FROM "AuditLog" AS a
    WHERE a."userId" = u."id"
      AND (
        a."action" ILIKE '%SSO%'
        OR a."action" ILIKE '%NEXCORE%'
      )
  );

UPDATE "Tenant" AS t
SET "origin" = 'NEXCORE'
WHERE t."origin" <> 'NEXCORE'
  AND EXISTS (
    SELECT 1
    FROM "AuditLog" AS a
    WHERE a."tenantId" = t."id"
      AND (
        a."action" ILIKE '%SSO%'
        OR a."action" ILIKE '%NEXCORE%'
      )
  );

-- Se o usuário está marcado como NexCore, marque também o tenant principal dele.
UPDATE "Tenant" AS t
SET "origin" = 'NEXCORE'
WHERE t."origin" <> 'NEXCORE'
  AND EXISTS (
    SELECT 1
    FROM "TenantMember" AS tm
    JOIN "User" AS u ON u."id" = tm."userId"
    WHERE tm."tenantId" = t."id"
      AND u."origin" = 'NEXCORE'
  );
