import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './client';

export interface Template {
  id: number;
  name: string;
  body: string;
  category: string;
  language: string;
  status: string;
  external_id: string;
}

interface TemplateInput {
  name: string;
  body: string;
  category?: string;
  language?: string;
}

export const useTemplates = () =>
  useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<{ data: Template[] }>('/templates').then(r => r.data.data),
  });

export const useCreateTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: TemplateInput) => api.post('/templates', data).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
};

export const useUpdateTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: TemplateInput & { id: number }) =>
      api.put(`/templates/${id}`, data).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
};

export const useDeleteTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
};
