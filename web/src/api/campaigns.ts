import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './client';

export interface Campaign {
  id: number;
  name: string;
  message: string;
  channel_id: number;
  template_id?: number;
  status: 'draft' | 'scheduled' | 'running' | 'completed' | 'failed';
  scheduled_at?: string;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

interface CampaignInput {
  name: string;
  message?: string;
  channel_id: number;
  template_id?: number;
  scheduled_at?: string;
}

export const useCampaigns = () =>
  useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.get<{ data: Campaign[] }>('/campaigns').then(r => r.data.data),
  });

export const useCreateCampaign = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CampaignInput) => api.post('/campaigns', data).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });
};

export const useWhatsAppPricing = () =>
  useQuery({
    queryKey: ['whatsapp-pricing'],
    queryFn: () =>
      api.get<{ data: unknown[] }>('/admin/whatsapp-pricing').then(r => r.data.data),
  });
