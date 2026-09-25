import { isDemo, post } from '../api.js';
import { errorText, t } from '../i18n.js';
import { h, field, withBusy } from '../ui.js';
import { icon, logo } from '../icons.js';
import { languageMenu, siteFooter, themeButton } from '../components.js';

export function mount(mode, ctx) {
  const card = h('div.auth-card');
  const page = h('div.auth-page',
    h('aside.auth-hero',
      h('div.hero-grid', { 'aria-hidden': 'true' }),
      h('div.hero-inner',
        h('div.hero-brand', logo(48), h('span', 'AZ SERIAL')),
        h('h1', t('auth.hero.title')),
        h('p', t('auth.hero.body')),
        h('ul.hero-features',
          h('li', icon('scan', 18), t('auth.hero.f1')),
          h('li', icon('shieldCheck', 18), t('auth.hero.f2')),
          h('li', icon('userCheck', 18), t('auth.hero.f3'))),
        heroMock())),
    h('section.auth-main',
      h('div.auth-top',
        h('div.auth-mobile-brand', logo(32), h('strong', 'AZ SERIAL')),
        h('div.auth-top-actions', languageMenu(ctx.rerender), themeButton())),
      card,
      siteFooter()));
  card.append(mode === 'signup' ? signupForm(card) : loginForm(ctx));
  return page;
}

/** Decorative preview of a scanned serial in the hero panel. */
function heroMock() {
  return h('div.hero-mock', { 'aria-hidden': 'true' },
    h('div.mock-frame', h('span.mock-bars'), h('span.scan-laser')),
    h('div.mock-row', h('span.mock-chip', icon('checkCircle', 14), 'SN-AZ24-0098341'), h('span.mock-dim', 'AZ-500 · ORD-7781')));
}

function alertBox(kind, iconName, text) {
  return h(`div.alert.alert-${kind}`, { role: 'alert' }, icon(iconName, 18), h('span', text));
}

function passwordInput(autocomplete) {
  const input = h('input.input', { type: 'password', autocomplete, required: true, dir: 'ltr' });
  const toggle = h('button.pw-toggle', {
    type: 'button', 'aria-label': t('auth.showPassword'),
    onclick: () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.replaceChildren(icon(show ? 'eyeOff' : 'eye', 18));
    },
  }, icon('eye', 18));
  return { input, wrap: h('div.pw-wrap', input, toggle) };
}

function loginForm(ctx) {
  const username = h('input.input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: false, required: true, dir: 'ltr' });
  const pw = passwordInput('current-password');
  const fUser = field({ label: t('auth.username'), input: username });
  const fPass = field({ label: t('auth.password'), input: pw.input, control: pw.wrap });
  const alertSlot = h('div');
  const submit = h('button.btn.primary.lg.block', { type: 'submit' }, t('auth.signin'));

  const form = h('form.auth-form', {
    novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      alertSlot.replaceChildren();
      fUser.setError(username.value.trim() ? '' : t('err.REQUIRED', { field: t('auth.username') }));
      fPass.setError(pw.input.value ? '' : t('err.REQUIRED', { field: t('auth.password') }));
      if (!username.value.trim() || !pw.input.value) return;
      withBusy(submit, async () => {
        try {
          await post('/auth/login', { username: username.value, password: pw.input.value });
          await ctx.signedIn();
        } catch (err) {
          const pending = err.code === 'PENDING_APPROVAL';
          alertSlot.replaceChildren(alertBox(pending ? 'warn' : 'error', pending ? 'clock' : 'alert', errorText(err.code)));
        }
      });
    },
  },
  h('div.auth-head', h('h1', t('auth.signin.title')), h('p.muted', t('auth.signin.subtitle'))),
  alertSlot, isDemo() ? demoAccounts(username, pw.input) : null, fUser, fPass, submit,
  h('p.auth-switch', t('auth.noAccount'), ' ', h('a', { href: '#/signup' }, t('auth.signup'))));
  setTimeout(() => username.focus(), 50);
  return form;
}

