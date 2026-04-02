import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Trader } from '@quotebot/shared';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  trader: Omit<Trader, 'createdAt' | 'updatedAt'> | null;
  setTokens: (access: string, refresh: string) => void;
  setTrader: (trader: Omit<Trader, 'createdAt' | 'updatedAt'>) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      trader: null,
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setTrader: (trader) => set({ trader }),
      logout: () => set({ accessToken: null, refreshToken: null, trader: null }),
    }),
    {
      name: 'quotebot-auth',
      partialize: (state) => ({
        refreshToken: state.refreshToken,
        trader: state.trader,
      }),
    }
  )
);
