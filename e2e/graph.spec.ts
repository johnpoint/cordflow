import { expect, test, type Page } from '@playwright/test';

async function expandConnectionPanel(page: Page): Promise<void> {
  const toggle = page.getByTestId('connection-panel-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

async function openAudioRouting(page: Page): Promise<void> {
  const button = page.getByTestId('view-audio-flows');
  if ((await button.getAttribute('aria-pressed')) === 'false') await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

async function openPortTopology(page: Page): Promise<void> {
  const advancedModeToggle = page.getByTestId('advanced-mode-toggle');
  if (!(await advancedModeToggle.isChecked())) {
    await page.getByTestId('advanced-mode-control').click();
  }
  await expect(advancedModeToggle).toBeChecked();
  const button = page.getByTestId('view-port-topology');
  await expect(button).toBeVisible();
  if ((await button.getAttribute('aria-pressed')) === 'false') {
    await button.click();
  }
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('workspace')).toBeVisible();
}

test('shows one readable end-to-end module per source in audio routing', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('view-output-volumes')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('advanced-mode-toggle')).not.toBeChecked();
  await expect(page.getByTestId('view-port-topology')).toHaveCount(0);
  await expect(page.getByTestId('patchbay-metrics')).toHaveCount(0);
  await expect(page.getByTestId('view-output-volumes')).toBeVisible();
  await expect(page.getByTestId('connection-panel-toggle')).toHaveCount(0);
  await openAudioRouting(page);
  await expect(page.locator('.audio-flow-overview')).toHaveCount(0);
  await expect(page.locator('.workspace-sidebar').getByTestId('flow-builder-open')).toBeVisible();
  const module = page.getByTestId('flow-module-1');
  const route = page.getByTestId('flow-route-1-1');

  await expect(module).toBeVisible();
  await expect(route).toContainText('Firefox');
  await expect(route).toContainText('EasyEffects');
  await expect(route).toContainText('Built-in Audio');
  await expect(route.locator('.audio-flow-hop')).toHaveCount(2);
  await expect(page.getByTestId('flow-module-4')).toHaveCount(0);
  await expect(page.locator('.link-layer')).toHaveCount(0);

  const readableScale = await module.evaluate((element) => ({
    moduleTitle: Number.parseFloat(
      getComputedStyle(element.querySelector('.audio-flow-module__name strong')!).fontSize,
    ),
    stageTitle: Number.parseFloat(
      getComputedStyle(element.querySelector('.audio-flow-stage strong')!).fontSize,
    ),
    stageHeight: element.querySelector('.audio-flow-stage')!.getBoundingClientRect().height,
  }));
  expect(readableScale.moduleTitle).toBeGreaterThanOrEqual(14);
  expect(readableScale.stageTitle).toBeGreaterThanOrEqual(12);
  expect(readableScale.stageHeight).toBeGreaterThanOrEqual(56);

  await page.getByTestId('flow-select-1').click();
  await expect(module).toHaveClass(/audio-flow-module--focused/);
  await page.getByTestId('flow-edit-1').click();
  await expect(page.getByTestId('view-audio-flows')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('flow-editor-1')).toBeVisible();
  await expect(page.locator('.audio-flow-editor__builder select')).toHaveCount(0);
  await expect(page.getByTestId('flow-editor-1')).not.toContainText('Connections in this flow');
  await expect(route.getByRole('button', { name: 'Disconnect route' })).toHaveCount(1);

  const outputChooserTrigger = page.getByTestId('flow-output-chooser-trigger-1');
  await outputChooserTrigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(outputChooserTrigger).toBeFocused();

  await outputChooserTrigger.click();
  await expect(page.locator('.port-chooser-port')).toHaveCount(0);
  await page.getByTestId('flow-node-choice-1').click();
  await page.getByTestId('flow-input-chooser-trigger-1').click();
  await page.getByTestId('flow-port-chooser-search').fill('EasyEffects');
  await expect(page.getByTestId('flow-node-choice-2')).toBeVisible();
  await page.getByTestId('flow-node-choice-2').click();
  await expect(page.getByTestId('flow-create-link-1')).toHaveCount(0);
  await expect(route.locator('.audio-flow-hop').first()).toHaveAttribute(
    'data-flow-link-ids',
    '101,700',
    { timeout: 5_000 },
  );
  await page.getByTestId('flow-route-disconnect-1-1').click();
  await expect(route).not.toContainText('Built-in Audio', { timeout: 5_000 });
  await expect(route.locator('.audio-flow-hop').first()).toHaveAttribute(
    'data-flow-link-ids',
    '101,700',
  );
});

test('shows and changes the system default playback device', async ({ page }) => {
  await page.goto('/?scenario=crowded-chooser');
  const control = page.getByTestId('default-playback-control');
  await expect(control.getByRole('combobox')).toHaveCount(0);
  await expect(control).toContainText('Built-in Audio');
  await page.getByTestId('default-devices-edit').click();
  const select = control.getByRole('combobox', { name: 'Default playback' });

  await expect(select).toHaveValue('3');
  await expect(select.locator('option:checked')).toContainText('Built-in Audio');
  await select.selectOption('811');
  await expect(control).toContainText('Applying');
  await expect(select).toBeEnabled({ timeout: 5_000 });
  await expect(select).toHaveValue('811');
  await expect(select.locator('option:checked')).toContainText('Unused audio target 12');
  await expect(select.locator('option:checked')).toContainText('Current');
  await page.getByTestId('default-devices-edit').click();
  await expect(control.getByRole('combobox')).toHaveCount(0);
  await expect(control).toContainText('Unused audio target 12');
});

