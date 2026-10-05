// Tests for the admin-users Edge Function logic with in-memory fakes.
// Run: node tests/admin-users.test.mjs   (Node 22+ strips the TypeScript types)
import { handle } from '../supabase/functions/admin-users/index.ts';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

function fakeDeps() {
  const users = new Map([
    ['admin-1', { email: 'h001@hplace.local', password: 'x', profile: { login_id: 'h001', role: 'admin', active: true } }],
    ['staff-1', { email: 's101@hplace.local', password: 'x', profile: { login_id: 's101', role: 'staff', active: true, branch_id: 'br01' } }],
  ]);
  const tokens = { 'jwt-admin': 'admin-1', 'jwt-staff': 'staff-1' };
  const calls = [];
  let nextId = 1;
  const deps = {
    loginDomain: 'hplace.local',
    failProfileUpdate: false,
    async getCaller(jwt) {
      const id = tokens[jwt];
      if (!id) return { userId: null, isAdmin: false };
      const p = users.get(id).profile;
      return { userId: id, isAdmin: p.role === 'admin' && p.active };
    },
    async createAuthUser(email, password, fullName) {
      calls.push(['create', email, fullName]);
      if ([...users.values()].some((u) => u.email === email)) return { error: 'A user with this email address has already been registered' };
      const id = `new-${nextId++}`;
      users.set(id, { email, password, profile: { login_id: email.split('@')[0], role: 'staff', active: true } });
      return { id };
    },
    async updateAuthUser(id, attrs) {
      calls.push(['updateAuth', id, attrs]);
      Object.assign(users.get(id), attrs);
      return {};
    },
    async deleteAuthUser(id) { calls.push(['delete', id]); users.delete(id); },
    async branchExists(id) { return id === 'br01'; },
    async profileExists(id) { return users.has(id); },
    async loginIdTaken(loginId, except) { return [...users.entries()].some(([id, u]) => id !== except && u.profile.login_id === loginId); },
    async updateProfile(id, fields) {
      if (deps.failProfileUpdate) return { error: 'boom' };
      Object.assign(users.get(id).profile, fields);
      return {};
    },
  };
  return { deps, users, calls };
}

async function call(deps, body, jwt = 'jwt-admin', method = 'POST') {
  const req = new Request('https://x/functions/v1/admin-users', {
    method, headers: jwt ? { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' } : {},
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
  const res = await handle(req, deps);
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}

console.log('access');
{
  const { deps } = fakeDeps();
  ok((await handle(new Request('https://x', { method: 'OPTIONS' }), deps)).status === 200, 'CORS preflight answered');
  ok((await call(deps, { action: 'create' }, null)).data.error === 'NOT_AUTHENTICATED', 'no token → NOT_AUTHENTICATED');
  ok((await call(deps, { action: 'create' }, 'bogus')).status === 401, 'unknown token → 401');
  const r = await call(deps, { action: 'set_password', userId: 'admin-1', password: 'hacked1' }, 'jwt-staff');
  ok(r.status === 403 && r.data.error === 'ADMIN_ONLY', 'staff → 403 ADMIN_ONLY');
}

console.log('create');
{
  const { deps, users, calls } = fakeDeps();
  let r = await call(deps, { action: 'create', loginId: ' S102 ', password: '124545', fullName: '박민준', role: 'staff', branchId: 'br01' });
  ok(r.status === 200 && r.data.loginId === 's102', 'admin creates s102 (ID normalised to lower case)');
  const u = users.get(r.data.userId);
  ok(u.email === 's102@hplace.local' && u.password === '124545', 'auth user gets <id>@domain and the given password');
  ok(u.profile.role === 'staff' && u.profile.branch_id === 'br01' && u.profile.full_name === '박민준', 'profile gets role, branch and name');
  r = await call(deps, { action: 'create', loginId: 's102', password: '124545', role: 'staff', branchId: 'br01' });
  ok(r.status === 409 && r.data.error === 'LOGIN_ID_TAKEN', 'duplicate ID → LOGIN_ID_TAKEN');
  ok((await call(deps, { action: 'create', loginId: '한글', password: '124545', role: 'staff', branchId: 'br01' })).data.error === 'INVALID_LOGIN_ID', 'invalid ID rejected');
  ok((await call(deps, { action: 'create', loginId: 's103', password: '123', role: 'staff', branchId: 'br01' })).data.error === 'WEAK_PASSWORD', 'short password rejected');
  ok((await call(deps, { action: 'create', loginId: 's103', password: '124545', role: 'staff', branchId: 'nope' })).data.error === 'BRANCH_NOT_FOUND', 'unknown branch rejected');
  ok((await call(deps, { action: 'create', loginId: 's103', password: '124545', role: 'staff' })).data.error === 'BRANCH_NOT_FOUND', 'staff without branch rejected');
  ok((await call(deps, { action: 'create', loginId: 's103', password: '124545', role: 'owner', branchId: 'br01' })).data.error === 'INVALID_ROLE', 'unknown role rejected');
  r = await call(deps, { action: 'create', loginId: 'h002', password: '124545', role: 'admin', branchId: 'br01' });
  ok(r.status === 200 && users.get(r.data.userId).profile.branch_id === null, 'admin account gets no branch');
  deps.failProfileUpdate = true;
  const before = users.size;
  r = await call(deps, { action: 'create', loginId: 's104', password: '124545', role: 'staff', branchId: 'br01' });
  ok(r.status === 500 && users.size === before && calls.some((c) => c[0] === 'delete'), 'profile failure rolls back the auth user');
}

console.log('change_login / set_password');
{
  const { deps, users } = fakeDeps();
  let r = await call(deps, { action: 'change_login', userId: 'staff-1', loginId: 'jisu' });
  ok(r.status === 200 && users.get('staff-1').email === 'jisu@hplace.local' && users.get('staff-1').profile.login_id === 'jisu', 'admin changes a login ID (auth email + profile)');
  ok((await call(deps, { action: 'change_login', userId: 'staff-1', loginId: 'h001' })).data.error === 'LOGIN_ID_TAKEN', 'cannot take another user\'s ID');
  ok((await call(deps, { action: 'change_login', userId: 'staff-1', loginId: 'jisu' })).status === 200, 'keeping the same ID is allowed');
  ok((await call(deps, { action: 'change_login', userId: 'ghost', loginId: 'x1' })).data.error === 'USER_NOT_FOUND', 'unknown user → USER_NOT_FOUND');
  r = await call(deps, { action: 'set_password', userId: 'staff-1', password: 'new-pass-1' });
  ok(r.status === 200 && users.get('staff-1').password === 'new-pass-1', 'admin resets another user\'s password');
  r = await call(deps, { action: 'set_password', userId: 'admin-1', password: 'mine-123' });
  ok(r.status === 200 && users.get('admin-1').password === 'mine-123', 'admin changes own password');
  ok((await call(deps, { action: 'set_password', userId: 'staff-1', password: 'x'.repeat(73) })).data.error === 'WEAK_PASSWORD', 'over-long password rejected');
  ok((await call(deps, { action: 'nope' })).data.error === 'BAD_REQUEST', 'unknown action → BAD_REQUEST');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
