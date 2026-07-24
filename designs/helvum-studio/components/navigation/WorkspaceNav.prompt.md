WorkspaceNav presents Output mixer first, followed by Audio routing and the Advanced patchbay when advanced mode is enabled.

```jsx
<WorkspaceNav items={items} activeId="mixer" onChange={setWorkspace} />
```

Keep Output mixer and Audio routing permanently visible. Advanced patchbay may be filtered from `items` while the default-off advanced mode is disabled.
