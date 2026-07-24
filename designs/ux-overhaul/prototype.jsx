const {
  Button,
  ConnectionRow,
  DeviceSelector,
  Dialog,
  Drawer,
  ModeSwitch,
  NodeCard,
  PortSocket,
  StatusBadge,
  SpectrumAnalyzer,
  VolumeControl,
  WorkspaceNav
} = window.HelvumStudio_38c7d4;

function FlowBuilder({ onClose, onCreated }) {
  const [builderStep, setBuilderStep] = React.useState(1);
  const [sourceNode, setSourceNode] = React.useState(null);
  const [processorNodes, setProcessorNodes] = React.useState([]);
  const [destinationNodes, setDestinationNodes] = React.useState([]);
  const toggleValue = (values, value) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  const canContinue = builderStep === 1 ? sourceNode !== null : builderStep === 2 ? true : destinationNodes.length > 0;
  const footer = (
    <React.Fragment>
      {builderStep > 1 ? <Button variant="ghost" onClick={() => setBuilderStep(builderStep - 1)}>Back</Button> : null}
      {builderStep < 3 ? <Button variant="primary" disabled={!canContinue} onClick={() => setBuilderStep(builderStep + 1)}>{builderStep === 2 && processorNodes.length === 0 ? 'Skip processing' : 'Continue'}</Button> : <Button variant="primary" disabled={!canContinue} onClick={() => { onCreated(); onClose(); }}>Create 4 connections</Button>}
    </React.Fragment>
  );
  return (
    <Dialog title="Create audio flow" description="Three explicit steps · automatic stereo matching" onClose={onClose} footer={footer}>
      <div className="ux-builder">
        <div className="ux-builder-steps" aria-label="Audio flow setup progress">
          {['Choose source', 'Processing chain', 'Choose outputs'].map((label, index) => <div key={label} className={`ux-builder-step ${builderStep === index + 1 ? 'ux-builder-step--active' : ''}`}><strong>{index + 1}. {label}</strong><small>{index + 1 < builderStep ? 'Complete' : index + 1 === builderStep ? 'Current step' : 'Not started'}</small></div>)}
        </div>
        {sourceNode ? <section className="ux-builder-summary"><strong>Flow plan</strong><div className="ux-builder-summary__route"><span>{sourceNode}</span>{processorNodes.map((processor) => <React.Fragment key={processor}><span>→</span><span>{processor}</span></React.Fragment>)}{destinationNodes.map((destination) => <React.Fragment key={destination}><span>↳</span><span>{destination}</span></React.Fragment>)}</div></section> : null}
        <div className="ux-builder-list">
          {builderStep === 1 ? ['Firefox', 'Music Player', 'Built-in Microphone'].map((sourceItem) => <button className="ux-choice-row" type="button" key={sourceItem} onClick={() => setSourceNode(sourceItem)}><input type="radio" readOnly checked={sourceNode === sourceItem} /><span><strong>{sourceItem}</strong><small>Audio source · stereo available</small></span><b>Select</b></button>) : builderStep === 2 ? cordflowMockData.processors.map((processorItem) => <label className="ux-choice-row" key={processorItem}><input type="checkbox" checked={processorNodes.includes(processorItem)} onChange={() => setProcessorNodes(toggleValue(processorNodes, processorItem))} /><span><strong>{processorItem}</strong><small>Optional processor</small></span></label>) : cordflowMockData.destinations.map((destinationItem) => <label className="ux-choice-row" key={destinationItem}><input type="checkbox" checked={destinationNodes.includes(destinationItem)} onChange={() => setDestinationNodes(toggleValue(destinationNodes, destinationItem))} /><span><strong>{destinationItem}</strong><small>{destinationItem === 'Built-in Audio' ? 'Existing connection reused' : '2 new channel connections'}</small></span></label>)}
        </div>
      </div>
    </Dialog>
  );
}

function FlowWorkspace() {
  return (
    <section className="ux-workspace" data-screen-label="Audio routing">
      <div className="ux-flow-list">{cordflowMockData.routes.map((route, index) => <article className="ux-flow-card" key={route.source}><div className="ux-flow-card__identity"><span className="ux-flow-card__index">{String(index + 1).padStart(2, '0')}</span><span><strong>{route.source}</strong><small>{route.stages.length} stages · 2 ch</small></span></div><div className="ux-flow-card__path">{route.stages.map((stage, stageIndex) => <React.Fragment key={stage.name}>{stageIndex > 0 ? <span className="ux-wire"></span> : null}<span className="ux-stage"><strong>{stage.name}</strong><small>{stage.role}</small></span></React.Fragment>)}</div><div className="ux-topbar__actions"><StatusBadge tone="success">Active</StatusBadge><Button variant="ghost">Add output</Button></div></article>)}</div>
    </section>
  );
}

