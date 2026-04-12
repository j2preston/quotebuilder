import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import type { RateCard, JobLibraryEntry, UpdateRateCardRequest } from '@quotebot/shared';

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
    mutationFn: async (body: UpdateRateCardRequest) => {
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

export function useCreateJobEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { jobKey: string; label: string; labourHours: number; materials: { item: string; cost: number }[] }) => {
      const { data } = await api.post('/trader/job-library', body);
      return data as { jobEntry: JobLibraryEntry };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trader', 'job-library'] }),
  });
}

export function useDeleteJobEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/trader/job-library/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trader', 'job-library'] }),
  });
}

export function useUpdateJobMaterials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, materials }: { id: string; materials: { item: string; cost: number }[] }) => {
      const { data } = await api.put(`/trader/job-library/${id}/materials`, { materials });
      return data as { jobEntry: JobLibraryEntry };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trader', 'job-library'] }),
  });
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/trader/onboarding/complete');
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trader', 'me'] }),
  });
}

// ─── Materials reviewed ───────────────────────────────────────────────────────

export function useMarkMaterialsReviewed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/trader/materials/reviewed');
      return data as { materialsReviewedAt: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trader', 'me'] }),
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
