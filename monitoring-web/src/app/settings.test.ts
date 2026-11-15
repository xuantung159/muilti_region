import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, resolveDefaultDemoMode, serializeSettings, STORAGE_KEY } from './settings';

afterEach(() => localStorage.clear());

describe('chế độ dữ liệu mặc định', () => {
  it('bản build production không cấu hình thì dùng dữ liệu thật, không hiện request mẫu', () => {
    expect(resolveDefaultDemoMode(undefined, true)).toBe(false);
    expect(resolveDefaultDemoMode('', true)).toBe(false);
    expect(resolveDefaultDemoMode('live', true)).toBe(false);
  });

  it('chỉ dev hoặc khi đặt rõ VITE_DEFAULT_DATA_MODE=mock mới mặc định dùng mock', () => {
    expect(resolveDefaultDemoMode(undefined, false)).toBe(true);
    expect(resolveDefaultDemoMode('mock', true)).toBe(true);
    expect(resolveDefaultDemoMode(' LIVE ', false)).toBe(false);
  });
});

describe('lưu thiết lập', () => {
  it('bỏ qua demoMode của định dạng cũ, vốn tự ghi cả giá trị mặc định lúc build', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, demoMode: !DEFAULT_SETTINGS.demoMode, range: '24h' }));
    const loaded = loadSettings();
    expect(loaded.demoMode).toBe(DEFAULT_SETTINGS.demoMode);
    expect(loaded.range).toBe('24h'); // các thiết lập khác vẫn giữ
  });

  it('không lưu demoMode khi người dùng chưa đổi, nên bản build mới đổi mặc định thì trình duyệt theo mặc định mới', () => {
    const stored = JSON.parse(serializeSettings(DEFAULT_SETTINGS));
    expect(stored).not.toHaveProperty('demoMode');
    expect(stored.v).toBe(2);
  });

  it('giữ lựa chọn demo người dùng chủ động bật trong Settings', () => {
    const chosen = { ...DEFAULT_SETTINGS, demoMode: !DEFAULT_SETTINGS.demoMode };
    localStorage.setItem(STORAGE_KEY, serializeSettings(chosen));
    expect(loadSettings().demoMode).toBe(chosen.demoMode);
  });
});
