import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translate, type MessageKey } from '../i18n';
import HeaderSettings from './HeaderSettings.svelte';

const t = (key: MessageKey, values: Record<string, string | number> = {}) =>
  translate('en', key, values);

afterEach(cleanup);

describe('HeaderSettings', () => {
  it('renders the Cordflow logo and opens settings from a monochrome gear button', async () => {
    const onOpenSettings = vi.fn();
    const { container, getByTestId, queryByText } = render(HeaderSettings, {
      props: {
        settingsOpen: false,
        t,
        onOpenSettings,
        onMinimize: vi.fn(),
        onToggleMaximize: vi.fn(),
        onCloseWindow: vi.fn(),
      },
    });

    const logo = getByTestId('brand-logo') as HTMLImageElement;
    expect(logo.src).toMatch(/^(data:image\/svg\+xml|.+icon\.svg)/);
    expect(queryByText('[CF]')).toBeNull();

    const trigger = getByTestId('settings-menu-trigger');
    expect(trigger.getAttribute('aria-label')).toBe('Settings');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.querySelector('svg')).toBeTruthy();
    expect(trigger.querySelector('.ascii-icon')).toBeNull();

    await fireEvent.click(trigger);
    expect(onOpenSettings).toHaveBeenCalledWith(trigger);
    expect(container.querySelector('[data-testid="settings-menu"]')).toBeNull();
  });
});