test('shows and changes the system default input device', async ({ page }) => {
  await page.goto('/');
  const control = page.getByTestId('default-input-control');
  await expect(control.getByRole('combobox')).toHaveCount(0);
  await expect(control).toContainText('Built-in Microphone');
  await page.getByTestId('default-devices-edit').click();
  const select = control.getByRole('combobox', { name: 'Default input' });

  await expect(select).toHaveValue('70');
  await expect(select.locator('option')).toHaveCount(2);
  await expect(select.locator('option:checked')).toContainText('Built-in Microphone');
  await expect(select).not.toContainText('Firefox');
  await select.selectOption('71');
  await expect(control).toContainText('Applying');
  await expect(select).toBeEnabled({ timeout: 5_000 });
  await expect(select).toHaveValue('71');
  await expect(select.locator('option:checked')).toContainText('USB Microphone');
  await expect(select.locator('option:checked')).toContainText('Current');
  await page.getByTestId('default-devices-edit').click();
  await expect(control.getByRole('combobox')).toHaveCount(0);
  await expect(control).toContainText('USB Microphone');
});

test('adjusts volume and mute for each output device', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('view-output-volumes').click();
  await expect(page.getByTestId('output-volume-workspace')).toBeVisible();
  await expect(page.getByTestId('mixer-device-volume-tab')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('mixer-application-volume-panel')).toHaveCount(0);
  await expect(page.locator('.output-volume-card__volume-icon')).toHaveCount(0);
  const spectrum = page.getByTestId('output-spectrum');
  await expect(spectrum).toBeVisible();
  await expect(spectrum).toHaveText('');
  const leftSpectrumBand = page.getByTestId('output-spectrum-left-band-8');
  const rightSpectrumBand = page.getByTestId('output-spectrum-right-band-8');
  const firstLeftSpectrumHeight = await leftSpectrumBand.getAttribute('style');
  const firstRightSpectrumHeight = await rightSpectrumBand.getAttribute('style');
  await expect
    .poll(async () => leftSpectrumBand.getAttribute('style'))
    .not.toBe(firstLeftSpectrumHeight);
  await expect
    .poll(async () => rightSpectrumBand.getAttribute('style'))
    .not.toBe(firstRightSpectrumHeight);
  await expect(page.getByTestId('output-spectrum-left-channel')).toBeVisible();
  await expect(page.getByTestId('output-spectrum-right-channel')).toBeVisible();
  const spectrumBox = await spectrum.boundingBox();
  const mixerWorkspaceBox = await page.getByTestId('output-volume-workspace').boundingBox();
  const statusbarBox = await page.getByTestId('app-statusbar').boundingBox();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const goldenSectionHeight = viewportHeight * ((3 - Math.sqrt(5)) / 2);
  expect(spectrumBox).not.toBeNull();
  expect(mixerWorkspaceBox).not.toBeNull();
  expect(statusbarBox).not.toBeNull();
  expect(spectrumBox!.height).toBeCloseTo(goldenSectionHeight, 0);
  expect(mixerWorkspaceBox!.height).toBeGreaterThan(spectrumBox!.height);
  expect(mixerWorkspaceBox!.y + mixerWorkspaceBox!.height).toBeLessThanOrEqual(statusbarBox!.y + 1);
  expect(spectrumBox!.y + spectrumBox!.height).toBeLessThanOrEqual(statusbarBox!.y + 1);
  await expect(spectrum).toHaveCSS('position', 'absolute');
  await expect(spectrum).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('.output-volume-overview')).toHaveCount(0);
  await expect(page.getByTestId('connection-panel-toggle')).toHaveCount(0);
  await expect(page.getByTestId('output-volume-device-2')).toContainText('EasyEffects');
  const virtualDeviceType = page.getByTestId('output-volume-device-type-2');
  await expect(virtualDeviceType).toHaveAccessibleName('Virtual');
  await expect(virtualDeviceType).toContainText('[Virtual]');
  expect(
    await virtualDeviceType.evaluate(
      (element) =>
        element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight,
    ),
  ).toBe(true);

  const device = page.getByTestId('output-volume-device-3');
  const slider = page.getByTestId('output-volume-slider-3');
  const number = page.getByTestId('output-volume-number-3');
  const mute = page.getByTestId('output-volume-mute-3');
  const meter = page.getByTestId('output-level-meter-3');
  await expect(device).toContainText('Built-in Audio');
  await expect(device).toContainText('Default');
  await expect(page.getByTestId('output-volume-device-2')).toContainText('Virtual');
  await expect(slider).toHaveValue('65');
  await expect(slider).toHaveAttribute('step', '1');
  await expect(meter).toHaveAttribute('role', 'meter');
  await expect
    .poll(async () => Number(await meter.getAttribute('aria-valuenow')))
    .toBeGreaterThan(-60);
  const firstMeterLevel = await meter.getAttribute('aria-valuenow');
  await expect.poll(async () => meter.getAttribute('aria-valuenow')).not.toBe(firstMeterLevel);
  const meterFill = page.getByTestId('output-level-fill-3');
  await expect
    .poll(async () =>
      Number.parseFloat((await meterFill.getAttribute('style'))?.match(/[\d.]+/)?.[0] ?? '0'),
    )
    .toBeLessThanOrEqual((65 / 150) * 100);
  const sliderBox = await slider.boundingBox();
  expect(sliderBox).not.toBeNull();
  expect(sliderBox!.width).toBeGreaterThan(sliderBox!.height * 4);
  expect((await device.boundingBox())!.height).toBeGreaterThanOrEqual(120);
  expect((await device.boundingBox())!.height).toBeLessThan(190);
  await page.mouse.click(
    sliderBox!.x + sliderBox!.width * 0.8,
    sliderBox!.y + sliderBox!.height / 2,
  );
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(100);
  expect(Number.isInteger(Number(await slider.inputValue()))).toBe(true);
  await expect(page.getByTestId('output-volume-boost-hint-3')).toBeVisible();
  await expect(device).toContainText('Boost');
  await page.getByTestId('output-volume-boost-dismiss-3').click();
  await expect(page.getByTestId('output-volume-clipping-risk-3')).toBeVisible();

  await slider.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '72';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(slider).toBeEnabled();
  await expect(number).toHaveValue('72');
  await expect(page.getByTestId('output-volume-clipping-risk-3')).toHaveCount(0);

  await slider.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '82';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(slider).toBeEnabled();
  await expect(number).toHaveValue('82');
  await expect(slider).toHaveValue('82');

  await expect(mute).toBeEnabled({ timeout: 5_000 });
  await number.fill('95');
  await number.press('Enter');
  await expect(slider).toHaveValue('95');
  await page.getByTestId('output-volume-reset-3').click();
  await expect(slider).toHaveValue('100');

  await expect(mute.locator('.output-volume-card__mute-icon')).toHaveCount(0);
  await expect(mute).toHaveAttribute('title', 'Click to mute');
  await mute.click();
  await expect(mute).toBeDisabled();
  await expect(mute).toBeEnabled({ timeout: 5_000 });
  await expect(mute).toHaveAttribute('aria-pressed', 'true');
  await expect(mute).toHaveAttribute('title', 'Click to restore sound');
  await expect(mute).toContainText('Muted');
  await expect(meter).toHaveAttribute('aria-valuetext', '−∞ dBFS');
  await expect(device).toHaveClass(/output-volume-card--muted/);
  expect(
    await device
      .locator('.output-volume-card__identity')
      .evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity)),
  ).toBeLessThan(0.8);

  await mute.click();
  await expect(mute).toHaveAttribute('aria-pressed', 'false', { timeout: 5_000 });
  await expect(device).not.toHaveClass(/output-volume-card--muted/);

  await expect(page.getByTestId('output-volume-more-2')).toHaveCount(0);
  const setDefault = page.getByTestId('output-volume-default-2');
  await expect(setDefault).toBeVisible();
  await expect(setDefault).toHaveText('Set as default');
  await setDefault.click();
  await expect(page.getByTestId('default-playback-control')).toContainText('EasyEffects');
  await expect(page.getByTestId('default-playback-control').getByRole('combobox')).toHaveCount(0);
  await expect(page.getByTestId('output-volume-device-2')).toContainText('Default');
});

