---
'@hearthkit/email': minor
'@hearthkit/cli': patch
---

Add `@hearthkit/email`: send transactional email from React Email templates through a swappable
transport, Mailpit over SMTP locally and Resend in production, chosen by one environment variable.

One template produces both parts of every message, so the HTML and plain text bodies cannot drift
apart. Ships a magic-link and a password-reset template for `@hearthkit/auth` to send. Every call
returns its failure as a value rather than throwing, and credentials never appear in a failure, a
log line, or a send result.

The `cli` change is test-only: the repo's new Mailpit holds host ports 1025 and 8025, so the
generated-compose gates remap their published ports the way they already do for MinIO. Fixing that
uncovered a real defect in the existing MinIO guard, which used a substring check and so accepted
`19000:9000` as if it were `9000:9000` and silently rewrote it into a nonsense port. Both guards now
match on digit boundaries.
