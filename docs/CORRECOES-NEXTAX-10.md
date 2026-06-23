# Correções aplicadas — NexTax 10

## Segurança/Auth

- Cadastro direto não cria mais sessão automaticamente.
- Login e refresh bloqueiam usuário local sem `emailVerifiedAt`.
- Reenvio de confirmação agora é público por e-mail e responde de forma genérica para evitar enumeração.
- Produção exige `RESEND_API_KEY` e `EMAIL_FROM`.
- Conta gerenciada pelo NexCore não pode ser excluída localmente pelo NexTax.

## NexCore/SSO

- Usuários via NexCore continuam sendo marcados como e-mail verificado.
- Sync interno agora aceita `membership.role` e sincroniza o papel do membro sem forçar `OWNER`.

## Billing/produção

- Catálogo de billing só marca checkout como configurado quando Mercado Pago tem access token, public key, webhook secret e URL pública.
- Webhook Mercado Pago continua com validação HMAC.
- Endpoint interno de manutenção criado:

```http
POST /internal/maintenance/run
x-internal-api-key: <NEXTAX_INTERNAL_API_KEY>
```

Ele expira planos vencidos, cancela checkouts antigos e limpa tokens usados/vencidos.

## Relatórios

- Geração mensal agora cria arquivos privados no Supabase Storage:
  - PDF simples;
  - CSV compatível com Excel.
- Novas URLs assinadas para download:

```http
GET /reports/:id/download/pdf
GET /reports/:id/download/excel
```

## Multiempresa

- Endpoints básicos do plano Business:

```http
GET /companies
POST /companies
POST /companies/:tenantId/switch
```

## Deploy/CI

- `render.yaml` passou a buildar pelo root com `npm ci --include=dev`.
- GitHub Actions adicionado em `.github/workflows/ci.yml`.
- `PRODUCTION_NOTES.md` criado.
