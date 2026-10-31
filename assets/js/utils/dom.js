export function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function toast(message, type = 'default') {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const node = element('div', `toast ${type}`, message);
  region.append(node);
  window.setTimeout(() => node.remove(), 3500);
}

export function setBusy(button, busy, busyLabel = 'Procesando…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.previousMarkup) button.dataset.previousMarkup = button.innerHTML;
    button.textContent = busyLabel;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    if (button.dataset.previousMarkup !== undefined) {
      button.innerHTML = button.dataset.previousMarkup;
      delete button.dataset.previousMarkup;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

export function safeDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}
