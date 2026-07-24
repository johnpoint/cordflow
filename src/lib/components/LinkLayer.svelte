<script lang="ts">
  import type { LinkDto, NodeDto, PortDto } from '../generated/graph';
  import type { MessageKey } from '../i18n';
  import type { PendingLink } from '../graph/connection';
  import { effectiveMediaType, nodeDisplayName } from '../graph/connection';
  import type { Point } from '../graph/layout';
  import { linkPath } from '../graph/layout';

  export let anchors: Record<number, Point>;
  export let links: LinkDto[];
  export let pendingLinks: PendingLink[];
  export let ports: PortDto[];
  export let nodes: NodeDto[];
  export let selectedLinkId: number | null;
  export let focusedLinkIds: Set<number>;
  export let focusActive: boolean;
  export let preview: { from: Point; to: Point; mediaType: string; valid: boolean } | null;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let onSelectLink: (linkId: number) => void;

  $: orderedLinks = !focusActive
    ? links
    : [
        ...links.filter((link) => !focusedLinkIds.has(link.id)),
        ...links.filter((link) => focusedLinkIds.has(link.id)),
      ];
  $: focusLinks = links.filter((link) => focusedLinkIds.has(link.id));

  function linkLabel(link: Pick<LinkDto, 'id' | 'outputPortId' | 'inputPortId'>): string {
    const output = ports.find((port) => port.id === link.outputPortId);
    const input = ports.find((port) => port.id === link.inputPortId);
    const outputNode = nodes.find((node) => node.id === output?.nodeId);
    const inputNode = nodes.find((node) => node.id === input?.nodeId);
    const from = `${outputNode ? nodeDisplayName(outputNode, t('unnamedNode')) : t('unknown')} · ${output?.name ?? link.outputPortId}`;
    const to = `${inputNode ? nodeDisplayName(inputNode, t('unnamedNode')) : t('unknown')} · ${input?.name ?? link.inputPortId}`;
    return `${t('linkId', { id: link.id })}: ${t('connectionFromTo', { from, to })}`;
  }

  function selectWithKeyboard(event: KeyboardEvent, linkId: number): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectLink(linkId);
    }
  }
</script>

<svg class="link-layer" aria-label={t('connections')}>
  <defs aria-hidden="true">
    <marker
      id="link-arrow-audio"
      viewBox="0 0 8 8"
      refX="7"
      refY="4"
      markerWidth="8"
      markerHeight="8"
      orient="auto"
      markerUnits="userSpaceOnUse"
    >
      <path class="link-arrow media-audio" d="M 0 0 L 8 4 L 0 8 Z"></path>
    </marker>
    <marker
      id="link-arrow-video"
      viewBox="0 0 8 8"
      refX="7"
      refY="4"
      markerWidth="8"
      markerHeight="8"
      orient="auto"
      markerUnits="userSpaceOnUse"
    >
      <path class="link-arrow media-video" d="M 0 0 L 8 4 L 0 8 Z"></path>
    </marker>
    <marker
      id="link-arrow-midi"
      viewBox="0 0 8 8"
      refX="7"
      refY="4"
      markerWidth="8"
      markerHeight="8"
      orient="auto"
      markerUnits="userSpaceOnUse"
    >
      <path class="link-arrow media-midi" d="M 0 0 L 8 4 L 0 8 Z"></path>
    </marker>
    <marker
      id="link-arrow-unknown"
      viewBox="0 0 8 8"
      refX="7"
      refY="4"
      markerWidth="8"
      markerHeight="8"
      orient="auto"
      markerUnits="userSpaceOnUse"
    >
      <path class="link-arrow media-unknown" d="M 0 0 L 8 4 L 0 8 Z"></path>
    </marker>
  </defs>

  {#each orderedLinks as link (link.id)}
    {@const from = anchors[link.outputPortId]}
    {@const to = anchors[link.inputPortId]}
    {#if from && to}
      {@const mediaType = effectiveMediaType(link, ports)}
      <g
        class:link-group--selected={selectedLinkId === link.id}
        class:link-group--deemphasized={focusActive && !focusedLinkIds.has(link.id)}
        class:link-group--inactive={!link.active}
        class={`link-group media-${mediaType}`}
        data-link-id={link.id}
        data-testid={`link-${link.id}`}
        role="button"
        tabindex="0"
        aria-label={linkLabel(link)}
        aria-pressed={selectedLinkId === link.id}
        onclick={() => onSelectLink(link.id)}
        onkeydown={(event) => selectWithKeyboard(event, link.id)}
      >
        <path class="link-path__hit" d={linkPath(from, to)}></path>
        <path class="link-path__outline" d={linkPath(from, to)}></path>
        <path
          class="link-path__visible"
          d={linkPath(from, to)}
          marker-end={`url(#link-arrow-${mediaType})`}
        ></path>
      </g>
    {/if}
  {/each}

  {#each pendingLinks as pending (pending.operationId)}
    {@const from = anchors[pending.outputPortId]}
    {@const to = anchors[pending.inputPortId]}
    {#if from && to}
      {@const output = ports.find((port) => port.id === pending.outputPortId)}
      <path
        class={`pending-link media-${output?.mediaType ?? 'unknown'}`}
        data-testid="pending-link"
        d={linkPath(from, to)}
      ></path>
    {/if}
  {/each}

  {#if preview}
    <path
      class:link-preview--invalid={!preview.valid}
      class={`link-preview media-${preview.mediaType}`}
      d={linkPath(preview.from, preview.to)}
    ></path>
  {/if}
</svg>

{#if focusLinks.length > 0}
  <svg class="link-focus-layer" aria-hidden="true" data-testid="focused-chain">
    {#each focusLinks as link (link.id)}
      {@const from = anchors[link.outputPortId]}
      {@const to = anchors[link.inputPortId]}
      {#if from && to}
        {@const mediaType = effectiveMediaType(link, ports)}
        <g data-focus-link-id={link.id} data-testid={`focused-link-${link.id}`}>
          <path class="link-focus__outline" d={linkPath(from, to)}></path>
          <path
            class={`link-focus__visible media-${mediaType}`}
            d={linkPath(from, to)}
            marker-end={`url(#link-arrow-${mediaType})`}
          ></path>
        </g>
      {/if}
    {/each}
  </svg>
{/if}
