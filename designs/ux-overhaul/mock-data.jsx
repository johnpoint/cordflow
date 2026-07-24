window.cordflowMockData = {
  navItems: [
    { id: 'mixer', label: 'Output mixer', description: 'Volume, mute, and defaults', icon: '[=]' },
    { id: 'flows', label: 'Audio routing', description: 'Automatic stereo routing' },
    { id: 'patchbay', label: 'Advanced patchbay', description: 'Manual port routing', icon: '[:]' }
  ],
  inputOptions: [
    { value: 'built-in-mic', label: 'Built-in Microphone · Current' },
    { value: 'usb-mic', label: 'USB Microphone' }
  ],
  outputOptions: [
    { value: 'built-in', label: 'Built-in Audio · Current' },
    { value: 'studio', label: 'Studio Monitor' }
  ],
  routes: [
    {
      source: 'Firefox',
      stages: [
        { name: 'EasyEffects', role: 'Processor' },
        { name: 'Built-in Audio', role: 'Output' }
      ]
    },
    {
      source: 'Music Player',
      stages: [{ name: 'Studio Monitor', role: 'Output' }]
    },
    {
      source: 'Built-in Microphone',
      stages: [
        { name: 'Voice Filter', role: 'Processor' },
        { name: 'Meeting App', role: 'Destination' }
      ]
    }
  ],
  processors: ['EasyEffects', 'Voice Filter', 'Noise Suppression'],
  destinations: ['Built-in Audio', 'Studio Monitor', 'HDMI Display']
};
