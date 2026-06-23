const apiUrl = (process.env.NEXTAX_API_URL || process.env.API_PUBLIC_URL || 'https://api.nextax.business').replace(/\/$/, '');
const webUrl = (process.env.NEXTAX_WEB_URL || process.env.WEB_ORIGIN || 'https://www.nextax.business').replace(/\/$/, '');

async function check(name, url, options = {}) {
  const started = Date.now();
  const res = await fetch(url, options);
  const text = await res.text().catch(() => '');
  const ms = Date.now() - started;
  if (!res.ok) {
    throw new Error(`${name} falhou: HTTP ${res.status} em ${url}\n${text.slice(0, 500)}`);
  }
  console.log(`✅ ${name} (${res.status}, ${ms}ms)`);
  return text;
}

await check('API health', `${apiUrl}/health`);
await check('API readiness', `${apiUrl}/health/ready`);
await check('API meta', `${apiUrl}/meta`);
await check('Termos', `${webUrl}/termos`);
await check('Privacidade', `${webUrl}/privacidade`);
await check('Aviso fiscal', `${webUrl}/aviso-fiscal`);

console.log('\nSmoke test concluído. Para fluxos privados, teste manualmente: signup, confirmação de e-mail, login, upload, checkout e webhook.');
