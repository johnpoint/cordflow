import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoSnapshot } from '../bridge/mock';
import { buildAudioFlowModules } from '../graph/audioFlow';
import { translate, type MessageKey } from '../i18n';
import AudioFlowWorkspace from './AudioFlowWorkspace.svelte';

const t = (key: MessageKey, values: Record<string, string | number> = {}) =>
  translate('en', key, values);

afterEach(cleanup);

describe('AudioFlowWorkspace', () => {
  it('renders an independent route and edits its PipeWire links inline', async () => {
    const snapshot = demoSnapshot();
    const modules = buildAudioFlowModules(snapshot.nodes, snapshot.ports, snapshot.links);
    const onSelectFlow = vi.fn();
    const onCreateLinks = vi.fn();
    const onRemoveLinks = vi.fn();
    const { container, getAllByText, getByTestId, getByText, queryByTestId } = render(
      AudioFlowWorkspace,
      {
        props: {
          modules,
          nodes: snapshot.nodes,
          ports: snapshot.ports,
          links: snapshot.links,
          pendingLinks: [],
          removingLinkIds: new Set<number>(),
          status: snapshot.status,
          selectedFlowSourceId: null,
          focusedLinkIds: new Set<number>(),
          focusActive: false,
          autoStereoMatch: true,
          t,
          onSelectFlow,
          onCreateLinks,
          onRemoveLinks,
        },
      },
    );

    expect(getByTestId('flow-module-1')).toBeTruthy();
    expect(getAllByText('Firefox')).toHaveLength(2);
    expect(getByText('EasyEffects')).toBeTruthy();
    expect(getByText('Built-in Audio')).toBeTruthy();
    expect(getAllByText('1 ch')).toHaveLength(2);
    expect(container.querySelector('.audio-flow-overview')).toBeNull();

    await fireEvent.click(getByTestId('flow-select-1'));
    await fireEvent.click(getByTestId('flow-edit-1'));
    expect(onSelectFlow).toHaveBeenCalledWith(1);
    expect(getByTestId('flow-editor-1')).toBeTruthy();
    expect(queryByTestId('flow-link-101')).toBeNull();
    expect(container.querySelector('.audio-flow-editor__builder select')).toBeNull();

    await fireEvent.click(getByTestId('flow-output-chooser-trigger-1'));
    expect(getByTestId('flow-port-chooser')).toBeTruthy();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(queryByTestId('flow-port-chooser')).toBeNull();

    await fireEvent.click(getByTestId('flow-output-chooser-trigger-1'));
    expect(queryByTestId('flow-port-choice-12')).toBeNull();
    await fireEvent.click(getByTestId('flow-node-choice-1'));
    expect(queryByTestId('flow-port-chooser')).toBeNull();

    await fireEvent.click(getByTestId('flow-input-chooser-trigger-1'));
    await fireEvent.input(getByTestId('flow-port-chooser-search'), {
      target: { value: 'EasyEffects' },
    });
    await fireEvent.click(getByTestId('flow-node-choice-2'));
    expect(queryByTestId('flow-create-link-1')).toBeNull();
    expect(onCreateLinks).toHaveBeenCalledWith([
      {
        output: snapshot.ports.find((port) => port.id === 12),
        input: snapshot.ports.find((port) => port.id === 22),
      },
    ]);

    await fireEvent.click(getByTestId('flow-route-disconnect-1-1'));
    expect(onRemoveLinks).toHaveBeenCalledWith([102]);
  });

  it('reuses the last processing stage when adding a second output device', async () => {
    const snapshot = demoSnapshot();
    snapshot.nodes.push({
      id: 8,
      name: 'usb_headphones',
      mediaName: 'USB Headphones',
      kind: 'input',
    });
    snapshot.ports.push(
      {
        id: 81,
        nodeId: 8,
        name: 'playback_FL',
        channel: 'FL',
        direction: 'input',
        mediaType: 'audio',
      },
      {
        id: 82,
        nodeId: 8,
        name: 'playback_FR',
        channel: 'FR',
        direction: 'input',
        mediaType: 'audio',
      },
    );
    snapshot.links.push(
      {
        id: 103,
        outputPortId: 12,
        inputPortId: 22,
        active: true,
        mediaType: 'audio',
      },
      {
        id: 104,
        outputPortId: 24,
        inputPortId: 32,
        active: true,
        mediaType: 'audio',
      },
    );
    const modules = buildAudioFlowModules(snapshot.nodes, snapshot.ports, snapshot.links);
    const onCreateLinks = vi.fn();
    const { getByTestId, queryByTestId } = render(AudioFlowWorkspace, {
      props: {
        modules,
        nodes: snapshot.nodes,
        ports: snapshot.ports,
        links: snapshot.links,
        pendingLinks: [],
        removingLinkIds: new Set<number>(),
        status: snapshot.status,
        selectedFlowSourceId: null,
        focusedLinkIds: new Set<number>(),
        focusActive: false,
        autoStereoMatch: true,
        t,
        onSelectFlow: vi.fn(),
        onCreateLinks,
        onRemoveLinks: vi.fn(),
      },
    });

    await fireEvent.click(getByTestId('flow-edit-1'));
    expect(getByTestId('flow-output-chooser-trigger-1').textContent).toContain('EasyEffects');

    await fireEvent.click(getByTestId('flow-output-chooser-trigger-1'));
    await fireEvent.click(getByTestId('flow-node-choice-2'));
    await fireEvent.click(getByTestId('flow-input-chooser-trigger-1'));
    expect(queryByTestId('flow-node-choice-2')).toBeNull();
    expect(queryByTestId('flow-node-choice-3')).toBeNull();
    await fireEvent.click(getByTestId('flow-node-choice-8'));

    expect(onCreateLinks).toHaveBeenCalledWith([
      {
        output: snapshot.ports.find((port) => port.id === 23),
        input: snapshot.ports.find((port) => port.id === 81),
      },
      {
        output: snapshot.ports.find((port) => port.id === 24),
        input: snapshot.ports.find((port) => port.id === 82),
      },
    ]);
    expect(getByTestId('flow-output-chooser-trigger-1').textContent).toContain('EasyEffects');
  });
});
