import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Opt-in local Auth + captured email integration. No application env files.
test('real signup confirmation, password recovery and guest email linking preserve identity', { timeout: 90000 }, async () => {
  let stage = 'local services', admin;
  const users = [];
  const messages = [];
  try {
    const status = JSON.parse(execFileSync(process.platform === 'win32' ? 'cmd.exe' : 'npx',
      process.platform === 'win32' ? ['/d', '/s', '/c', 'npx --no-install supabase status -o json'] : ['--no-install', 'supabase', 'status', '-o', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }));
    const url = new URL(status.API_URL);
    const mail = new URL(status.MAILPIT_URL ?? 'http://127.0.0.1:54324');
    for (const target of [url, mail]) assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
    const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
    const client = () => createClient(url.origin, status.PUBLISHABLE_KEY ?? status.ANON_KEY, options);
    admin = createClient(url.origin, status.SECRET_KEY ?? status.SERVICE_ROLE_KEY, options);
    const ok = result => { if (result.error) throw new Error('Auth operation failed'); return result.data; };
    const confirm = async (email, authClient) => {
      let message;
      for (let i = 0; i < 30; i++) {
        const response = await fetch(new URL('/api/v1/search?query=' + encodeURIComponent('to:' + email), mail));
        const data = await response.json();
        message = data.messages?.find(m => !messages.includes(m.ID));
        if (message) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      assert.ok(message, 'Confirmation email arrived in local Mailpit');
      messages.push(message.ID);
      const content = await (await fetch(new URL('/api/v1/message/' + message.ID, mail))).json();
      const link = content.HTML.match(/href="([^"]*\/auth\/v1\/verify[^\"]*)"/)?.[1]?.replaceAll('&amp;', '&');
      assert.ok(link, 'Email includes verification link');
      const verify = new URL(link);
      assert.equal(verify.origin, url.origin);
      const response = await fetch(verify, { redirect: 'manual' });
      const redirect = new URL(response.headers.get('location'));
      const tokens = new URLSearchParams(redirect.hash.slice(1));
      assert.ok(tokens.get('access_token'), 'Verification returns a session');
      return ok(await authClient.auth.setSession({ access_token: tokens.get('access_token'), refresh_token: tokens.get('refresh_token') }));
    };
    const run = randomUUID();
    const teacher = client();
    const email = `grasp-confirm-${run}@example.test`;
    const password = randomUUID() + 'Aa1!';
    stage = 'signup and confirmation email';
    const signed = ok(await teacher.auth.signUp({ email, password }));
    users.push(signed.user.id);
    assert.equal(signed.session, null);
    assert.equal((await confirm(email, teacher)).user.id, signed.user.id);
    ok(await teacher.auth.signOut());
    ok(await teacher.auth.signInWithPassword({ email, password }));
    stage = 'password recovery email';
    ok(await teacher.auth.resetPasswordForEmail(email));
    await confirm(email, teacher);
    const replacement = randomUUID() + 'Bb2!';
    ok(await teacher.auth.updateUser({ password: replacement }));
    ok(await teacher.auth.signOut());
    assert.ok((await teacher.auth.signInWithPassword({ email, password })).error);
    ok(await teacher.auth.signInWithPassword({ email, password: replacement }));
    stage = 'guest email linking';
    const guest = client();
    const anonymous = ok(await guest.auth.signInAnonymously());
    users.push(anonymous.user.id);
    const guestEmail = `grasp-link-${run}@example.test`;
    ok(await guest.auth.updateUser({ email: guestEmail }));
    const linked = await confirm(guestEmail, guest);
    assert.equal(linked.user.id, anonymous.user.id);
    assert.equal(linked.user.is_anonymous, false);
    ok(await guest.auth.updateUser({ password }));
    const fresh = ok(await client().auth.signInWithPassword({ email: guestEmail, password }));
    assert.equal(fresh.user.id, anonymous.user.id);
  } catch {
    throw new Error(`Account integration failed at: ${stage}`);
  } finally {
    if (admin) for (const id of users) await admin.auth.admin.deleteUser(id);
  }
});
