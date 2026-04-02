import axios from 'axios';
import { useAuthStore } from '../store/auth.ts';

export const api = axios.create({
  baseURL: '/api',
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
            const { data } = await axios.post('/api/auth/refresh', { refreshToken });
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
