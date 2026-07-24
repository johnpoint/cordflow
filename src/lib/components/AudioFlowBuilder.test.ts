import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoSnapshot } from '../bridge/mock';
import { translate, type MessageKey } from '../i18n';
import AudioFlowBuilder from './AudioFlowBuilder.svelte';

const t = (key: MessageKey, values: Record<string, string | number> = {}) =>
  translate('en', key, values);

afterEach(cleanup);

describe('AudioFlowBuilder', () => {
  it('skips the optional processing step and moves to output selection', async () => {
    const snapshot = demoSnapshot();
    const { getByTestId, queryByTestId } = render(AudioFlowBuilder, {
      props: {
        nodes: snapshot.nodes,
        ports: snapshot.ports,
        links: snapshot.links,
        pendingLinks: [],
        status: snapshot.status,
        t,
        onComplete: vi.fn(),
        onClose: vi.fn(),
      },
    });

    await fireEvent.click(getByTestId('flow-builder-source-1'));
    await fireEvent.click(getByTestId('flow-builder-skip-processing'));

    expect(getByTestId('flow-builder-destination-3')).toBeTruthy();
    expect(queryByTestId('flow-builder-step-2')).toBeNull();
  });

  it('builds a shared processing chain with multiple output devices step by step', async () => {
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
    const onComplete = vi.fn();
    const onClose = vi.fn();
    const { getByTestId, getByText, queryByTestId } = render(AudioFlowBuilder, {
      props: {
        nodes: snapshot.nodes,
        ports: snapshot.ports,
        links: snapshot.links,
        pendingLinks: [],
        status: snapshot.status,
        t,
        onComplete,
        onClose,
      },
    });

    await fireEvent.click(getByTestId('flow-builder-source-1'));
    await fireEvent.click(getByTestId('flow-builder-step-2'));
    expect(getByText('0 new · 2 reused')).toBeTruthy();
    await fireEvent.click(getByTestId('flow-builder-skip-processing'));

    await fireEvent.click(getByTestId('flow-builder-destination-3'));
    expect(queryByTestId('flow-builder-step-2')).toBeNull();
    await fireEvent.click(getByTestId('flow-builder-destination-8'));
    await fireEvent.click(getByTestId('flow-builder-complete'));

    expect(onComplete).toHaveBeenCalledWith([
      {
        output: snapshot.ports.find((port) => port.id === 23),
        input: snapshot.ports.find((port) => port.id === 81),
      },
      {
        output: snapshot.ports.find((port) => port.id === 24),
        input: snapshot.ports.find((port) => port.id === 82),
      },
    ]);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
