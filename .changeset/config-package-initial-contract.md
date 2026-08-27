---
'@hearthkit/config': minor
---

New package: one validated Zod schema for all environment variables. Composes per-package env schema fragments, validates process.env in a single pass, and returns a typed frozen config object. Boot failures name every missing or invalid variable in one aggregate message. Failure modes: missing variable, wrong type, invalid URL, fragment conflict.
