import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './client';

export interface Channel {
  id: number;
  name: string;
  type: 'whatsapp' | 'messenger' | 'instagram' | 'telegram';
  description: string;
  identifier: string;
  department_id?: number;
  status: 'active' | 'inactive' | 'suspended';
  is_active: boolean;
  created_at: string;
}

interface ChannelInput {
  name: string;
  type: string;
  description?: string;
  identifier?: string;
  department_id?: number;
  credentials?: Record<string, unknown>;
}

export const useChannels = () =>
  useQuery({
    queryKey: ['channels'],
    queryFn: () => api.get<{ data: Channel[] }>('/channels').then(r => r.data.data),
  });

export const useCreateChannel = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ChannelInput) => api.post('/channels', data).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  });
};

export const useUpdateChannel = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Channel> & { id: number }) =>
      api.put(`/channels/${id}`, data).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  });
};

export const useDeleteChannel = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/channels/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['channels'] }),
  });
};
