VolumeControl combines device identity, a live dBFS output meter inside the volume rail, 0/100/150 landmarks, numeric volume, mute, and gain risk. The moving rail fill represents the current peak while the thumb represents the configured volume, and the fill is capped at the thumb so it never visually exceeds the configured volume. `level` is the raw normalized PipeWire peak; the component applies the displayed volume gain and mute state.

```jsx
<VolumeControl name="Built-in Audio" detail="Default output" value={82} level={0.72} />
```

Keep throttled pending behavior in production and show gain risk above 100%.
