import axios from 'axios';
import { useAuthStore } from '../store/auth.ts';

// In production VITE_API_URL is baked in at build time (e.g. https://ca-quotebot-api...azurecontainerapps.io)
// In local dev it is undefined → baseURL falls back to '/api' which Vite proxies to localhost:3001
const apiBase = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api';

export const api = axios.create({
  baseURL: apiBase,
  headers: { 'Content-Type': 'application/json' },
});

// Attach access token
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-refresh on 401
let refreshing: Promise<string | null> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;

      if (!refreshing) {
        refreshing = (async () => {
          const refreshToken = useAuthStore.getState().refreshToken;
          if (!refreshToken) return null;
          try {
            const { data } = await api.post('/auth/refresh', { refreshToken });
            useAuthStore.getState().setTokens(data.accessToken, data.refreshToken);
            return data.accessToken;
          } catch {
            useAuthStore.getState().logout();
            return null;
          } finally {
            refreshing = null;
          }
        })();
      }

      const newToken = await refreshing;
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  }
);
