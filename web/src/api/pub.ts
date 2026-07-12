import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './client';

export interface PubPost {
  id: number;
  title: string;
  content: string;
  channel: string;
  status: 'draft' | 'scheduled' | 'published';
  scheduled_at?: string;
  published_at?: string;
  created_at: string;
}

export interface PubLead {
  id: number;
  name: string;
  email: string;
  phone: string;
  source: string;
  status: string;
  created_at: string;
}

export const usePubDashboard = () =>
  useQuery({
    queryKey: ['pub-dashboard'],
    queryFn: () => api.get('/pub/dashboard').then(r => r.data),
  });

export const usePubPosts = () =>
  useQuery({
    queryKey: ['pub-posts'],
    queryFn: () => api.get<{ data: PubPost[] }>('/pub/posts').then(r => r.data.data),
  });

export const useCreatePubPost = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<PubPost>) => api.post('/pub/posts', data).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pub-posts'] }),
  });
};

export const useUpdatePubPost = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<PubPost> & { id: number }) =>
      api.put(`/pub/posts/${id}`, data).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pub-posts'] }),
  });
};

export const useDeletePubPost = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/pub/posts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pub-posts'] }),
  });
};

export const usePubLeads = () =>
  useQuery({
    queryKey: ['pub-leads'],
    queryFn: () => api.get<{ data: PubLead[] }>('/pub/leads').then(r => r.data.data),
  });

export const usePubAnalytics = () =>
  useQuery({
    queryKey: ['pub-analytics'],
    queryFn: () => api.get('/pub/analytics').then(r => r.data),
  });
