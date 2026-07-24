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
  const spectrumBandCount = 32;
  const contourRiseMomentum = 0.3;
  const contourReleaseDurationMs = 700;
  const contourReleaseExponent = 1.5;
  const contourSettleThreshold = 0.5;
  const emptySpectrum = Array(32).fill(0) as number[];
  const emptyChannels = {
    leftSpectrum: emptySpectrum,
    rightSpectrum: emptySpectrum,
  };
  type SpectrumChannels = Pick<OutputLevel, 'leftSpectrum' | 'rightSpectrum'>;
  type SpectrumContour = {
    leftHeights: number[];
    rightHeights: number[];
    leftSourceHeights: number[];
    rightSourceHeights: number[];
    leftReleaseOrigins: number[];
    rightReleaseOrigins: number[];
    leftReleaseElapsedMs: number[];
    rightReleaseElapsedMs: number[];
  };

  let currentFrame: SpectrumChannels = emptyChannels;
  let contour: SpectrumContour | null = null;
  let trackedNodeId: number | null = null;
  let trackedSpectrum: SpectrumChannels | undefined;
  let hasCurrentSpectrum = false;
  let lastSpectrumSampleAt: number | null = null;

  $: currentNode =
    nodes.find((node) => node.objectName === defaultAudioSinkName) ?? nodes.at(0) ?? null;
  $: currentSpectrum = currentNode ? spectra[currentNode.id] : undefined;
  $: updateSpectrumContour(currentNode?.id ?? null, currentSpectrum);
  $: visibleLeftSpectrum = currentFrame.leftSpectrum;
  $: visibleRightSpectrum = currentFrame.rightSpectrum;
  $: currentNodeName = currentNode
    ? nodeDisplayName(currentNode, t('unnamedNode'))
    : t('spectrumNoDevice');

  function normalizedBands(bands: number[]): number[] {
    return Array.from({ length: spectrumBandCount }, (_, index) => {
      const amplitude = bands[index];
      return typeof amplitude === 'number' && Number.isFinite(amplitude) ? amplitude : 0;
    });
  }

  function normalizedFrame(spectrum: SpectrumChannels): SpectrumChannels {
    return {
      leftSpectrum: normalizedBands(spectrum.leftSpectrum),
      rightSpectrum: normalizedBands(spectrum.rightSpectrum),
    };
  }

  function clearSpectrumContour(
    nodeId: number | null,
    spectrum: SpectrumChannels | undefined,
  ): void {
    trackedNodeId = nodeId;
    trackedSpectrum = spectrum;
    hasCurrentSpectrum = false;
    currentFrame = emptyChannels;
    contour = null;
    lastSpectrumSampleAt = null;
  }

  function frameHeights(frame: SpectrumChannels): SpectrumContour {
    const leftHeights = frame.leftSpectrum.map(bandHeight);
    const rightHeights = frame.rightSpectrum.map(bandHeight);
    return {
      leftHeights,
      rightHeights,
      leftSourceHeights: leftHeights,
      rightSourceHeights: rightHeights,
      leftReleaseOrigins: leftHeights,
      rightReleaseOrigins: rightHeights,
      leftReleaseElapsedMs: Array(spectrumBandCount).fill(0),
      rightReleaseElapsedMs: Array(spectrumBandCount).fill(0),
    };
  }

  function followContour(
    previous: SpectrumContour,
    current: SpectrumContour,
    elapsedMs: number,
  ): SpectrumContour {
    const elapsed = Math.max(0, elapsedMs);
    const follow = (
      previousHeight: number,
      previousSourceHeight: number,
      releaseOrigin: number,
      releaseElapsedMs: number,
      currentHeight: number,
    ): { height: number; origin: number; elapsedMs: number } => {
      const rise = Math.max(0, currentHeight - previousSourceHeight);
      const inertialRise = Math.min(100, currentHeight + rise * contourRiseMomentum);
      if (inertialRise > previousHeight) {
        return { height: inertialRise, origin: inertialRise, elapsedMs: 0 };
      }
      if (previousHeight - currentHeight <= contourSettleThreshold) {
        return { height: currentHeight, origin: currentHeight, elapsedMs: 0 };
      }

      const nextElapsedMs = Math.min(contourReleaseDurationMs, releaseElapsedMs + elapsed);
      const progress = nextElapsedMs / contourReleaseDurationMs;
      const easedProgress = Math.pow(progress, contourReleaseExponent);
      const releasedHeight = releaseOrigin + (currentHeight - releaseOrigin) * easedProgress;
      const height = Math.max(currentHeight, Math.min(previousHeight, releasedHeight));
      return height - currentHeight <= contourSettleThreshold
        ? { height: currentHeight, origin: currentHeight, elapsedMs: 0 }
        : { height, origin: releaseOrigin, elapsedMs: nextElapsedMs };
    };
    const left = current.leftHeights.map((height, index) =>
      follow(
        previous.leftHeights[index] ?? height,
        previous.leftSourceHeights[index] ?? height,
        previous.leftReleaseOrigins[index] ?? height,
        previous.leftReleaseElapsedMs[index] ?? 0,
        height,
      ),
    );
    const right = current.rightHeights.map((height, index) =>
      follow(
        previous.rightHeights[index] ?? height,
        previous.rightSourceHeights[index] ?? height,
        previous.rightReleaseOrigins[index] ?? height,
        previous.rightReleaseElapsedMs[index] ?? 0,
        height,
      ),
    );

    return {
      leftHeights: left.map(({ height }) => height),
      rightHeights: right.map(({ height }) => height),
      leftSourceHeights: current.leftHeights,
      rightSourceHeights: current.rightHeights,
      leftReleaseOrigins: left.map(({ origin }) => origin),
      rightReleaseOrigins: right.map(({ origin }) => origin),
      leftReleaseElapsedMs: left.map(({ elapsedMs }) => elapsedMs),
      rightReleaseElapsedMs: right.map(({ elapsedMs }) => elapsedMs),
    };
  }

  function updateSpectrumContour(
    nodeId: number | null,
    spectrum: SpectrumChannels | undefined,
  ): void {
    if (nodeId === null || spectrum === undefined) {
      if (
        trackedNodeId !== nodeId ||
        trackedSpectrum !== spectrum ||
        hasCurrentSpectrum ||
        contour !== null
      ) {
        clearSpectrumContour(nodeId, spectrum);
      }
      return;
    }

    const sampledAt = Date.now();
    const nextFrame = normalizedFrame(spectrum);
    const nextHeights = frameHeights(nextFrame);

    if (trackedNodeId !== nodeId) {
      clearSpectrumContour(nodeId, spectrum);
      trackedSpectrum = spectrum;
      currentFrame = nextFrame;
      contour = nextHeights;
      hasCurrentSpectrum = true;
      lastSpectrumSampleAt = sampledAt;
      return;
    }

    if (trackedSpectrum === spectrum) return;

    const elapsedMs =
      lastSpectrumSampleAt === null ? 0 : Math.max(0, sampledAt - lastSpectrumSampleAt);
    trackedSpectrum = spectrum;
    currentFrame = nextFrame;
    contour = contour ? followContour(contour, nextHeights, elapsedMs) : nextHeights;
    hasCurrentSpectrum = true;
    lastSpectrumSampleAt = sampledAt;
  }

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
      <div class="output-spectrum__contour" data-testid="output-spectrum-contour">
        {#if contour}
          <div class="output-spectrum__contour-frame" data-testid="output-spectrum-contour-frame">
            <div class="output-spectrum__bands output-spectrum__bands--left">
              {#each contour.leftHeights as height, index (index)}
                <i
                  class="output-spectrum__band output-spectrum__band--left"
                  style={`height: ${height}%`}
                ></i>
              {/each}
            </div>
            <div class="output-spectrum__bands output-spectrum__bands--right">
              {#each contour.rightHeights as height, index (index)}
                <i
                  class="output-spectrum__band output-spectrum__band--right"
                  style={`height: ${height}%`}
                ></i>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      <div class="output-spectrum__current" data-testid="output-spectrum-current">
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
  </div>
</section>
