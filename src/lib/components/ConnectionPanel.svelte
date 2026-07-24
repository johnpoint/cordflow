<script lang="ts">
  import type { LinkDto, MediaType, PortDto } from '../generated/graph';
  import type { MessageKey } from '../i18n';
  import { bundleStereoConnections, type PendingLink } from '../graph/connection';

  export let links: LinkDto[];
  export let ports: PortDto[];
  export let pendingLinks: PendingLink[];
  export let removingLinkIds: Set<number>;
  export let selectedLinkId: number | null;
  export let focusedLinkIds: Set<number>;
  export let focusActive: boolean;
  export let expanded: boolean;
  export let autoStereoMatch: boolean;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let describeLink: (
    link: Pick<LinkDto, 'outputPortId' | 'inputPortId'>,
    nodeOnly?: boolean,
  ) => {
    from: string;
    to: string;
    mediaType: MediaType;
  };
  export let onSelectLink: (linkId: number) => void;
  export let onRemoveLink: (linkId: number) => void;
  export let onExpandedChange: (expanded: boolean) => void;

  $: linkBundles = autoStereoMatch
    ? bundleStereoConnections(links, ports)
    : links.map((link) => ({ connections: [link], stereo: false }));
  $: pendingBundles = autoStereoMatch
    ? bundleStereoConnections(pendingLinks, ports)
    : pendingLinks.map((link) => ({ connections: [link], stereo: false }));
  $: selectedBundle =
    linkBundles.find((bundle) => bundle.connections.some((link) => link.id === selectedLinkId)) ??
    null;
  $: selectedDescription = selectedBundle
    ? describeLink(selectedBundle.connections[0], autoStereoMatch)
    : null;
</script>

<section
  class:connection-panel--expanded={expanded}
  class:connection-panel--collapsed={!expanded}
  class="connection-panel"
  aria-labelledby="connection-panel-title"
  data-testid="connection-panel"
>
  <header class="connection-panel__header">
    <button
      class="connection-panel__toggle"
      type="button"
      aria-expanded={expanded}
      aria-controls="connection-panel-list"
      aria-label={t(expanded ? 'collapseConnections' : 'expandConnections')}
      data-testid="connection-panel-toggle"
      onclick={() => onExpandedChange(!expanded)}
    >
      <span
        class:connection-panel__chevron--expanded={expanded}
        class="connection-panel__chevron"
        aria-hidden="true"
      ></span>
      <span class="connection-panel__eyebrow">{t('routes')}</span>
      <span
        id="connection-panel-title"
        class="connection-panel__title"
        role="heading"
        aria-level="2">{t('connections')}</span
      >
      <span class="connection-panel__total">{linkBundles.length + pendingBundles.length}</span>
      {#if selectedDescription}
        <span class="connection-panel__selection">
          <strong>{selectedDescription.from}</strong>
          <span aria-hidden="true">→</span>
          <strong>{selectedDescription.to}</strong>
        </span>
      {:else}
        <span
          class="connection-panel__selection connection-panel__selection--empty"
          aria-hidden="true"
        ></span>
      {/if}
      <span class="connection-panel__toggle-label">
        {t(expanded ? 'collapseConnections' : 'expandConnections')}
      </span>
    </button>
  </header>

  {#if expanded}
    {#if selectedBundle && selectedDescription}
      <aside class="connection-panel__selected-detail" data-testid="selected-connection-summary">
        <div>
          <span>{t('selectedConnection')}</span>
          <strong>{selectedDescription.from} → {selectedDescription.to}</strong>
          <small>
            {t(selectedDescription.mediaType)} ·
            {t(
              selectedBundle.connections.every((connection) => connection.active)
                ? 'active'
                : 'inactive',
            )}
          </small>
        </div>
        <button
          class="button button--danger"
          type="button"
          disabled={selectedBundle.connections.some((connection) =>
            removingLinkIds.has(connection.id),
          )}
          onclick={() => onRemoveLink(selectedBundle.connections[0].id)}
        >
          {t('disconnectSelected')}
        </button>
      </aside>
    {/if}
    <div id="connection-panel-list" class="connection-panel__list" data-testid="connection-list">
      {#each linkBundles as bundle (bundle.connections.map((link) => link.id).join('-'))}
        {@const link = bundle.connections[0]}
        {@const description = describeLink(link, autoStereoMatch)}
        <article
          class:connection-item--selected={bundle.connections.some(
            (connection) => selectedLinkId === connection.id,
          )}
          class:connection-item--focused={bundle.connections.some((connection) =>
            focusedLinkIds.has(connection.id),
          )}
          class:connection-item--deemphasized={focusActive &&
            !bundle.connections.some((connection) => focusedLinkIds.has(connection.id))}
          class="connection-item"
          data-connection-link-ids={bundle.connections.map((connection) => connection.id).join(',')}
          data-testid={`connection-${link.id}`}
        >
          <button
            class="connection-item__main"
            type="button"
            onclick={() => onSelectLink(link.id)}
            aria-pressed={bundle.connections.some((connection) => selectedLinkId === connection.id)}
          >
            <span class={`connection-item__media media-${description.mediaType}`}>
              {t(description.mediaType)}
            </span>
            <span class="connection-item__route">
              <strong>{description.from}</strong>
              <span aria-hidden="true">→</span>
              <strong>{description.to}</strong>
            </span>
            {#if autoStereoMatch}
              <span class="connection-item__mode">
                {t(bundle.stereo ? 'automaticStereoConnection' : 'automaticConnection')}
              </span>
            {/if}
            <span
              class={`connection-item__state state-${bundle.connections.every((connection) => connection.active) ? 'active' : 'inactive'}`}
            >
              {t(
                bundle.connections.every((connection) => connection.active) ? 'active' : 'inactive',
              )}
            </span>
            {#if !autoStereoMatch}
              <span class="connection-item__id">L{link.id}</span>
            {/if}
          </button>
          <button
            class="button button--danger button--small"
            type="button"
            disabled={bundle.connections.some((connection) => removingLinkIds.has(connection.id))}
            onclick={() => onRemoveLink(link.id)}
          >
            {bundle.connections.some((connection) => removingLinkIds.has(connection.id))
              ? t('pending')
              : t('disconnect')}
          </button>
        </article>
      {/each}

      {#each pendingBundles as bundle (bundle.connections
        .map((pending) => pending.operationId)
        .join('-'))}
        {@const pending = bundle.connections[0]}
        {@const description = describeLink(
          {
            outputPortId: pending.outputPortId,
            inputPortId: pending.inputPortId,
          },
          autoStereoMatch,
        )}
        <article
          class:connection-item--deemphasized={focusActive}
          class="connection-item connection-item--pending"
          data-testid="pending-connection"
        >
          <div class="connection-item__main">
            <span class={`connection-item__media media-${description.mediaType}`}>
              {t(description.mediaType)}
            </span>
            <span class="connection-item__route">
              <strong>{description.from}</strong><span aria-hidden="true">→</span><strong
                >{description.to}</strong
              >
            </span>
            {#if autoStereoMatch}
              <span class="connection-item__mode">
                {t(bundle.stereo ? 'automaticStereoConnection' : 'automaticConnection')}
              </span>
            {/if}
            <span class="connection-item__state state-pending">{t('pending')}</span>
          </div>
        </article>
      {/each}

      {#if links.length === 0 && pendingLinks.length === 0}
        <p class="connection-panel__empty">{t('noConnections')}</p>
      {/if}
    </div>
  {/if}
</section>
