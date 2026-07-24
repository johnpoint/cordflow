export function RouteLane({ source, stages, state = 'Active', action = null }) {
  return (
    <article className="hs-route-lane">
      <div><small>Source</small><strong>{source}</strong></div>
      <div className="hs-route-lane__path">
        {stages.map((stage, index) => (
          <React.Fragment key={`${stage.name}-${index}`}>
            {index > 0 ? <span className="hs-route-lane__wire" aria-hidden="true"></span> : null}
            <span className="hs-route-lane__stage"><strong>{stage.name}</strong><small>{stage.role}</small></span>
          </React.Fragment>
        ))}
      </div>
      <div><span className="hs-status-badge hs-status-badge--success">{state}</span>{action}</div>
    </article>
  );
}

