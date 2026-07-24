Dialog contains focused multi-step work, blocks the background, and restores focus when closed.

```jsx
<Dialog title="Create audio flow" footer={<Button variant="primary">Continue</Button>}>…</Dialog>
```

Production implementations trap Tab, close on Escape, and return focus to their trigger.

