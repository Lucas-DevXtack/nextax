import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  ArrowLeft,
  Bell,
  Building2,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Lock,
  LogOut,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  WalletCards,
} from 'lucide-react';
import { api, backToNexCore, changePassword, deleteAccount, exchangeNexCoreToken, forgotPassword, login, logout, resendVerification, resetPassword, signup, verifyEmail } from './api';
import logo from './icons/NexTax_logo_sem_fundo.svg';
import icon from './icons/NexTax_logo.svg';
import './style.css';

type View = 'dashboard' | 'revenues' | 'expenses' | 'obligations' | 'documents' | 'checklist' | 'simulator' | 'reports' | 'plans' | 'settings';
type AuthMode = 'login' | 'signup' | 'forgot' | 'reset' | 'verify' | 'sso';
type Option = { value: string; label: string };
type Meta = Record<string, Option[]>;
type PlanCode = 'FREE' | 'STARTER' | 'PRO' | 'BUSINESS';
type AccessPayload = {
  plan: { code: PlanCode; label: string; rank: number; expiresAt?: string | null; expired?: boolean };
  canReturnToNexCore: boolean;
  pages: Record<View, boolean>;
  requiredPlanByPage: Record<View, PlanCode>;
  limits: { revenuePerMonth: number | null; expensePerMonth: number | null; documents: number };
  features: Record<string, unknown>;
  integrations: Array<{ key: string; label: string; description: string; url: string; source: 'PLAN' | 'ADDON' }>;
  blockedIntegrations: Array<{ key: string; label: string; description: string; url: string }>;
};
type MePayload = { user?: { name?: string; email?: string; origin?: string; emailVerifiedAt?: string | null }; tenant?: { name?: string; plan?: PlanCode; planExpiresAt?: string | null }; access?: AccessPayload };
type BillingCatalog = {
  checkoutConfigured: boolean;
  currentPlan: { code: PlanCode; label: string; expiresAt?: string | null; expired?: boolean };
  plans: Array<{ code: Exclude<PlanCode, 'FREE'>; label: string; price: number; amountCents: number; currency: string; current: boolean; upgradeAvailable: boolean; renewalAvailable?: boolean }>;
  addons: Array<{ key: string; label: string; description: string; price: number; amountCents: number; currency: string; enabled: boolean; includedInCurrentPlan: boolean }>;
};
type BillingCheckout = { id: string; itemType: 'PLAN' | 'INTEGRATION_ADDON'; targetPlan?: PlanCode | null; integrationKey?: string | null; status: string; amountCents: number; currency: string; paidAt?: string | null; periodEnd?: string | null; createdAt: string };

const fallbackMeta: Meta = {
  paymentMethods: [
    { value: 'PIX', label: 'Pix' },
    { value: 'CASH', label: 'Dinheiro' },
    { value: 'CARD', label: 'Cartão' },
    { value: 'BOLETO', label: 'Boleto' },
    { value: 'TRANSFER', label: 'Transferência' },
    { value: 'OTHER', label: 'Outro' },
  ],
  revenueCategories: [
    { value: 'SERVICE', label: 'Serviço' },
    { value: 'PRODUCT', label: 'Produto' },
    { value: 'RECURRING', label: 'Recorrente' },
    { value: 'OCCASIONAL', label: 'Avulso' },
    { value: 'OTHER', label: 'Outro' },
  ],
  expenseCategories: [
    { value: 'RENT', label: 'Aluguel' },
    { value: 'ENERGY', label: 'Energia' },
    { value: 'INTERNET', label: 'Internet' },
    { value: 'ACCOUNTANT', label: 'Contador' },
    { value: 'SUPPLIER', label: 'Fornecedor' },
    { value: 'TRANSPORT', label: 'Transporte' },
    { value: 'MARKETING', label: 'Marketing' },
    { value: 'SOFTWARE', label: 'Software' },
    { value: 'CARD_MACHINE', label: 'Maquininha' },
    { value: 'WORK_MATERIAL', label: 'Material de trabalho' },
    { value: 'MAINTENANCE', label: 'Manutenção' },
    { value: 'FOOD', label: 'Alimentação' },
    { value: 'OTHER', label: 'Outro' },
  ],
  obligationTypes: [
    { value: 'DAS_MEI', label: 'DAS MEI' },
    { value: 'DAS_SIMPLES', label: 'DAS Simples Nacional' },
    { value: 'MUNICIPAL_GUIDE', label: 'Guia municipal' },
    { value: 'CUSTOM_TAX', label: 'Imposto personalizado' },
    { value: 'OTHER', label: 'Outro' },
  ],
  obligationStatuses: [
    { value: 'PENDING', label: 'Pendente' },
    { value: 'PAID', label: 'Pago' },
    { value: 'OVERDUE', label: 'Atrasado' },
    { value: 'IGNORED', label: 'Ignorado' },
    { value: 'REVIEWING', label: 'Em revisão' },
  ],
  documentTypes: [
    { value: 'DAS', label: 'DAS' },
    { value: 'INVOICE', label: 'Nota fiscal' },
    { value: 'RECEIPT', label: 'Recibo' },
    { value: 'STATEMENT', label: 'Extrato' },
    { value: 'CONTRACT', label: 'Contrato' },
    { value: 'COMPANY_DOCUMENT', label: 'Documento da empresa' },
    { value: 'PERSONAL_DOCUMENT', label: 'Documento pessoal' },
    { value: 'REPORT', label: 'Relatório' },
    { value: 'OTHER', label: 'Outro' },
  ],
  documentStatuses: [
    { value: 'PENDING', label: 'Pendente' },
    { value: 'REVIEWED', label: 'Revisado' },
    { value: 'SENT_TO_ACCOUNTANT', label: 'Enviado ao contador' },
    { value: 'APPROVED', label: 'Aprovado' },
    { value: 'REJECTED', label: 'Rejeitado' },
    { value: 'NEEDS_FIX', label: 'Precisa corrigir' },
  ],
  taxRegimes: [
    { value: 'MEI', label: 'MEI' },
    { value: 'SIMPLES_NACIONAL', label: 'Simples Nacional' },
    { value: 'AUTONOMO', label: 'Autônomo' },
    { value: 'UNKNOWN', label: 'Ainda não definido' },
    { value: 'OTHER', label: 'Outro' },
  ],
  businessTypes: [
    { value: 'SERVICE', label: 'Serviço' },
    { value: 'COMMERCE', label: 'Comércio' },
    { value: 'INDUSTRY', label: 'Indústria' },
    { value: 'SERVICE_AND_COMMERCE', label: 'Serviço e comércio' },
    { value: 'OTHER', label: 'Outro' },
  ],
};

function money(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateBR(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function fileSizeBR(value?: number) {
  if (!value) return 'Sem tamanho';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',').pop() || '' : result);
    };
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

function mimeTypeForFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const fallback: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    xml: 'application/xml',
    csv: 'text/csv',
    txt: 'text/plain',
    json: 'application/json',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };

  return file.type || (extension ? fallback[extension] : undefined) || 'application/octet-stream';
}

function optionLabel(options: Option[] | undefined, value: string) {
  return options?.find((option) => option.value === value)?.label ?? value;
}

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : 'Erro inesperado';
}

function getInitialAuthMode(): AuthMode {
  if (location.pathname === '/reset-password') return 'reset';
  if (location.pathname === '/verify-email') return 'verify';
  if (location.pathname === '/auth/nexcore') return 'sso';
  return 'login';
}

