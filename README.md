# NexTax — Organizador fiscal inteligente

SaaS para pequenos negócios organizarem receitas, despesas, DAS/obrigações, notas, documentos, checklist mensal, relatórios para contador e simulações educativas.

> O NexTax é uma ferramenta de organização fiscal e estimativas. Ele não substitui contador ou profissional habilitado.

## Stack

- API: Node.js, Express, TypeScript, Prisma, PostgreSQL
- Web: React, Vite, TypeScript
- Auth: JWT curto + refresh token rotacionável em cookie httpOnly
- Deploy: Render API + Vercel Web
- Storage: Supabase Storage privado para documentos fiscais

## Rodar local

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run prisma:generate
npm run dev:api
npm run dev:web
```

## Build

```bash
npm run build
```

## Produção

Leia `PRODUCTION_NOTES.md`.
