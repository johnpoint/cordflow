import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translate, type MessageKey } from '../i18n';
import OutputVolumeWorkspace from './OutputVolumeWorkspace.svelte';

const t = (key: MessageKey, values: Record<string, string | number> = {}) =>
  translate('en', key, values);
const tZh = (key: MessageKey, values: Record<string, string | number> = {}) =>
  translate('zh-CN', key, values);

describe('OutputVolumeWorkspace', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('changes volume and mute for an output device', async () => {
    const onSetVolume = vi.fn();
    const onSetMuted = vi.fn();
    const onSetDefault = vi.fn();
    const { getByTestId, getByText, queryByTestId } = render(OutputVolumeWorkspace, {
      props: {
        applications: [],
        nodes: [
          {
            id: 3,
            name: 'alsa_output.pci',
            mediaName: 'Built-in Audio',
            mediaClass: 'Audio/Sink',
            objectName: 'alsa_output.pci',
            kind: 'input',
            volumePercent: 65,
            muted: false,
          },
        ],
        outputLevels: { 3: 0.5 },
        defaultAudioSinkName: 'alsa_output.pci',
        pendingNodeIds: new Set<number>(),
        pendingDefaultNodeId: null,
        t,
        onSetVolume,
        onSetMuted,
        onSetDefault,
        onSetApplicationVolume: vi.fn(),
        onSetApplicationMuted: vi.fn(),
      },
    });

    expect(getByText('Built-in Audio')).toBeTruthy();
    expect(getByText('Default')).toBeTruthy();
    expect((getByTestId('output-volume-number-3') as HTMLInputElement).value).toBe('65');
    const meter = getByTestId('output-level-meter-3');
    expect(meter.getAttribute('role')).toBe('meter');
    expect(Number(meter.getAttribute('aria-valuenow'))).toBeCloseTo(-17.25, 1);
    expect(getByTestId('output-level-value-3').textContent).toContain('-17.2 dBFS');
    expect(
      Number.parseFloat((getByTestId('output-level-fill-3') as HTMLElement).style.width),
    ).toBeCloseTo((65 / 150) * 100);

    const slider = getByTestId('output-volume-slider-3');
    expect(slider.getAttribute('aria-orientation')).toBeNull();
    expect(slider.getAttribute('step')).toBe('1');
    await fireEvent.input(slider, {
      target: { value: '72' },
    });
    expect((getByTestId('output-volume-number-3') as HTMLInputElement).value).toBe('72');
    expect(onSetVolume).toHaveBeenLastCalledWith(3, 72);

    await fireEvent.change(getByTestId('output-volume-number-3'), {
      target: { value: '95' },
    });
    expect(onSetVolume).toHaveBeenLastCalledWith(3, 95);

    await fireEvent.input(slider, { target: { value: '120' } });
    expect(getByTestId('output-volume-boost-hint-3')).toBeTruthy();
    expect(queryByTestId('output-volume-clipping-risk-3')).toBeNull();
    expect(localStorage.getItem('cordflow.output-volume-boost-warning-seen')).toBe('true');
    await fireEvent.click(getByTestId('output-volume-boost-dismiss-3'));
    expect(getByTestId('output-volume-clipping-risk-3')).toBeTruthy();

    await fireEvent.click(getByTestId('output-volume-reset-3'));
    expect(onSetVolume).toHaveBeenLastCalledWith(3, 100);
    expect(queryByTestId('output-volume-clipping-risk-3')).toBeNull();
    await fireEvent.click(getByTestId('output-volume-mute-3'));

    expect(onSetMuted).toHaveBeenCalledWith(3, true);
  });

  it('expresses the muted state with text and pressed styling', () => {
    const { getByTestId } = render(OutputVolumeWorkspace, {
      props: {
        applications: [],
        nodes: [
          {
            id: 3,
            name: 'alsa_output.pci',
            mediaName: 'Built-in Audio',
            mediaClass: 'Audio/Sink',
            objectName: 'alsa_output.pci',
            kind: 'input',
            volumePercent: 65,
            muted: true,
          },
        ],
        outputLevels: { 3: 0.8 },
        defaultAudioSinkName: 'alsa_output.pci',
        pendingNodeIds: new Set<number>(),
        pendingDefaultNodeId: null,
        t,
        onSetVolume: vi.fn(),
        onSetMuted: vi.fn(),
        onSetDefault: vi.fn(),
        onSetApplicationVolume: vi.fn(),
        onSetApplicationMuted: vi.fn(),
      },
    });

    const device = getByTestId('output-volume-device-3');
    const mute = getByTestId('output-volume-mute-3');
    expect(device.classList.contains('output-volume-card--muted')).toBe(true);
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    expect(mute.getAttribute('title')).toBe('Click to restore sound');
    expect(mute.querySelector('.output-volume-card__mute-icon')).toBeNull();
    expect(mute.textContent).toContain('Muted');
    expect(getByTestId('output-level-meter-3').getAttribute('aria-valuetext')).toBe('−∞ dBFS');
  });

  it('shows complete localized device types instead of abbreviations', () => {
    const { getByTestId } = render(OutputVolumeWorkspace, {
      props: {
        applications: [],
        nodes: [
          {
            id: 2,
            name: 'easyeffects_sink',
            mediaName: 'EasyEffects',
            mediaClass: 'Audio/Sink/Virtual',
            objectName: 'easyeffects_sink',
            kind: 'input',
            volumePercent: 100,
            muted: false,
          },
          {
            id: 4,
            name: 'alsa_output.hdmi',
            mediaName: 'HDMI',
            mediaClass: 'Audio/Sink',
            objectName: 'alsa_output.hdmi',
            kind: 'input',
            volumePercent: 80,
            muted: false,
          },
        ],
        outputLevels: {},
        defaultAudioSinkName: null,
        pendingNodeIds: new Set<number>(),
        pendingDefaultNodeId: null,
        t: tZh,
        onSetVolume: vi.fn(),
        onSetMuted: vi.fn(),
        onSetDefault: vi.fn(),
        onSetApplicationVolume: vi.fn(),
        onSetApplicationMuted: vi.fn(),
      },
    });

    const virtualMarker = getByTestId('output-volume-device-type-2');
    const hdmiMarker = getByTestId('output-volume-device-type-4');
    expect(virtualMarker.textContent).toBe('[虚拟设备]');
    expect(virtualMarker.getAttribute('aria-label')).toBe('虚拟设备');
    expect(virtualMarker.getAttribute('title')).toBe('虚拟设备');
    expect(hdmiMarker.textContent).toBe('[HDMI]');
    expect(hdmiMarker.getAttribute('aria-label')).toBe('HDMI');
  });

  it('switches between device and remembered application volume tabs', async () => {
    const onSetApplicationVolume = vi.fn();
    const onSetApplicationMuted = vi.fn();
    const { getByTestId, queryByTestId } = render(OutputVolumeWorkspace, {
      props: {
        nodes: [
          {
            id: 3,
            name: 'alsa_output.pci',
            mediaName: 'Built-in Audio',
            mediaClass: 'Audio/Sink',
            objectName: 'alsa_output.pci',
            kind: 'input',
            volumePercent: 65,
            muted: false,
          },
        ],
        applications: [
          {
            id: 'org.mozilla.firefox',
            name: 'Firefox',
            volumePercent: 35,
            muted: false,
            lastSeenAt: Date.now(),
            active: false,
            nodeIds: [],
          },
        ],
        outputLevels: {},
        defaultAudioSinkName: 'alsa_output.pci',
        pendingNodeIds: new Set<number>(),
        pendingDefaultNodeId: null,
        t,
        onSetVolume: vi.fn(),
        onSetMuted: vi.fn(),
        onSetDefault: vi.fn(),
        onSetApplicationVolume,
        onSetApplicationMuted,
      },
    });

    expect(getByTestId('mixer-device-volume-tab').getAttribute('aria-selected')).toBe('true');
    expect(getByTestId('output-volume-device-3')).toBeTruthy();
    expect(queryByTestId('application-volume-org-mozilla-firefox')).toBeNull();

    await fireEvent.click(getByTestId('mixer-application-volume-tab'));
    expect(getByTestId('mixer-application-volume-tab').getAttribute('aria-selected')).toBe('true');
    expect(queryByTestId('output-volume-device-3')).toBeNull();
    expect(getByTestId('application-volume-org-mozilla-firefox').textContent).toContain(
      'Remembered',
    );
    expect(localStorage.getItem('cordflow.mixer-volume-view')).toBe('applications');

    await fireEvent.input(getByTestId('application-volume-slider-org-mozilla-firefox'), {
      target: { value: '28' },
    });
    expect(onSetApplicationVolume).toHaveBeenCalledWith('org.mozilla.firefox', 28);
    await fireEvent.click(getByTestId('application-volume-mute-org-mozilla-firefox'));
    expect(onSetApplicationMuted).toHaveBeenCalledWith('org.mozilla.firefox', true);
  });

  it('keeps application volume controls interactive while a backend update is pending', async () => {
    const onSetApplicationVolume = vi.fn();
    const { getByTestId } = render(OutputVolumeWorkspace, {
      props: {
        nodes: [],
        applications: [
          {
            id: 'org.mozilla.firefox',
            name: 'Firefox',
            volumePercent: 35,
            muted: false,
            lastSeenAt: Date.now(),
            active: true,
            nodeIds: [11],
          },
        ],
        outputLevels: {},
        defaultAudioSinkName: null,
        pendingNodeIds: new Set([11]),
        pendingDefaultNodeId: null,
        t,
        onSetVolume: vi.fn(),
        onSetMuted: vi.fn(),
        onSetDefault: vi.fn(),
        onSetApplicationVolume,
        onSetApplicationMuted: vi.fn(),
      },
    });

    await fireEvent.click(getByTestId('mixer-application-volume-tab'));
    const slider = getByTestId('application-volume-slider-org-mozilla-firefox') as HTMLInputElement;
    const number = getByTestId('application-volume-number-org-mozilla-firefox') as HTMLInputElement;
    const reset = getByTestId('application-volume-reset-org-mozilla-firefox') as HTMLButtonElement;
    const mute = getByTestId('application-volume-mute-org-mozilla-firefox') as HTMLButtonElement;

    expect(slider.disabled).toBe(false);
    expect(number.disabled).toBe(false);
    expect(reset.disabled).toBe(false);
    expect(mute.disabled).toBe(true);

    await fireEvent.input(slider, { target: { value: '36' } });
    await fireEvent.input(slider, { target: { value: '37' } });
    await fireEvent.input(slider, { target: { value: '38' } });

    expect(slider.value).toBe('38');
    await vi.waitFor(() => {
      expect(onSetApplicationVolume).toHaveBeenLastCalledWith('org.mozilla.firefox', 38);
    });
  });
});
