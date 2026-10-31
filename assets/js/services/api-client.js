import { SUPABASE_CONFIG, APP_CONFIG } from '../config/supabase.config.js';

export class ApiError extends Error {
  constructor(message, status = 500, code = 'api_error') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export class ApiClient {
  static get token() {
    return sessionStorage.getItem(APP_CONFIG.sessionStorageKey) || '';
  }

  static setSession(token, user) {
    if (token) sessionStorage.setItem(APP_CONFIG.sessionStorageKey, token);
    if (user) sessionStorage.setItem(APP_CONFIG.userStorageKey, JSON.stringify(user));
  }

  static clearSession() {
    sessionStorage.removeItem(APP_CONFIG.sessionStorageKey);
    sessionStorage.removeItem(APP_CONFIG.userStorageKey);
  }

  static get cachedUser() {
    try { return JSON.parse(sessionStorage.getItem(APP_CONFIG.userStorageKey) || 'null'); }
    catch { return null; }
  }

  static async call(action, payload = {}, { auth = true, timeoutMs = 60000 } = {}) {
    const headers = {
      'Content-Type': 'application/json',
      apikey: SUPABASE_CONFIG.publishableKey,
    };
    if (auth && this.token) headers['x-app-session'] = this.token;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(SUPABASE_CONFIG.functionUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action, ...payload }),
        cache: 'no-store',
        signal: controller.signal,
      });

      let result;
      try { result = await response.json(); }
      catch {
        throw new ApiError(
          `Supabase respondió con un formato no válido (HTTP ${response.status}).`,
          response.status,
          'invalid_response'
        );
      }

      if (!response.ok || !result?.ok) {
        const detail = result?.error || {};
        throw new ApiError(
          detail.message || `No se pudo completar la solicitud (HTTP ${response.status}).`,
          response.status,
          detail.code || 'api_error'
        );
      }
      return result.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error?.name === 'AbortError') {
        throw new ApiError(
          'Supabase no respondió dentro de 60 segundos. La petición se canceló; verifica el estado de music-api y vuelve a intentarlo.',
          0,
          'request_timeout'
        );
      }
      throw new ApiError(
        'No se pudo conectar con Supabase. Comprueba tu conexión o revisa que la función music-api esté activa.',
        0,
        'network_error'
      );
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
