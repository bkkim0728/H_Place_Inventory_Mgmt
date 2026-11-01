// Supabase Edge Function: admin-users
//
// Account operations that need the service role key, available only to an
// active admin (전체 관리자):
//   { action: 'create',       loginId, password, fullName, role, branchId }
//   { action: 'change_login', userId, loginId }
//   { action: 'set_password', userId, password }
//
// Name, role, branch and active flag are changed through the update_user()
// SQL function, which has its own permission checks.
//
// Accounts use the email <loginId>@<LOGIN_DOMAIN> (default hplace.local), the
// same domain the web app uses to turn an ID into an email at sign-in.
// Errors come back as { error: CODE } with an HTTP status; the app translates
// the codes. The service role key never leaves this function.

type Role = 'staff' | 'manager' | 'admin';

export interface Deps {
  loginDomain: string;
  getCaller(jwt: string): Promise<{ userId: string | null; isAdmin: boolean }>;
  createAuthUser(email: string, password: string, fullName: string): Promise<{ id?: string; error?: string }>;
  updateAuthUser(userId: string, attrs: { email?: string; password?: string }): Promise<{ error?: string }>;
  deleteAuthUser(userId: string): Promise<void>;
  branchExists(branchId: string): Promise<boolean>;
  profileExists(userId: string): Promise<boolean>;
  loginIdTaken(loginId: string, exceptUserId?: string): Promise<boolean>;
  updateProfile(userId: string, fields: Record<string, unknown>): Promise<{ error?: string }>;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const LOGIN_ID = /^[a-z0-9][a-z0-9._-]{1,29}$/;
const ROLES: Role[] = ['staff', 'manager', 'admin'];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, code: string) => json(status, { error: code });

function normLogin(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  return LOGIN_ID.test(s) ? s : null;
}
function passwordOk(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 6 && v.length <= 72;
}
function authErrorCode(message: string, fallback: string): string {
  if (/already (been )?registered|already exists|duplicate/i.test(message)) return 'LOGIN_ID_TAKEN';
  if (/password/i.test(message)) return 'WEAK_PASSWORD';
  if (/email/i.test(message)) return 'INVALID_LOGIN_ID';
  return fallback;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED');

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return fail(401, 'NOT_AUTHENTICATED');
  const caller = await deps.getCaller(jwt);
  if (!caller.userId) return fail(401, 'NOT_AUTHENTICATED');
  if (!caller.isAdmin) return fail(403, 'ADMIN_ONLY');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'BAD_REQUEST');
  }

  switch (body?.action) {
    case 'create': {
      const loginId = normLogin(body.loginId);
      if (!loginId) return fail(400, 'INVALID_LOGIN_ID');
      if (!passwordOk(body.password)) return fail(400, 'WEAK_PASSWORD');
      const role = body.role as Role;
      if (!ROLES.includes(role)) return fail(400, 'INVALID_ROLE');
      const branchId = role === 'admin' ? null : String(body.branchId ?? '');
      if (role !== 'admin' && (!branchId || !(await deps.branchExists(branchId)))) return fail(400, 'BRANCH_NOT_FOUND');
      if (await deps.loginIdTaken(loginId)) return fail(409, 'LOGIN_ID_TAKEN');
      const fullName = String(body.fullName ?? '').trim() || loginId;

      const created = await deps.createAuthUser(`${loginId}@${deps.loginDomain}`, body.password, fullName);
      if (created.error || !created.id) return fail(created.error ? 400 : 500, authErrorCode(created.error || '', 'CREATE_FAILED'));

      const upd = await deps.updateProfile(created.id, {
        login_id: loginId, full_name: fullName, role, branch_id: branchId, active: true,
      });
      if (upd.error) {
        await deps.deleteAuthUser(created.id);  // don't leave a half-made account behind
        return fail(500, 'CREATE_FAILED');
      }
      return json(200, { userId: created.id, loginId });
    }

    case 'change_login': {
      const userId = String(body.userId ?? '');
      if (!userId || !(await deps.profileExists(userId))) return fail(404, 'USER_NOT_FOUND');
      const loginId = normLogin(body.loginId);
      if (!loginId) return fail(400, 'INVALID_LOGIN_ID');
      if (await deps.loginIdTaken(loginId, userId)) return fail(409, 'LOGIN_ID_TAKEN');
      const email = `${loginId}@${deps.loginDomain}`;
      const res = await deps.updateAuthUser(userId, { email });
      if (res.error) return fail(400, authErrorCode(res.error, 'UPDATE_FAILED'));
      const upd = await deps.updateProfile(userId, { login_id: loginId, email });
      if (upd.error) return fail(500, 'UPDATE_FAILED');
      return json(200, { userId, loginId });
    }

    case 'set_password': {
      const userId = String(body.userId ?? '');
      if (!userId || !(await deps.profileExists(userId))) return fail(404, 'USER_NOT_FOUND');
      if (!passwordOk(body.password)) return fail(400, 'WEAK_PASSWORD');
      const res = await deps.updateAuthUser(userId, { password: body.password });
      if (res.error) return fail(400, authErrorCode(res.error, 'UPDATE_FAILED'));
      return json(200, { userId });
    }

    default:
      return fail(400, 'BAD_REQUEST');
  }
}

// ---------------------------------------------------------------------------
// Runtime wiring (Supabase Edge Runtime / Deno). Skipped when imported by tests.
// ---------------------------------------------------------------------------
const DenoNs = (globalThis as any).Deno;
if (DenoNs) {
  const { createClient } = await import('npm:@supabase/supabase-js@2.117.1');
  const admin = createClient(DenoNs.env.get('SUPABASE_URL'), DenoNs.env.get('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const deps: Deps = {
    loginDomain: String(DenoNs.env.get('LOGIN_DOMAIN') || 'hplace.local').toLowerCase(),
    async getCaller(jwt) {
      const { data } = await admin.auth.getUser(jwt);
      const userId = data?.user?.id ?? null;
      if (!userId) return { userId: null, isAdmin: false };
      const { data: p } = await admin.from('profiles').select('role, active').eq('user_id', userId).maybeSingle();
      return { userId, isAdmin: p?.role === 'admin' && p?.active === true };
    },
    async createAuthUser(email, password, fullName) {
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: fullName },
      });
      return { id: data?.user?.id, error: error?.message };
    },
    async updateAuthUser(userId, attrs) {
      const { error } = await admin.auth.admin.updateUserById(userId, attrs.email ? { ...attrs, email_confirm: true } : attrs);
      return { error: error?.message };
    },
    async deleteAuthUser(userId) {
      await admin.auth.admin.deleteUser(userId);
    },
    async branchExists(branchId) {
      const { data } = await admin.from('branches').select('id').eq('id', branchId).eq('active', true).maybeSingle();
      return Boolean(data);
    },
    async profileExists(userId) {
      const { data } = await admin.from('profiles').select('user_id').eq('user_id', userId).maybeSingle();
      return Boolean(data);
    },
    async loginIdTaken(loginId, exceptUserId) {
      // login_id is always stored lower-case, so an exact match is enough (and
      // avoids LIKE wildcards such as '_' in IDs).
      let q = admin.from('profiles').select('user_id').eq('login_id', loginId);
      if (exceptUserId) q = q.neq('user_id', exceptUserId);
      const { data } = await q.limit(1);
      return Boolean(data && data.length);
    },
    async updateProfile(userId, fields) {
      const { error } = await admin.from('profiles').update(fields).eq('user_id', userId);
      return { error: error?.message };
    },
  };

  DenoNs.serve((req: Request) => handle(req, deps));
}
