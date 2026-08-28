# Test fixtures

Anything captured from, or derived from, a real vehicle lives under
`{brand}/{platform}/`, one directory per vehicle platform:

```
fixtures/
  {brand}/                 pack brand id (e.g. the `brands[].id` in uds-map)
    {platform}/            platform key, or `unknown-platform` when unresolved
      elm/                 ELM replay captures (see elm/README.md for the format
                           and redaction rules)
      correlation/         HypothesisInput replay inputs for the correlation engine
  elm/                     synthetic outcome fixtures only (clear success/refused/
                           silence, transport failures); no vehicle data here
```

Rules:

- A fixture that carries bytes from a vehicle goes in that vehicle's
  `{brand}/{platform}/` directory, never in the top-level `elm/`.
- Tests reference fixtures by their full path (`include_str!`), so a move is a
  compile error, not a silent skip.
- `{brand}` and `{platform}` are lower-case pack identifiers, not marketing names.
- Redaction rules in `elm/README.md` apply to every capture regardless of
  directory.
