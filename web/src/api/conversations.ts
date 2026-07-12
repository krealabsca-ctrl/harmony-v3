import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './client';

export interface Contact {
  id: number;
  name: string;
  phone: string;
  email: string;
  avatar_url: string;
}

export interface Message {
  id: number;
  conversation_id: number;
  body: string;
  type: string;
  direction: 'inbound' | 'outbound';
  status: string;
  created_at: string;
}

export interface Conversation {
  id: number;
  case_number: string;
  status: 'open' | 'pending' | 'closed';
  contact?: Contact;
  agent?: { id: number; name: string };
  channel?: { id: number; name: string; type: string };
  tags?: { id: number; name: string; color: string }[];
  unread_count: number;
  last_message_at?: string;
  created_at: string;
}

export const useConversations = (status = 'open', page = 1) =>
  useQuery({
    queryKey: ['conversations', status, page],
    queryFn: () =>
      api.get<{ data: Conversation[]; total: number }>('/conversations', {
        params: { status, page },
      }).then(r => r.data),
    refetchInterval: 15000,
  });

export const useConversation = (id: number) =>
  useQuery({
    queryKey: ['conversation', id],
    queryFn: () =>
      api.get<{ data: Conversation }>(`/conversations/${id}`).then(r => r.data.data),
    enabled: !!id,
  });

export const useMessages = (conversationId: number, page = 1) =>
  useQuery({
    queryKey: ['messages', conversationId, page],
    queryFn: () =>
      api.get<{ data: Message[]; total: number }>(`/conversations/${conversationId}/messages`, {
        params: { page },
      }).then(r => r.data),
    enabled: !!conversationId,
  });

export const useSendMessage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ conversationId, body, type = 'text' }: { conversationId: number; body: string; type?: string }) =>
      api.post(`/conversations/${conversationId}/messages`, { body, type }).then(r => r.data.data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['messages', vars.conversationId] });
    },
  });
};

export const useAssignConversation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, agent_id, department_id }: { id: number; agent_id?: number; department_id?: number }) =>
      api.put(`/conversations/${id}/assign`, { agent_id, department_id }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['conversation', vars.id] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
};

export const useCloseConversation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.put(`/conversations/${id}/close`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conversations'] }),
  });
};

export const useChatHistory = (page = 1) =>
  useQuery({
    queryKey: ['chat-history', page],
    queryFn: () =>
      api.get<{ data: Conversation[]; total: number }>('/chat-history', { params: { page } }).then(r => r.data),
  });
