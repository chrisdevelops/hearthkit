---
'@hearthkit/storage': minor
---

Trim the public entry point of `@hearthkit/storage` to a fixed allowlist of 15 values: the four functions, the env schema fragment, the failure union schema, the connection schema, the four result schemas, and the four branded schemas an app parses user input through (object key, key prefix, content type, download file name). Error-message prefixes, default and maximum constants, connection-part schemas, options schemas, per-arm success schemas, and the listing piece schemas are no longer exported from the package. Import types as before; type exports are unchanged.
