import { screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NotConnectedProvider } from '../data/providers';
import { TOKEN_KEY } from '../portal/client';
import { renderApp } from '../test/render';
const reports = vi.fn(async () => []);
const base = new NotConnectedProvider();
const provider = { id: 'http' as const, getSnapshot: base.getSnapshot.bind(base), getEndpoints: reports, getRoutes: reports, getSources: reports, getIncidents: reports };
afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); reports.mockClear(); });
it('anonymous cannot query incident reports', async () => {
  sessionStorage.clear(); renderApp(provider, '/incidents');
  expect(await screen.findByText('Đăng nhập để xem báo cáo')).toBeInTheDocument();
  expect(reports).not.toHaveBeenCalled();
});
it('signed in without active keys cannot query incident reports', async () => {
  sessionStorage.setItem(TOKEN_KEY, 'a'.repeat(64));
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ keys: [{ status: 'revoked' }] }), { headers: { 'Content-Type': 'application/json' } }));
  renderApp(provider, '/incidents');
  expect(await screen.findByText('Đăng ký API key để xem báo cáo')).toBeInTheDocument();
  expect(reports).not.toHaveBeenCalled();
});
it('signed in with an active key can query incident reports', async () => {
  sessionStorage.setItem(TOKEN_KEY, 'a'.repeat(64));
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ keys: [{ status: 'active' }] }), { headers: { 'Content-Type': 'application/json' } }));
  renderApp(provider, '/incidents');
  expect(await screen.findByRole('heading', { name: 'Failover & Incidents' })).toBeInTheDocument();
  expect(reports).toHaveBeenCalledOnce();
});
it('anonymous sees a one-click demo option next to sign in', async () => {
  sessionStorage.clear(); renderApp(provider, '/');
  expect(await screen.findByRole('button', { name: 'Xem ngay bằng dữ liệu demo' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Đăng nhập / Đăng ký' })).toHaveAttribute('href', '/portal');
});