function TextInput({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="field"><span>{label}</span><input {...props} /></label>;
}

function SelectInput({ label, options, value, onChange }: { label: string; options: Option[]; value: string; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function Notice({ type = 'info', children }: { type?: 'info' | 'error' | 'success' | 'warning'; children: React.ReactNode }) {
  return <div className={`notice ${type}`}>{children}</div>;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty"><FolderOpen size={28} /><strong>{title}</strong><span>{description}</span></div>;
}

function LoadingState({ label = 'Carregando dados...' }: { label?: string }) {
  return <div className="loading"><RefreshCw size={18} className="spin" />{label}</div>;
}

function useMeta() {
  const [meta, setMeta] = useState<Meta>(fallbackMeta);

  useEffect(() => {
    api('/meta').then((data) => setMeta({ ...fallbackMeta, ...data })).catch(() => null);
  }, []);

  return meta;
}

function Auth({ onAuth }: { onAuth: () => void }) {
  const [mode, setMode] = useState<AuthMode>(getInitialAuthMode());
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(mode === 'sso');

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
    setMessage('');
  };

  useEffect(() => {
    if (mode !== 'sso') return;

    const params = new URLSearchParams(location.search);
    const token = params.get('token');
    const app = params.get('app') || 'nextax';

    if (!token) {
      setError('Token SSO ausente. Volte pelo painel NexCore.');
      setLoading(false);
      return;
    }

    setLoading(true);
    exchangeNexCoreToken(token, app)
      .then(() => {
        window.history.replaceState({}, '', '/');
        onAuth();
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [mode, onAuth]);

  useEffect(() => {
    if (mode !== 'verify') return;

    const token = new URLSearchParams(location.search).get('token') || '';
    if (!token) {
      setError('Token de verificação ausente. Peça um novo link pelo formulário de login.');
      setLoading(false);
      return;
    }

    setLoading(true);
    verifyEmail(token)
      .then((data) => {
        setMessage(data?.message || 'E-mail confirmado. Faça login novamente para atualizar sua sessão.');
        window.history.replaceState({}, '', '/');
      })
      .catch((err) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [mode]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
      if (mode === 'signup') {
        const data = await signup(name, email, password);
        setMessage(data?.verifyUrl ? `Conta criada. Link de desenvolvimento: ${data.verifyUrl}` : data?.message || 'Conta criada. Confirme seu e-mail antes de entrar.');
        setMode('login');
      } else if (mode === 'forgot') {
        const data = await forgotPassword(email);
        setMessage(data.resetUrl ? `Link de desenvolvimento: ${data.resetUrl}` : data.message);
      } else if (mode === 'reset') {
        const token = new URLSearchParams(location.search).get('token') || '';
        await resetPassword(token, password);
        setMessage('Senha redefinida. Faça login novamente.');
        window.history.replaceState({}, '', '/');
        setMode('login');
      } else {
        await login(email, password);
        onAuth();
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (mode === 'sso') {
    return <main className="auth auth-sso">
      <section className="nex-auth-card sso-card">
        <img src={icon} alt="NexTax" className="auth-logo" />
        <span className="login-badge">LOGIN INTEGRADO</span>
        <h1>Conectando sua conta NexCore ao NexTax</h1>
        <p>{loading ? 'Validando token seguro e preparando seu acesso.' : error || 'Não foi possível concluir o acesso integrado.'}</p>
        {loading ? <button className="validating" disabled>Validando...</button> : <button onClick={() => switchMode('login')}>Voltar ao login</button>}
      </section>
    </main>;
  }

  const title = mode === 'signup' ? 'Criar conta' : mode === 'forgot' ? 'Esqueci minha senha' : mode === 'reset' ? 'Redefinir senha' : mode === 'verify' ? 'Confirmar e-mail' : 'Entrar';
  const subtitle = mode === 'forgot'
    ? 'Informe seu e-mail para receber o link de redefinição.'
    : mode === 'reset'
      ? 'Crie uma senha forte para recuperar o acesso.'
      : mode === 'verify'
        ? 'Validando seu link de confirmação.'
        : 'Acesse sua central fiscal com segurança.';

  return <main className="auth">
    <section className="auth-hero">
      <span className="eyebrow"><Sparkles size={16} /> Organizador fiscal inteligente</span>
      <h1>DAS, documentos e relatórios prontos para o contador.</h1>
      <p>NexTax centraliza faturamento, despesas, obrigações, checklist mensal e simulações responsáveis para pequenos negócios.</p>
      <div className="hero-grid">
        <div><strong>Controle mensal</strong><span>Checklist, vencimentos e documentos em um só lugar.</span></div>
        <div><strong>Visão fiscal</strong><span>Limite MEI, despesas e relatórios sem planilha solta.</span></div>
      </div>
    </section>

    <section className="nex-auth-card">
      <img src={icon} alt="NexTax" className="auth-logo" />
      <span className="login-badge">ACESSO SEGURO</span>
      <h2>{title}</h2>
      <p>{subtitle}</p>
      {mode !== 'verify' && <form onSubmit={submit}>
        {mode === 'signup' && <TextInput required label="Nome" placeholder="Seu nome" value={name} onChange={(event) => setName(event.target.value)} />}
        {mode !== 'reset' && <TextInput required label="E-mail" placeholder="voce@email.com" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />}
        {mode !== 'forgot' && <TextInput required label="Senha" placeholder="Mín. 8, maiúscula e número" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />}
        <button disabled={loading}>{loading ? 'Processando...' : title}</button>
      </form>}
      {error && <Notice type="error">{error}</Notice>}
      {message && <Notice type="success">{message}</Notice>}
      <div className="auth-links">
        {mode !== 'verify' && <button className="link" type="button" onClick={() => switchMode(mode === 'signup' ? 'login' : 'signup')}>{mode === 'signup' ? 'Já tenho conta' : 'Criar conta'}</button>}
        {mode !== 'forgot' && mode !== 'reset' && <button className="link" type="button" onClick={() => switchMode('forgot')}>Esqueci a senha</button>}
        {mode === 'login' && <button className="link" type="button" onClick={async () => { setError(''); setMessage(''); if (!email.trim()) { setError('Informe seu e-mail para reenviar a confirmação.'); return; } try { const data = await resendVerification(email); setMessage(data?.verifyUrl ? `Link de desenvolvimento: ${data.verifyUrl}` : data?.message || 'Se o e-mail existir, enviaremos um novo link.'); } catch (err) { setError(getErrorMessage(err)); } }}>Reenviar confirmação</button>}
        {(mode === 'forgot' || mode === 'reset' || mode === 'verify') && <button className="link" type="button" onClick={() => switchMode('login')}>Voltar ao login</button>}
      </div>
      <small className="legal">O NexTax organiza dados e estimativas. Não substitui contador. <a href="/termos">Termos</a> · <a href="/privacidade">Privacidade</a> · <a href="/aviso-fiscal">Aviso fiscal</a></small>
    </section>
  </main>;
}

const planLabels: Record<PlanCode, string> = { FREE: 'Free', STARTER: 'Starter', PRO: 'Pro', BUSINESS: 'Business' };

const viewLabels: Record<View, string> = {
  dashboard: 'Dashboard',
  revenues: 'Faturamento',
  expenses: 'Despesas',
  obligations: 'DAS e obrigações',
  documents: 'Documentos',
  checklist: 'Checklist',
  simulator: 'Simulador',
  reports: 'Relatórios',
  plans: 'Planos e integrações',
  settings: 'Configurações',
};

const fallbackRequiredPlan: Record<View, PlanCode> = {
  dashboard: 'FREE',
  revenues: 'FREE',
  expenses: 'FREE',
  obligations: 'STARTER',
  documents: 'STARTER',
  checklist: 'FREE',
  simulator: 'FREE',
  reports: 'STARTER',
  plans: 'FREE',
  settings: 'FREE',
};

function canAccessView(access: AccessPayload | undefined, view: View) {
  if (view === 'plans') return true;
  if (!access) return view === 'dashboard' || view === 'settings';
  return Boolean(access.pages?.[view]);
}

async function safeBackToNexCore(setError?: (value: string) => void) {
  try {
    await backToNexCore();
  } catch (err) {
    const message = getErrorMessage(err);
    if (setError) setError(message);
    else alert(message);
  }
}

function Header({ setAuthed, me }: { setAuthed: (value: boolean) => void; me: MePayload | null }) {
  const integrations = me?.access?.integrations ?? [];
  const [error, setError] = useState('');

  return <header>
    <div className="brand-row brand-logo-only"><img src={logo} alt="NexTax" /></div>
    <div className="header-actions">
      {me?.access?.plan && <span className="plan-pill">{me.access.plan.label}</span>}
      {me?.user && !me.user.emailVerifiedAt && <span className="plan-pill warning">E-mail não confirmado</span>}
      {integrations.map((integration) => <a className="integration-button" key={integration.key} href={integration.url}>{integration.label}</a>)}
      {me?.user?.name && <span className="user-pill">{me.user.name}</span>}
      {me?.access?.canReturnToNexCore && <button className="secondary" onClick={() => safeBackToNexCore(setError)}><ArrowLeft size={16} /> NexCore</button>}
      <button onClick={async () => { await logout(); setAuthed(false); }}><LogOut size={16} />Sair</button>
      {error && <span className="header-error">{error}</span>}
    </div>
  </header>;
}

const nav: [View, any, string][] = [
  ['dashboard', LayoutDashboard, 'Dashboard'],
  ['revenues', WalletCards, 'Faturamento'],
  ['expenses', ReceiptText, 'Despesas'],
  ['obligations', Bell, 'DAS e obrigações'],
  ['documents', Upload, 'Documentos'],
  ['checklist', ShieldCheck, 'Checklist'],
  ['simulator', Calculator, 'Simulador'],
  ['reports', FileText, 'Relatórios'],
  ['plans', Sparkles, 'Planos e integrações'],
  ['settings', Building2, 'Configurações'],
];

function Shell({ setAuthed }: { setAuthed: (value: boolean) => void }) {
  const [view, setView] = useState<View>('dashboard');
  const [me, setMe] = useState<MePayload | null>(null);
  const [billingNotice, setBillingNotice] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

  const loadMe = useCallback(async () => {
    const data = await api('/auth/me');
    setMe(data);
    return data;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const paymentId = params.get('payment_id') || params.get('collection_id');
    const billing = params.get('billing');

    async function boot() {
      try {
        if (paymentId) {
          const result = await api('/billing/mercadopago/confirm', { method: 'POST', body: JSON.stringify({ paymentId }) });
          if (result?.access) setMe((prev) => (prev ? { ...prev, access: result.access } : prev));
          setBillingNotice({ type: 'success', message: 'Pagamento confirmado. Recursos liberados conforme o plano ou add-on comprado.' });
        } else if (billing === 'pending') {
          setBillingNotice({ type: 'warning', message: 'Pagamento pendente. Assim que o Mercado Pago aprovar, o NexTax libera automaticamente.' });
        } else if (billing === 'failure') {
          setBillingNotice({ type: 'error', message: 'Pagamento não aprovado. Nenhum recurso foi liberado.' });
        }
      } catch (err) {
        setBillingNotice({ type: 'error', message: getErrorMessage(err) });
      } finally {
        if (billing || paymentId) window.history.replaceState({}, '', '/');
        await loadMe().catch(() => null);
      }
    }

    boot();
  }, [loadMe]);

  return <div>
    <Header setAuthed={setAuthed} me={me} />
    <div className="app">
      <aside>{nav.map(([id, Icon, label]) => {
        const locked = !canAccessView(me?.access, id);
        return <button key={id} className={`${view === id ? 'active' : ''} ${locked ? 'locked' : ''}`} onClick={() => setView(id)}><Icon size={17} />{label}{locked && <Lock size={14} />}</button>;
      })}</aside>
      <section className="content">{billingNotice && <Notice type={billingNotice.type}>{billingNotice.message}</Notice>}{me?.user && !me.user.emailVerifiedAt && <Notice type="warning">Confirme seu e-mail para liberar checkout, upload/download de documentos e geração de relatórios. Reenvie o link em Configurações.</Notice>}<Page view={view} me={me} setAuthed={setAuthed} reloadMe={loadMe} /></section>
    </div>
  </div>;
}

function UpgradeScreen({ view, access }: { view: View; access?: AccessPayload }) {
  const required = access?.requiredPlanByPage?.[view] ?? fallbackRequiredPlan[view];
  const current = access?.plan?.label ?? 'Free';
  const [error, setError] = useState('');

  return <section className="upgrade-panel">
    <Lock size={34} />
    <span className="eyebrow">Upgrade necessário</span>
    <h1>{viewLabels[view]} bloqueado no plano {current}</h1>
    <p>Essa página faz parte do plano {planLabels[required]}. O backend também bloqueia a API, então não adianta esconder só no frontend.</p>
    {error && <Notice type="error">{error}</Notice>}
    {access?.canReturnToNexCore
      ? <button onClick={() => safeBackToNexCore(setError)}><ArrowLeft size={16} />Voltar ao NexCore para ajustar plano</button>
      : <button onClick={() => { location.href = import.meta.env.VITE_NEXCORE_APP_URL || 'https://www.nexcore.business/app'; }}>Ver planos no NexCore</button>}
  </section>;
}

function Page({ view, me, setAuthed, reloadMe }: { view: View; me: MePayload | null; setAuthed: (value: boolean) => void; reloadMe: () => Promise<MePayload> }) {
  const meta = useMeta();

  if (view === 'plans') return <PlansIntegrations access={me?.access} />;

  if (!canAccessView(me?.access, view)) return <UpgradeScreen view={view} access={me?.access} />;

  if (view === 'dashboard') return <Dashboard meta={meta} />;
  if (view === 'revenues') return <FinancialCrud meta={meta} kind="revenue" access={me?.access} />;
  if (view === 'expenses') return <FinancialCrud meta={meta} kind="expense" access={me?.access} />;
  if (view === 'obligations') return <Obligations meta={meta} />;
  if (view === 'documents') return <Documents meta={meta} access={me?.access} />;
  if (view === 'checklist') return <Checklist />;
  if (view === 'simulator') return <Simulator access={me?.access} />;
  if (view === 'reports') return <Reports access={me?.access} />;
  return <Settings meta={meta} access={me?.access} me={me} setAuthed={setAuthed} reloadMe={reloadMe} />;
}

function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-title"><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>;
}

function MetricCard({ title, value, tone, icon: Icon }: { title: string; value: React.ReactNode; tone?: 'good' | 'danger' | 'warn'; icon?: any }) {
  return <div className={`metric ${tone ?? ''}`}>{Icon && <Icon size={20} />}<span>{title}</span><strong>{value}</strong></div>;
}



type LocalPlanCard = {
  code: PlanCode;
  title: string;
  subtitle: string;
  bestFor: string;
  limits: string[];
  features: string[];
  integrations: string[];
  recommended?: boolean;
};

const planRank: Record<PlanCode, number> = { FREE: 0, STARTER: 1, PRO: 2, BUSINESS: 3 };

const localPlanCatalog: LocalPlanCard[] = [
  {
    code: 'FREE',
    title: 'Free',
    subtitle: 'Demonstra o valor sem entregar a rotina fiscal completa.',
    bestFor: 'Curioso, MEI começando ou teste interno.',
    limits: ['20 faturamentos/mês', '10 despesas/mês', '0 documentos', 'Sem DAS/obrigações', 'Sem relatórios'],
    features: ['Dashboard básico', 'Faturamento limitado', 'Despesas limitadas', 'Checklist apenas visual', 'Simulador MEI simples'],
    integrations: ['Nenhuma integração inclusa'],
  },
  {
    code: 'STARTER',
    title: 'Starter',
    subtitle: 'Plano de entrada para MEI que precisa parar de perder vencimento e comprovante.',
    bestFor: 'MEI ativo, autônomo e micro negócio simples.',
    limits: ['300 faturamentos/mês', '300 despesas/mês', '50 documentos', 'DAS básico', 'Relatório mensal simples'],
    features: ['Dashboard completo MEI', 'Obrigações fiscais', 'Upload de documentos', 'Checklist básico', 'Integração NexFinance'],
    integrations: ['NexFinance'],
  },
  {
    code: 'PRO',
    title: 'Pro',
    subtitle: 'Plano principal: mais volume, checklist automático e simulação fiscal mais forte.',
    bestFor: 'MEI forte, ME pequena e negócio com rotina fiscal real.',
    limits: ['Faturamentos ilimitados', 'Despesas ilimitadas', '500 documentos', 'Relatório mensal detalhado', 'Preparado para contador'],
    features: ['Checklist automático', 'Simulador MEI x Simples', 'Relatórios detalhados no painel', 'Organização para contador', 'Integrações NexFinance + NexStock'],
    integrations: ['NexFinance', 'NexStock'],
    recommended: true,
  },
  {
    code: 'BUSINESS',
    title: 'Business',
    subtitle: 'Camada de maior limite e ecossistema completo. Recursos de equipe avançada entram em roadmap.' ,
    bestFor: 'Empresa maior ou cliente usando o ecossistema todo.' ,
    limits: ['Faturamentos ilimitados', 'Despesas ilimitadas', '5.000 documentos', 'Maior limite operacional', 'Suporte a rotina com contador'],
    features: ['Permissões básicas por papel', 'Checklist automático', 'Relatórios detalhados', 'Maior limite de documentos', 'Todas as integrações'],
    integrations: ['NexFinance', 'NexStock', 'NexCRM'],
  },
];

const integrationRequiredPlan: Record<string, PlanCode> = {
  NEXFINANCE: 'STARTER',
  NEXSTOCK: 'PRO',
  NEXCRM: 'BUSINESS',
};

const localIntegrations = [
  { key: 'NEXFINANCE', label: 'NexFinance', description: 'Receitas, despesas e fluxo financeiro puxados para o fiscal.', url: import.meta.env.VITE_NEXFINANCE_APP_URL || 'https://www.nexfinance.business' },
  { key: 'NEXSTOCK', label: 'NexStock', description: 'Vendas, estoque e movimentações ajudando no fechamento fiscal.', url: import.meta.env.VITE_NEXSTOCK_APP_URL || 'https://www.nexstock.business' },
  { key: 'NEXCRM', label: 'NexCRM', description: 'Clientes, histórico comercial e origem de receitas do ecossistema.', url: import.meta.env.VITE_NEXCRM_APP_URL || 'https://www.nexcrm.business' },
];

function planAllows(plan: PlanCode, view: View) {
  if (view === 'plans') return true;
  return planRank[plan] >= planRank[fallbackRequiredPlan[view]];
}

function limitText(value: number | null | undefined, suffix = '') {
  if (value === null) return 'Ilimitado';
  if (value === undefined) return '-';
  return `${value}${suffix}`;
}

function goToNexCorePlans() {
  location.href = import.meta.env.VITE_NEXCORE_APP_URL || 'https://www.nexcore.business/app';
}

function PlansIntegrations({ access }: { access?: AccessPayload }) {
  const currentPlan = access?.plan.code ?? 'FREE';
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [billing, setBilling] = useState<BillingCatalog | null>(null);
  const [checkouts, setCheckouts] = useState<BillingCheckout[]>([]);
  const [checkoutLoading, setCheckoutLoading] = useState('');
  const enabledKeys = new Set((access?.integrations ?? []).map((integration) => integration.key));
  const integrations = localIntegrations.map((integration) => {
    const enabled = enabledKeys.has(integration.key);
    const effective = access?.integrations?.find((item) => item.key === integration.key);
    const blocked = access?.blockedIntegrations?.find((item) => item.key === integration.key);
    const offer = billing?.addons.find((addon) => addon.key === integration.key);
    return {
      ...integration,
      ...blocked,
      ...effective,
      price: offer?.price,
      enabled: enabled || Boolean(offer?.enabled),
      includedInCurrentPlan: Boolean(offer?.includedInCurrentPlan),
      requiredPlan: integrationRequiredPlan[integration.key],
    };
  });

  const loadBilling = useCallback(async () => {
    try {
      const [catalog, history] = await Promise.all([
        api('/billing/catalog'),
        api('/billing/checkouts').catch(() => []),
      ]);
      setBilling(catalog);
      setCheckouts(history);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => { loadBilling(); }, [loadBilling]);

  async function startCheckout(input: { itemType: 'PLAN'; plan: Exclude<PlanCode, 'FREE'> } | { itemType: 'INTEGRATION_ADDON'; integrationKey: string }) {
    setError('');
    setMessage('');
    const key = input.itemType === 'PLAN' ? `PLAN-${input.plan}` : `ADDON-${input.integrationKey}`;
    setCheckoutLoading(key);

    try {
      const data = await api('/billing/checkout', { method: 'POST', body: JSON.stringify(input) });
      const redirectUrl = data.initPoint || data.sandboxInitPoint;
      if (!redirectUrl) throw new Error('Mercado Pago não retornou link de checkout. Confira o access token.');
      location.href = redirectUrl;
    } catch (err) {
      setError(getErrorMessage(err));
      setCheckoutLoading('');
    }
  }

  function planOffer(code: PlanCode) {
    if (code === 'FREE') return null;
    return billing?.plans.find((plan) => plan.code === code) ?? null;
  }

  function statusLabel(status: string) {
    const map: Record<string, string> = {
      PENDING: 'Pendente',
      APPROVED: 'Aprovado',
      AUTHORIZED: 'Autorizado',
      IN_PROCESS: 'Em análise',
      REJECTED: 'Rejeitado',
      CANCELLED: 'Cancelado',
      REFUNDED: 'Reembolsado',
      CHARGED_BACK: 'Chargeback',
      ERROR: 'Erro',
    };
    return map[status] ?? status;
  }

  return <>
    <div className="title-actions">
      <PageTitle eyebrow="Acesso" title="Planos, pagamentos e integrações" description="Compre pelo Mercado Pago. Quando o pagamento é aprovado, o backend libera o plano ou add-on automaticamente." />
      {access?.canReturnToNexCore && <button className="secondary" onClick={() => safeBackToNexCore(setError)}><ArrowLeft size={16} />Voltar ao NexCore</button>}
    </div>

    {error && <Notice type="error">{error}</Notice>}
    {message && <Notice type="success">{message}</Notice>}
    {billing && !billing.checkoutConfigured && <Notice type="warning">Mercado Pago ainda não configurado na API. Coloque MERCADO_PAGO_ACCESS_TOKEN no Render para liberar o checkout.</Notice>}
    {access?.plan?.expiresAt && <Notice>Plano pago ativo até {dateBR(access.plan.expiresAt)}. Depois disso, se não houver renovação, o acesso volta ao Free.</Notice>}

    <section className="panel plan-summary-panel">
      <div className="panel-head"><h2>Conta atual</h2><span>Permissões calculadas pelo backend</span></div>
      <div className="mini-metrics">
        <span>Plano ativo: <b>{access?.plan.label ?? planLabels[currentPlan]}</b></span>
        <span>Vencimento: <b>{access?.plan.expiresAt ? dateBR(access.plan.expiresAt) : 'Sem vencimento automático'}</b></span>
        <span>Faturamento/mês: <b>{limitText(access?.limits.revenuePerMonth)}</b></span>
        <span>Despesas/mês: <b>{limitText(access?.limits.expensePerMonth)}</b></span>
        <span>Documentos: <b>{access?.limits.documents ?? 0}</b></span>
        <span>Voltar ao NexCore: <b>{access?.canReturnToNexCore ? 'Liberado' : 'Conta local NexTax'}</b></span>
        <span>Integrações ativas: <b>{access?.integrations.length || 0}</b></span>
      </div>
    </section>

    <section className="plans-grid">
      {localPlanCatalog.map((plan) => {
        const active = plan.code === currentPlan;
        const upgrade = planRank[plan.code] > planRank[currentPlan];
        const offer = planOffer(plan.code);
        const loadingKey = plan.code !== 'FREE' ? `PLAN-${plan.code}` : '';
        return <article className={`plan-card ${active ? 'active' : ''} ${plan.recommended ? 'recommended' : ''}`} key={plan.code}>
          <div className="plan-card-head">
            <span>{plan.recommended ? 'MAIS INDICADO' : active ? 'PLANO ATUAL' : 'PLANO'}</span>
            <h2>{plan.title}</h2>
            <p>{plan.subtitle}</p>
            {plan.code === 'FREE'
              ? <strong className="plan-price">R$ 0</strong>
              : <strong className="plan-price">{offer ? money(offer.price) : 'Preço no Render'} <small>/ 31 dias</small></strong>}
          </div>
          <div className="plan-best-for"><strong>Ideal para:</strong><span>{plan.bestFor}</span></div>
          <div className="plan-list"><strong>Limites</strong>{plan.limits.map((item) => <span key={item}><CheckCircle2 size={15} />{item}</span>)}</div>
          <div className="plan-list"><strong>Funções</strong>{plan.features.map((item) => <span key={item}><ShieldCheck size={15} />{item}</span>)}</div>
          <div className="plan-list"><strong>Integrações</strong>{plan.integrations.map((item) => <span key={item}><Sparkles size={15} />{item}</span>)}</div>
          {active && plan.code !== 'FREE'
            ? <button disabled={checkoutLoading === loadingKey} onClick={() => startCheckout({ itemType: 'PLAN', plan: plan.code as Exclude<PlanCode, 'FREE'> })}>{checkoutLoading === loadingKey ? 'Abrindo Mercado Pago...' : 'Renovar plano'}</button>
            : active
              ? <button disabled>Plano atual</button>
              : plan.code === 'FREE'
                ? <button className="secondary" disabled>Plano gratuito</button>
                : upgrade
                  ? <button disabled={checkoutLoading === loadingKey} onClick={() => startCheckout({ itemType: 'PLAN', plan: plan.code as Exclude<PlanCode, 'FREE'> })}>{checkoutLoading === loadingKey ? 'Abrindo Mercado Pago...' : 'Pagar com Mercado Pago'}</button>
                  : <button className="secondary" disabled>Downgrade manual</button>}
        </article>;
      })}
    </section>

    <section className="panel">
      <div className="panel-head"><h2>Integrações do ecossistema</h2><span>Plano libera automaticamente; add-on libera por pagamento aprovado</span></div>
      <div className="integration-cards">
        {integrations.map((integration) => {
          const loadingKey = `ADDON-${integration.key}`;
          return <article className={`integration-card ${integration.enabled ? 'enabled' : 'blocked'}`} key={integration.key}>
            <div className="integration-title">
              {integration.enabled ? <CheckCircle2 size={22} /> : <Lock size={22} />}
              <div><strong>{integration.label}</strong><span>{integration.enabled ? (integration.source === 'ADDON' || !integration.includedInCurrentPlan ? 'Liberada por add-on' : 'Inclusa no plano') : `A partir do ${planLabels[integration.requiredPlan]} ou add-on`}</span></div>
            </div>
            <p>{integration.description}</p>
            {!integration.enabled && typeof integration.price === 'number' && <strong className="addon-price">{money(integration.price)} / 31 dias</strong>}
            {integration.enabled
              ? <a className="integration-open" href={integration.url}>Abrir {integration.label}</a>
              : <button className="secondary" disabled={checkoutLoading === loadingKey} onClick={() => startCheckout({ itemType: 'INTEGRATION_ADDON', integrationKey: integration.key })}>{checkoutLoading === loadingKey ? 'Abrindo Mercado Pago...' : 'Liberar add-on'}</button>}
          </article>;
        })}
      </div>
    </section>

    <section className="panel table-panel">
      <div className="panel-head"><h2>Últimos pagamentos</h2><span>Histórico de checkouts criados no Mercado Pago</span></div>
      {!checkouts.length ? <EmptyState title="Nenhum checkout ainda" description="Clique em um plano ou add-on para criar o primeiro pagamento." /> : <table><thead><tr><th>Item</th><th>Status</th><th>Valor</th><th>Criado</th><th>Vence</th></tr></thead><tbody>{checkouts.map((item) => <tr key={item.id}>
        <td>{item.itemType === 'PLAN' ? `Plano ${planLabels[item.targetPlan || 'FREE']}` : `Add-on ${item.integrationKey}`}</td>
        <td><span className={`matrix-status ${item.status === 'APPROVED' ? 'allowed' : 'denied'}`}>{statusLabel(item.status)}</span></td>
        <td>{money(item.amountCents / 100)}</td>
        <td>{dateBR(item.createdAt)}</td>
        <td>{item.periodEnd ? dateBR(item.periodEnd) : '-'}</td>
      </tr>)}</tbody></table>}
    </section>

    <section className="panel table-panel">
      <div className="panel-head"><h2>Bloqueio por página</h2><span>Frontend bloqueia visualmente, backend bloqueia a API</span></div>
      <table className="plan-matrix"><thead><tr><th>Página/Função</th>{localPlanCatalog.map((plan) => <th key={plan.code}>{plan.title}</th>)}</tr></thead><tbody>
        {nav.filter(([id]) => id !== 'plans').map(([id, Icon, label]) => <tr key={id}>
          <td><span className="matrix-page"><Icon size={16} />{label}</span></td>
          {localPlanCatalog.map((plan) => {
            const allowed = planAllows(plan.code, id);
            return <td key={plan.code}><span className={`matrix-status ${allowed ? 'allowed' : 'denied'}`}>{allowed ? 'Liberado' : `Upgrade ${planLabels[fallbackRequiredPlan[id]]}`}</span></td>;
          })}
        </tr>)}
      </tbody></table>
    </section>
  </>;
}

function Dashboard({ meta }: { meta: Meta }) {
  const [data, setData] = useState<any>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api('/dashboard'));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <Notice type="error">{error}</Notice>;
  if (!data) return <LoadingState />;

  const maxFlow = Math.max(...data.cashFlow.flatMap((item: any) => [Math.abs(item.revenue), Math.abs(item.expense), Math.abs(item.result)]), 1);
  const nextObligation = data.upcomingObligations?.[0];

  return <>
    <div className="title-actions"><PageTitle eyebrow="Visão geral" title="Dashboard fiscal" description="O painel que mostra o que está organizado, o que está atrasado e o que precisa virar rotina." /><button className="secondary" onClick={load}><RefreshCw size={16} />Atualizar</button></div>
    <Notice>{data.disclaimer}</Notice>
    <div className="metrics">
      <MetricCard icon={WalletCards} title="Faturamento do mês" value={money(data.monthRevenue)} />
      <MetricCard icon={ReceiptText} title="Despesas do mês" value={money(data.monthExpense)} />
      <MetricCard icon={data.monthResult >= 0 ? CheckCircle2 : AlertTriangle} title="Resultado do mês" value={money(data.monthResult)} tone={data.monthResult >= 0 ? 'good' : 'danger'} />
      <MetricCard icon={AlertTriangle} title="Limite MEI usado" value={`${data.meiLimitUsed}%`} tone={data.meiLimitUsed >= 80 ? 'warn' : undefined} />
      <MetricCard icon={FolderOpen} title="Documentos pendentes" value={data.pendingDocuments} tone={data.pendingDocuments ? 'warn' : 'good'} />
      <MetricCard icon={ClipboardCheck} title="Organização fiscal" value={`${data.organizationScore}%`} tone={data.organizationScore >= 80 ? 'good' : 'warn'} />
    </div>

    <div className="dashboard-grid">
      <section className="panel">
        <div className="panel-head"><h2>Fluxo dos últimos 6 meses</h2><span>Receitas, despesas e resultado</span></div>
        <div className="flow-list">{data.cashFlow.map((item: any) => <div key={`${item.month}-${item.year}`} className="flow-row">
          <span>{item.label}</span>
          <div className="flow-bars">
            <i className="revenue" style={{ width: `${Math.max(4, (Math.abs(item.revenue) / maxFlow) * 100)}%` }} />
            <i className="expense" style={{ width: `${Math.max(4, (Math.abs(item.expense) / maxFlow) * 100)}%` }} />
          </div>
          <strong>{money(item.result)}</strong>
        </div>)}</div>
      </section>

      <section className="panel">
        <div className="panel-head"><h2>Próximas obrigações</h2><span>Não deixa virar multa</span></div>
        {!data.upcomingObligations?.length && <EmptyState title="Nada pendente" description="Sem obrigações abertas no momento." />}
        {data.upcomingObligations?.map((item: any) => <div className="obligation-item" key={item.id}>
          <div><strong>{optionLabel(meta.obligationTypes, item.type)}</strong><span>{dateBR(item.dueDate)} • {optionLabel(meta.obligationStatuses, item.status)}</span></div>
          <b>{item.amount ? money(Number(item.amount)) : 'Sem valor'}</b>
        </div>)}
        {nextObligation && <Notice type="warning">Próxima prioridade: {optionLabel(meta.obligationTypes, nextObligation.type)} vence em {dateBR(nextObligation.dueDate)}.</Notice>}
      </section>
    </div>
  </>;
}

function FinancialCrud({ kind, meta, access }: { kind: 'revenue' | 'expense'; meta: Meta; access?: AccessPayload }) {
  const isRevenue = kind === 'revenue';
  const path = isRevenue ? '/revenues' : '/expenses';
  const dateField = isRevenue ? 'receivedAt' : 'paidAt';
  const title = isRevenue ? 'Faturamento' : 'Despesas';
  const description = isRevenue ? 'Registre entradas por serviço, produto ou recorrência.' : 'Registre custos fixos e variáveis sem misturar com faturamento.';
  const categoryOptions = isRevenue ? meta.revenueCategories : meta.expenseCategories;
  const monthlyLimit = isRevenue ? access?.limits?.revenuePerMonth : access?.limits?.expensePerMonth;
  const [list, setList] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const initialForm = useMemo(() => ({ description: '', amount: '', [dateField]: today(), category: isRevenue ? 'SERVICE' : 'OTHER', paymentMethod: 'PIX', customerName: '', supplierName: '', hasInvoice: false, isRecurring: false, notes: '' }), [dateField, isRevenue]);
  const [form, setForm] = useState<Record<string, any>>(initialForm);

  const load = useCallback(async () => {
    setError('');
    try {
      setList(await api(path));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [path]);

  useEffect(() => { load(); }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');

    const payload: Record<string, any> = {
      description: form.description,
      amount: Number(form.amount),
      [dateField]: form[dateField],
      category: form.category,
      paymentMethod: form.paymentMethod,
      notes: form.notes || undefined,
    };

    if (isRevenue) {
      payload.customerName = form.customerName || undefined;
      payload.hasInvoice = Boolean(form.hasInvoice);
    } else {
      payload.supplierName = form.supplierName || undefined;
      payload.isRecurring = Boolean(form.isRecurring);
    }

    try {
      await api(path, { method: 'POST', body: JSON.stringify(payload) });
      setForm(initialForm);
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Remover este registro?')) return;
    await api(`${path}/${id}`, { method: 'DELETE' });
    await load();
  }

  return <>
    <PageTitle eyebrow={isRevenue ? 'Entradas' : 'Saídas'} title={title} description={description} />
    {typeof monthlyLimit === 'number' && <Notice>Seu plano {access?.plan?.label} permite até {monthlyLimit} registros por mês nesta tela.</Notice>}
    {error && <Notice type="error">{error}</Notice>}
    <form className="panel form-grid" onSubmit={save}>
      <TextInput required label="Descrição" placeholder={isRevenue ? 'Venda, serviço, mensalidade...' : 'Aluguel, fornecedor, software...'} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
      <TextInput required label="Valor" type="number" min="0" step="0.01" placeholder="0,00" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
      <TextInput required label="Data" type="date" value={form[dateField]} onChange={(event) => setForm({ ...form, [dateField]: event.target.value })} />
      <SelectInput label="Categoria" options={categoryOptions} value={form.category} onChange={(value) => setForm({ ...form, category: value })} />
      <SelectInput label="Pagamento" options={meta.paymentMethods} value={form.paymentMethod} onChange={(value) => setForm({ ...form, paymentMethod: value })} />
      {isRevenue ? <TextInput label="Cliente" placeholder="Opcional" value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} /> : <TextInput label="Fornecedor" placeholder="Opcional" value={form.supplierName} onChange={(event) => setForm({ ...form, supplierName: event.target.value })} />}
      <label className="check compact"><input type="checkbox" checked={isRevenue ? form.hasInvoice : form.isRecurring} onChange={(event) => setForm({ ...form, [isRevenue ? 'hasInvoice' : 'isRecurring']: event.target.checked })} />{isRevenue ? 'Tem nota fiscal' : 'Despesa recorrente'}</label>
      <button disabled={saving}><Plus size={16} />{saving ? 'Salvando...' : 'Adicionar'}</button>
    </form>

    <section className="panel table-panel">
      {!list.length ? <EmptyState title="Nenhum registro" description="Cadastre o primeiro item para o dashboard começar a ficar útil." /> : <table><thead><tr><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Data</th><th></th></tr></thead><tbody>{list.map((item) => <tr key={item.id}><td>{item.description}</td><td>{optionLabel(categoryOptions, item.category)}</td><td>{money(Number(item.amount))}</td><td>{dateBR(item[dateField])}</td><td><button className="danger ghost" onClick={() => remove(item.id)}><Trash2 size={15} /></button></td></tr>)}</tbody></table>}
    </section>
  </>;
}

function Obligations({ meta }: { meta: Meta }) {
  const current = new Date();
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({ type: 'DAS_MEI', competenceMonth: current.getMonth() + 1, competenceYear: current.getFullYear(), dueDate: today(), amount: '', notes: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setList(await api('/tax-obligations'));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await api('/tax-obligations', { method: 'POST', body: JSON.stringify({ ...form, amount: form.amount ? Number(form.amount) : undefined }) });
      setForm({ ...form, amount: '', notes: '' });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function markPaid(item: any) {
    await api(`/tax-obligations/${item.id}/mark-paid`, { method: 'POST', body: JSON.stringify({ amount: item.amount ? Number(item.amount) : undefined }) });
    await load();
  }

  async function remove(id: string) {
    if (!confirm('Remover esta obrigação?')) return;
    await api(`/tax-obligations/${id}`, { method: 'DELETE' });
    await load();
  }

  return <>
    <PageTitle eyebrow="Vencimentos" title="DAS e obrigações" description="Cadastre guias, impostos e lembretes fiscais. Aqui o atraso fica visível antes de virar problema." />
    {error && <Notice type="error">{error}</Notice>}
    <form className="panel form-grid" onSubmit={create}>
      <SelectInput label="Tipo" options={meta.obligationTypes} value={form.type} onChange={(value) => setForm({ ...form, type: value })} />
      <TextInput required label="Mês" type="number" min="1" max="12" value={form.competenceMonth} onChange={(event) => setForm({ ...form, competenceMonth: Number(event.target.value) })} />
      <TextInput required label="Ano" type="number" min="2020" value={form.competenceYear} onChange={(event) => setForm({ ...form, competenceYear: Number(event.target.value) })} />
      <TextInput required label="Vencimento" type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
      <TextInput label="Valor" type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
      <button><Plus size={16} />Criar obrigação</button>
    </form>
    <section className="panel table-panel">
      {!list.length ? <EmptyState title="Sem obrigações" description="Cadastre DAS, guias municipais e impostos para acompanhar os vencimentos." /> : <table><thead><tr><th>Tipo</th><th>Competência</th><th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody>{list.map((item) => <tr key={item.id}><td>{optionLabel(meta.obligationTypes, item.type)}</td><td>{item.competenceMonth}/{item.competenceYear}</td><td>{dateBR(item.dueDate)}</td><td>{item.amount ? money(Number(item.amount)) : '-'}</td><td><span className={`status ${item.status.toLowerCase()}`}>{optionLabel(meta.obligationStatuses, item.status)}</span></td><td className="row-actions"><button className="ghost" disabled={item.status === 'PAID'} onClick={() => markPaid(item)}>Pago</button><button className="danger ghost" onClick={() => remove(item.id)}><Trash2 size={15} /></button></td></tr>)}</tbody></table>}
    </section>
  </>;
}

function Documents({ meta, access }: { meta: Meta; access?: AccessPayload }) {
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({ name: '', type: 'OTHER', competenceMonth: '', competenceYear: new Date().getFullYear(), tags: '' });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      setList(await api('/documents'));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError('');

    if (!selectedFile) {
      setError('Selecione um arquivo para enviar ao Supabase Storage.');
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      setError('Arquivo maior que 10 MB. Comprima ou envie um arquivo menor.');
      return;
    }

    const tags = form.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
    setSaving(true);

    try {
      const base64 = await fileToBase64(selectedFile);
      await api('/documents', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          competenceMonth: form.competenceMonth ? Number(form.competenceMonth) : undefined,
          competenceYear: form.competenceYear ? Number(form.competenceYear) : undefined,
          tags,
          file: {
            originalName: selectedFile.name,
            mimeType: mimeTypeForFile(selectedFile),
            size: selectedFile.size,
            base64,
          },
        }),
      });

      setForm({ ...form, name: '', tags: '' });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(id: string, status: string) {
    try {
      setError('');
      await api(`/documents/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function openDocument(id: string) {
    try {
      setError('');
      const data = await api(`/documents/${id}/download`);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function remove(id: string) {
    if (!confirm('Arquivar/remover este documento?')) return;

    try {
      setError('');
      await api(`/documents/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return <>
    <PageTitle eyebrow="Arquivos" title="Documentos fiscais" description="Envie notas, recibos, DAS, extratos e comprovantes para o Supabase Storage privado." />
    <Notice>Os arquivos ficam no Supabase Storage privado. O NexTax abre documentos usando URL assinada temporária, sem expor o bucket ao público.</Notice>
    {access?.limits?.documents ? <Notice>Limite do plano {access.plan.label}: {access.limits.documents} documentos ativos.</Notice> : null}
    {error && <Notice type="error">{error}</Notice>}
    <form className="panel form-grid document-upload-form" onSubmit={create}>
      <TextInput required label="Nome do documento" placeholder="Ex.: DAS Junho" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      <SelectInput label="Tipo" options={meta.documentTypes} value={form.type} onChange={(value) => setForm({ ...form, type: value })} />
      <TextInput label="Mês" type="number" min="1" max="12" value={form.competenceMonth} onChange={(event) => setForm({ ...form, competenceMonth: event.target.value })} />
      <TextInput label="Ano" type="number" min="2020" value={form.competenceYear} onChange={(event) => setForm({ ...form, competenceYear: Number(event.target.value) })} />
      <TextInput label="Tags" placeholder="contador, junho, das" value={form.tags} onChange={(event) => setForm({ ...form, tags: event.target.value })} />
      <label className="field file-field"><span>Arquivo</span><input ref={fileInputRef} required type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.xml,.csv,.txt,.json,.xls,.xlsx,application/pdf,image/png,image/jpeg,image/webp,application/xml,text/xml,text/csv,text/plain,application/json" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} />{selectedFile && <small>{selectedFile.name} • {fileSizeBR(selectedFile.size)}</small>}</label>
      <button disabled={saving}><Upload size={16} />{saving ? 'Enviando...' : 'Enviar documento'}</button>
    </form>
    <div className="document-grid">
      {!list.length && <EmptyState title="Nenhum documento" description="Envie pelo menos os comprovantes principais do mês." />}
      {list.map((document) => <article className="doc-card" key={document.id}>
        <div><FileText size={20} /><strong>{document.name}</strong></div>
        <span>{optionLabel(meta.documentTypes, document.type)} • {document.competenceMonth ? `${document.competenceMonth}/${document.competenceYear}` : 'Sem competência'}</span>
        <span>{document.mimeType ? `${document.mimeType} • ${fileSizeBR(document.size)}` : 'Arquivo externo'}</span>
        {(document.fileKey || document.fileUrl) && <button className="secondary" onClick={() => openDocument(document.id)}>Abrir arquivo</button>}
        <SelectInput label="Status" options={meta.documentStatuses} value={document.status} onChange={(value) => updateStatus(document.id, value)} />
        <button className="danger ghost" onClick={() => remove(document.id)}><Trash2 size={15} />Remover</button>
      </article>)}
    </div>
  </>;
}

function Checklist() {
  const [data, setData] = useState<any>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await api('/checklists/current'));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <Notice type="error">{error}</Notice>;
  if (!data) return <LoadingState />;

  const done = data.done ?? data.items.filter((item: any) => item.status === 'DONE').length;
  const total = data.total ?? data.items.length;
  const progress = data.progress ?? (total ? Math.round((done / total) * 100) : 0);

  return <>
    <PageTitle eyebrow="Rotina" title="Checklist mensal automático" description="Aqui não tem marcação manual. O NexTax conclui cada item quando a ação real é feita na tela correspondente." />
    <Notice>{data.message ?? 'Checklist calculado automaticamente com base nas ações feitas no sistema.'}</Notice>
    <section className="panel checklist-panel">
      <div className="panel-head">
        <h2>{progress}% concluído</h2>
        <span>{done} de {total} tarefas feitas automaticamente</span>
      </div>
      <div className="progress"><i style={{ width: `${progress}%` }} /></div>
      <div className="checklist-grid">
        {data.items.map((item: any) => {
          const isDone = item.status === 'DONE';
          return <article className={`check auto-check ${isDone ? 'done' : 'pending'}`} key={item.id}>
            <div className="check-icon">{isDone ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}</div>
            <div className="check-content">
              <strong>{item.title}</strong>
              <span>{item.description}</span>
              {item.completedAt && <small>Atualizado em {new Date(item.completedAt).toLocaleDateString('pt-BR')}</small>}
            </div>
            <span className={`status ${isDone ? 'paid' : 'reviewing'}`}>{isDone ? 'Automático' : 'Pendente'}</span>
          </article>;
        })}
      </div>
      <button className="secondary" onClick={load}><RefreshCw size={16} />Atualizar checklist</button>
    </section>
  </>;
}

function Simulator({ access }: { access?: AccessPayload }) {
  const [monthlyRevenue, setMonthlyRevenue] = useState(6200);
  const [currentAnnualRevenue, setCurrentAnnualRevenue] = useState(0);
  const [employees, setEmployees] = useState(0);
  const [result, setResult] = useState<any>();
  const [error, setError] = useState('');

  async function simulate(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      setResult(await api('/simulators/mei-vs-simples', { method: 'POST', body: JSON.stringify({ monthlyRevenue, currentAnnualRevenue, employees }) }));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return <>
    <PageTitle eyebrow="Projeção" title="Simulador MEI x Simples" description="Simulação educativa para acender alerta cedo. Não é cálculo oficial e não substitui contador." />
    {error && <Notice type="error">{error}</Notice>}
    <form className="panel form-grid" onSubmit={simulate}>
      <TextInput label="Faturamento médio mensal" type="number" min="0" step="0.01" value={monthlyRevenue} onChange={(event) => setMonthlyRevenue(Number(event.target.value))} />
      <TextInput label="Faturamento acumulado no ano" type="number" min="0" step="0.01" value={currentAnnualRevenue} onChange={(event) => setCurrentAnnualRevenue(Number(event.target.value))} />
      <TextInput label="Funcionários" type="number" min="0" value={employees} onChange={(event) => setEmployees(Number(event.target.value))} />
      <button><Calculator size={16} />Simular</button>
    </form>
    {access?.features?.simulator === 'basic' && <Notice>Plano Free mostra a simulação básica. Comparação completa MEI x Simples fica no Pro.</Notice>}
    {result && <section className="panel simulator-result">
      <MetricCard title="Projeção anual" value={money(result.projection)} tone={result.attention ? 'warn' : 'good'} icon={Calculator} />
      <MetricCard title="Uso do limite de referência" value={`${result.percent}%`} tone={result.percent >= 80 ? 'warn' : 'good'} icon={AlertTriangle} />
      <p>{result.message}</p>
      {result.warnings?.map((warning: string) => <Notice key={warning} type="warning">{warning}</Notice>)}
      {result.upgradeHint && <Notice>{result.upgradeHint}</Notice>}
      <small>{result.disclaimer}</small>
    </section>}
  </>;
}

function Reports({ access }: { access?: AccessPayload }) {
  const now = new Date();
  const [list, setList] = useState<any[]>([]);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setList(await api('/reports'));
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    setError('');
    try {
      await api('/reports/monthly/generate', { method: 'POST', body: JSON.stringify({ month, year }) });
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function download(reportId: string, format: 'pdf' | 'excel') {
    setError('');
    try {
      const data = await api(`/reports/${reportId}/download/${format}`);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return <>
    <PageTitle eyebrow="Fechamento" title="Relatórios para contador" description="Gere um resumo mensal com receitas, despesas, obrigações e documentos do período." />
    {access?.features?.reports && <Notice>Relatórios liberados no plano {access.plan.label}: {String(access.features.reports).replaceAll('_', ' ')}.</Notice>}
    {error && <Notice type="error">{error}</Notice>}
    <section className="panel inline-actions">
      <TextInput label="Mês" type="number" min="1" max="12" value={month} onChange={(event) => setMonth(Number(event.target.value))} />
      <TextInput label="Ano" type="number" min="2020" value={year} onChange={(event) => setYear(Number(event.target.value))} />
      <button onClick={generate}><FileText size={16} />Gerar relatório</button>
    </section>
    <div className="report-list">
      {!list.length && <EmptyState title="Nenhum relatório" description="Gere o primeiro fechamento mensal para criar histórico." />}
      {list.map((report) => {
        const summary = report.summary ?? {};
        return <article className="panel report-card" key={report.id}>
          <div className="panel-head"><h2>Relatório {report.month}/{report.year}</h2><span>Gerado em {dateBR(report.generatedAt)}</span></div>
          <div className="mini-metrics"><span>Receitas: <b>{money(summary.revenuesTotal)}</b></span><span>Despesas: <b>{money(summary.expensesTotal)}</b></span><span>Resultado: <b>{money(summary.result)}</b></span><span>Docs: <b>{summary.documentsCount ?? 0}</b></span></div>
          <div className="inline-actions compact">
            {report.pdfUrl && <button className="secondary" onClick={() => download(report.id, 'pdf')}>Baixar PDF</button>}
            {report.excelUrl && <button className="secondary" onClick={() => download(report.id, 'excel')}>Baixar CSV/Excel</button>}
          </div>
        </article>;
      })}
    </div>
  </>;
}

function Settings({ meta, access, me, setAuthed, reloadMe }: { meta: Meta; access?: AccessPayload; me: MePayload | null; setAuthed: (value: boolean) => void; reloadMe: () => Promise<MePayload> }) {
  const [tenant, setTenant] = useState<Record<string, any>>({});
  const [profile, setProfile] = useState<Record<string, any>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api('/settings');
      setTenant(data.tenant ?? {});
      setProfile(data.profile ?? {});
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      await api('/settings', { method: 'PATCH', body: JSON.stringify({ tenant, profile }) });
      setMessage('Configurações salvas.');
      await load();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function sendVerificationLink() {
    setError('');
    setMessage('');
    try {
      const data = await resendVerification(me?.user?.email || '');
      setMessage(data.verifyUrl ? `Link de desenvolvimento: ${data.verifyUrl}` : data.message);
      await reloadMe();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function submitPasswordChange(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const data = await changePassword(currentPassword, newPassword);
      setMessage(data.message || 'Senha alterada. Faça login novamente.');
      setCurrentPassword('');
      setNewPassword('');
      setAuthed(false);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function submitAccountDeletion(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      const data = await deleteAccount(deletePassword, deleteConfirmation);
      setMessage(data.message || 'Conta excluída.');
      setAuthed(false);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  if (loading) return <LoadingState />;

  return <>
    <PageTitle eyebrow="Empresa" title="Configurações" description="Dados fiscais básicos, regime, contador e limites usados nos alertas do sistema." />
    {access && <section className="panel access-panel">
      <div className="panel-head"><h2>Plano e integrações</h2><span>Controlado pelo plano ativo ou add-on</span></div>
      <div className="mini-metrics">
        <span>Plano ativo: <b>{access.plan.label}</b></span>
        <span>Faturamento/mês: <b>{access.limits.revenuePerMonth ?? 'Ilimitado'}</b></span>
        <span>Despesas/mês: <b>{access.limits.expensePerMonth ?? 'Ilimitado'}</b></span>
        <span>Documentos: <b>{access.limits.documents}</b></span>
      </div>
      <div className="integration-list">
        {access.integrations.length ? access.integrations.map((integration) => <a key={integration.key} href={integration.url}>{integration.label}<small>{integration.source === 'ADDON' ? 'Add-on liberado' : 'Incluso no plano'}</small></a>) : <span className="muted-text">Nenhuma integração liberada neste plano.</span>}
      </div>
    </section>}
    {error && <Notice type="error">{error}</Notice>}
    {message && <Notice type="success">{message}</Notice>}
    <form className="panel settings-form" onSubmit={save}>
      <h2>Dados da empresa</h2>
      <div className="form-grid">
        <TextInput label="Nome comercial" value={tenant.name ?? ''} onChange={(event) => setTenant({ ...tenant, name: event.target.value })} />
        <TextInput label="Razão social" value={tenant.legalName ?? ''} onChange={(event) => setTenant({ ...tenant, legalName: event.target.value })} />
        <TextInput label="CNPJ" value={tenant.cnpj ?? ''} onChange={(event) => setTenant({ ...tenant, cnpj: event.target.value })} />
        <TextInput label="Cidade" value={tenant.city ?? ''} onChange={(event) => setTenant({ ...tenant, city: event.target.value })} />
        <TextInput label="Estado" value={tenant.state ?? ''} onChange={(event) => setTenant({ ...tenant, state: event.target.value.toUpperCase() })} />
        <TextInput label="Telefone" value={tenant.phone ?? ''} onChange={(event) => setTenant({ ...tenant, phone: event.target.value })} />
        <TextInput label="E-mail fiscal" type="email" value={tenant.email ?? ''} onChange={(event) => setTenant({ ...tenant, email: event.target.value })} />
        <SelectInput label="Regime no cadastro" options={meta.taxRegimes} value={tenant.taxProfile ?? 'UNKNOWN'} onChange={(value) => setTenant({ ...tenant, taxProfile: value })} />
      </div>

      <h2>Perfil fiscal</h2>
      <div className="form-grid">
        <SelectInput label="Regime" options={meta.taxRegimes} value={profile.regime ?? 'UNKNOWN'} onChange={(value) => setProfile({ ...profile, regime: value })} />
        <SelectInput label="Tipo de negócio" options={meta.businessTypes} value={profile.businessType ?? 'OTHER'} onChange={(value) => setProfile({ ...profile, businessType: value })} />
        <TextInput label="Limite anual MEI usado nos alertas" type="number" min="1" value={profile.meiAnnualLimit ?? 81000} onChange={(event) => setProfile({ ...profile, meiAnnualLimit: Number(event.target.value) })} />
        <TextInput label="Dia de vencimento do DAS" type="number" min="1" max="31" value={profile.dasDueDay ?? 20} onChange={(event) => setProfile({ ...profile, dasDueDay: Number(event.target.value) })} />
        <TextInput label="Alíquota estimada (%)" type="number" min="0" max="100" step="0.01" value={profile.estimatedTaxRate ?? ''} onChange={(event) => setProfile({ ...profile, estimatedTaxRate: event.target.value ? Number(event.target.value) : undefined })} />
        <label className="check compact"><input type="checkbox" checked={Boolean(profile.hasAccountant)} onChange={(event) => setProfile({ ...profile, hasAccountant: event.target.checked })} />Tenho contador</label>
        <TextInput label="Nome do contador" value={profile.accountantName ?? ''} onChange={(event) => setProfile({ ...profile, accountantName: event.target.value })} />
        <TextInput label="E-mail do contador" type="email" value={profile.accountantEmail ?? ''} onChange={(event) => setProfile({ ...profile, accountantEmail: event.target.value })} />
        <TextInput label="Telefone do contador" value={profile.accountantPhone ?? ''} onChange={(event) => setProfile({ ...profile, accountantPhone: event.target.value })} />
      </div>
      <div className="settings-actions"><button><Save size={16} />Salvar configurações</button></div>
    </form>

    <section className="panel settings-form">
      <h2>Segurança da conta</h2>
      <div className="mini-metrics">
        <span>E-mail: <b>{me?.user?.email || '-'}</b></span>
        <span>Status: <b>{me?.user?.emailVerifiedAt ? 'Confirmado' : 'Não confirmado'}</b></span>
      </div>
      {!me?.user?.emailVerifiedAt && <button type="button" className="secondary" onClick={sendVerificationLink}><ShieldCheck size={16} />Reenviar confirmação de e-mail</button>}
      <form onSubmit={submitPasswordChange} className="form-grid security-form">
        <TextInput required label="Senha atual" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        <TextInput required label="Nova senha" type="password" placeholder="Mín. 8, maiúscula e número" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        <div className="settings-actions"><button><Lock size={16} />Alterar senha</button></div>
      </form>
    </section>

    <section className="panel danger-zone">
      <h2>Zona de risco</h2>
      <p>Exclui sua conta, bloqueia a empresa e tenta remover arquivos do Supabase Storage. Essa ação encerra a sessão e não deve ser usada como teste.</p>
      <form onSubmit={submitAccountDeletion} className="form-grid security-form">
        <TextInput required label="Senha atual" type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} />
        <TextInput required label="Digite EXCLUIR para confirmar" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} />
        <div className="settings-actions"><button className="danger-button"><Trash2 size={16} />Excluir minha conta</button></div>
      </form>
    </section>
  </>;
}


function LegalPage() {
  const path = location.pathname;
  const kind = path.includes('privacidade') ? 'privacy' : path.includes('aviso-fiscal') ? 'fiscal' : 'terms';
  const title = kind === 'privacy' ? 'Política de Privacidade' : kind === 'fiscal' ? 'Aviso fiscal importante' : 'Termos de Uso';

  return <main className="legal-page">
    <section className="panel legal-panel">
      <img src={logo} alt="NexTax" className="auth-logo" />
      <span className="eyebrow">NexTax</span>
      <h1>{title}</h1>
      {kind === 'terms' && <>
        <p>O NexTax é uma ferramenta de organização fiscal para pequenos negócios. O sistema ajuda a registrar receitas, despesas, documentos, obrigações, relatórios e estimativas.</p>
        <p>O usuário é responsável pela veracidade dos dados inseridos, pela conferência das informações e pelo cumprimento das obrigações legais do próprio negócio.</p>
        <p>O NexTax pode limitar recursos conforme plano contratado e pode suspender acesso em caso de uso abusivo, tentativa de fraude, violação de segurança ou inadimplência.</p>
        <p>Cancelamentos, reembolsos e chargebacks seguem a política do meio de pagamento e as condições comerciais vigentes no momento da compra.</p>
      </>}
      {kind === 'privacy' && <>
        <p>Tratamos dados de cadastro, dados da empresa, lançamentos financeiros, obrigações fiscais e documentos enviados pelo usuário para fornecer as funcionalidades do NexTax.</p>
        <p>Documentos fiscais são armazenados em bucket privado e acessados por URL assinada temporária. Chaves sensíveis devem ficar apenas no backend.</p>
        <p>Podemos usar logs técnicos e registros de auditoria para segurança, suporte, prevenção de fraude e melhoria do serviço.</p>
        <p>O usuário pode solicitar exclusão da conta nas configurações. A exclusão bloqueia o acesso, revoga sessões e tenta remover arquivos armazenados.</p>
      </>}
      {kind === 'fiscal' && <>
        <p>O NexTax organiza informações, gera estimativas e ajuda a manter rotina fiscal. Ele não substitui contador, advogado, consultor tributário ou análise profissional habilitada.</p>
        <p>Simulações de MEI, Simples, impostos, limites, vencimentos e relatórios têm finalidade informativa. Antes de tomar decisão fiscal, valide com contador.</p>
        <p>Leis, limites, alíquotas e obrigações podem mudar. O usuário deve conferir dados oficiais e orientação profissional.</p>
      </>}
      <div className="auth-links"><a href="/">Voltar ao NexTax</a><a href="/termos">Termos</a><a href="/privacidade">Privacidade</a><a href="/aviso-fiscal">Aviso fiscal</a></div>
    </section>
  </main>;
}

function App() {
  const isLegalRoute = ['/termos', '/privacidade', '/aviso-fiscal'].includes(location.pathname);
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(!isLegalRoute && location.pathname !== '/auth/nexcore');
  const handleAuth = useCallback(() => setAuthed(true), []);

  useEffect(() => {
    if (isLegalRoute || location.pathname === '/auth/nexcore') return;

    api('/auth/me')
      .then(() => setAuthed(true))
      .catch(() => null)
      .finally(() => setChecking(false));
  }, [isLegalRoute]);

  if (isLegalRoute) return <LegalPage />;

  if (checking) return <main className="auth auth-sso"><section className="nex-auth-card sso-card"><img src={logo} alt="NexTax" className="auth-logo" /><span className="login-badge">CARREGANDO</span><h1>Preparando seu acesso</h1><p>Verificando sessão segura.</p><button className="validating" disabled>Validando...</button></section></main>;

  return authed ? <Shell setAuthed={setAuthed} /> : <Auth onAuth={handleAuth} />;
}

createRoot(document.getElementById('root')!).render(<App />);
