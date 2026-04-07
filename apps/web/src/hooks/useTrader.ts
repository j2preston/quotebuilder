import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import type { RateCard, JobLibraryEntry } from '@quotebot/shared';

// ─── Rate card ────────────────────────────────────────────────────────────────

export function useRateCard() {
  return useQuery({
    queryKey: ['trader', 'me'],
    queryFn: async () => {
      const { data } = await api.get('/trader/me');
      return data as { trader: unknown; rateCard: RateCard | null };
    },
    select: (d) => d.rateCard,
  });
}

export function useUpdateRateCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Partial<RateCard>) => {
      const { data } = await api.put('/trader/rate-card', body);
      return data as { rateCard: RateCard };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trader', 'me'] }),
  });
}

// ─── Job library ──────────────────────────────────────────────────────────────

export function useJobLibrary() {
  return useQuery({
    queryKey: ['trader', 'job-library'],
    queryFn: async () => {
      const { data } = await api.get('/trader/job-library');
      return (data.jobLibrary ?? []) as JobLibraryEntry[];
    },
  });
}

export function useUpdateJobEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: string; label?: string; labourHours?: number; active?: boolean }) => {
      const { data } = await api.put(`/trader/job-library/${id}`, body);
      return data as { entry: JobLibraryEntry };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trader', 'job-library'] }),
  });
}

// ─── Profile ──────────────────────────────────────────────────────────────────

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { name?: string; businessName?: string; trade?: string; location?: string; whatsappNumber?: string }) => {
      const { data } = await api.put('/trader/profile', body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trader', 'me'] }),
  });
}
