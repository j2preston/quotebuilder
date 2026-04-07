import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { QuoteStatus } from '@quotebot/shared';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft:    'Draft',
  sent:     'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired:  'Expired',
};

export const STATUS_COLORS: Record<QuoteStatus, string> = {
  draft:    'bg-gray-100 text-gray-700',
  sent:     'bg-purple-100 text-purple-800',
  accepted: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-800',
  expired:  'bg-gray-100 text-gray-500',
};