function MixerWorkspace() {
  const [mixerVolumeView, setMixerVolumeView] = React.useState('devices');
  const [builtInVolume, setBuiltInVolume] = React.useState(82);
  const [studioVolume, setStudioVolume] = React.useState(118);
  const [muted, setMuted] = React.useState(false);
  const [firefoxVolume, setFirefoxVolume] = React.useState(34);
  const [firefoxMuted, setFirefoxMuted] = React.useState(false);
  const [notifierVolume, setNotifierVolume] = React.useState(18);
  const [notifierMuted, setNotifierMuted] = React.useState(true);
  const [levels, setLevels] = React.useState([0.72, 0.84]);
  const [leftSpectrumBands, setLeftSpectrumBands] = React.useState(Array(32).fill(0));
  const [rightSpectrumBands, setRightSpectrumBands] = React.useState(Array(32).fill(0));
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      const time = performance.now() / 1000;
      setLevels([
        0.04 + Math.abs(Math.sin(time * 2.1)) * 0.78,
        0.06 + Math.abs(Math.sin(time * 1.7 + 1.3)) * 0.88
      ]);
      const channelSpectrum = (phase) => Array.from({length: 32}, (_, band) => {
        const bass = Math.exp(-Math.pow((band - 7 - Math.sin(time + phase) * 2) / 4.5, 2));
        const presence = Math.exp(-Math.pow((band - 19 - Math.cos(time * .7 + phase) * 3) / 6, 2));
        return Math.min(1, (bass * .68 + presence * .48 + .025) * (.5 + .5 * Math.abs(Math.sin(time * (1.1 + band * .035) + band + phase * 2.4))));
      });
      setLeftSpectrumBands(channelSpectrum(0));
      setRightSpectrumBands(channelSpectrum(.64));
    }, 80);
    return () => window.clearInterval(timer);
  }, []);
  const mixerVolumeItems = [
    { id: 'devices', label: 'Device volume', description: 'Hardware and virtual outputs', icon: '[O]' },
    { id: 'applications', label: 'Application volume', description: 'Remembered for 7 days', icon: '[A]' }
  ];
  return (
    <section className="ux-workspace ux-mixer-workspace" data-screen-label="Output mixer">
      <div className="ux-mixer-content">
        <div className="ux-mixer-tabs"><WorkspaceNav items={mixerVolumeItems} activeId={mixerVolumeView} onChange={setMixerVolumeView} /></div>
        <div className="ux-mixer-grid">
          {mixerVolumeView === 'devices' ? <React.Fragment><VolumeControl name="Built-in Audio" detail="Default output · Analog stereo" value={builtInVolume} level={levels[0]} muted={muted} onChange={setBuiltInVolume} onMute={setMuted} /><VolumeControl name="Studio Monitor" detail="USB output" value={studioVolume} level={levels[1]} onChange={setStudioVolume} /></React.Fragment> : <React.Fragment><VolumeControl name="Firefox" detail="Stream available · org.mozilla.firefox" value={firefoxVolume} level={levels[0]} muted={firefoxMuted} onChange={setFirefoxVolume} onMute={setFirefoxMuted} /><div className="ux-application-volume--offline"><VolumeControl name="Notifier" detail="Remembered · applies to the next notification or audio stream" value={notifierVolume} level={0} muted={notifierMuted} onChange={setNotifierVolume} onMute={setNotifierMuted} /></div></React.Fragment>}
        </div>
      </div>
      <SpectrumAnalyzer device="Built-in Audio" leftBands={leftSpectrumBands} rightBands={rightSpectrumBands} />
    </section>
  );
}

function PatchbayWorkspace() {
  const [selectedPort, setSelectedPort] = React.useState('output_FL');
  const [selectedConnection, setSelectedConnection] = React.useState(true);
  return (
    <section className="ux-workspace" data-screen-label="Advanced patchbay">
      <div className="ux-patch-layout"><div className="ux-patch-main"><div className="ux-patch-hint"><div className="ux-patch-hint__status"><strong>Start:</strong><span>Firefox · {selectedPort} · 3 compatible targets</span></div><div className="ux-patch-hint__shortcuts"><span><kbd>Tab</kbd> move</span><span><kbd>Enter</kbd> connect</span><span><kbd>Esc</kbd> cancel</span></div></div><div className="ux-patch-canvas"><div className="ux-patch-column"><NodeCard name="Firefox" detail="Audio source · Node 1"><PortSocket name="output_FL" id="11" selected={selectedPort === 'output_FL'} onClick={() => setSelectedPort('output_FL')} /><PortSocket name="output_FR" id="12" selected={selectedPort === 'output_FR'} onClick={() => setSelectedPort('output_FR')} /></NodeCard><NodeCard name="MIDI Bridge" detail="MIDI · Node 8"><PortSocket name="events" id="81" media="midi" /></NodeCard></div><div className="ux-patch-column"><NodeCard name="EasyEffects" detail="Duplex processor · Node 2"><PortSocket name="input_FL" id="21" direction="input" /><PortSocket name="input_FR" id="22" direction="input" /><PortSocket name="output_FL" id="23" /><PortSocket name="output_FR" id="24" /></NodeCard></div><div className="ux-patch-column"><NodeCard name="Built-in Audio" detail="Output · Node 3"><PortSocket name="playback_FL" id="31" direction="input" /><PortSocket name="playback_FR" id="32" direction="input" /></NodeCard></div></div></div><Drawer title="Connections"><div className="ux-connection-list"><ConnectionRow from="Firefox · output_FL" to="EasyEffects · input_FL" selected={selectedConnection} action={selectedConnection ? <Button variant="danger" onClick={() => setSelectedConnection(false)}>Disconnect</Button> : null} /><ConnectionRow from="Firefox · output_FR" to="EasyEffects · input_FR" /><ConnectionRow from="EasyEffects · output_FL" to="Built-in Audio · playback_FL" /></div></Drawer></div>
    </section>
  );
}