test('remembers application volume while its audio stream is inactive', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('mixer-application-volume-tab').click();
  await expect(page.getByTestId('mixer-application-volume-tab')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('mixer-device-volume-panel')).toHaveCount(0);

  const firefox = page.getByTestId('application-volume-org-mozilla-firefox');
  const firefoxSlider = page.getByTestId('application-volume-slider-org-mozilla-firefox');
  const firefoxMute = page.getByTestId('application-volume-mute-org-mozilla-firefox');
  await expect(firefox).toContainText('Firefox');
  await expect(firefox).toContainText('Stream available');
  await expect(firefoxSlider).toHaveValue('100');

  await firefoxSlider.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = '34';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(firefoxSlider).toBeEnabled({ timeout: 5_000 });
  await expect(firefoxSlider).toHaveValue('34');
  await expect(firefoxMute).toBeEnabled({ timeout: 5_000 });
  await firefoxMute.click();
  await expect(firefoxMute).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

  await page.evaluate(() => {
    const key = 'cordflow.application-volumes';
    const remembered = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<
      Record<string, unknown>
    >;
    remembered.push({
      id: 'org.example.Notifier',
      name: 'Notifier',
      volumePercent: 18,
      muted: true,
      lastSeenAt: Date.now(),
    });
    localStorage.setItem(key, JSON.stringify(remembered));
    sessionStorage.removeItem('cordflow.mock.demo');
  });
  await page.reload();

  await expect(page.getByTestId('mixer-application-volume-tab')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(firefoxSlider).toHaveValue('34', { timeout: 5_000 });
  await expect(firefoxMute).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

  const notifier = page.getByTestId('application-volume-org-example-notifier');
  await expect(notifier).toContainText('Remembered');
  await expect(notifier).toContainText('Waiting for the next audio stream');
  await expect(page.getByTestId('application-volume-slider-org-example-notifier')).toHaveValue(
    '18',
  );
  await expect(page.getByTestId('application-volume-mute-org-example-notifier')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('creates a shared processing flow with multiple outputs through the guided builder', async ({
  page,
}) => {
  await page.goto('/?scenario=crowded-chooser');
  await openAudioRouting(page);
  await page.getByTestId('flow-builder-open').click();
  await expect(page.getByTestId('flow-builder')).toBeVisible();

  await page.getByTestId('flow-builder-source-1').click();
  await page.getByTestId('flow-builder-step-2').click();
  await page.getByTestId('flow-builder-skip-processing').click();
  await page.getByTestId('flow-builder-destination-3').click();
  await page.getByTestId('flow-builder-destination-811').click();
  await expect(page.getByTestId('flow-builder-complete')).toBeEnabled();
  await page.getByTestId('flow-builder-complete').click();

  await expect(page.getByTestId('flow-builder')).toHaveCount(0);
  await expect(page.getByTestId('flow-builder-open')).toBeFocused();
  const firstRoute = page.getByTestId('flow-route-1-1');
  const secondRoute = page.getByTestId('flow-route-1-2');
  await expect(firstRoute.locator('.audio-flow-hop').first()).toHaveAttribute(
    'data-flow-link-ids',
    '101,700',
    { timeout: 5_000 },
  );
  await expect(firstRoute.locator('.audio-flow-hop').nth(1)).toHaveAttribute(
    'data-flow-link-ids',
    '102,701',
  );
  await expect(secondRoute).toContainText('Unused audio target 12');
  await expect(secondRoute).toContainText('EasyEffects');
  await expect(secondRoute.locator('.audio-flow-hop').nth(1)).toHaveAttribute(
    'data-flow-link-ids',
    '702',
  );
});

test('keeps every target device selectable when the chooser contains many nodes', async ({
  page,
}) => {
  await page.goto('/?scenario=crowded-chooser');
  await openAudioRouting(page);
  await page.getByTestId('flow-edit-1').click();
  await expect(page.getByTestId('flow-output-chooser-trigger-1')).toContainText('EasyEffects');
  await page.getByTestId('flow-input-chooser-trigger-1').click();

  const chooserBody = page.locator('.port-chooser-dialog__body');
  await expect(chooserBody).toHaveCSS('display', 'flex');
  const choices = page.locator('.port-chooser-device');
  await expect(choices).toHaveCount(13);
  await expect(page.locator('.port-chooser-port')).toHaveCount(0);
  const usableHeights = await choices.evaluateAll((buttons) =>
    buttons.map((button) => button.getBoundingClientRect().height),
  );
  expect(Math.min(...usableHeights)).toBeGreaterThanOrEqual(56);
  expect(await chooserBody.evaluate((body) => body.scrollHeight > body.clientHeight)).toBe(true);

  const lastChoice = page.getByTestId('flow-node-choice-811');
  await lastChoice.scrollIntoViewIfNeeded();
  await lastChoice.click();
  await expect(page.getByTestId('flow-port-chooser')).toHaveCount(0);
  await expect(page.getByTestId('flow-route-1-2')).toContainText('Unused audio target 12', {
    timeout: 5_000,
  });
  await expect(page.getByTestId('flow-route-1-2')).not.toContainText('playback_11');
  await expect(
    page.getByTestId('flow-route-1-2').locator('.audio-flow-hop').last(),
  ).toHaveAttribute('data-flow-link-ids', '700');
  await expect(page.getByTestId('flow-output-chooser-trigger-1')).toContainText('EasyEffects');
});

test('matches both stereo channels from the audio-flow connection editor', async ({ page }) => {
  await page.goto('/');
  await openAudioRouting(page);
  await page.getByTestId('flow-edit-1').click();
  await expect(page.getByTestId('flow-editor-1')).toContainText(
    'Add multiple output devices without duplicating the processing chain',
  );

  await page.getByTestId('flow-route-disconnect-1-1').click();
  await expect(page.getByTestId('flow-route-1-1')).not.toContainText('Built-in Audio', {
    timeout: 5_000,
  });
  await page.getByTestId('flow-output-chooser-trigger-1').click();
  await page.getByTestId('flow-node-choice-2').click();
  await page.getByTestId('flow-input-chooser-trigger-1').click();
  await page.getByTestId('flow-node-choice-3').click();

  const stereoRoute = page.getByTestId('flow-route-1-1');
  await expect(stereoRoute).toContainText('EasyEffects', { timeout: 5_000 });
  await expect(stereoRoute).toContainText('Built-in Audio');
  await expect(stereoRoute).not.toContainText('output_FL');
  await expect(stereoRoute).not.toContainText('output_FR');
  await expect(stereoRoute.locator('.audio-flow-hop').last()).toHaveAttribute(
    'data-flow-link-ids',
    '700,701',
  );

  await page.getByTestId('flow-route-disconnect-1-1').click();
  await expect(stereoRoute).not.toContainText('Built-in Audio', { timeout: 5_000 });
  await openPortTopology(page);
  await expect(page.getByTestId('link-700')).toHaveCount(0);
  await expect(page.getByTestId('link-701')).toHaveCount(0);
});

test('keeps advanced routing off by default and persists the mode switch', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Cordflow');
  await expect(page.locator('.app-header h1')).toHaveText('Cordflow');
  await expect(page.locator('.brand-mark')).toHaveText('[CF]');
  await expect(page.locator('.app-header')).not.toContainText('Helvum');
  await expect(page.locator('.app-header')).toHaveAttribute('data-tauri-drag-region', '');
  const titleSpacing = await page.locator('.app-header').evaluate((header) => {
    const title = header.querySelector('h1')!.getBoundingClientRect();
    const subtitle = header.querySelector('p')!.getBoundingClientRect();
    const bounds = header.getBoundingClientRect();
    return {
      height: bounds.height,
      top: title.top - bounds.top,
      bottom: bounds.bottom - subtitle.bottom,
    };
  });
  expect(titleSpacing.height).toBeGreaterThanOrEqual(48);
  expect(titleSpacing.top).toBeGreaterThanOrEqual(5);
  expect(titleSpacing.bottom).toBeGreaterThanOrEqual(5);
  await expect(page.getByTestId('window-minimize')).toHaveAccessibleName('Minimize window');
  await expect(page.getByTestId('window-maximize')).toHaveAccessibleName(
    'Maximize or restore window',
  );
  await expect(page.getByTestId('window-close')).toHaveAccessibleName('Close window');
  const statusbar = page.getByTestId('app-statusbar');
  await expect(statusbar).toBeVisible();
  await expect(statusbar.getByTestId('default-input-control')).toBeVisible();
  await expect(statusbar.getByTestId('default-playback-control')).toBeVisible();
  await expect(statusbar.getByTestId('graph-status')).toContainText('Connected');
  const connectionStatusBox = await statusbar.getByTestId('graph-status').boundingBox();
  const defaultDevicesBox = await statusbar.locator('.default-device-controls').boundingBox();
  expect(connectionStatusBox).not.toBeNull();
  expect(defaultDevicesBox).not.toBeNull();
  expect(connectionStatusBox!.x).toBeLessThan(defaultDevicesBox!.x);
  await expect(statusbar.getByTestId('advanced-mode-control')).toBeVisible();
  await expect(statusbar).not.toContainText('Device controls only');
  await expect(statusbar).not.toContainText('Routing policy is fixed by this workspace.');
  await expect(page.locator('.app-header').getByTestId('graph-status')).toHaveCount(0);
  await expect(page.locator('.workspace-sidebar').getByTestId('advanced-mode-control')).toHaveCount(
    0,
  );
  const navigationItems = page.locator('.workspace-nav__item');
  await expect(navigationItems).toHaveCount(2);
  await expect(navigationItems.nth(0)).toHaveAttribute('data-testid', 'view-output-volumes');
  await expect(navigationItems.nth(0)).toContainText('Output mixer');
  await expect(navigationItems.nth(1)).toHaveAttribute('data-testid', 'view-audio-flows');
  await expect(navigationItems.nth(1)).toContainText('Audio routing');
  await expect(page.getByTestId('view-output-volumes')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('view-audio-flows')).toBeVisible();
  await expect(page.getByTestId('view-output-volumes')).toBeVisible();
  await expect(page.getByTestId('advanced-mode-toggle')).not.toBeChecked();
  await expect(page.getByTestId('view-port-topology')).toHaveCount(0);

  await page.getByTestId('advanced-mode-control').click();
  await expect(page.getByTestId('advanced-mode-toggle')).toBeChecked();
  await expect(page.getByTestId('view-port-topology')).toBeVisible();
  await expect(navigationItems).toHaveCount(3);
  await expect(navigationItems.nth(2)).toContainText('Advanced patchbay');
  await page.getByTestId('view-port-topology').click();
  await expect(page.getByTestId('view-port-topology')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(page.getByTestId('patchbay-heading')).toHaveCount(0);
  const patchbayMetrics = page.getByTestId('patchbay-metrics');
  await expect(patchbayMetrics).toBeVisible();
  await expect(patchbayMetrics).toContainText('nodes');
  await expect(patchbayMetrics).toContainText('ports');
  await expect(patchbayMetrics).toContainText('links');
  await expect(page.locator('.patchbay-interaction-strip__shortcuts')).toBeVisible();
  const [workspaceBox, interactionStripBox, navigationBox, metricsBox] = await Promise.all([
    page.getByTestId('workspace').boundingBox(),
    page.getByTestId('patchbay-interaction-strip').boundingBox(),
    page.locator('.workspace-nav').boundingBox(),
    patchbayMetrics.boundingBox(),
  ]);
  expect(Math.abs((workspaceBox?.width ?? 0) - (interactionStripBox?.width ?? 0))).toBeLessThan(1);
  expect(Math.abs((navigationBox?.y ?? 0) - (metricsBox?.y ?? 0))).toBeLessThanOrEqual(6);
  expect(
    await page
      .getByTestId('workspace')
      .evaluate((element) => getComputedStyle(element).scrollbarWidth),
  ).toBe('thin');
  await expect(page.getByTestId('connection-panel-toggle')).toBeVisible();

  await page.getByTestId('advanced-mode-control').click();
  await expect(page.getByTestId('advanced-mode-toggle')).not.toBeChecked();
  await expect(page.getByTestId('view-port-topology')).toHaveCount(0);
  await expect(page.getByTestId('patchbay-metrics')).toHaveCount(0);
  await expect(page.getByTestId('view-output-volumes')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('connection-panel-toggle')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('advanced-mode-toggle')).not.toBeChecked();
  await expect(page.getByTestId('view-port-topology')).toHaveCount(0);
  await expect(page.getByTestId('view-output-volumes')).toHaveAttribute('aria-pressed', 'true');
});

test('migrates legacy custom mode to the advanced patchbay', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('cordflow.workspace');
    localStorage.setItem('helvum-next.custom-mode', 'true');
    localStorage.setItem('helvum-next.workspace-view', 'flows');
  });
  await page.goto('/');
  await expect(page.getByTestId('advanced-mode-toggle')).toBeChecked();
  await expect(page.getByTestId('view-port-topology')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('workspace')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cordflow.workspace'))).toBe('patchbay');
});

test('creates and confirms a link with the complete keyboard path', async ({ page }) => {
  await page.goto('/');
  await openPortTopology(page);
  await expandConnectionPanel(page);
  await expect(page.getByTestId('graph-status')).toContainText('Connected');
  await expect(
    page.getByTestId('connection-list').locator('[data-testid^="connection-"]'),
  ).toHaveCount(2);

  await page.getByTestId('port-12').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  const target = page.locator(':focus');
  await expect(target).toHaveAttribute('data-direction', 'input');
  await expect(target).toHaveClass(/port-button--compatible/);
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('pending-connection')).toBeVisible();
  await expect(page.getByTestId('pending-connection')).toHaveCount(0, { timeout: 5_000 });
  await expect(
    page.getByTestId('connection-list').locator('[data-testid^="connection-"]'),
  ).toHaveCount(3);
});

