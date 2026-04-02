import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import type { Quote, UpdateQuoteRequest } from '@quotebot/shared';

export function useQuotes(status?: string) {
  return useQuery({
    queryKey: ['quotes', status],
    queryFn: async () => {
      const { data } = await api.get('/quotes', { params: status ? { status } : {} });
      return data as { data: Quote[]; total: number; page: number; pageSize: number };
    },
  });
}

export function useQuote(id: string) {
  return useQuery({
    queryKey: ['quotes', id],
    queryFn: async () => {
      const { data } = await api.get(`/quotes/${id}`);
      return data as Quote;
    },
    enabled: !!id,
  });
}

export function useUpdateQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateQuoteRequest & { id: string }) => {
      const { data } = await api.patch(`/quotes/${id}`, body);
      return data as Quote;
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
  });
}

export function useGeneratePdf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/quotes/${id}/pdf`);
      return data as { pdfUrl: string };
    },
    onSuccess: (_, id) => qc.invalidateQueries({ queryKey: ['quotes', id] }),
  });
}

export function useUploadVoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await api.post('/uploads/voice', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotes'] }),
  });
}
