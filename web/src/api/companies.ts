import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './client';

export interface Company {
  id: number;
  name: string;
  slug: string;
  logo_path?: string;
  primary_color: string;
  secondary_color: string;
  is_active: boolean;
  omnichannel_enabled: boolean;
  advertising_enabled: boolean;
  db_name: string;
  created_at: string;
}

interface CreateCompanyInput {
  name: string;
  slug: string;
  primary_color?: string;
  secondary_color?: string;
}

export const useCompanies = () =>
  useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get<{ data: Company[] }>('/admin/companies').then(r => r.data.data),
  });

export const useCreateCompany = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCompanyInput) =>
      api.post('/admin/companies', data).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  });
};

export const useUpdateCompany = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Company> & { id: number }) =>
      api.put(`/admin/companies/${id}`, data).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companies'] }),
  });
};
