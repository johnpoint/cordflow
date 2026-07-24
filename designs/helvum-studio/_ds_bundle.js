/* @ds-bundle: {"format":3,"namespace":"HelvumStudio_38c7d4","components":[{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Notice","sourcePath":"components/core/Notice.jsx"},{"name":"StatusBadge","sourcePath":"components/core/StatusBadge.jsx"},{"name":"SpectrumAnalyzer","sourcePath":"components/mixer/SpectrumAnalyzer.jsx"},{"name":"VolumeControl","sourcePath":"components/mixer/VolumeControl.jsx"},{"name":"DeviceSelector","sourcePath":"components/navigation/DeviceSelector.jsx"},{"name":"ModeSwitch","sourcePath":"components/navigation/ModeSwitch.jsx"},{"name":"WorkspaceNav","sourcePath":"components/navigation/WorkspaceNav.jsx"},{"name":"Dialog","sourcePath":"components/overlays/Dialog.jsx"},{"name":"Drawer","sourcePath":"components/overlays/Drawer.jsx"},{"name":"ConnectionRow","sourcePath":"components/routing/ConnectionRow.jsx"},{"name":"NodeCard","sourcePath":"components/routing/NodeCard.jsx"},{"name":"PortSocket","sourcePath":"components/routing/PortSocket.jsx"},{"name":"RouteLane","sourcePath":"components/routing/RouteLane.jsx"}],"sourceHashes":{"components/core/Button.jsx":"ec904db0338f","components/core/IconButton.jsx":"1c46a14a3771","components/core/Notice.jsx":"8bdb5c970df1","components/core/StatusBadge.jsx":"e96efc3994a8","components/mixer/SpectrumAnalyzer.jsx":"65e4e4a59184","components/mixer/VolumeControl.jsx":"d6c5d91095a0","components/navigation/DeviceSelector.jsx":"2d8b126fd11d","components/navigation/ModeSwitch.jsx":"939813705bdc","components/navigation/WorkspaceNav.jsx":"b35b24046445","components/overlays/Dialog.jsx":"e76318a3bcd5","components/overlays/Drawer.jsx":"e1da0e9abc5f","components/routing/ConnectionRow.jsx":"55fa8ba583fe","components/routing/NodeCard.jsx":"790f2e4b437c","components/routing/PortSocket.jsx":"64586b60b7c4","components/routing/RouteLane.jsx":"c8014e7ca63c"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.HelvumStudio_38c7d4 = window.HelvumStudio_38c7d4 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Button.jsx
try { (() => {
function Button({
  children,
  variant = 'default',
  disabled = false,
  onClick,
  type = 'button'
}) {
  return /*#__PURE__*/React.createElement("button", {
    className: `hs-button hs-button--${variant}`,
    type: type,
    disabled: disabled,
    onClick: onClick
  }, children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function IconButton({
  label,
  children,
  disabled = false,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    className: "hs-icon-button",
    type: "button",
    "aria-label": label,
    title: label,
    disabled: disabled,
    onClick: onClick
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, children));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Notice.jsx
try { (() => {
function Notice({
  children,
  tone = 'neutral',
  action = null
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: `hs-notice hs-notice--${tone}`,
    role: tone === 'danger' ? 'alert' : 'status'
  }, /*#__PURE__*/React.createElement("div", {
    className: "hs-notice__body"
  }, children), action);
}
Object.assign(__ds_scope, { Notice });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Notice.jsx", error: String((e && e.message) || e) }); }

// components/core/StatusBadge.jsx
try { (() => {
function StatusBadge({
  children,
  tone = 'neutral'
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `hs-status-badge hs-status-badge--${tone}`
  }, children);
}
Object.assign(__ds_scope, { StatusBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatusBadge.jsx", error: String((e && e.message) || e) }); }

// components/mixer/SpectrumAnalyzer.jsx
try { (() => {
function SpectrumAnalyzer({
  device,
  leftBands,
  rightBands
}) {
  const minimumDecibels = -72;
  const contourRiseMomentum = 0.3;
  const contourReleaseDurationMs = 700;
  const contourReleaseExponent = 1.5;
  const contourSettleThreshold = 0.5;
  const trackedDevice = React.useRef(device);
  const lastSpectrumSampleAt = React.useRef(null);
  const contourRef = React.useRef(null);
  const [contour, setContour] = React.useState(null);
  const visibleBands = bands => {
    const sourceBands = bands ?? [];
    return Array.from({
      length: 32
    }, (_, index) => {
      const amplitude = sourceBands[index];
      return typeof amplitude === 'number' && Number.isFinite(amplitude) ? amplitude : 0;
    });
  };
  const bandHeight = amplitude => {
    const decibels = amplitude <= 0 ? minimumDecibels : Math.min(12, Math.max(minimumDecibels, 20 * Math.log10(amplitude)));
    return Math.max(0, Math.min(100, (decibels - minimumDecibels) / 72 * 100));
  };
  const visibleLeftBands = visibleBands(leftBands);
  const visibleRightBands = visibleBands(rightBands);
  React.useEffect(() => {
    const spectrumAvailable = Boolean(device) && Array.isArray(leftBands) && Array.isArray(rightBands);
    if (!spectrumAvailable) {
      trackedDevice.current = device;
      lastSpectrumSampleAt.current = null;
      contourRef.current = null;
      setContour(null);
      return;
    }
    const sampledAt = Date.now();
    const leftHeights = visibleBands(leftBands).map(bandHeight);
    const rightHeights = visibleBands(rightBands).map(bandHeight);
    const nextHeights = {
      leftHeights,
      rightHeights,
      leftSourceHeights: leftHeights,
      rightSourceHeights: rightHeights,
      leftReleaseOrigins: leftHeights,
      rightReleaseOrigins: rightHeights,
      leftReleaseElapsedMs: Array(32).fill(0),
      rightReleaseElapsedMs: Array(32).fill(0)
    };
    if (trackedDevice.current !== device || contourRef.current === null) {
      trackedDevice.current = device;
      lastSpectrumSampleAt.current = sampledAt;
      contourRef.current = nextHeights;
      setContour(nextHeights);
      return;
    }
    const elapsedMs = Math.max(0, sampledAt - (lastSpectrumSampleAt.current ?? sampledAt));
    const follow = (previousHeight, previousSourceHeight, releaseOrigin, releaseElapsedMs, currentHeight) => {
      const rise = Math.max(0, currentHeight - previousSourceHeight);
      const inertialRise = Math.min(100, currentHeight + rise * contourRiseMomentum);
      if (inertialRise > previousHeight) {
        return {
          height: inertialRise,
          origin: inertialRise,
          elapsedMs: 0
        };
      }
      if (previousHeight - currentHeight <= contourSettleThreshold) {
        return {
          height: currentHeight,
          origin: currentHeight,
          elapsedMs: 0
        };
      }
      const nextElapsedMs = Math.min(contourReleaseDurationMs, releaseElapsedMs + elapsedMs);
      const progress = nextElapsedMs / contourReleaseDurationMs;
      const easedProgress = Math.pow(progress, contourReleaseExponent);
      const releasedHeight = releaseOrigin + (currentHeight - releaseOrigin) * easedProgress;
      const height = Math.max(currentHeight, Math.min(previousHeight, releasedHeight));
      return height - currentHeight <= contourSettleThreshold ? {
        height: currentHeight,
        origin: currentHeight,
        elapsedMs: 0
      } : {
        height,
        origin: releaseOrigin,
        elapsedMs: nextElapsedMs
      };
    };
    const left = nextHeights.leftHeights.map((height, index) => follow(contourRef.current.leftHeights[index] ?? height, contourRef.current.leftSourceHeights[index] ?? height, contourRef.current.leftReleaseOrigins[index] ?? height, contourRef.current.leftReleaseElapsedMs[index] ?? 0, height));
    const right = nextHeights.rightHeights.map((height, index) => follow(contourRef.current.rightHeights[index] ?? height, contourRef.current.rightSourceHeights[index] ?? height, contourRef.current.rightReleaseOrigins[index] ?? height, contourRef.current.rightReleaseElapsedMs[index] ?? 0, height));
    const nextContour = {
      leftHeights: left.map(({
        height
      }) => height),
      rightHeights: right.map(({
        height
      }) => height),
      leftSourceHeights: nextHeights.leftHeights,
      rightSourceHeights: nextHeights.rightHeights,
      leftReleaseOrigins: left.map(({
        origin
      }) => origin),
      rightReleaseOrigins: right.map(({
        origin
      }) => origin),
      leftReleaseElapsedMs: left.map(({
        elapsedMs
      }) => elapsedMs),
      rightReleaseElapsedMs: right.map(({
        elapsedMs
      }) => elapsedMs)
    };
    lastSpectrumSampleAt.current = sampledAt;
    contourRef.current = nextContour;
    setContour(nextContour);
  }, [device, leftBands, rightBands]);
  return /*#__PURE__*/React.createElement("section", {
    className: "hs-spectrum",
    "aria-label": `Stereo real-time output spectrum for ${device}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "hs-spectrum__plot",
    role: "img",
    "aria-label": `Stereo real-time output spectrum for ${device}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "hs-spectrum__channels",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hs-spectrum__contour"
  }, contour ? /*#__PURE__*/React.createElement("div", {
    className: "hs-spectrum__contour-frame"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hs-spectrum__bands hs-spectrum__bands--left"
  }, contour.leftHeights.map((height, index) => /*#__PURE__*/React.createElement("i", {
    key: index,
    className: "hs-spectrum__band hs-spectrum__band--left",
    style: {
      height: `${height}%`
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "hs-spectrum__bands hs-spectrum__bands--right"
  }, contour.rightHeights.map((height, index) => /*#__PURE__*/React.createElement("i", {
    key: index,
    className: "hs-spectrum__band hs-spectrum__band--right",
    style: {
      height: `${height}%`
    }
  })))) : null), /*#__PURE__*/React.createElement("div", {
    className: "hs-spectrum__current"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hs-spectrum__bands hs-spectrum__bands--left"
  }, visibleLeftBands.map((amplitude, index) => /*#__PURE__*/React.createElement("i", {
    key: index,
    className: "hs-spectrum__band hs-spectrum__band--left",
    style: {
      height: `${bandHeight(amplitude)}%`
    }
  }))), /*#__PURE__*/React.createElement("div", {
    className: "hs-spectrum__bands hs-spectrum__bands--right"
  }, visibleRightBands.map((amplitude, index) => /*#__PURE__*/React.createElement("i", {
    key: index,
    className: "hs-spectrum__band hs-spectrum__band--right",
    style: {
      height: `${bandHeight(amplitude)}%`
    }
  })))))));
}
Object.assign(__ds_scope, { SpectrumAnalyzer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/mixer/SpectrumAnalyzer.jsx", error: String((e && e.message) || e) }); }

// components/mixer/VolumeControl.jsx
try { (() => {
function VolumeControl({
  name,
  detail,
  value,
  level,
  muted = false,
  onChange,
  onMute
}) {
  const effectivePeak = level === undefined ? undefined : muted ? 0 : Math.max(0, level * Math.pow(value / 100, 3));
  const decibels = effectivePeak === undefined ? undefined : effectivePeak <= 0 ? -60 : Math.min(6, Math.max(-60, 20 * Math.log10(effectivePeak)));
  const peakFill = decibels === undefined ? 0 : (decibels + 60) / 66 * 100;
  const volumeLimit = Math.min(150, Math.max(0, value)) / 150 * 100;
  const levelFill = Math.min(peakFill, volumeLimit);
  const levelText = effectivePeak === undefined ? '-- dBFS' : effectivePeak <= 0 ? '−∞ dBFS' : `${decibels.toFixed(1)} dBFS`;
  const levelTone = decibels >= 0 ? 'danger' : decibels >= -6 ? 'warning' : 'normal';
  return /*#__PURE__*/React.createElement("article", {
    className: "hs-volume-control"
  }, /*#__PURE__*/React.createElement("header", {
    className: "hs-volume-control__header"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, name), /*#__PURE__*/React.createElement("small", null, detail)), value > 100 ? /*#__PURE__*/React.createElement("span", {
    className: "hs-status-badge hs-status-badge--warning"
  }, "Gain risk") : null), /*#__PURE__*/React.createElement("div", {
    className: "hs-volume-control__controls"
  }, /*#__PURE__*/React.createElement("button", {
    className: "hs-button",
    type: "button",
    "aria-pressed": muted,
    onClick: () => onMute?.(!muted)
  }, muted ? 'Unmute' : 'Mute'), /*#__PURE__*/React.createElement("label", {
    className: "hs-volume-control__slider"
  }, /*#__PURE__*/React.createElement("div", {
    className: `hs-volume-control__meter hs-volume-control__meter--${levelTone}`,
    role: "meter",
    "aria-label": `Live output level for ${name}`,
    "aria-valuemin": "-60",
    "aria-valuemax": "6",
    "aria-valuenow": decibels ?? -60,
    "aria-valuetext": levelText
  }, /*#__PURE__*/React.createElement("i", {
    style: {
      width: `${levelFill}%`
    }
  }), /*#__PURE__*/React.createElement("b", {
    className: "hs-volume-control__meter-tick hs-volume-control__meter-tick--quiet"
  }), /*#__PURE__*/React.createElement("b", {
    className: "hs-volume-control__meter-tick hs-volume-control__meter-tick--warning"
  }), /*#__PURE__*/React.createElement("b", {
    className: "hs-volume-control__meter-tick hs-volume-control__meter-tick--clip"
  })), /*#__PURE__*/React.createElement("input", {
    "aria-label": `Volume for ${name}`,
    className: value > 100 ? 'hs-volume-control__range--boost' : undefined,
    type: "range",
    min: "0",
    max: "150",
    value: value,
    onChange: event => onChange?.(Number(event.target.value))
  })), /*#__PURE__*/React.createElement("output", {
    className: "hs-volume-control__volume-value"
  }, value, "%")), /*#__PURE__*/React.createElement("small", {
    className: "hs-volume-control__meta"
  }, /*#__PURE__*/React.createElement("span", null, "[|] ", levelText), /*#__PURE__*/React.createElement("span", null, "0 \xB7 100 normal \xB7 150 software gain")));
}
Object.assign(__ds_scope, { VolumeControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/mixer/VolumeControl.jsx", error: String((e && e.message) || e) }); }

// components/navigation/DeviceSelector.jsx
try { (() => {
function DeviceSelector({
  label,
  value,
  options,
  disabled = false,
  onChange
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: "hs-device-selector"
  }, /*#__PURE__*/React.createElement("span", null, label), /*#__PURE__*/React.createElement("select", {
    "aria-label": label,
    value: value,
    disabled: disabled,
    onChange: event => onChange?.(event.target.value)
  }, options.map(option => /*#__PURE__*/React.createElement("option", {
    key: option.value,
    value: option.value
  }, option.label))));
}
Object.assign(__ds_scope, { DeviceSelector });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/DeviceSelector.jsx", error: String((e && e.message) || e) }); }

// components/navigation/ModeSwitch.jsx
try { (() => {
function ModeSwitch({
  label,
  checked = false,
  disabled = false,
  onLabel = 'On',
  offLabel = 'Off',
  onChange
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: `hs-mode-switch ${disabled ? 'hs-mode-switch--disabled' : ''}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "hs-mode-switch__label"
  }, label), /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: checked,
    disabled: disabled,
    "aria-label": label,
    onChange: event => onChange?.(event.target.checked)
  }), /*#__PURE__*/React.createElement("span", {
    className: "hs-mode-switch__track",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("i", null)), /*#__PURE__*/React.createElement("strong", null, checked ? onLabel : offLabel));
}
Object.assign(__ds_scope, { ModeSwitch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/ModeSwitch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/WorkspaceNav.jsx
try { (() => {
function WorkspaceNav({
  items,
  activeId,
  onChange
}) {
  return /*#__PURE__*/React.createElement("nav", {
    className: "hs-workspace-nav",
    "aria-label": "Workspaces"
  }, items.map(item => /*#__PURE__*/React.createElement("button", {
    key: item.id,
    className: `hs-workspace-nav__item ${item.id === activeId ? 'hs-workspace-nav__item--active' : ''}`,
    type: "button",
    "aria-current": item.id === activeId ? 'page' : undefined,
    onClick: () => onChange?.(item.id)
  }, item.icon ? /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true"
  }, item.icon) : null, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("strong", null, item.label), /*#__PURE__*/React.createElement("small", null, item.description)))));
}
Object.assign(__ds_scope, { WorkspaceNav });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/WorkspaceNav.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Dialog.jsx
try { (() => {
function Dialog({
  title,
  description,
  children,
  footer,
  onClose
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "hs-dialog-backdrop"
  }, /*#__PURE__*/React.createElement("section", {
    className: "hs-dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title
  }, /*#__PURE__*/React.createElement("header", {
    className: "hs-dialog__header"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, title), description ? /*#__PURE__*/React.createElement("p", null, description) : null), /*#__PURE__*/React.createElement("button", {
    className: "hs-icon-button",
    type: "button",
    "aria-label": "Close",
    onClick: onClose
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    className: "hs-dialog__body"
  }, children), footer ? /*#__PURE__*/React.createElement("footer", {
    className: "hs-dialog__footer"
  }, footer) : null));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/overlays/Drawer.jsx
try { (() => {
function Drawer({
  title,
  children
}) {
  return /*#__PURE__*/React.createElement("aside", {
    className: "hs-drawer"
  }, /*#__PURE__*/React.createElement("header", {
    className: "hs-drawer__header"
  }, /*#__PURE__*/React.createElement("strong", null, title)), /*#__PURE__*/React.createElement("div", {
    className: "hs-drawer__body"
  }, children));
}
Object.assign(__ds_scope, { Drawer });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlays/Drawer.jsx", error: String((e && e.message) || e) }); }

// components/routing/ConnectionRow.jsx
try { (() => {
function ConnectionRow({
  from,
  to,
  media = 'Audio',
  selected = false,
  action = null
}) {
  return /*#__PURE__*/React.createElement("article", {
    className: "hs-connection-row",
    "aria-current": selected ? 'true' : undefined
  }, /*#__PURE__*/React.createElement("span", {
    className: `hs-port-socket__dot hs-port-socket--${media.toLowerCase()}`,
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("div", {
    className: "hs-connection-row__route"
  }, /*#__PURE__*/React.createElement("strong", null, from, " \u2192 ", to), /*#__PURE__*/React.createElement("small", null, media, " \xB7 Active")), action);
}
Object.assign(__ds_scope, { ConnectionRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/routing/ConnectionRow.jsx", error: String((e && e.message) || e) }); }

// components/routing/NodeCard.jsx
try { (() => {
function NodeCard({
  name,
  detail,
  children
}) {
  return /*#__PURE__*/React.createElement("article", {
    className: "hs-node-card"
  }, /*#__PURE__*/React.createElement("header", {
    className: "hs-node-card__header"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("strong", null, name), /*#__PURE__*/React.createElement("small", null, detail))), /*#__PURE__*/React.createElement("div", {
    className: "hs-node-card__ports"
  }, children));
}
Object.assign(__ds_scope, { NodeCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/routing/NodeCard.jsx", error: String((e && e.message) || e) }); }

// components/routing/PortSocket.jsx
try { (() => {
function PortSocket({
  name,
  id,
  media = 'audio',
  direction = 'output',
  selected = false,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    className: `hs-port-socket hs-port-socket--${media}`,
    type: "button",
    "aria-pressed": selected,
    "aria-label": `${name}, ${media}, ${direction}, port ${id}`,
    onClick: onClick
  }, /*#__PURE__*/React.createElement("span", {
    className: "hs-port-socket__dot",
    "aria-hidden": "true"
  }), /*#__PURE__*/React.createElement("span", null, name), /*#__PURE__*/React.createElement("small", null, media, " \xB7 P", id));
}
Object.assign(__ds_scope, { PortSocket });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/routing/PortSocket.jsx", error: String((e && e.message) || e) }); }

// components/routing/RouteLane.jsx
try { (() => {
function RouteLane({
  source,
  stages,
  state = 'Active',
  action = null
}) {
  return /*#__PURE__*/React.createElement("article", {
    className: "hs-route-lane"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("small", null, "Source"), /*#__PURE__*/React.createElement("strong", null, source)), /*#__PURE__*/React.createElement("div", {
    className: "hs-route-lane__path"
  }, stages.map((stage, index) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: `${stage.name}-${index}`
  }, index > 0 ? /*#__PURE__*/React.createElement("span", {
    className: "hs-route-lane__wire",
    "aria-hidden": "true"
  }) : null, /*#__PURE__*/React.createElement("span", {
    className: "hs-route-lane__stage"
  }, /*#__PURE__*/React.createElement("strong", null, stage.name), /*#__PURE__*/React.createElement("small", null, stage.role))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    className: "hs-status-badge hs-status-badge--success"
  }, state), action));
}
Object.assign(__ds_scope, { RouteLane });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/routing/RouteLane.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Notice = __ds_scope.Notice;

__ds_ns.StatusBadge = __ds_scope.StatusBadge;

__ds_ns.SpectrumAnalyzer = __ds_scope.SpectrumAnalyzer;

__ds_ns.VolumeControl = __ds_scope.VolumeControl;

__ds_ns.DeviceSelector = __ds_scope.DeviceSelector;

__ds_ns.ModeSwitch = __ds_scope.ModeSwitch;

__ds_ns.WorkspaceNav = __ds_scope.WorkspaceNav;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Drawer = __ds_scope.Drawer;

__ds_ns.ConnectionRow = __ds_scope.ConnectionRow;

__ds_ns.NodeCard = __ds_scope.NodeCard;

__ds_ns.PortSocket = __ds_scope.PortSocket;

__ds_ns.RouteLane = __ds_scope.RouteLane;

})();
