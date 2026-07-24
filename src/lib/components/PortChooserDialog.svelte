<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeDto, PortDto } from '../generated/graph';
  import { findStereoPortPair } from '../graph/connection';
  import type { MessageKey } from '../i18n';

  type ChooserMode = 'output' | 'input';

  export let mode: ChooserMode;
  export let groups: Array<{ node: NodeDto; ports: PortDto[] }>;
  export let selectedPortId: number | null;
  export let automatic: boolean;
  export let t: (key: MessageKey, values?: Record<string, string | number>) => string;
  export let nodeName: (node: NodeDto) => string;
  export let onChoose: (port: PortDto) => void;
  export let onClose: () => void;

  let query = '';
  let dialogElement: HTMLElement;
  let searchInput: HTMLInputElement;

  $: normalizedQuery = query.trim().toLocaleLowerCase();
  $: filteredGroups = automatic
    ? groups.filter((group) => nodeMatches(group.node))
    : groups
        .map((group) => ({
          ...group,
          ports: group.ports.filter((port) => portMatches(group.node, port)),
        }))
        .filter((group) => group.ports.length > 0);

  function nodeMatches(node: NodeDto): boolean {
    if (!normalizedQuery) return true;
    return [nodeName(node), node.name, `Node ${node.id}`, String(node.id)].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    );
  }

  function portMatches(node: NodeDto, port: PortDto): boolean {
    if (!normalizedQuery) return true;
    return [nodeName(node), node.name, port.name, `P${port.id}`, String(port.id)].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    );
  }

  function preferredPort(candidatePorts: PortDto[]): PortDto {
    for (const port of candidatePorts) {
      const pair = findStereoPortPair(port, candidatePorts);
      if (pair) return pair.left;
    }
    return candidatePorts[0];
  }

  function handleWindowKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = [...dialogElement.querySelectorAll<HTMLElement>('button, input')].filter(
      (element) => !element.hasAttribute('disabled'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  onMount(() => searchInput.focus());
</script>

<svelte:window onkeydown={handleWindowKeyDown} />

<div class="port-chooser-backdrop" data-testid="flow-port-chooser">
  <button
    class="port-chooser-backdrop__dismiss"
    type="button"
    tabindex="-1"
    aria-label={t('closePortChooser')}
    onclick={onClose}
  ></button>

  <div
    class="port-chooser-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="port-chooser-title"
    aria-describedby="port-chooser-hint"
    bind:this={dialogElement}
  >
    <header class="port-chooser-dialog__header">
      <div>
        <span>
          {t(
            automatic
              ? mode === 'output'
                ? 'fromStage'
                : 'targetDevice'
              : mode === 'output'
                ? 'fromPort'
                : 'targetPort',
          )}
        </span>
        <h2 id="port-chooser-title">
          {t(
            automatic
              ? mode === 'output'
                ? 'chooseStageTitle'
                : 'chooseDestinationTitle'
              : mode === 'output'
                ? 'chooseOutputTitle'
                : 'chooseTargetTitle',
          )}
        </h2>
        <p id="port-chooser-hint">
          {t(
            automatic
              ? mode === 'output'
                ? 'chooseStageHint'
                : 'chooseDestinationHint'
              : mode === 'output'
                ? 'chooseOutputHint'
                : 'chooseTargetHint',
          )}
        </p>
      </div>
      <button
        class="port-chooser-dialog__close"
        type="button"
        aria-label={t('closePortChooser')}
        data-testid="flow-port-chooser-close"
        onclick={onClose}
      >
        <span aria-hidden="true">×</span>
      </button>
    </header>

    <label class="port-chooser-dialog__search">
      <span>{t(automatic ? 'searchDevices' : 'searchPorts')}</span>
      <input
        type="search"
        bind:this={searchInput}
        bind:value={query}
        placeholder={t(automatic ? 'searchDevicesPlaceholder' : 'searchPortsPlaceholder')}
        autocomplete="off"
        data-testid="flow-port-chooser-search"
      />
    </label>

    <div class="port-chooser-dialog__body">
      {#each filteredGroups as group (group.node.id)}
        {#if automatic}
          {@const port = preferredPort(group.ports)}
          {@const selected = group.ports.some((candidate) => candidate.id === selectedPortId)}
          <button
            class:port-chooser-device--selected={selected}
            class="port-chooser-device"
            type="button"
            aria-pressed={mode === 'output' ? selected : undefined}
            data-testid={`flow-node-choice-${group.node.id}`}
            onclick={() => onChoose(port)}
          >
            <span>
              <strong>{nodeName(group.node)}</strong>
              <small>
                {t('nodeIdShort', { id: group.node.id })} · {t('channelsMatchedAutomatically')}
              </small>
            </span>
            <span class="port-chooser-port__action">
              {t(mode === 'input' ? 'connectNow' : selected ? 'selectedPort' : 'selectStage')}
            </span>
          </button>
        {:else}
          <section class="port-chooser-group">
            <header>
              <h3>{nodeName(group.node)}</h3>
              <span>{t('nodeIdShort', { id: group.node.id })}</span>
            </header>
            <div class="port-chooser-group__ports">
              {#each group.ports as port (port.id)}
                <button
                  class:port-chooser-port--selected={selectedPortId === port.id}
                  class="port-chooser-port"
                  type="button"
                  aria-pressed={selectedPortId === port.id}
                  data-testid={`flow-port-choice-${port.id}`}
                  onclick={() => onChoose(port)}
                >
                  <span>
                    <strong>{port.name}</strong>
                    <small>{t(port.mediaType)} · P{port.id}</small>
                  </span>
                  <span class="port-chooser-port__action">
                    {t(selectedPortId === port.id ? 'selectedPort' : 'selectPort')}
                  </span>
                </button>
              {/each}
            </div>
          </section>
        {/if}
      {:else}
        <div class="port-chooser-dialog__empty" role="status">
          <strong>{t(automatic ? 'noMatchingDevices' : 'noMatchingPorts')}</strong>
          <span>{t(automatic ? 'noMatchingDevicesHint' : 'noMatchingPortsHint')}</span>
        </div>
      {/each}
    </div>
  </div>
</div>