/** Demo build only: one-tap sign-in with the seeded test accounts. */
function demoAccounts(userInput, passInput) {
  const fill = (u, p) => { userInput.value = u; passInput.value = p; userInput.form.requestSubmit(); };
  return h('div.demo-accounts',
    h('p.small.muted', t('demo.accounts')),
    h('div.chips',
      h('button.chip', { type: 'button', dir: 'ltr', onclick: () => fill('admin', 'admin12345') }, 'admin / admin12345'),
      h('button.chip', { type: 'button', dir: 'ltr', onclick: () => fill('demo', 'demo12345') }, 'demo / demo12345'),
      h('button.chip', { type: 'button', dir: 'ltr', onclick: () => fill('newuser', 'newuser123') }, 'newuser (pending)')));
}

function signupForm(card) {
  const inputs = {
    fullName: h('input.input', { type: 'text', autocomplete: 'name', required: true }),
    username: h('input.input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', spellcheck: false, required: true, dir: 'ltr' }),
    phone: h('input.input', { type: 'tel', autocomplete: 'tel', dir: 'ltr', inputmode: 'tel' }),
  };
  const pw = passwordInput('new-password');
  const fields = {
    fullName: field({ label: t('auth.fullName'), input: inputs.fullName, required: true }),
    username: field({ label: t('auth.username'), input: inputs.username, hint: t('auth.usernameHint'), required: true }),
    phone: field({ label: t('auth.phone'), input: inputs.phone }),
    password: field({ label: t('auth.password'), input: pw.input, control: pw.wrap, hint: t('auth.passwordHint'), required: true }),
  };
  const alertSlot = h('div');
  const submit = h('button.btn.primary.lg.block', { type: 'submit' }, t('auth.signup'));
  const labels = { fullName: 'auth.fullName', username: 'auth.username', password: 'auth.password', phone: 'auth.phone' };

  const form = h('form.auth-form', {
    novalidate: true,
    onsubmit: (e) => {
      e.preventDefault();
      alertSlot.replaceChildren();
      Object.values(fields).forEach((f) => f.setError(''));
      const body = { fullName: inputs.fullName.value, username: inputs.username.value, phone: inputs.phone.value, password: pw.input.value };
      let bad = false;
      for (const k of ['fullName', 'username', 'password']) {
        if (!String(body[k]).trim()) { fields[k].setError(t('err.REQUIRED', { field: t(labels[k]) })); bad = true; }
      }
      if (!bad && body.password.length < 8) { fields.password.setError(t('err.PASSWORD_TOO_SHORT')); bad = true; }
      if (bad) return;
      withBusy(submit, async () => {
        try {
          await post('/auth/register', body);
          card.replaceChildren(pendingScreen());
        } catch (err) {
          if (err.errors) {
            for (const [k, code] of Object.entries(err.errors)) fields[k]?.setError(errorText(code, { field: t(labels[k]) }));
          } else {
            alertSlot.replaceChildren(alertBox('error', 'alert', errorText(err.code)));
          }
        }
      });
    },
  },
  h('div.auth-head', h('h1', t('auth.signup.title')), h('p.muted', t('auth.signup.subtitle'))),
  alertSlot, fields.fullName, fields.username, fields.phone, fields.password, submit,
  h('p.auth-switch', t('auth.haveAccount'), ' ', h('a', { href: '#/login' }, t('auth.signin'))));
  setTimeout(() => inputs.fullName.focus(), 50);
  return form;
}

function pendingScreen() {
  return h('div.auth-form.pending',
    h('div.pending-icon', icon('clock', 30)),
    h('h1', t('auth.pending.title')),
    h('p.muted', t('auth.pending.body')),
    h('a.btn.subtle.lg.block', { href: '#/login' }, t('auth.backToSignin')));
}
