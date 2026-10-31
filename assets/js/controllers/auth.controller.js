import { ApiClient } from '../services/api-client.js';
import { setBusy } from '../utils/dom.js';

const showMessage = (node, message, success = false) => {
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('success', success);
};

const loginForm = document.getElementById('login-form');
if (loginForm) {
  if (ApiClient.token) window.location.replace('./dashboard.html');
  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = loginForm.querySelector('button[type="submit"]');
    const message = document.getElementById('login-message');
    const form = new FormData(loginForm);
    setBusy(button, true, 'Verificando…'); showMessage(message, '');
    try {
      const data = await ApiClient.call('auth.login', {
        identifier: String(form.get('identifier') || '').trim(),
        password: String(form.get('password') || ''),
      }, { auth: false });
      ApiClient.setSession(data.session.token, data.user);
      window.location.replace('./dashboard.html');
    } catch (error) { showMessage(message, error.message || 'No fue posible iniciar sesión.'); }
    finally { setBusy(button, false); }
  });
}

const registerForm = document.getElementById('register-form');
if (registerForm) {
  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = registerForm.querySelector('button[type="submit"]');
    const message = document.getElementById('register-message');
    const form = new FormData(registerForm);
    const password = String(form.get('password') || '');
    const confirmPassword = String(form.get('confirmPassword') || '');
    if (password !== confirmPassword) { showMessage(message, 'Las contraseñas no coinciden.'); return; }
    if (password.length < 12) { showMessage(message, 'La contraseña debe tener al menos 12 caracteres.'); return; }
    setBusy(button, true, 'Creando cuenta…'); showMessage(message, '');
    try {
      const data = await ApiClient.call('auth.register', {
        displayName: String(form.get('displayName') || '').trim(),
        username: String(form.get('username') || '').trim(),
        email: String(form.get('email') || '').trim(),
        password,
      }, { auth: false });
      ApiClient.setSession(data.session.token, data.user);
      window.location.replace('./dashboard.html');
    } catch (error) { showMessage(message, error.message || 'No fue posible crear la cuenta.'); }
    finally { setBusy(button, false); }
  });
}

const recoveryRequestForm = document.getElementById('recovery-request-form');
const recoveryResetForm = document.getElementById('recovery-reset-form');
if (recoveryRequestForm && recoveryResetForm) {
  const token = new URLSearchParams(window.location.search).get('token');
  if (token) {
    recoveryRequestForm.classList.add('hidden');
    recoveryResetForm.classList.remove('hidden');
    document.getElementById('recovery-title').textContent = 'Crea una contraseña nueva';
    document.getElementById('recovery-description').textContent = 'Elige una contraseña segura para volver a acceder a tu biblioteca.';
  }
  recoveryRequestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = recoveryRequestForm.querySelector('button');
    const message = document.getElementById('recovery-request-message');
    setBusy(button, true, 'Enviando…'); showMessage(message, '');
    try {
      const data = await ApiClient.call('auth.request-reset', { email: new FormData(recoveryRequestForm).get('email') }, { auth: false });
      showMessage(message, data.message || 'Solicitud procesada.', true);
    } catch (error) { showMessage(message, error.message); }
    finally { setBusy(button, false); }
  });
  recoveryResetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = recoveryResetForm.querySelector('button');
    const message = document.getElementById('recovery-reset-message');
    const form = new FormData(recoveryResetForm);
    const password = String(form.get('password') || '');
    if (password !== String(form.get('confirmPassword') || '')) { showMessage(message, 'Las contraseñas no coinciden.'); return; }
    setBusy(button, true, 'Actualizando…'); showMessage(message, '');
    try {
      const data = await ApiClient.call('auth.reset-password', { token, password }, { auth: false });
      showMessage(message, data.message || 'Contraseña actualizada.', true);
      recoveryResetForm.reset();
      window.setTimeout(() => window.location.assign('./login.html'), 1800);
    } catch (error) { showMessage(message, error.message); }
    finally { setBusy(button, false); }
  });
}
