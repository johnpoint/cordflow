<script lang="ts">
  import type { NodeDto, PortDto } from '../generated/graph';
  import type { MessageKey } from '../i18n';
  import { nodeDisplayName } from '../graph/connection';

  export let node: NodeDto;
  export let ports: PortDto[];
  export let selectedStartPortId: number | null;
  export let compatibleTargetIds: Set<number>;
  export let connectedPortIds: Set<number>;
  export let focusedPortIds: Set<number>;
  export let focused: boolean;
  export let focusRoot: boolean;
  export let deemphasized: boolean;
  export let interactive: boolean;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let onPortPointerDown: (event: PointerEvent, port: PortDto) => void;
  export let onPortKeyDown: (event: KeyboardEvent, port: PortDto) => void;
  export let onSelectNode: (nodeId: number) => void;

  $: inputs = ports
    .filter((port) => port.direction === 'input')
    .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id);
  $: outputs = ports
    .filter((port) => port.direction === 'output')
    .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id);
  $: displayName = nodeDisplayName(node, t('unnamedNode'));

  function mediaAbbreviation(port: PortDto): string {
    if (port.mediaType === 'audio') return 'AUD';
    if (port.mediaType === 'video') return 'VID';
    if (port.mediaType === 'midi') return 'MIDI';
    return '?';
  }

  function portLabel(port: PortDto): string {
    return `${displayName}, ${port.name}, ${t(port.direction)}, ${t(port.mediaType)}, ${t('portId', { id: port.id })}`;
  }
</script>

<article
  class:node-card--focused={focused}
  class:node-card--focus-root={focusRoot}
  class:node-card--deemphasized={deemphasized}
  class="node-card"
  data-node-id={node.id}
  data-testid={`node-${node.id}`}
>
  <button
    class="node-card__header"
    type="button"
    data-testid={`node-select-${node.id}`}
    title={t('highlightChain', { name: displayName })}
    aria-label={t('highlightChain', { name: displayName })}
    aria-pressed={focused}
    onclick={() => onSelectNode(node.id)}
  >
    <span class="node-card__identity">
      <span class="node-card__title" role="heading" aria-level="3" title={displayName}
        >{displayName}</span
      >
      {#if node.mediaName && node.name !== node.mediaName}
        <span class="node-card__subtitle">{node.name}</span>
      {/if}
    </span>
    <span
      class="node-card__id"
      title={t('nodeId', { id: node.id })}
      aria-label={t('nodeId', { id: node.id })}
    >
      ID {node.id}
    </span>
  </button>

  <div class="node-card__ports">
    <div class="port-list port-list--inputs" aria-label={t('input')}>
      {#each inputs as port (port.id)}
        <button
          class:port-button--selected={selectedStartPortId === port.id}
          class:port-button--compatible={compatibleTargetIds.has(port.id)}
          class:port-button--connected={connectedPortIds.has(port.id)}
          class:port-button--link-selected={focusedPortIds.has(port.id)}
          class:port-button--muted={selectedStartPortId !== null &&
            selectedStartPortId !== port.id &&
            !compatibleTargetIds.has(port.id)}
          class={`port-button port-button--input media-${port.mediaType}`}
          type="button"
          disabled={!interactive}
          data-port-id={port.id}
          data-direction={port.direction}
          data-testid={`port-${port.id}`}
          aria-label={portLabel(port)}
          title={portLabel(port)}
          aria-pressed={selectedStartPortId === port.id}
          tabindex={selectedStartPortId !== null &&
          selectedStartPortId !== port.id &&
          !compatibleTargetIds.has(port.id)
            ? -1
            : 0}
          onpointerdown={(event) => onPortPointerDown(event, port)}
          onkeydown={(event) => onPortKeyDown(event, port)}
        >
          <span class="port-button__socket" aria-hidden="true"></span>
          <span class="port-button__copy">
            <span class="port-button__name">{port.name}</span>
            <span class="port-button__media">{mediaAbbreviation(port)}</span>
          </span>
        </button>
      {/each}
    </div>

    <div class="port-list port-list--outputs" aria-label={t('output')}>
      {#each outputs as port (port.id)}
        <button
          class:port-button--selected={selectedStartPortId === port.id}
          class:port-button--compatible={compatibleTargetIds.has(port.id)}
          class:port-button--connected={connectedPortIds.has(port.id)}
          class:port-button--link-selected={focusedPortIds.has(port.id)}
          class:port-button--muted={selectedStartPortId !== null &&
            selectedStartPortId !== port.id &&
            !compatibleTargetIds.has(port.id)}
          class={`port-button port-button--output media-${port.mediaType}`}
          type="button"
          disabled={!interactive}
          data-port-id={port.id}
          data-direction={port.direction}
          data-testid={`port-${port.id}`}
          aria-label={portLabel(port)}
          title={portLabel(port)}
          aria-pressed={selectedStartPortId === port.id}
          tabindex={selectedStartPortId !== null &&
          selectedStartPortId !== port.id &&
          !compatibleTargetIds.has(port.id)
            ? -1
            : 0}
          onpointerdown={(event) => onPortPointerDown(event, port)}
          onkeydown={(event) => onPortKeyDown(event, port)}
        >
          <span class="port-button__copy">
            <span class="port-button__name">{port.name}</span>
            <span class="port-button__media">{mediaAbbreviation(port)}</span>
          </span>
          <span class="port-button__socket" aria-hidden="true"></span>
        </button>
      {/each}
    </div>
  </div>
</article>