test('creates a link by clicking a start port and a highlighted target', async ({ page }) => {
  await page.goto('/');
  await openPortTopology(page);
  await expandConnectionPanel(page);
  const start = page.getByTestId('port-12');
  const target = page.getByTestId('port-22');

  await start.click();
  await expect(start).toHaveAttribute('aria-pressed', 'true');
  await expect(target).toHaveClass(/port-button--compatible/);
  await target.click();

  await expect(page.getByTestId('pending-connection')).toBeVisible();
  await expect(page.getByTestId('pending-connection')).toHaveCount(0, { timeout: 5_000 });
  await expect(
    page.getByTestId('connection-list').locator('[data-testid^="connection-"]'),
  ).toHaveCount(3);
});

test('normalizes a mouse drag that starts from an input port', async ({ page }) => {
  await page.goto('/');
  await openPortTopology(page);
  await expandConnectionPanel(page);
  const input = page.getByTestId('port-22');
  const output = page.getByTestId('port-12');
  await input.scrollIntoViewIfNeeded();
  await output.scrollIntoViewIfNeeded();
  const inputBox = await input.boundingBox();
  const outputBox = await output.boundingBox();
  if (!inputBox || !outputBox) throw new Error('demo ports are not visible');

  await page.mouse.move(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(outputBox.x + outputBox.width / 2, outputBox.y + outputBox.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  await expect(page.getByTestId('pending-connection')).toBeVisible();
  await expect(page.getByTestId('pending-connection')).toHaveCount(0, { timeout: 5_000 });
  await expect(
    page.getByTestId('connection-list').locator('[data-testid^="connection-"]'),
  ).toHaveCount(3);
});

test('uses a single selected channel in the advanced patchbay', async ({ page }) => {
  await page.goto('/');
  await openPortTopology(page);
  await expandConnectionPanel(page);
  await expect(page.getByTestId('patchbay-interaction-strip')).toContainText('Select a start port');

  await page.getByTestId('connection-101').getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByTestId('connection-101')).toHaveCount(0, { timeout: 5_000 });

  const start = page.getByTestId('port-11');
  const target = page.getByTestId('port-22');
  await start.click();
  await expect(target).toHaveClass(/port-button--compatible/);
  await target.click();

  await expect(page.getByTestId('link-700')).toBeAttached({ timeout: 5_000 });
  await expect(page.getByTestId('link-701')).toHaveCount(0);
  await expect(page.getByTestId('connection-700')).toContainText('output_FL');
  await expect(page.getByTestId('connection-700')).toContainText('input_FR');
});

test('cancels a keyboard connection with Escape or a blank-canvas click', async ({ page }) => {
  await page.goto('/');
  await openPortTopology(page);
  const port = page.getByTestId('port-12');
  await port.focus();
  await page.keyboard.press('Enter');
  await expect(port).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(port).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('Enter');
  await expect(port).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.workspace-canvas').click({ position: { x: 5, y: 5 } });
  await expect(port).toHaveAttribute('aria-pressed', 'false');
});

test('creates MIDI and video routes with distinct labels and line patterns', async ({ page }) => {
  await page.goto('/');
  await openPortTopology(page);
  await expandConnectionPanel(page);

  await page.getByTestId('port-41').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('link-700')).toBeAttached({ timeout: 5_000 });
  await expect(page.getByTestId('connection-700')).toContainText('MIDI');

  await page.getByTestId('port-51').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('link-701')).toBeAttached({ timeout: 5_000 });
  await expect(page.getByTestId('connection-701')).toContainText('Video');

  const patterns = await Promise.all(
    [101, 700, 701].map((id) =>
      page
        .getByTestId(`link-${id}`)
        .locator('.link-path__visible')
        .evaluate((path) => getComputedStyle(path).strokeDasharray),
    ),
  );
  expect(new Set(patterns).size).toBe(3);

  const audioLink = page.getByTestId('link-101');
  await expect(audioLink.locator('.link-path__outline')).toHaveCount(1);
  await expect(audioLink.locator('.link-path__visible')).toHaveAttribute(
    'marker-end',
    'url(#link-arrow-audio)',
  );
});

