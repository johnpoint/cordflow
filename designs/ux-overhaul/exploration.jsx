const {
  Button,
  ConnectionRow,
  Drawer,
  NodeCard,
  PortSocket,
  RouteLane,
  StatusBadge,
  WorkspaceNav
} = window.HelvumStudio_38c7d4;

function StudioDirection() {
  return (
    <div className="ux-shell" data-screen-label="Studio Console">
      <header className="ux-topbar">
        <div className="ux-brand"><span className="ux-brand__mark"><i></i><i></i><i></i></span><strong>Cordflow</strong></div>
        <div className="ux-topbar__devices"><span>Default input · Built-in Microphone</span><span>Default output · Built-in Audio</span></div>
        <div className="ux-topbar__actions"><StatusBadge tone="success">Connected</StatusBadge><Button variant="ghost">Settings</Button></div>
      </header>
      <aside className="ux-sidebar"><span className="ux-sidebar__label">Workspaces</span><WorkspaceNav items={cordflowMockData.navItems} activeId="flows" /><div className="ux-policy">Automatic stereo matching</div></aside>
      <main className="ux-main"><section className="ux-workspace"><header className="ux-workspace-header"><div><span className="ux-eyebrow">Balanced everyday and expert use</span><h1>Audio flows</h1><p>Source-centered routes with a persistent professional workspace rail.</p></div><Button variant="primary">Create audio flow</Button></header><div className="ux-flow-list">{cordflowMockData.routes.map((route, index) => <RouteLane key={route.source} {...route} action={<Button variant="ghost">Edit</Button>} />)}</div></section></main>
    </div>
  );
}

function CanvasDirection() {
  return (
    <div className="ux-canvas-layout" data-screen-label="Patch Canvas">
      <section><header className="ux-workspace-header"><div><span className="ux-eyebrow">Canvas first</span><h1>Patch Canvas</h1><p>Select a node or connection to expose context and destructive actions.</p></div><StatusBadge tone="success">Connected</StatusBadge></header><div className="ux-canvas"><NodeCard name="Firefox" detail="Audio source · Node 1"><PortSocket name="output_FL" id="11" /><PortSocket name="output_FR" id="12" /></NodeCard><NodeCard name="EasyEffects" detail="Processor · Node 2"><PortSocket name="input_FL" id="21" direction="input" /><PortSocket name="output_FL" id="23" /></NodeCard><NodeCard name="Built-in Audio" detail="Output · Node 3"><PortSocket name="playback_FL" id="31" direction="input" /><PortSocket name="playback_FR" id="32" direction="input" /></NodeCard></div></section><Drawer title="Inspector"><div className="ux-connection-list"><ConnectionRow from="Firefox · output_FL" to="EasyEffects · input_FL" selected={true} /><p>Audio · Active · Link 101</p><Button variant="danger">Disconnect selected</Button></div></Drawer>
    </div>
  );
}

function LanesDirection() {
  return (
    <div className="ux-lanes-layout" data-screen-label="Flow Lanes">
      <aside className="ux-lanes-ruler"><header><span className="ux-eyebrow">DAW metaphor</span><h1>Flow Lanes</h1></header>{cordflowMockData.routes.map((route, index) => <section className="ux-lane-label" key={route.source}><small>Track {String(index + 1).padStart(2, '0')}</small><strong>{route.source}</strong><p>2 ch · Active</p></section>)}</aside>
      <main className="ux-lanes-tracks"><header className="ux-workspace-header"><div><p>Source → processing chain → output, aligned like channels on a console.</p></div><Button variant="primary">Add track</Button></header>{cordflowMockData.routes.map((route) => <section className="ux-lane-track" key={route.source}>{route.stages.map((stage, index) => <React.Fragment key={stage.name}>{index > 0 ? <span className="ux-wire"></span> : null}<span className="ux-stage"><strong>{stage.name}</strong><small>{stage.role}</small></span></React.Fragment>)}<span className="ux-wire"></span><StatusBadge tone="success">Active</StatusBadge></section>)}</main>
    </div>
  );
}

function ExplorationApp() {
  const [directionId, setDirectionId] = React.useState('studio');
  return (
    <main className="ux-exploration">
      <header className="ux-exploration-header">
        <div><span className="ux-eyebrow">Same graph data · three interaction models</span><h1>Cordflow direction study</h1></div>
        <div className="ux-exploration-tabs">
          <Button variant={directionId === 'studio' ? 'primary' : 'ghost'} onClick={() => setDirectionId('studio')}>Studio Console</Button>
          <Button variant={directionId === 'canvas' ? 'primary' : 'ghost'} onClick={() => setDirectionId('canvas')}>Patch Canvas</Button>
          <Button variant={directionId === 'lanes' ? 'primary' : 'ghost'} onClick={() => setDirectionId('lanes')}>Flow Lanes</Button>
        </div>
      </header>
      <section className="ux-exploration-stage">
        {directionId === 'studio' ? <StudioDirection /> : directionId === 'canvas' ? <CanvasDirection /> : <LanesDirection />}
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<ExplorationApp />);
