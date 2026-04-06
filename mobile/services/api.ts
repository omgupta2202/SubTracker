import * as SecureStore from 'expo-secure-store';
import { API_BASE } from '@/constants/api';
import type {
  AuthUser, Subscription, EMI, CreditCard, BankAccount,
  Receivable, CapExItem, Rent, SmartAllocationResponse,
  CardTransaction, GmailStatus, SyncResult,
} from '@/types';

// ── Token helpers ─────────────────────────────────────────────────────────────

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync('auth_token');
}

export async function setStoredToken(token: string): Promise<void> {
  await SecureStore.setItemAsync('auth_token', token);
}

export async function clearStoredToken(): Promise<void> {
  await SecureStore.deleteItemAsync('auth_token');
}

export async function getStoredUser(): Promise<AuthUser | null> {
  const raw = await SecureStore.getItemAsync('auth_user');
  return raw ? JSON.parse(raw) : null;
}

export async function setStoredUser(user: AuthUser): Promise<void> {
  await SecureStore.setItemAsync('auth_user', JSON.stringify(user));
}

export async function clearStoredUser(): Promise<void> {
  await SecureStore.deleteItemAsync('auth_user');
}

// ── Core request ──────────────────────────────────────────────────────────────

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = await getStoredToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });

  if (res.status === 401) {
    await clearStoredToken();
    await clearStoredUser();
    throw new Error('UNAUTHORIZED');
  }

  const json = (await res.json()) as { data: T | null; error: string | null };
  if (!res.ok || json.error) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return json.data as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const loginUser = (email: string, password: string) =>
  request<{ access_token: string; user: AuthUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

export const registerUser = (email: string, password: string, name?: string) =>
  request<{ message: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });

export const updateUser = (d: { name?: string; email?: string; password?: string }) =>
  request<AuthUser>('/auth/me', { method: 'PUT', body: JSON.stringify(d) });

export const deleteUser = () =>
  request<{ message: string }>('/auth/me', { method: 'DELETE' });

// ── Subscriptions ─────────────────────────────────────────────────────────────

export const getSubscriptions = () => request<Subscription[]>('/subscriptions');
export const createSubscription = (d: Omit<Subscription, 'id'>) =>
  request<Subscription>('/subscriptions', { method: 'POST', body: JSON.stringify(d) });
export const updateSubscription = (id: string, d: Partial<Omit<Subscription, 'id'>>) =>
  request<Subscription>(`/subscriptions/${id}`, { method: 'PUT', body: JSON.stringify(d) });
export const deleteSubscription = (id: string) =>
  request<{ deleted: string }>(`/subscriptions/${id}`, { method: 'DELETE' });

// ── EMIs ──────────────────────────────────────────────────────────────────────

export const getEmis = () => request<EMI[]>('/emis');
export const createEmi = (d: Omit<EMI, 'id'>) =>
  request<EMI>('/emis', { method: 'POST', body: JSON.stringify(d) });
export const updateEmi = (id: string, d: Partial<Omit<EMI, 'id'>>) =>
  request<EMI>(`/emis/${id}`, { method: 'PUT', body: JSON.stringify(d) });
export const deleteEmi = (id: string) =>
  request<{ deleted: string }>(`/emis/${id}`, { method: 'DELETE' });

// ── Credit Cards ──────────────────────────────────────────────────────────────

export const getCards = () => request<CreditCard[]>('/cards');
export const createCard = (d: Omit<CreditCard, 'id' | 'due_date_offset'>) =>
  request<CreditCard>('/cards', { method: 'POST', body: JSON.stringify(d) });
export const updateCard = (id: string, d: Partial<Omit<CreditCard, 'id' | 'due_date_offset'>>) =>
  request<CreditCard>(`/cards/${id}`, { method: 'PUT', body: JSON.stringify(d) });
export const deleteCard = (id: string) =>
  request<{ deleted: string }>(`/cards/${id}`, { method: 'DELETE' });

export const getCardTransactions = (cardId: string) =>
  request<CardTransaction[]>(`/cards/${cardId}/transactions`);
export const addCardTransaction = (cardId: string, d: { description: string; amount: number; txn_date?: string }) =>
  request<CardTransaction>(`/cards/${cardId}/transactions`, { method: 'POST', body: JSON.stringify(d) });
export const deleteCardTransaction = (cardId: string, txnId: string) =>
  request<{ deleted: string }>(`/cards/${cardId}/transactions/${txnId}`, { method: 'DELETE' });

// ── Bank Accounts ─────────────────────────────────────────────────────────────

export const getAccounts = () => request<BankAccount[]>('/accounts');
export const createAccount = (d: Omit<BankAccount, 'id'>) =>
  request<BankAccount>('/accounts', { method: 'POST', body: JSON.stringify(d) });
export const updateAccount = (id: string, d: Partial<Omit<BankAccount, 'id'>>) =>
  request<BankAccount>(`/accounts/${id}`, { method: 'PUT', body: JSON.stringify(d) });
export const deleteAccount = (id: string) =>
  request<{ deleted: string }>(`/accounts/${id}`, { method: 'DELETE' });

// ── Receivables ───────────────────────────────────────────────────────────────

export const getReceivables = () => request<Receivable[]>('/receivables');
export const createReceivable = (d: Omit<Receivable, 'id'>) =>
  request<Receivable>('/receivables', { method: 'POST', body: JSON.stringify(d) });
export const updateReceivable = (id: string, d: Partial<Omit<Receivable, 'id'>>) =>
  request<Receivable>(`/receivables/${id}`, { method: 'PUT', body: JSON.stringify(d) });
export const deleteReceivable = (id: string) =>
  request<{ deleted: string }>(`/receivables/${id}`, { method: 'DELETE' });

// ── CapEx ─────────────────────────────────────────────────────────────────────

export const getCapex = () => request<CapExItem[]>('/capex');
export const createCapex = (d: Omit<CapExItem, 'id'>) =>
  request<CapExItem>('/capex', { method: 'POST', body: JSON.stringify(d) });
export const updateCapex = (id: string, d: Partial<Omit<CapExItem, 'id'>>) =>
  request<CapExItem>(`/capex/${id}`, { method: 'PUT', body: JSON.stringify(d) });
export const deleteCapex = (id: string) =>
  request<{ deleted: string }>(`/capex/${id}`, { method: 'DELETE' });

// ── Rent ──────────────────────────────────────────────────────────────────────

export const getRent = () => request<Rent>('/rent');
export const updateRent = (d: Rent) =>
  request<Rent>('/rent', { method: 'PUT', body: JSON.stringify(d) });

// ── Smart Allocation ──────────────────────────────────────────────────────────

export const getSmartAllocation = () =>
  request<SmartAllocationResponse>('/smart-allocation');

// ── Gmail ─────────────────────────────────────────────────────────────────────

export const getGmailStatus = () => request<GmailStatus>('/gmail/status');
export const syncGmail = () => request<SyncResult>('/gmail/sync', { method: 'POST' });
export const disconnectGmail = () =>
  request<{ disconnected: boolean }>('/gmail/disconnect', { method: 'DELETE' });
export const getGmailConnectUrl = () =>
  request<{ oauth_url: string }>('/gmail/connect?mobile=1');

// ── Google SSO ────────────────────────────────────────────────────────────────

export const loginWithGoogle = (idToken: string) =>
  request<{ access_token: string; user: AuthUser }>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ id_token: idToken }),
  });
