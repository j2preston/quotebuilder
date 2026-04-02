import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.ts';
import { useAuthStore } from '../store/auth.ts';

type FormData = {
  fullName: string;
  businessName: string;
  phone: string;
  vatNumber: string;
  addressLine1: string;
  city: string;
  postcode: string;
  defaultVatRate: number;
  defaultMarkup: number;
  defaultLabourRate: number;
  quoteValidityDays: number;
  paymentTermsDays: number;
  quoteFooterText: string;
  whatsappNumber: string;
};

export default function SettingsPage() {
  const { trader, setTrader } = useAuthStore();

  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<FormData>({
    defaultValues: {
      fullName: trader?.fullName ?? '',
      businessName: trader?.businessName ?? '',
      phone: trader?.phone ?? '',
      vatNumber: trader?.vatNumber ?? '',
      addressLine1: trader?.addressLine1 ?? '',
      city: trader?.city ?? '',
      postcode: trader?.postcode ?? '',
      defaultVatRate: trader?.defaultVatRate ?? 20,
      defaultMarkup: (trader as { defaultMarkup?: number })?.defaultMarkup ?? 20,
      defaultLabourRate: (trader as { defaultLabourRate?: number })?.defaultLabourRate ?? 4500,
      quoteValidityDays: trader?.quoteValidityDays ?? 30,
      paymentTermsDays: trader?.paymentTermsDays ?? 14,
      quoteFooterText: trader?.quoteFooterText ?? '',
      whatsappNumber: trader?.whatsappNumber ?? '',
    },
  });

  const { mutate, isPending, isSuccess } = useMutation({
    mutationFn: async (data: FormData) => {
      const { data: updated } = await api.patch('/trader/profile', {
        ...data,
        defaultLabourRate: Number(data.defaultLabourRate),
        defaultVatRate: Number(data.defaultVatRate),
        defaultMarkup: Number(data.defaultMarkup),
        quoteValidityDays: Number(data.quoteValidityDays),
        paymentTermsDays: Number(data.paymentTermsDays),
      });
      return updated;
    },
    onSuccess: (data) => setTrader(data),
  });

  return (
    <div className="max-w-lg space-y-6 pb-20 md:pb-0">
      <h1 className="text-xl font-bold text-gray-900">Settings</h1>

      <form onSubmit={handleSubmit((d) => mutate(d))} className="space-y-6">
        {/* Business */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">Business Details</h2>
          <Field label="Full Name" error={errors.fullName?.message}>
            <input {...register('fullName', { required: 'Required' })} className="input" />
          </Field>
          <Field label="Business Name">
            <input {...register('businessName')} className="input" />
          </Field>
          <Field label="Phone">
            <input {...register('phone')} type="tel" className="input" />
          </Field>
          <Field label="VAT Number" hint="Optional">
            <input {...register('vatNumber')} className="input" placeholder="GB123456789" />
          </Field>
          <Field label="Address">
            <input {...register('addressLine1')} className="input" placeholder="Street address" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="City">
              <input {...register('city')} className="input" />
            </Field>
            <Field label="Postcode">
              <input {...register('postcode')} className="input" />
            </Field>
          </div>
        </div>

        {/* Quote defaults */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">Quote Defaults</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="VAT Rate (%)" hint="Usually 20">
              <input {...register('defaultVatRate')} type="number" className="input" min={0} max={100} />
            </Field>
            <Field label="Markup (%)">
              <input {...register('defaultMarkup')} type="number" className="input" min={0} />
            </Field>
          </div>
          <Field label="Labour Rate (pence/hr)" hint="£45/hr = 4500">
            <input {...register('defaultLabourRate')} type="number" className="input" min={0} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quote Valid (days)">
              <input {...register('quoteValidityDays')} type="number" className="input" min={1} />
            </Field>
            <Field label="Payment Terms (days)">
              <input {...register('paymentTermsDays')} type="number" className="input" min={0} />
            </Field>
          </div>
          <Field label="Quote Footer Text" hint="Optional">
            <textarea {...register('quoteFooterText')} className="input resize-none" rows={3} placeholder="Payment terms, guarantees, etc." />
          </Field>
        </div>

        {/* WhatsApp */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-gray-900">WhatsApp Bot</h2>
          <Field label="WhatsApp Number" hint="Include country code, e.g. +447700900000">
            <input {...register('whatsappNumber')} type="tel" className="input" placeholder="+447700900000" />
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={!isDirty || isPending} className="btn-primary">
            {isPending ? 'Saving…' : 'Save Changes'}
          </button>
          {isSuccess && <p className="text-sm text-green-600">Saved!</p>}
        </div>
      </form>
    </div>
  );
}

function Field({ label, hint, error, children }: {
  label: string; hint?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        {hint && <span className="text-xs text-gray-400">{hint}</span>}
      </div>
      {children}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}
