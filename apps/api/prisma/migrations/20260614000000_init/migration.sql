-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'FINANCE', 'ACCOUNTANT', 'READER');
CREATE TYPE "TaxRegime" AS ENUM ('MEI', 'SIMPLES_NACIONAL', 'AUTONOMO', 'UNKNOWN', 'OTHER');
CREATE TYPE "BusinessType" AS ENUM ('SERVICE', 'COMMERCE', 'INDUSTRY', 'SERVICE_AND_COMMERCE', 'OTHER');
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'CASH', 'CARD', 'BOLETO', 'TRANSFER', 'OTHER');
CREATE TYPE "RevenueCategory" AS ENUM ('SERVICE', 'PRODUCT', 'RECURRING', 'OCCASIONAL', 'OTHER');
CREATE TYPE "ExpenseCategory" AS ENUM ('RENT', 'ENERGY', 'INTERNET', 'ACCOUNTANT', 'SUPPLIER', 'TRANSPORT', 'MARKETING', 'SOFTWARE', 'CARD_MACHINE', 'WORK_MATERIAL', 'MAINTENANCE', 'FOOD', 'OTHER');
CREATE TYPE "ObligationType" AS ENUM ('DAS_MEI', 'DAS_SIMPLES', 'MUNICIPAL_GUIDE', 'CUSTOM_TAX', 'OTHER');
CREATE TYPE "ObligationStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'IGNORED', 'REVIEWING');
CREATE TYPE "InvoiceType" AS ENUM ('ISSUED', 'RECEIVED', 'RECEIPT', 'FISCAL_COUPON', 'OTHER');
CREATE TYPE "DocumentType" AS ENUM ('DAS', 'INVOICE', 'RECEIPT', 'STATEMENT', 'CONTRACT', 'COMPANY_DOCUMENT', 'PERSONAL_DOCUMENT', 'REPORT', 'OTHER');
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'REVIEWED', 'SENT_TO_ACCOUNTANT', 'APPROVED', 'REJECTED', 'NEEDS_FIX');
CREATE TYPE "ChecklistStatus" AS ENUM ('OPEN', 'DONE', 'PARTIAL');
CREATE TYPE "ChecklistItemStatus" AS ENUM ('PENDING', 'DONE', 'SKIPPED');
CREATE TYPE "ReportStatus" AS ENUM ('GENERATED', 'SENT', 'ARCHIVED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'OWNER',
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

CREATE TABLE "RefreshToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

CREATE TABLE "Tenant" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legalName" TEXT,
  "cnpj" TEXT,
  "taxProfile" "TaxRegime" NOT NULL DEFAULT 'UNKNOWN',
  "city" TEXT,
  "state" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "ownerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Tenant_ownerId_idx" ON "Tenant"("ownerId");

CREATE TABLE "TenantMember" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'OWNER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TenantMember_tenantId_userId_key" ON "TenantMember"("tenantId", "userId");
CREATE INDEX "TenantMember_userId_idx" ON "TenantMember"("userId");

CREATE TABLE "FiscalProfile" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "regime" "TaxRegime" NOT NULL DEFAULT 'UNKNOWN',
  "businessType" "BusinessType" NOT NULL DEFAULT 'OTHER',
  "meiAnnualLimit" DECIMAL(65,30) NOT NULL DEFAULT 81000,
  "dasDueDay" INTEGER NOT NULL DEFAULT 20,
  "hasAccountant" BOOLEAN NOT NULL DEFAULT false,
  "accountantName" TEXT,
  "accountantEmail" TEXT,
  "accountantPhone" TEXT,
  "estimatedTaxRate" DECIMAL(65,30),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FiscalProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FiscalProfile_tenantId_key" ON "FiscalProfile"("tenantId");

CREATE TABLE "Revenue" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "customerName" TEXT,
  "customerDocument" TEXT,
  "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'PIX',
  "category" "RevenueCategory" NOT NULL DEFAULT 'SERVICE',
  "hasInvoice" BOOLEAN NOT NULL DEFAULT false,
  "invoiceId" TEXT,
  "documentId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Revenue_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Revenue_tenantId_receivedAt_idx" ON "Revenue"("tenantId", "receivedAt");
CREATE INDEX "Revenue_tenantId_category_idx" ON "Revenue"("tenantId", "category");

CREATE TABLE "Expense" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "paidAt" TIMESTAMP(3) NOT NULL,
  "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
  "supplierName" TEXT,
  "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'PIX',
  "isRecurring" BOOLEAN NOT NULL DEFAULT false,
  "documentId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Expense_tenantId_paidAt_idx" ON "Expense"("tenantId", "paidAt");
CREATE INDEX "Expense_tenantId_category_idx" ON "Expense"("tenantId", "category");

CREATE TABLE "TaxObligation" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" "ObligationType" NOT NULL,
  "competenceMonth" INTEGER NOT NULL,
  "competenceYear" INTEGER NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(65,30),
  "status" "ObligationStatus" NOT NULL DEFAULT 'PENDING',
  "paidAt" TIMESTAMP(3),
  "paymentDocumentId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TaxObligation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaxObligation_tenantId_dueDate_idx" ON "TaxObligation"("tenantId", "dueDate");
CREATE INDEX "TaxObligation_tenantId_status_idx" ON "TaxObligation"("tenantId", "status");

CREATE TABLE "Invoice" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "type" "InvoiceType" NOT NULL,
  "number" TEXT,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "partyName" TEXT,
  "partyDocument" TEXT,
  "description" TEXT,
  "fileDocumentId" TEXT,
  "revenueId" TEXT,
  "expenseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Invoice_tenantId_issuedAt_idx" ON "Invoice"("tenantId", "issuedAt");

CREATE TABLE "FiscalDocument" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "DocumentType" NOT NULL DEFAULT 'OTHER',
  "fileUrl" TEXT,
  "fileKey" TEXT,
  "mimeType" TEXT,
  "size" INTEGER,
  "competenceMonth" INTEGER,
  "competenceYear" INTEGER,
  "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
  "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "uploadedBy" TEXT,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FiscalDocument_tenantId_status_idx" ON "FiscalDocument"("tenantId", "status");
CREATE INDEX "FiscalDocument_tenantId_competenceYear_competenceMonth_idx" ON "FiscalDocument"("tenantId", "competenceYear", "competenceMonth");

CREATE TABLE "FiscalChecklist" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "month" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "status" "ChecklistStatus" NOT NULL DEFAULT 'OPEN',
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FiscalChecklist_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FiscalChecklist_tenantId_month_year_key" ON "FiscalChecklist"("tenantId", "month", "year");

CREATE TABLE "FiscalChecklistItem" (
  "id" TEXT NOT NULL,
  "checklistId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "ChecklistItemStatus" NOT NULL DEFAULT 'PENDING',
  "dueDate" TIMESTAMP(3),
  "documentId" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FiscalChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FiscalReport" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "month" INTEGER NOT NULL,
  "year" INTEGER NOT NULL,
  "status" "ReportStatus" NOT NULL DEFAULT 'GENERATED',
  "summary" JSONB NOT NULL,
  "pdfUrl" TEXT,
  "excelUrl" TEXT,
  "zipUrl" TEXT,
  "generatedBy" TEXT,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentToAccountantAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FiscalReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FiscalReport_tenantId_year_month_idx" ON "FiscalReport"("tenantId", "year", "month");

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'UNREAD',
  "scheduledFor" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_tenantId_status_idx" ON "Notification"("tenantId", "status");

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "userId" TEXT,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT,
  "metadata" JSONB,
  "ip" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalProfile" ADD CONSTRAINT "FiscalProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Revenue" ADD CONSTRAINT "Revenue_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxObligation" ADD CONSTRAINT "TaxObligation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalChecklist" ADD CONSTRAINT "FiscalChecklist_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalChecklistItem" ADD CONSTRAINT "FiscalChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "FiscalChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FiscalReport" ADD CONSTRAINT "FiscalReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
