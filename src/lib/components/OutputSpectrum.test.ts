import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translate, type MessageKey } from '../i18n';
import OutputSpectrum from './OutputSpectrum.svelte';

const t = (key: MessageKey, values: Record<string, string | number> = {}) =>
  translate('en', key, values);

const outputNodes = [
  {
    id: 2,
    name: 'virtual_sink',
    mediaName: 'Effects',
    mediaClass: 'Audio/Sink',
    objectName: 'virtual_sink',
    kind: 'input' as const,
    volumePercent: 100,
    muted: false,
  },
  {
    id: 3,
    name: 'alsa_output.pci',
    mediaName: 'Built-in Audio',
    mediaClass: 'Audio/Sink',
    objectName: 'alsa_output.pci',
    kind: 'input' as const,
    volumePercent: 65,
    muted: false,
  },
];

describe('OutputSpectrum', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const spectrum = (left: number[], right: number[] = left) => ({
    leftSpectrum: [...left, ...Array(Math.max(0, 32 - left.length)).fill(0)].slice(0, 32),
    rightSpectrum: [...right, ...Array(Math.max(0, 32 - right.length)).fill(0)].slice(0, 32),
  });

  it('shows the live FFT bands for the default output device', () => {
    const { getByTestId, queryByText } = render(OutputSpectrum, {
      props: {
        nodes: outputNodes,
        spectra: {
          2: {
            leftSpectrum: Array(32).fill(0),
            rightSpectrum: Array(32).fill(0),
          },
          3: {
            leftSpectrum: [1, 0.1, ...Array(30).fill(0)],
            rightSpectrum: [0.01, 0.5, ...Array(30).fill(0)],
          },
        },
        defaultAudioSinkName: 'alsa_output.pci',
        t,
      },
    });

    expect(queryByText('Real-time spectrum')).toBeNull();
    expect(queryByText('Built-in Audio')).toBeNull();
    expect(getByTestId('output-spectrum').getAttribute('aria-label')).toBe(
      'Stereo real-time output spectrum for Built-in Audio',
    );
    expect((getByTestId('output-spectrum-left-band-0') as HTMLElement).style.height).toBe('100%');
    expect(
      Number.parseFloat((getByTestId('output-spectrum-left-band-1') as HTMLElement).style.height),
    ).toBeCloseTo(72.22, 1);
    expect(
      Number.parseFloat((getByTestId('output-spectrum-right-band-1') as HTMLElement).style.height),
    ).toBeCloseTo(91.64, 1);
    expect(getByTestId('output-spectrum-left-channel')).toBeTruthy();
    expect(getByTestId('output-spectrum-right-channel')).toBeTruthy();
  });

  it('stays visually quiet until real samples arrive', () => {
    const { getByTestId, queryByTestId, queryByText } = render(OutputSpectrum, {
      props: {
        nodes: outputNodes,
        spectra: {},
        defaultAudioSinkName: 'alsa_output.pci',
        t,
      },
    });

    expect(queryByText('Waiting for audio')).toBeNull();
    expect(queryByTestId('output-spectrum-contour-frame')).toBeNull();
    expect((getByTestId('output-spectrum-left-band-0') as HTMLElement).style.height).toBe('0%');
    expect((getByTestId('output-spectrum-right-band-0') as HTMLElement).style.height).toBe('0%');
  });

  it('raises the contour immediately and releases it toward the current spectrum', async () => {
    let sampledAt = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => sampledAt);
    const props = {
      nodes: outputNodes,
      spectra: { 3: spectrum([1]) },
      defaultAudioSinkName: 'alsa_output.pci',
      t,
    };
    const { container, getByTestId, rerender } = render(OutputSpectrum, { props });
    const contourBand = () =>
      container.querySelector(
        '.output-spectrum__contour-frame .output-spectrum__band--left',
      ) as HTMLElement;

    expect(contourBand().style.height).toBe('100%');
    sampledAt = 50;
    await rerender({ ...props, spectra: { 3: spectrum([0]) } });
    expect((getByTestId('output-spectrum-left-band-0') as HTMLElement).style.height).toBe('0%');
    expect(Number.parseFloat(contourBand().style.height)).toBeCloseTo(98.09, 1);

    sampledAt = 150;
    await rerender({ ...props, spectra: { 3: spectrum([0]) } });
    expect(Number.parseFloat(contourBand().style.height)).toBeCloseTo(90.08, 1);

    sampledAt = 650;
    await rerender({ ...props, spectra: { 3: spectrum([0]) } });
    expect(Number.parseFloat(contourBand().style.height)).toBeCloseTo(10.52, 1);

    sampledAt = 700;
    await rerender({ ...props, spectra: { 3: spectrum([0]) } });
    expect(contourBand().style.height).toBe('0%');

    sampledAt = 732;
    await rerender({ ...props, spectra: { 3: spectrum([0.1]) } });
    const currentRiseHeight = Number.parseFloat(
      (getByTestId('output-spectrum-left-band-0') as HTMLElement).style.height,
    );
    expect(Number.parseFloat(contourBand().style.height) - currentRiseHeight).toBeGreaterThan(20);

    sampledAt = 764;
    await rerender({ ...props, spectra: { 3: spectrum([1]) } });
    expect(contourBand().style.height).toBe('100%');
    expect((getByTestId('output-spectrum-left-band-0') as HTMLElement).style.height).toBe('100%');
  });

  it('clears the contour when data disappears and resets it on device changes', async () => {
    const props = {
      nodes: outputNodes,
      spectra: {
        2: spectrum([0.2]),
        3: spectrum([1]),
      },
      defaultAudioSinkName: 'alsa_output.pci',
      t,
    };
    const { container, getByTestId, rerender } = render(OutputSpectrum, { props });
    await rerender({
      ...props,
      spectra: {
        2: spectrum([0.2]),
        3: spectrum([0.5]),
      },
    });
    expect(container.querySelectorAll('.output-spectrum__contour-frame')).toHaveLength(1);

    await rerender({ ...props, spectra: { 2: spectrum([0.2]) } });
    expect(container.querySelectorAll('.output-spectrum__contour-frame')).toHaveLength(0);
    expect((getByTestId('output-spectrum-left-band-0') as HTMLElement).style.height).toBe('0%');

    await rerender({ ...props, defaultAudioSinkName: 'virtual_sink' });
    const currentHeight = (getByTestId('output-spectrum-left-band-0') as HTMLElement).style.height;
    const contourHeight = (
      container.querySelector(
        '.output-spectrum__contour-frame .output-spectrum__band--left',
      ) as HTMLElement
    ).style.height;
    expect(contourHeight).toBe(currentHeight);
  });
});
