import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './client';

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'supervisor' | 'agent' | 'mercadeo';
  department_id?: number;
  is_online: boolean;
  can_send_campaigns: boolean;
  can_access_advertising: boolean;
  created_at: string;
}

interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: string;
  department_id?: number;
}

interface UpdateUserInput {
  name?: string;
  email?: string;
  password?: string;
  role?: string;
  department_id?: number;
}

export const useUsers = () =>
  useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ data: User[] }>('/admin/users').then(r => r.data.data),
  });

export const useCreateUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserInput) => api.post('/admin/users', data).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
};

export const useUpdateUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: UpdateUserInput & { id: number }) =>
      api.put(`/admin/users/${id}`, data).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
};

export const useDeleteUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
};

export const useToggleCampaigns = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post(`/admin/users/${id}/toggle-campaigns`).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
};

export const useToggleAdvertising = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post(`/admin/users/${id}/toggle-advertising`).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
};
