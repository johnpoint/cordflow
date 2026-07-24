import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
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
    vi.unstubAllGlobals();
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

  it('initializes the contour when samples arrive after the device', async () => {
    const props = {
      nodes: outputNodes,
      spectra: {},
      defaultAudioSinkName: 'alsa_output.pci',
      t,
    };
    const { queryByTestId, rerender } = render(OutputSpectrum, { props });

    expect(queryByTestId('output-spectrum-contour-frame')).toBeNull();
    await rerender({ ...props, spectra: { 3: spectrum([0.5]) } });
    expect(queryByTestId('output-spectrum-contour-frame')).not.toBeNull();
  });

  it('holds the contour above lower bands and lets a touching band raise it without overshoot', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    vi.stubGlobal('cancelAnimationFrame', undefined);
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

    sampledAt = 350;
    await rerender({ ...props, spectra: { 3: spectrum([0]) } });
    const heldContourHeight = Number.parseFloat(contourBand().style.height);

    await rerender({ ...props, spectra: { 3: spectrum([0.05]) } });
    const lowerCurrentHeight = Number.parseFloat(
      (getByTestId('output-spectrum-left-band-0') as HTMLElement).style.height,
    );
    expect(heldContourHeight).toBeGreaterThan(lowerCurrentHeight);
    expect(Number.parseFloat(contourBand().style.height)).toBeCloseTo(heldContourHeight, 5);

    sampledAt = 382;
    await rerender({ ...props, spectra: { 3: spectrum([0.1]) } });
    const touchingCurrentHeight = Number.parseFloat(
      (getByTestId('output-spectrum-left-band-0') as HTMLElement).style.height,
    );
    expect(Number.parseFloat(contourBand().style.height)).toBeCloseTo(touchingCurrentHeight, 5);

    sampledAt = 700;
    await rerender({ ...props, spectra: { 3: spectrum([0]) } });
    expect(Number.parseFloat(contourBand().style.height)).toBeLessThan(touchingCurrentHeight);
  });

  it('uses the rendered band position before moving the contour upward', async () => {
    let renderedCurrentHeight = 60;
    let contactFrame: FrameRequestCallback | undefined;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        contactFrame = callback;
        return 1;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(Date, 'now').mockReturnValue(0);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const height = this.classList.contains('output-spectrum__channels')
        ? 100
        : this.closest('.output-spectrum__current')
          ? renderedCurrentHeight
          : this.closest('.output-spectrum__contour-frame')
            ? Number.parseFloat(this.style.height)
            : 0;
      return {
        x: 0,
        y: 100 - height,
        width: 10,
        height,
        top: 100 - height,
        right: 10,
        bottom: 100,
        left: 0,
        toJSON: () => ({}),
      };
    });
    const props = {
      nodes: outputNodes,
      spectra: { 3: spectrum([0.05]) },
      defaultAudioSinkName: 'alsa_output.pci',
      t,
    };
    const { container, rerender } = render(OutputSpectrum, { props });
    const contourHeight = () =>
      Number.parseFloat(
        (
          container.querySelector(
            '.output-spectrum__contour-frame .output-spectrum__band--left',
          ) as HTMLElement
        ).style.height,
      );
    const initialContourHeight = contourHeight();

    await rerender({ ...props, spectra: { 3: spectrum([1]) } });
    expect(initialContourHeight).toBeGreaterThan(renderedCurrentHeight);
    expect(contourHeight()).toBeCloseTo(initialContourHeight, 5);

    renderedCurrentHeight = 70;
    contactFrame?.(16);
    await tick();
    expect(contourHeight()).toBeCloseTo(renderedCurrentHeight, 5);
    expect(contourHeight()).toBeLessThan(100);
  });

  it('releases the contour on every animation frame', async () => {
    const renderedCurrentHeight = 0;
    let animationFrame: FrameRequestCallback | undefined;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        animationFrame = callback;
        return 1;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.spyOn(Date, 'now').mockReturnValue(0);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const height = this.classList.contains('output-spectrum__channels')
        ? 100
        : this.closest('.output-spectrum__current')
          ? renderedCurrentHeight
          : 0;
      return {
        x: 0,
        y: 100 - height,
        width: 10,
        height,
        top: 100 - height,
        right: 10,
        bottom: 100,
        left: 0,
        toJSON: () => ({}),
      };
    });
    const props = {
      nodes: outputNodes,
      spectra: { 3: spectrum([1]) },
      defaultAudioSinkName: 'alsa_output.pci',
      t,
    };
    const { container, rerender } = render(OutputSpectrum, { props });
    const contourHeight = () =>
      Number.parseFloat(
        (
          container.querySelector(
            '.output-spectrum__contour-frame .output-spectrum__band--left',
          ) as HTMLElement
        ).style.height,
      );
    await rerender({ ...props, spectra: { 3: spectrum([0]) } });

    const heights: number[] = [];
    for (const timestamp of [0, 16, 32, 48, 64]) {
      animationFrame?.(timestamp);
      await tick();
      heights.push(contourHeight());
    }

    expect(heights[0]).toBe(100);
    expect(new Set(heights).size).toBe(heights.length);
    expect(heights.every((height, index) => index === 0 || height < heights[index - 1]!)).toBe(
      true,
    );
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