test('disconnects an existing link from the readable connection list', async ({ page }) => {
  await page.goto('/');
  await openPortTopology(page);
  await expandConnectionPanel(page);
  const first = page.getByTestId('connection-101');
  await expect(first).toContainText('Firefox');
  await expect(first).toContainText('output_FL');
  await expect(first).toContainText('input_FL');
  await first.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByTestId('connection-101')).toHaveCount(0, { timeout: 5_000 });
});

test('disconnects the selected link with Delete', async ({ page }) => {
  await page.goto('/');
  await openPortTopology(page);
  await expandConnectionPanel(page);
  await page.getByTestId('connection-101').locator('.connection-item__main').click();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('connection-101')).toHaveCount(0, { timeout: 5_000 });
});

test('selects a visible SVG link directly and exposes the disconnect action', async ({ page }) => {
  await page.goto('/');
  await openPortTopology(page);
  const point = await page
    .getByTestId('link-101')
    .locator('.link-path__hit')
    .evaluate((element) => {
      const path = element as SVGPathElement;
      const local = path.getPointAtLength(path.getTotalLength() / 2);
      const matrix = path.getScreenCTM();
      if (!matrix) throw new Error('link path has no screen transform');
      const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });
  const hitLinkId = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest<SVGGElement>('[data-link-id]')?.dataset.linkId,
    point,
  );
  expect(hitLinkId).toBe('101');
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('focused-chain')).toBeVisible();
  await expect(page.locator('.port-button--link-selected')).toHaveCount(2);
  await expandConnectionPanel(page);
  const disconnect = page
    .getByTestId('selected-connection-summary')
    .getByRole('button', { name: 'Disconnect selected' });
  await expect(disconnect).toBeVisible();
  await disconnect.click();
  await expect(page.getByTestId('link-101')).toHaveCount(0, { timeout: 5_000 });
});

