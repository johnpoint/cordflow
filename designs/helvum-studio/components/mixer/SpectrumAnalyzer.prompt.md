SpectrumAnalyzer is a tall, bottom-docked ambience background for Output mixer. It fills the available workspace background up to 38.1966% of the live window height, using the smaller golden-section segment without covering controls. It visualizes the left and right channels as paired dark-blue and light-blue bars across 32 logarithmic frequency bands derived from real PCM FFT data for the current default output, so both channels remain visible in short windows. `leftBands` and `rightBands` contain linear amplitudes, not decorative random values; the component converts them to restrained background bar heights without visible labels, dividers, analytical axes, or exact readings.

```jsx
<SpectrumAnalyzer device="Built-in Audio" leftBands={[0.08, 0.2, 0.54, 0.31]} rightBands={[0.06, 0.3, 0.42, 0.18]} />
```

Place it directly above the application status bar. Preserve the square OpenCode structure and quiet opacity. Keep the current device only in the accessible name. Do not add a visible title, device name, status text, divider, Hz/dB axes, grid labels, peak numbers, or warning zones.
