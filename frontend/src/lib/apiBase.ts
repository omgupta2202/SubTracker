const DEFAULT_API_BASE = "/api";

export function getApiBase(): string {
  const rawBase = (import.meta as any).env?.VITE_API_BASE ?? DEFAULT_API_BASE;
  return String(rawBase).replace(/\/$/, "");
}