test('clicking a node highlights its complete transitive chain above every card', async ({
  page,
}) => {
  await page.goto('/');
  await openPortTopology(page);
  await expandConnectionPanel(page);
  await page.getByTestId('node-select-1').click();

  for (const nodeId of [1, 2, 3]) {
    await expect(page.getByTestId(`node-${nodeId}`)).toHaveClass(/node-card--focused/);
  }
  await expect(page.getByTestId('node-1')).toHaveClass(/node-card--focus-root/);
  await expect(page.getByTestId('node-4')).toHaveClass(/node-card--deemphasized/);
  await expect(page.locator('.port-button--link-selected')).toHaveCount(4);
  await expect(page.getByTestId('connection-101')).toHaveClass(/connection-item--focused/);
  await expect(page.getByTestId('connection-102')).toHaveClass(/connection-item--focused/);

  const focusLinks = await page
    .locator('[data-focus-link-id]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-focus-link-id')),
    );
  expect(new Set(focusLinks)).toEqual(new Set(['101', '102']));

  const layerOrder = await page.evaluate(() => ({
    cards: Number(getComputedStyle(document.querySelector('.graph-column__nodes')!).zIndex),
    focusedChain: Number(getComputedStyle(document.querySelector('.link-focus-layer')!).zIndex),
  }));
  expect(layerOrder.focusedChain).toBeGreaterThan(layerOrder.cards);

  await page.locator('.workspace-canvas').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('focused-chain')).toHaveCount(0);
  await expect(page.locator('.node-card--focused')).toHaveCount(0);
});

