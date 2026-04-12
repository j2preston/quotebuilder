import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import type { Quote, UpdateQuoteRequest } from '@quotebot/shared';

// ─── List (paginated, infinite scroll) ───────────────────────────────────────

export function useQuotes(status?: string) {
  return useQuery({
    queryKey: ['quotes', status],
    queryFn: async () => {
      const { data } = await api.get('/quotes', { params: { ...(status ? { status } : {}), limit: 20 } });
      return data as { quotes: Quote[]; total: number; page: number; limit: number };
    },
  });
}

export function useQuotesInfinite(status?: string) {
  return useInfiniteQuery({
    queryKey: ['quotes-inf', status],
    queryFn: async ({ pageParam = 1 }) => {
      const { data } = await api.get('/quotes', {
        params: { ...(status ? { status } : {}), page: pageParam, limit: 20 },
      });
      return data as { quotes: Quote[]; total: number; page: number; limit: number };
    },
    getNextPageParam: (last) => {
      const fetched = last.page * last.limit;
      return fetched < last.total ? last.page + 1 : undefined;
    },
    initialPageParam: 1,
  });
}

// ─── Single quote ─────────────────────────────────────────────────────────────

export function useQuote(id: string) {
  return useQuery({
    queryKey: ['quotes', id],
    queryFn: async () => {
      const { data } = await api.get(`/quotes/${id}`);
      return data.quote as Quote;
    },
    enabled: !!id,
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useUpdateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateQuoteRequest & { id: string }) => {
      const { data } = await api.put(`/quotes/${id}`, body);
      return data.quote as Quote;
    },
    onSuccess: (quote) => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['quotes-inf'] });
      qc.setQueryData(['quotes', quote.id], quote);
    },
  });
}

export function useUpdateLineItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, lineItems }: { id: string; lineItems: Array<{ description: string; qty: number; unitPrice: number; sortOrder?: number }> }) => {
      const { data } = await api.put(`/quotes/${id}/line-items`, lineItems);
      return data.quote as Quote;
    },
    onSuccess: (quote) => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.setQueryData(['quotes', quote.id], quote);
    },
  });
}

export function useDeleteQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/quotes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['quotes-inf'] });
    },
  });
}

export function useGeneratePdf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.get(`/quotes/${id}/pdf`);
      return data as { pdfUrl: string };
    },
    onSuccess: (_, id) => qc.invalidateQueries({ queryKey: ['quotes', id] }),
  });
}

export function useSendQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, whatsappOverride }: { id: string; whatsappOverride?: string }) => {
      const { data } = await api.post(`/quotes/${id}/send`, whatsappOverride ? { whatsapp: whatsappOverride } : {});
      return data as { status: string; needsWhatsapp?: boolean };
    },
    onSuccess: (_, { id }) => qc.invalidateQueries({ queryKey: ['quotes', id] }),
  });
}

export type CorrectionResult =
  | { status: 'calibrated'; jobLabel: string; oldHours: number; newHours: number; corrections: number }
  | { status: 'logged'; jobLabel?: string; correctionCount: number; neededToCalibrate: number };

export function useLogCorrection() {
  return useMutation({
    mutationFn: async ({
      quoteId, jobKey, field, oldValue, newValue, reason,
    }: { quoteId: string; jobKey: string; field: string; oldValue: number; newValue: number; reason: string }): Promise<CorrectionResult> => {
      const { data } = await api.post(`/quotes/${quoteId}/corrections`, { jobKey, field, oldValue, newValue, reason });
      return data as CorrectionResult;
    },
  });
}

export function useUploadVoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/quotes/transcribe', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data as { status: string; quoteId?: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['quotes-inf'] });
    },
  });
}
