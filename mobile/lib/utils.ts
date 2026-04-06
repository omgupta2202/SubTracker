export function formatINR(amount: number): string {
  return '₹' + Math.abs(amount).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function pluralise(n: number, word: string): string {
  return `${n} ${word}${n !== 1 ? 's' : ''}`;
}