test('expands to every signal-flow layer beyond three columns', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 700 });
  await page.goto('/?scenario=deep');
  await openPortTopology(page);
  const columns = page.locator('[data-testid^="topology-column-"]');
  await expect(columns).toHaveCount(5);
  await expect(page.getByRole('heading', { name: 'Signal layer 4' })).toBeVisible();
  await expect(page.getByTestId('node-5')).toHaveAttribute('data-node-id', '5');
  const overflows = await page
    .getByTestId('workspace')
    .evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflows).toBe(true);
});

test('collapses connection details by default and persists the drawer state', async ({ page }) => {
  await page.goto('/');
  await openPortTopology(page);
  const toggle = page.getByTestId('connection-panel-toggle');
  const workspace = page.getByTestId('workspace');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('connection-list')).toHaveCount(0);
  const collapsedHeight = await workspace.evaluate(
    (element) => element.getBoundingClientRect().height,
  );

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('connection-list')).toBeVisible();
  const expandedHeight = await workspace.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect(collapsedHeight - expandedHeight).toBeGreaterThan(80);

  await page.reload();
  await expect(page.getByTestId('connection-panel-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.getByTestId('connection-panel-toggle').click();
  await page.reload();
  await expect(page.getByTestId('connection-panel-toggle')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('switches to Simplified Chinese and persists the choice', async ({ page }) => {
  await page.goto('/');
  await openPortTopology(page);
  await page.getByTestId('settings-menu-trigger').click();
  await page.getByLabel('Language').selectOption('zh-CN');
  await expect(page.getByRole('heading', { name: '信号层 1' })).toBeVisible();
  await expect(page.getByText('路由', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '连接列表' })).toBeVisible();
});

test('restores the confirmed graph after a window reload', async ({ page }) => {
  await page.goto('/');
  await openPortTopology(page);
  await expandConnectionPanel(page);
  await page.getByTestId('port-12').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(
    page.getByTestId('connection-list').locator('[data-testid^="connection-"]'),
  ).toHaveCount(2, { timeout: 5_000 });

  await page.reload();
  await expect(
    page.getByTestId('connection-list').locator('[data-testid^="connection-"]'),
  ).toHaveCount(2);
});

test('resyncs and reports an unconfirmed operation after five seconds', async ({ page }) => {
  await page.goto('/?scenario=timeout');
  await openPortTopology(page);
  await expandConnectionPanel(page);
  await page.getByTestId('port-12').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('pending-connection')).toBeVisible();

  await expect(page.getByTestId('pending-connection')).toHaveCount(0, { timeout: 6_500 });
  await expect(page.getByRole('alert')).toContainText('did not confirm');
  await page.waitForTimeout(3_500);
  await expect(page.getByRole('alert')).toContainText('did not confirm');
  await expect(
    page.getByTestId('connection-list').locator('[data-testid^="connection-"]'),
  ).toHaveCount(2);
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('announces a successful backend reconnect with a new generation', async ({ page }) => {
  await page.goto('/?scenario=reconnect');
  await openPortTopology(page);
  await expect(page.getByTestId('graph-status')).toContainText('Disconnected');
  await expect(page.getByTestId('port-12')).toBeDisabled();
  await expect(page.getByTestId('graph-status')).toContainText('Connected', { timeout: 5_000 });
  await expect(page.getByTestId('port-12')).toBeEnabled();
  await expect(page.locator('.sr-only')).toContainText('reconnected');
});

test('renders the stress graph with one SVG link per backend link', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as Window & { __portMeasureCount?: number };
    state.__portMeasureCount = 0;
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (this instanceof Element && this.hasAttribute('data-port-id')) {
        state.__portMeasureCount = (state.__portMeasureCount ?? 0) + 1;
      }
      return original.call(this);
    };
  });
  await page.goto('/?stress=1');
  await openAudioRouting(page);
  await expect(page.locator('[data-testid^="flow-module-"]')).toHaveCount(21, {
    timeout: 10_000,
  });
  const flowFocusLatency = await page.getByTestId('flow-select-1000').evaluate(async (element) => {
    const startedAt = performance.now();
    (element as HTMLButtonElement).click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return performance.now() - startedAt;
  });
  expect(flowFocusLatency).toBeLessThan(300);
  await expect(page.getByTestId('flow-module-1000')).toHaveClass(/audio-flow-module--focused/);
  await expect(page.locator('.link-layer')).toHaveCount(0);

  await openPortTopology(page);
  await expandConnectionPanel(page);
  await expect(page.locator('[data-node-id]')).toHaveCount(50, { timeout: 10_000 });
  await expect(page.locator('[data-port-id]')).toHaveCount(200);
  await expect(page.locator('[data-link-id]')).toHaveCount(100);

  const cardsStayInsideColumns = await page.locator('[data-node-id]').evaluateAll((cards) =>
    cards.every((card) => {
      const column = card.closest('.graph-column');
      if (!column) return false;
      const cardRect = card.getBoundingClientRect();
      const columnRect = column.getBoundingClientRect();
      return cardRect.left >= columnRect.left - 1 && cardRect.right <= columnRect.right + 1;
    }),
  );
  expect(cardsStayInsideColumns).toBe(true);

  const routesFitPanel = await page
    .getByTestId('connection-list')
    .evaluate((list) => list.scrollWidth <= list.clientWidth + 1);
  expect(routesFitPanel).toBe(true);

  const linkIds = await page
    .locator('[data-link-id]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-link-id')));
  expect(new Set(linkIds).size).toBe(100);

  await page.waitForTimeout(200);
  const measurementsBefore = await page.evaluate(
    () => (window as Window & { __portMeasureCount?: number }).__portMeasureCount ?? 0,
  );
  await page.waitForTimeout(400);
  const measurementsAfter = await page.evaluate(
    () => (window as Window & { __portMeasureCount?: number }).__portMeasureCount ?? 0,
  );
  expect(measurementsAfter - measurementsBefore).toBeLessThan(400);

  const measurementsBeforeFocus = measurementsAfter;
  const focusLatency = await page.getByTestId('node-select-1000').evaluate(async (element) => {
    const startedAt = performance.now();
    (element as HTMLButtonElement).click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return performance.now() - startedAt;
  });
  await expect(page.getByTestId('focused-chain')).toBeVisible();
  expect(focusLatency).toBeLessThan(300);
  await page.waitForTimeout(100);
  const measurementsAfterFocus = await page.evaluate(
    () => (window as Window & { __portMeasureCount?: number }).__portMeasureCount ?? 0,
  );
  expect(measurementsAfterFocus - measurementsBeforeFocus).toBeLessThan(20);
  await expect(page.getByTestId('node-1049')).toHaveCSS('filter', 'none');
  await expect(page.locator('.link-focus__outline').first()).toHaveCSS('filter', 'none');

  const port = page.getByTestId('port-2000');
  await port.scrollIntoViewIfNeeded();
  const box = await port.boundingBox();
  if (!box) throw new Error('stress port is not visible');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 50, { steps: 8 });
  await expect(page.locator('.link-preview')).toHaveCount(1);
  await page.mouse.up();
});
