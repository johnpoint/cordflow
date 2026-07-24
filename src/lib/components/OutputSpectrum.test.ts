import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
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
  afterEach(cleanup);

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
    const { getByTestId, queryByText } = render(OutputSpectrum, {
      props: {
        nodes: outputNodes,
        spectra: {},
        defaultAudioSinkName: 'alsa_output.pci',
        t,
      },
    });

    expect(queryByText('Waiting for audio')).toBeNull();
    expect((getByTestId('output-spectrum-left-band-0') as HTMLElement).style.height).toBe('0%');
    expect((getByTestId('output-spectrum-right-band-0') as HTMLElement).style.height).toBe('0%');
  });
});
