import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuthStore } from '../store/auth.ts';
import type { AuthResponse } from '@quotebot/shared';
import { UK_TRADES } from '@quotebot/shared';

const schema = z.object({
  name:          z.string().min(2, 'Enter your name'),
  businessName:  z.string().min(2, 'Enter your business name'),
  trade:         z.string().min(1, 'Select your trade'),
  location:      z.string().min(2, 'Enter your location'),
  email:         z.string().email('Enter a valid email'),
  password:      z.string().min(8, 'At least 8 characters'),
  labourRate:    z.coerce.number().positive('Enter your hourly rate'),
  vatRegistered: z.boolean(),
});

type FormData = z.infer<typeof schema>;

export default function RegisterPage() {
  const navigate = useNavigate();
  const { setTokens, setTrader } = useAuthStore();

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { labourRate: 45, vatRegistered: false, trade: 'Electrician' },
  });

  const { mutate, isPending, error } = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await api.post<AuthResponse>('/auth/register', data);
      return res.data;
    },
    onSuccess: (data) => {
      setTokens(data.token, '');
      setTrader(data.trader);
      navigate('/dashboard');
    },
  });

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <Zap className="h-8 w-8 text-brand-700" />
            <span className="text-2xl font-bold text-brand-700">QuoteBot</span>
          </div>
          <p className="text-gray-600 text-sm">Create your free account</p>
        </div>

        <div className="card p-6">
          <form onSubmit={handleSubmit((d) => mutate(d))} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input {...register('name')} className="input" placeholder="John Smith" />
              {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
              <input {...register('businessName')} className="input" placeholder="Smith Electrical" />
              {errors.businessName && <p className="text-red-500 text-xs mt-1">{errors.businessName.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Trade</label>
                <select {...register('trade')} className="input">
                  {UK_TRADES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {errors.trade && <p className="text-red-500 text-xs mt-1">{errors.trade.message}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                <input {...register('location')} className="input" placeholder="e.g. Manchester" />
                {errors.location && <p className="text-red-500 text-xs mt-1">{errors.location.message}</p>}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input {...register('email')} type="email" className="input" placeholder="john@smithelectrical.co.uk" />
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input {...register('password')} type="password" className="input" />
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Labour Rate (£/hr)</label>
                <input {...register('labourRate')} type="number" min={1} step={0.01} className="input" />
                {errors.labourRate && <p className="text-red-500 text-xs mt-1">{errors.labourRate.message}</p>}
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input {...register('vatRegistered')} type="checkbox" className="h-4 w-4 rounded border-gray-300 text-brand-700" />
                  <span className="text-sm font-medium text-gray-700">VAT registered</span>
                </label>
              </div>
            </div>

            {error && (
              <p className="text-red-500 text-sm text-center">
                Registration failed. Email may already be in use.
              </p>
            )}

            <button type="submit" disabled={isPending} className="btn-primary w-full">
              {isPending ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-600 mt-4">
          Already have an account?{' '}
          <Link to="/login" className="text-brand-700 font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
