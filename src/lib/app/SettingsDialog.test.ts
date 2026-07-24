import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NodeDto } from '../generated/graph';
import { translate, type MessageKey } from '../i18n';
import SettingsDialog from './SettingsDialog.svelte';

const t = (key: MessageKey, values: Record<string, string | number> = {}) =>
  translate('en', key, values);
const builtInAudio: NodeDto = {
  id: 3,
  name: 'alsa_output.pci',
  mediaName: 'Built-in Audio',
  objectName: 'alsa_output.pci',
  kind: 'input',
};
const effects: NodeDto = {
  id: 2,
  name: 'easyeffects_sink',
  mediaName: 'EasyEffects',
  objectName: 'easyeffects_sink',
  kind: 'duplex',
};
const builtInMicrophone: NodeDto = {
  id: 70,
  name: 'alsa_input.pci',
  mediaName: 'Built-in Microphone',
  objectName: 'alsa_input.pci',
  kind: 'output',
};
const usbMicrophone: NodeDto = {
  id: 71,
  name: 'alsa_input.usb',
  mediaName: 'USB Microphone',
  objectName: 'alsa_input.usb',
  kind: 'output',
};

function defaultDeviceProps() {
  return {
    status: { state: 'connected' as const, detail: null },
    defaultAudioSources: [builtInMicrophone, usbMicrophone],
    activeDefaultAudioSource: builtInMicrophone,
    displayedDefaultAudioSourceId: 70 as number | '',
    pendingDefaultAudioSourceNodeId: null,
    defaultAudioSourceName: builtInMicrophone.objectName!,
    defaultAudioSinks: [builtInAudio, effects],
    activeDefaultAudioSink: builtInAudio,
    displayedDefaultAudioSinkId: 3 as number | '',
    pendingDefaultAudioSinkNodeId: null,
    defaultAudioSinkName: builtInAudio.objectName!,
    outputSpectrumEnabled: true,
    onDefaultAudioSourceChange: vi.fn(),
    onDefaultAudioSinkChange: vi.fn(),
    onOutputSpectrumChange: vi.fn(),
  };
}

afterEach(cleanup);

describe('SettingsDialog', () => {
  it('is an independent modal with language and resync actions', async () => {
    const onLocaleChange = vi.fn();
    const onResync = vi.fn();
    const onClose = vi.fn();
    const { getByRole, getByTestId } = render(SettingsDialog, {
      props: {
        ...defaultDeviceProps(),
        locale: 'en',
        resyncing: false,
        t,
        onLocaleChange,
        onResync,
        onClose,
      },
    });

    const dialog = getByRole('dialog', { name: 'Settings' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(getByTestId('settings-menu-close'));
    expect((getByRole('combobox', { name: 'Default playback' }) as HTMLSelectElement).value).toBe(
      '3',
    );
    expect((getByRole('combobox', { name: 'Default input' }) as HTMLSelectElement).value).toBe(
      '70',
    );

    await fireEvent.change(getByRole('combobox', { name: 'Language' }), {
      target: { value: 'zh-CN' },
    });
    await fireEvent.click(getByRole('button', { name: 'Resync graph' }));
    expect(onLocaleChange).toHaveBeenCalledOnce();
    expect(onResync).toHaveBeenCalledOnce();

    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('traps keyboard focus and disables resync while it is running', async () => {
    const onClose = vi.fn();
    const { getByRole, getByTestId } = render(SettingsDialog, {
      props: {
        ...defaultDeviceProps(),
        locale: 'en',
        resyncing: true,
        t,
        onLocaleChange: vi.fn(),
        onResync: vi.fn(),
        onClose,
      },
    });

    const close = getByTestId('settings-menu-close');
    const spectrumToggle = getByTestId('settings-output-spectrum-toggle');
    expect(
      (
        getByRole('button', {
          name: 'Resyncing the PipeWire graph.',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    spectrumToggle.focus();
    await fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    close.focus();
    await fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(spectrumToggle);
  });

  it('changes the default playback and input devices from settings', async () => {
    const onDefaultAudioSinkChange = vi.fn();
    const onDefaultAudioSourceChange = vi.fn();
    const { getByRole } = render(SettingsDialog, {
      props: {
        ...defaultDeviceProps(),
        locale: 'en',
        resyncing: false,
        t,
        onDefaultAudioSinkChange,
        onDefaultAudioSourceChange,
        onLocaleChange: vi.fn(),
        onResync: vi.fn(),
        onClose: vi.fn(),
      },
    });

    await fireEvent.change(getByRole('combobox', { name: 'Default playback' }), {
      target: { value: '2' },
    });
    await fireEvent.change(getByRole('combobox', { name: 'Default input' }), {
      target: { value: '71' },
    });

    expect(onDefaultAudioSinkChange).toHaveBeenCalledOnce();
    expect(onDefaultAudioSourceChange).toHaveBeenCalledOnce();
  });

  it('changes the audio spectrum background preference without status text', async () => {
    const onOutputSpectrumChange = vi.fn();
    const { getByTestId } = render(SettingsDialog, {
      props: {
        ...defaultDeviceProps(),
        locale: 'en',
        resyncing: false,
        t,
        onLocaleChange: vi.fn(),
        onOutputSpectrumChange,
        onResync: vi.fn(),
        onClose: vi.fn(),
      },
    });

    const control = getByTestId('settings-output-spectrum-control');
    const toggle = getByTestId('settings-output-spectrum-toggle') as HTMLInputElement;
    expect(control.textContent?.trim()).toBe('Audio spectrum background');
    expect(toggle.checked).toBe(true);

    await fireEvent.click(toggle);
    expect(onOutputSpectrumChange).toHaveBeenCalledOnce();
  });
});