function PrototypeApp() {
  const [workspaceId, setWorkspaceId] = React.useState('mixer');
  const [advancedModeEnabled, setAdvancedModeEnabled] = React.useState(false);
  const [builderVisible, setBuilderVisible] = React.useState(false);
  const [settingsVisible, setSettingsVisible] = React.useState(false);
  const [noticeVisible, setNoticeVisible] = React.useState(false);
  const [defaultDevicesEditing, setDefaultDevicesEditing] = React.useState(false);
  const visibleNavigationItems = advancedModeEnabled ? cordflowMockData.navItems : cordflowMockData.navItems.filter((item) => item.id !== 'patchbay');
  const changePrototypeAdvancedMode = (nextAdvancedMode) => {
    setAdvancedModeEnabled(nextAdvancedMode);
    if (!nextAdvancedMode && workspaceId === 'patchbay') setWorkspaceId('mixer');
  };
  return (
    <main className="ux-shell">
      <header className="ux-topbar"><div className="ux-brand"><span className="ux-brand__mark">[CF]</span><span><strong>Cordflow</strong><small>PipeWire studio routing</small></span></div><div className="ux-topbar__actions"><Button variant="ghost" onClick={() => setSettingsVisible(!settingsVisible)}>[..]</Button><div className="ux-window-controls" aria-label="Window controls"><button type="button" aria-label="Minimize window">[-]</button><button type="button" aria-label="Maximize or restore window">[□]</button><button className="ux-window-controls__close" type="button" aria-label="Close window">[x]</button></div></div></header>
      <aside className="ux-sidebar"><span className="ux-sidebar__label">Workspaces</span><WorkspaceNav items={visibleNavigationItems} activeId={workspaceId} onChange={setWorkspaceId} />{workspaceId === 'patchbay' ? <div className="ux-patch-metrics" aria-label="Graph summary"><span>6 nodes</span><span>14 ports</span><span>4 connections</span></div> : null}{workspaceId === 'flows' ? <Button variant="primary" onClick={() => setBuilderVisible(true)}>Create audio flow</Button> : null}</aside>
      <section className="ux-main">{noticeVisible ? <div className="hs-notice" role="status"><div className="hs-notice__body">Audio flow created. Existing connection reused; four new channel connections requested.</div><Button variant="ghost" onClick={() => setNoticeVisible(false)}>Dismiss</Button></div> : null}{workspaceId === 'flows' ? <FlowWorkspace /> : workspaceId === 'mixer' ? <MixerWorkspace /> : <PatchbayWorkspace />}</section>
      <footer className="ux-statusbar"><StatusBadge tone="success">Connected</StatusBadge><div className="ux-topbar__devices">{defaultDevicesEditing ? <React.Fragment><DeviceSelector label="Default input" value="built-in-mic" options={cordflowMockData.inputOptions} /><DeviceSelector label="Default output" value="built-in" options={cordflowMockData.outputOptions} /></React.Fragment> : <React.Fragment><div className="ux-default-device"><span>Default input</span><strong>Built-in Microphone</strong></div><div className="ux-default-device"><span>Default output</span><strong>Built-in Audio</strong></div></React.Fragment>}</div><Button variant="ghost" onClick={() => setDefaultDevicesEditing(!defaultDevicesEditing)}>{defaultDevicesEditing ? 'Done' : 'Edit'}</Button><ModeSwitch label="Advanced mode" checked={advancedModeEnabled} onChange={changePrototypeAdvancedMode} /></footer>
      {settingsVisible ? <aside className="ux-settings"><div className="ux-settings-row"><strong>Language</strong><select><option>English</option><option>简体中文</option></select></div><Button onClick={() => setSettingsVisible(false)}>Resync graph</Button></aside> : null}
      {builderVisible ? <FlowBuilder onClose={() => setBuilderVisible(false)} onCreated={() => setNoticeVisible(true)} /> : null}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<PrototypeApp />);
