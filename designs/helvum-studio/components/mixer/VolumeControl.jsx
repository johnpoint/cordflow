export function VolumeControl({ name, detail, value, level, muted = false, onChange, onMute }) {
  const effectivePeak = level === undefined ? undefined : muted ? 0 : Math.max(0, level * Math.pow(value / 100, 3));
  const decibels = effectivePeak === undefined ? undefined : effectivePeak <= 0 ? -60 : Math.min(6, Math.max(-60, 20 * Math.log10(effectivePeak)));
  const peakFill = decibels === undefined ? 0 : ((decibels + 60) / 66) * 100;
  const volumeLimit = (Math.min(150, Math.max(0, value)) / 150) * 100;
  const levelFill = Math.min(peakFill, volumeLimit);
  const levelText = effectivePeak === undefined ? '-- dBFS' : effectivePeak <= 0 ? '−∞ dBFS' : `${decibels.toFixed(1)} dBFS`;
  const levelTone = decibels >= 0 ? 'danger' : decibels >= -6 ? 'warning' : 'normal';

  return (
    <article className="hs-volume-control">
      <header className="hs-volume-control__header">
        <div><strong>{name}</strong><small>{detail}</small></div>
        {value > 100 ? <span className="hs-status-badge hs-status-badge--warning">Gain risk</span> : null}
      </header>
      <div className="hs-volume-control__controls">
        <button className="hs-button" type="button" aria-pressed={muted} onClick={() => onMute?.(!muted)}>{muted ? 'Unmute' : 'Mute'}</button>
        <label className="hs-volume-control__slider">
          <div
            className={`hs-volume-control__meter hs-volume-control__meter--${levelTone}`}
            role="meter"
            aria-label={`Live output level for ${name}`}
            aria-valuemin="-60"
            aria-valuemax="6"
            aria-valuenow={decibels ?? -60}
            aria-valuetext={levelText}
          >
            <i style={{ width: `${levelFill}%` }}></i>
            <b className="hs-volume-control__meter-tick hs-volume-control__meter-tick--quiet"></b>
            <b className="hs-volume-control__meter-tick hs-volume-control__meter-tick--warning"></b>
            <b className="hs-volume-control__meter-tick hs-volume-control__meter-tick--clip"></b>
          </div>
          <input
            aria-label={`Volume for ${name}`}
            className={value > 100 ? 'hs-volume-control__range--boost' : undefined}
            type="range"
            min="0"
            max="150"
            value={value}
            onChange={(event) => onChange?.(Number(event.target.value))}
          />
        </label>
        <output className="hs-volume-control__volume-value">{value}%</output>
      </div>
      <small className="hs-volume-control__meta">
        <span>[|] {levelText}</span>
        <span>0 · 100 normal · 150 software gain</span>
      </small>
    </article>
  );
}
