export function SpectrumAnalyzer({ device, leftBands, rightBands }) {
  const minimumDecibels = -72;
  const contourRiseMomentum = 0.3;
  const contourReleaseDurationMs = 700;
  const contourReleaseExponent = 1.5;
  const contourSettleThreshold = 0.5;
  const trackedDevice = React.useRef(device);
  const lastSpectrumSampleAt = React.useRef(null);
  const contourRef = React.useRef(null);
  const [contour, setContour] = React.useState(null);
  const visibleBands = (bands) => {
    const sourceBands = bands ?? [];
    return Array.from({ length: 32 }, (_, index) => {
      const amplitude = sourceBands[index];
      return typeof amplitude === 'number' && Number.isFinite(amplitude) ? amplitude : 0;
    });
  };
  const bandHeight = (amplitude) => {
    const decibels =
      amplitude <= 0
        ? minimumDecibels
        : Math.min(12, Math.max(minimumDecibels, 20 * Math.log10(amplitude)));
    return Math.max(0, Math.min(100, ((decibels - minimumDecibels) / 72) * 100));
  };
  const visibleLeftBands = visibleBands(leftBands);
  const visibleRightBands = visibleBands(rightBands);

  React.useEffect(() => {
    const spectrumAvailable =
      Boolean(device) && Array.isArray(leftBands) && Array.isArray(rightBands);
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
      rightReleaseElapsedMs: Array(32).fill(0),
    };
    if (trackedDevice.current !== device || contourRef.current === null) {
      trackedDevice.current = device;
      lastSpectrumSampleAt.current = sampledAt;
      contourRef.current = nextHeights;
      setContour(nextHeights);
      return;
    }

    const elapsedMs = Math.max(0, sampledAt - (lastSpectrumSampleAt.current ?? sampledAt));
    const follow = (
      previousHeight,
      previousSourceHeight,
      releaseOrigin,
      releaseElapsedMs,
      currentHeight,
    ) => {
      const rise = Math.max(0, currentHeight - previousSourceHeight);
      const inertialRise = Math.min(100, currentHeight + rise * contourRiseMomentum);
      if (inertialRise > previousHeight) {
        return { height: inertialRise, origin: inertialRise, elapsedMs: 0 };
      }
      if (previousHeight - currentHeight <= contourSettleThreshold) {
        return { height: currentHeight, origin: currentHeight, elapsedMs: 0 };
      }

      const nextElapsedMs = Math.min(contourReleaseDurationMs, releaseElapsedMs + elapsedMs);
      const progress = nextElapsedMs / contourReleaseDurationMs;
      const easedProgress = Math.pow(progress, contourReleaseExponent);
      const releasedHeight = releaseOrigin + (currentHeight - releaseOrigin) * easedProgress;
      const height = Math.max(currentHeight, Math.min(previousHeight, releasedHeight));
      return height - currentHeight <= contourSettleThreshold
        ? { height: currentHeight, origin: currentHeight, elapsedMs: 0 }
        : { height, origin: releaseOrigin, elapsedMs: nextElapsedMs };
    };
    const left = nextHeights.leftHeights.map((height, index) =>
      follow(
        contourRef.current.leftHeights[index] ?? height,
        contourRef.current.leftSourceHeights[index] ?? height,
        contourRef.current.leftReleaseOrigins[index] ?? height,
        contourRef.current.leftReleaseElapsedMs[index] ?? 0,
        height,
      ),
    );
    const right = nextHeights.rightHeights.map((height, index) =>
      follow(
        contourRef.current.rightHeights[index] ?? height,
        contourRef.current.rightSourceHeights[index] ?? height,
        contourRef.current.rightReleaseOrigins[index] ?? height,
        contourRef.current.rightReleaseElapsedMs[index] ?? 0,
        height,
      ),
    );
    const nextContour = {
      leftHeights: left.map(({ height }) => height),
      rightHeights: right.map(({ height }) => height),
      leftSourceHeights: nextHeights.leftHeights,
      rightSourceHeights: nextHeights.rightHeights,
      leftReleaseOrigins: left.map(({ origin }) => origin),
      rightReleaseOrigins: right.map(({ origin }) => origin),
      leftReleaseElapsedMs: left.map(({ elapsedMs }) => elapsedMs),
      rightReleaseElapsedMs: right.map(({ elapsedMs }) => elapsedMs),
    };
    lastSpectrumSampleAt.current = sampledAt;
    contourRef.current = nextContour;
    setContour(nextContour);
  }, [device, leftBands, rightBands]);

  return (
    <section className="hs-spectrum" aria-label={`Stereo real-time output spectrum for ${device}`}>
      <div
        className="hs-spectrum__plot"
        role="img"
        aria-label={`Stereo real-time output spectrum for ${device}`}
      >
        <div className="hs-spectrum__channels" aria-hidden="true">
          <div className="hs-spectrum__contour">
            {contour ? (
              <div className="hs-spectrum__contour-frame">
                <div className="hs-spectrum__bands hs-spectrum__bands--left">
                  {contour.leftHeights.map((height, index) => (
                    <i
                      key={index}
                      className="hs-spectrum__band hs-spectrum__band--left"
                      style={{ height: `${height}%` }}
                    ></i>
                  ))}
                </div>
                <div className="hs-spectrum__bands hs-spectrum__bands--right">
                  {contour.rightHeights.map((height, index) => (
                    <i
                      key={index}
                      className="hs-spectrum__band hs-spectrum__band--right"
                      style={{ height: `${height}%` }}
                    ></i>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="hs-spectrum__current">
            <div className="hs-spectrum__bands hs-spectrum__bands--left">
              {visibleLeftBands.map((amplitude, index) => (
                <i
                  key={index}
                  className="hs-spectrum__band hs-spectrum__band--left"
                  style={{ height: `${bandHeight(amplitude)}%` }}
                ></i>
              ))}
            </div>
            <div className="hs-spectrum__bands hs-spectrum__bands--right">
              {visibleRightBands.map((amplitude, index) => (
                <i
                  key={index}
                  className="hs-spectrum__band hs-spectrum__band--right"
                  style={{ height: `${bandHeight(amplitude)}%` }}
                ></i>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
