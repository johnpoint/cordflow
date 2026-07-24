SpectrumAnalyzer is a tall, bottom-docked ambience background for Output mixer. It fills the available workspace background up to 38.1966% of the live window height, using the smaller golden-section segment without covering controls. It visualizes the left and right channels as paired half-width deep-blue bars across 32 logarithmic frequency bands derived from real PCM FFT data for the current default output. The current frame uses `--hs-accent-strong` at 0.18 opacity. A persistent 2px peak-envelope contour sits above it at 0.38 opacity. The contour is derived only from the current spectrum: each band carries 30% of its visual rise above the current band as upward momentum, then begins releasing on the very next falling sample with no peak hold. Release follows a nonlinear 1.5-power ease-in over 700ms, starting slowly at the peak and accelerating toward the current band for a longer inertial travel. It never drops below the current band, stores no historical spectrum frames, and has no opacity fade animation. `leftBands` and `rightBands` contain linear amplitudes, not decorative random values; the component converts them to restrained background bar heights without visible labels, dividers, analytical axes, or exact readings.

```jsx
<SpectrumAnalyzer
  device="Built-in Audio"
  leftBands={[0.08, 0.2, 0.54, 0.31]}
  rightBands={[0.06, 0.3, 0.42, 0.18]}
/>
```

Place it directly above the application status bar. Preserve the square OpenCode structure, quiet opacity, spatial left/right distinction, and single peak-envelope contour. Reset the contour when the device changes and clear it when the spectrum source is unavailable; explicit zero frames should release the contour down to zero. Hide the contour under `prefers-reduced-motion: reduce`. Keep the current device only in the accessible name. Do not add a visible title, device name, status text, divider, Hz/dB axes, grid labels, peak numbers, or warning zones.
