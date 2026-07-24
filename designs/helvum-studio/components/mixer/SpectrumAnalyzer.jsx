export function SpectrumAnalyzer({ device, leftBands, rightBands }) {
  const minimumDecibels = -72;
  const visibleBands = (bands) => {
    const sourceBands = bands ?? [];
    return Array.from({ length: 32 }, (_, index) => sourceBands[index] ?? 0);
  };
  const bandHeight = (amplitude) => {
    const decibels = amplitude <= 0
      ? minimumDecibels
      : Math.min(12, Math.max(minimumDecibels, 20 * Math.log10(amplitude)));
    return Math.max(0, Math.min(100, ((decibels - minimumDecibels) / 72) * 100));
  };

  return (
    <section className="hs-spectrum" aria-label={`Stereo real-time output spectrum for ${device}`}>
      <div className="hs-spectrum__plot" role="img" aria-label={`Stereo real-time output spectrum for ${device}`}>
        <div className="hs-spectrum__channels" aria-hidden="true">
          <div className="hs-spectrum__bands hs-spectrum__bands--left">
            {visibleBands(leftBands).map((amplitude, index) => <i key={index} className="hs-spectrum__band hs-spectrum__band--left" style={{height: `${bandHeight(amplitude)}%`}}></i>)}
          </div>
          <div className="hs-spectrum__bands hs-spectrum__bands--right">
            {visibleBands(rightBands).map((amplitude, index) => <i key={index} className="hs-spectrum__band hs-spectrum__band--right" style={{height: `${bandHeight(amplitude)}%`}}></i>)}
          </div>
        </div>
      </div>
    </section>
  );
}
