import { useQuery } from '@tanstack/react-query';
import api from './client';

export interface DashboardStats {
  open_conversations: number;
  pending_conversations: number;
  closed_today: number;
  messages_today: number;
}

export interface MonitorConversation {
  id: number;
  case_number: string;
  status: string;
  contact?: { name: string; phone: string };
  agent?: { name: string };
  channel?: { name: string; type: string };
  last_message_at?: string;
}

export const useDashboard = () =>
  useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardStats>('/dashboard').then(r => r.data),
    refetchInterval: 30000,
  });

export const useMonitor = () =>
  useQuery({
    queryKey: ['monitor'],
    queryFn: () => api.get<{ data: MonitorConversation[] }>('/monitor').then(r => r.data.data),
    refetchInterval: 15000,
  });

export const useReports = (from?: string, to?: string) =>
  useQuery({
    queryKey: ['reports', from, to],
    queryFn: () =>
      api.get('/reports', { params: { from, to } }).then(r => r.data),
  });
