RouteLane renders one source-centered audio branch with shared processing and an output.

```jsx
<RouteLane source="Firefox" stages={[{name:'EasyEffects', role:'Processor'}, {name:'Built-in Audio', role:'Output'}]} />
```

Keep branches independently disconnectable while making the shared chain visually obvious.

