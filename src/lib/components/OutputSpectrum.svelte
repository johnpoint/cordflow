<script lang="ts">
  import type { NodeDto, OutputLevel } from '../generated/graph';
  import { nodeDisplayName } from '../graph/connection';
  import type { MessageKey } from '../i18n';

  export let nodes: NodeDto[] = [];
  export let spectra: Record<
    number,
    Pick<OutputLevel, 'leftSpectrum' | 'rightSpectrum'> | undefined
  > = {};
  export let defaultAudioSinkName: string | null = null;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;

  const minimumDecibels = -72;
  const maximumDecibels = 0;
  const emptySpectrum = Array(32).fill(0) as number[];
  const emptyChannels = {
    leftSpectrum: emptySpectrum,
    rightSpectrum: emptySpectrum,
  };

  $: currentNode =
    nodes.find((node) => node.objectName === defaultAudioSinkName) ?? nodes.at(0) ?? null;
  $: currentSpectrum = currentNode ? (spectra[currentNode.id] ?? emptyChannels) : emptyChannels;
  $: visibleLeftSpectrum = Array.from(
    { length: 32 },
    (_, index) => currentSpectrum.leftSpectrum[index] ?? 0,
  );
  $: visibleRightSpectrum = Array.from(
    { length: 32 },
    (_, index) => currentSpectrum.rightSpectrum[index] ?? 0,
  );
  $: currentNodeName = currentNode
    ? nodeDisplayName(currentNode, t('unnamedNode'))
    : t('spectrumNoDevice');

  function amplitudeDecibels(amplitude: number): number {
    if (amplitude <= 0) return minimumDecibels;
    return Math.min(12, Math.max(minimumDecibels, 20 * Math.log10(amplitude)));
  }

  function bandHeight(amplitude: number): number {
    const decibels = amplitudeDecibels(amplitude);
    return Math.max(
      0,
      Math.min(100, ((decibels - minimumDecibels) / (maximumDecibels - minimumDecibels)) * 100),
    );
  }
</script>

<section
  class="output-spectrum"
  aria-label={t('stereoSpectrumFor', { name: currentNodeName })}
  data-testid="output-spectrum"
>
  <div
    class="output-spectrum__plot"
    role="img"
    aria-label={t('stereoSpectrumFor', { name: currentNodeName })}
    data-testid="output-spectrum-plot"
  >
    <div class="output-spectrum__channels" aria-hidden="true">
      <div
        class="output-spectrum__bands output-spectrum__bands--left"
        data-testid="output-spectrum-left-channel"
      >
        {#each visibleLeftSpectrum as amplitude, index (index)}
          <i
            class="output-spectrum__band output-spectrum__band--left"
            style={`height: ${bandHeight(amplitude)}%`}
            data-testid={`output-spectrum-left-band-${index}`}
          ></i>
        {/each}
      </div>
      <div
        class="output-spectrum__bands output-spectrum__bands--right"
        data-testid="output-spectrum-right-channel"
      >
        {#each visibleRightSpectrum as amplitude, index (index)}
          <i
            class="output-spectrum__band output-spectrum__band--right"
            style={`height: ${bandHeight(amplitude)}%`}
            data-testid={`output-spectrum-right-band-${index}`}
          ></i>
        {/each}
      </div>
    </div>
  </div>
</section>
