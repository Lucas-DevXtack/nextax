# NexTax — notas de produção

## Checklist antes de abrir para cliente real

1. Configure todas as variáveis do Render da API, principalmente:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `JWT_ACCESS_SECRET`
   - `JWT_REFRESH_SECRET`
   - `RESEND_API_KEY`
   - `EMAIL_FROM`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_STORAGE_BUCKET`
   - `MERCADO_PAGO_ACCESS_TOKEN`
   - `MERCADO_PAGO_PUBLIC_KEY`
   - `MERCADO_PAGO_WEBHOOK_SECRET`
   - `NEXCORE_PRODUCT_KEY`
   - `NEXCORE_INTERNAL_API_KEY`
   - `NEXTAX_INTERNAL_API_KEY`
2. Rode no ambiente real:

```bash
npm ci --include=dev
npm run prisma:generate
npm run build:api
npm run build:web
npm run prisma:deploy
```

3. Crie o bucket privado `nextax-documents` no Supabase Storage ou deixe a API criá-lo no primeiro upload.
4. Configure o webhook do Mercado Pago para:

```txt
https://api.nextax.business/webhooks/mercadopago
```

5. Agende um cron a cada 5–15 minutos para:

```http
POST https://api.nextax.business/internal/maintenance/run
x-internal-api-key: <NEXTAX_INTERNAL_API_KEY>
```

Esse endpoint expira planos vencidos, cancela checkouts pendentes antigos e limpa tokens usados/vencidos.

## Fluxos obrigatórios de teste

- cadastro direto → bloqueado até confirmar e-mail;
- reenviar confirmação por e-mail;
- login após confirmação;
- reset de senha;
- SSO NexCore → NexTax;
- sync interno NexCore com `membership.role`;
- upload/download de documentos privados;
- geração de relatório mensal com PDF e CSV;
- checkout Mercado Pago sandbox;
- webhook Mercado Pago assinado;
- criação/troca de empresa no plano Business;
- exclusão local bloqueada para conta gerenciada pelo NexCore.
