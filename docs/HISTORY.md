# hearthkit history

Journal of verified facts and traps, newest at the top. Search it; do not read it top to bottom.
Entries were moved here unchanged from `docs/STATUS.md` on 2026-09-07.

## 2026-09-09: PAYMENTS CONTRACT REWRITE (step 5)

Sections removed from `packages/payments/CONTRACT.md` when it was rewritten from 1304 lines to 197 on
`refactor/exports-payments`. Moved here unchanged (headings demoted one level). The line ranges are
those of the file at main `68d54c2`: 378–628 (the `line_items`, customer-linked, plan 4.8 deviation,
subscription status and Better Auth Stripe plugin arguments), 700–811 (details the gates and the
implementation both depend on), 926–1148 (verified, still not verified), 1149–1304 (the ten original
decisions, rulings and corrections). Research notes, measurements and rulings that argued the contract
into its shape; the current contract states each surviving fact once.

#### A webhook delivery does not carry `line_items`, and the purchase path is built around that

**`Checkout.Session.line_items` is not in a webhook payload.** Measured at `stripe@22.6.1`, it is
declared `line_items?: ApiList<LineItem>` — an **optional** property — and the SDK's own comment says
"When **retrieving** a Checkout Session, there is an **includable** `line_items` property". Includable
means expanded on a retrieve. Nothing expands it on a delivery.

**The plugin hits the same wall and pays the price this package refuses to pay.** Its
`onCheckoutSessionCompleted` calls `await client.subscriptions.retrieve(checkoutSession.subscription)`
and resolves the plan from `subscription.items.data` — never from `checkoutSession.line_items`. That
is the **only** `retrieve` inside any of its four webhook handlers; `onSubscriptionCreated` and
`onSubscriptionUpdated` both read `event.data.object.items.data` directly.

This package adds **no** retrieve call, because `handleStripeWebhook` being fully offline is worth
protecting: it is the one part of `payments` whose every path — including both signature failures and
the replay — can be gated with no Stripe key at all, and a single retrieve would drag the whole set
behind one. So the purchase path is resolved from metadata this package already writes, and every
`payments_purchase` column has a source in the payload:

| Column                    | Source in the `checkout.session.completed` payload                |
| ------------------------- | ----------------------------------------------------------------- |
| `stripeCheckoutSessionId` | `session.id`                                                      |
| `stripeCustomerId`        | `session.customer`, as a string                                   |
| `stripePaymentIntentId`   | `session.payment_intent`, as a string; null when absent           |
| `billingReferenceId`      | `session.metadata.hearthkit_billing_reference_id`                 |
| `priceName`               | `session.metadata.hearthkit_price_name`                           |
| `stripePriceId`           | `session.metadata.hearthkit_stripe_price_id`                      |
| `quantity`                | `session.metadata.hearthkit_quantity`, parsed from a string       |
| `currency`                | `session.currency`                                                |
| `amountTotalMinorUnits`   | `session.amount_total`                                            |
| `purchasedAt`             | the event's `created`, seconds since the epoch (`Events.d.ts:38`) |

`session.currency` and `session.amount_total` are **plain fields, not expandable**: measured, they are
`currency: string | null` and `amount_total: number | null`, with no `string |` reference union of the
sort `customer`, `payment_intent` and `subscription` carry. A paid payment-mode session has both. A
`null` on this path is not a contract state and becomes `payments-request-failed`, the same treatment a
`null` `checkoutUrl` gets.

**Stripe metadata values are strings**, so `hearthkit_quantity` is written as a decimal string by
`createCheckoutSession` and parsed back here. A value that is not a positive integer is treated as
missing metadata rather than defaulted to 1, because silently billing one unit for an order of five is
worse than declining to record it.

**The checkout path does not consult the catalog at all**, and that is deliberate rather than an
omission. A purchase is a historical fact: deleting a price from `payments-catalog.ts` must not make a
completed order unrecordable. The metadata already carries everything the row needs. The subscription
path is the opposite — it _must_ consult the catalog, because `payments_subscription.priceName` is
resolved from `lookup_key` and there is no metadata to fall back on.

**The price metadata goes on the session and never on `subscription_data.metadata`.** A subscription's
price changes when a customer upgrades through the hosted portal, and metadata stamped at creation does
not change with it — so a `hearthkit_price_name` on a subscription would go stale and then be actively
wrong, reported as fact. The subscription path reads `items.data[].price.lookup_key` live instead,
which cannot go stale. `subscription_data.metadata` carries the two reference keys and nothing else.

#### The customer-linked path, and where `billingContactEmail` comes from on it

`payments_customer.billingContactEmail` is `text NOT NULL`, so a customer-linked delivery that has to
insert a row needs an address. The path upserts on `billingReferenceId`:

| Column                | Source in the `checkout.session.completed` payload                           |
| --------------------- | ---------------------------------------------------------------------------- |
| `billingReferenceId`  | `session.metadata.hearthkit_billing_reference_id`                            |
| `billingScope`        | `session.metadata.hearthkit_billing_scope`                                   |
| `stripeCustomerId`    | `session.customer`, as a string — written on both insert and update          |
| `billingContactEmail` | `session.customer_details.email ?? session.customer_email` — **insert only** |
| `updatedAt`           | the event's `created`                                                        |

**`billingContactEmail` is written on insert and never on update.** On an existing row it is left
exactly as `createCheckoutSession` set it, from the address the app supplied. Both Stripe fields are
things a buyer can influence on a page the app does not control, so letting a delivery overwrite the
row would let a buyer silently change where the app thinks receipts and dunning go. Keeping the write
to the insert branch keeps that door shut while still giving the `NOT NULL` column a value in the one
case where nothing else can.

**Both fields are read, in that order, and neither alone is sufficient.** Measured at the pin:
`Session.customer_email` is a **prefill** field — "Use this parameter to prefill customer data if you
already have an email on file. To access information about the customer once the payment flow is
complete, use the `customer` attribute" — and is null on a session created with a customer id, which
is every session this package creates after the first. `CustomerDetails.email` is documented as the
address "after a completed Checkout Session", which is exactly the webhook case, so it goes first.
**But read its second sentence too**: "Otherwise, if the customer has consented to promotional content,
this value is the most recent valid email provided by the customer on the Checkout form." So it is not
unconditionally a billing address either. That is the other half of why it may only seed a new row and
may never overwrite one.

**When both are null and a row must be inserted, the delivery is `payments-request-failed`.** It is not
ignored: a completed subscription checkout that this package cannot record is not a normal state, and
silence would drop it. The retry Stripe then performs is bounded and gives an operator the signal.
**No gate covers this branch** — every gate that synthesises a session supplies an address — so it is
also the one place here where the contract is not pinned by a test; see Still not verified.

**The insert branch is reachable in practice only for a session this package did not create.**
`createCheckoutSession` writes the customer row before a session can exist, so an ordinary flow always
takes the update branch. It is kept rather than removed because a row deleted by an operator, or a
session created by other tooling against the same Stripe account, must still be recordable.

**Idempotency is structural, not a bookkeeping table.** Stripe delivers events more than once, and
plan 4.8's gate replays one deliberately. Rather than record processed event ids in a fourth table —
which would go beyond the plan's three — every write is an upsert on a unique Stripe id:
`payments_subscription.stripeSubscriptionId` and `payments_purchase.stripeCheckoutSessionId`. A replay
therefore writes the same values to the same row and the row count does not move. **The gate that
matters is "deliver the same event twice, then assert exactly one row"**, which is stronger than
asserting a second delivery was refused, because it holds even if the two deliveries interleave.

**How an event finds its reference and its price.** Neither is guessable and both are set by this
package on the way out:

- `createCheckoutSession` writes `hearthkit_billing_reference_id` and `hearthkit_billing_scope` into
  the session's `metadata`, and — for a subscription-mode session — into `subscription_data.metadata`
  as well, so that the `customer.subscription.*` events carry them on the subscription object itself.
  Without the second copy those three events have no reference at all, because they are about a
  subscription and not about a session.
- `createCheckoutSession` also writes `hearthkit_price_name`, `hearthkit_stripe_price_id` and
  `hearthkit_quantity` into the **session's** `metadata` only. It has all three in hand at the moment
  it creates the session. They exist because a delivery carries no `line_items`, argued above.
- The subscription's catalog price is resolved from the Stripe price's `lookup_key`, which
  `syncPaymentsCatalog` set to the `priceName`. It is read off the price object already embedded in
  the event payload, so no second API call is needed, and it works for a subscription however it was
  created as long as the price is one of ours. **`SubscriptionItem.price` is typed `Price`, not
  `string | Price`**, so it is always the full object and never an id — which is what makes this path
  offline rather than merely usually offline. `@better-auth/stripe`'s `resolvePlanItem` reads
  `item.price.id` and `item.price.lookup_key` off the same payload, independently confirming it.
- `client_reference_id` is deliberately **not** used. Stripe restricts its character set, that
  restriction is documented rather than enforced in the SDK, and one mechanism with one spelling beats
  two that must agree.

**Where the period dates come from, and this one costs a round if taken from memory.** At
`stripe@22.6.1` the `Subscription` object has **no** `current_period_start` or `current_period_end`.
Both live on the subscription **item**: `subscription.items.data[<item>].current_period_start`. Two
independent sources at the pin agree — the SDK's `SubscriptionItems.d.ts` declares them, and
`@better-auth/stripe`'s dist reads them from exactly there in all four of its handlers. The
subscription-level fields that do exist are `cancel_at_period_end`, `cancel_at`, `canceled_at`,
`ended_at`, `trial_start` and `trial_end`. The item this package reads is the first whose
`price.lookup_key` names a catalog price.

**`subscription.customer` is a string in a webhook payload**, not an expanded object, but the SDK types
it `string | Customer | DeletedCustomer`. Read the string; if it is an object take `.id`.

**`payments_subscription.quantity` comes from `SubscriptionItem.quantity`, which the SDK types
optional — `quantity?: number` — and it defaults to 1 when absent.** Stripe omits it for prices that
have no explicit quantity, metered prices among them.

**That default looks like it contradicts the `hearthkit_quantity` rule two sections up, and the
difference is the point.** `hearthkit_quantity` is a string this package wrote into metadata and read
back: a value that is not a positive integer means something went wrong in transit or somebody edited
it, so silently billing one unit for an order of five would be reporting a number nobody chose — hence
"treat as missing" there. `SubscriptionItem.quantity` is a field on **Stripe's own object**, where
absence carries a meaning: the item has no explicit quantity, which is one unit of the thing. Nothing
is being guessed. **The rule is not "always default" or "never default" — it is that a default is
allowed where absence has a defined meaning, and forbidden where it means the data is untrustworthy.**

#### Deviation from plan 4.8's gate wording, and why

Plan 4.8's gate line reads: "replay a `checkout.session.completed` event through the webhook handler,
confirm the subscription row exists." **That sequence cannot pass against this contract, and the
mismatch is deliberate rather than an oversight.** Under the routing above, a subscription-mode
`checkout.session.completed` upserts the **customer** row and reports `'customer-linked'`; the
subscription row only ever comes from `customer.subscription.*`.

The reason is the `line_items` measurement. The plan's line was written before anyone measured what a
delivery carries. To do what it literally describes, a handler must call
`subscriptions.retrieve(session.subscription)` — which is exactly what `@better-auth/stripe` does, and
exactly the network call this package declines, because it would put every webhook gate behind a live
Stripe key. The alternative costs nothing real: Stripe sends `customer.subscription.created` for the
same checkout anyway.

**So the gate replays two events and asserts after the second:**

1. Deliver `checkout.session.completed` with `mode: 'subscription'`. Assert
   `'payments-webhook-processed'` with `webhookOutcome: 'customer-linked'` and that the
   `payments_customer` row exists.
2. Deliver `customer.subscription.created` carrying the same reference metadata. Assert
   `'subscription-upserted'`, then confirm the `payments_subscription` row exists — which is the
   assertion plan 4.8 asks for, one event later than it says.
3. Deliver the second event again. Assert `'subscription-upserted'` once more and that there is still
   exactly **one** row, which is the replay half of the plan's gate.

Both events are synthesised locally and signed with `generateTestHeaderString`, so the whole sequence
runs with no Stripe key and no network.

#### Subscription status, and the decoy one union away

`status` is stored as a plain string, not as a Zod enum, so a status Stripe adds later cannot break a
write or a read. The eight values at the pin are exported as `paymentsKnownSubscriptionStatuses` for
callers and gates to compare against: `active`, `canceled`, `incomplete`, `incomplete_expired`,
`past_due`, `paused`, `trialing`, `unpaid`. `paymentsActiveSubscriptionStatuses` is `active` and
`trialing` — the same two `@better-auth/stripe`'s `isActiveOrTrialing` tests, read out of its dist.

**`'ended'` and `'all'` are not subscription statuses.** They are members of
`SubscriptionListParams.Status` in the same file, one union away from the real one, and a status column
containing `'ended'` would be wrong in a way nothing would catch. `docs/STATUS.md` records three
occasions where this repo took a plausible near-miss from an adjacent enum entry; naming this one is
what stops the fourth.

#### The Better Auth Stripe plugin, and why this package does not use it

Plan 4.8 says to verify at build time whether Better Auth's Stripe plugin covers one-time purchases and
to "implement one-time purchases directly with the Stripe SDK alongside it" if not. The verification
was done against a real install. The answer turned out to be broader than the question, and **the
decisive fact is not about one-time purchases at all**.

1. **The plugin cannot be installed without changing `@hearthkit/auth`, and no option avoids it.**
   `getSchema` in its dist spreads a `user` model carrying `stripeCustomerId` in **both branches** of
   its only conditional — `if (options.subscription?.enabled)` spreads `{ ...subscriptions, ...user }`
   and the `else` spreads `{ ...user }` — so the field is there even with subscriptions turned off.
   Saying "unconditionally" invites a reader to go hunting for the switch; there is no switch. It adds
   the same field to `organization` when organization support is on.
   `hearthkitAuthDrizzleSchema` has no such column, Drizzle table objects cannot be extended by another
   package, and the Better Auth Drizzle adapter resolves a column as `schema[modelName][fieldName]` and
   throws `The field "<name>" does not exist in the schema for the model "<model>". Please update your
schema.` when it is absent. So adopting the plugin means editing `@hearthkit/auth`'s table
   definitions — a package this one may not edit, and whose contract states in as many words that it
   "must not import `payments`, know about Stripe, or model a plan, a price or a subscription".
2. **It is subscription-only.** Its dist contains exactly one checkout mode literal, `mode:
"subscription"`, and zero occurrences of `mode: "payment"` or `payment_intent`. Plan 4.8's Purpose
   names one-time purchases, so they are ours either way.
3. **It has no catalog sync.** Its only calls into the Stripe price API are `prices.list` and
   `prices.retrieve`; `products.create`, `products.update` and `prices.create` appear nowhere. Plan
   4.8's `syncPaymentsCatalog` is ours either way.
4. **Its surface is routes, not functions.** It registers `/stripe/webhook`, `/subscription/upgrade`,
   `/subscription/cancel`, `/subscription/restore`, `/subscription/list`, `/subscription/success` and
   `/subscription/billing-portal` on the auth instance, and the subscription routes are session-scoped
   through `sessionMiddleware`. Plan 4.8's outputs are four named functions, and its gate replays a raw
   event body through a webhook handler — a function taking a body and a signature, not a route needing
   a session.
5. **Its peer set contains an exact pin that is a standing hazard.** `@better-auth/stripe@1.7.2` peers
   on `better-call: 1.4.0` — exact, not a range. `better-auth@1.7.2` happens to depend on exactly
   `better-call: 1.4.0` today, so they agree at the pin; any `better-auth` patch that moves
   `better-call` breaks the peer. Only `@better-auth/stripe@1.7.2` fits our `better-auth` pin at all:
   `latest` is 1.7.3 and peers on `^1.7.3` — that last pair is the orchestrator's registry measurement,
   not one this agent re-read, and it is the only claim in this section with that provenance.

So this package owns three tables of its own and talks to Stripe through the SDK. What it does **not**
do is invent vocabulary: `billingScope`'s two values are the plugin's `customerType` values, and the
column-name mapping below is stated so a later move to the plugin is a rename with a known target
rather than an excavation.

| This package                              | `@better-auth/stripe`                                     | Stripe                                        |
| ----------------------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| `billingReferenceId`                      | `referenceId`                                             | `metadata.hearthkit_billing_reference_id`     |
| `billingScope`                            | `customerType`                                            | `metadata.hearthkit_billing_scope`            |
| `priceName`                               | `plan`                                                    | `Price.lookup_key`                            |
| `currentPeriodStart` / `…End`             | `periodStart` / `…End`                                    | `SubscriptionItem.current_period_start` / `…` |
| `stripeCustomerId` on `payments_customer` | `user.stripeCustomerId` / `organization.stripeCustomerId` | `Customer.id`                                 |
| not modelled                              | `seats`, `stripeScheduleId`, `billingInterval`            | —                                             |

`seats`, `stripeScheduleId` and `billingInterval` are left out because nothing in plan 4.8 asks for seat
billing or scheduled plan changes, and `billingInterval` is already in the catalog under the price
name. Each is an additive column later.

#### Details the gates and the implementation both depend on

- **`payments-price-not-found` covers two causes and carries which one, because the fixes differ.**
  `priceLookupFailure` is `'absent-from-catalog'` when `priceName` names no price in the catalog the
  client was built with — a code mistake, and a check that touches no network at all — and
  `'absent-from-stripe'` when the catalog has it but Stripe has no active price with that lookup key,
  which means `hearthkit payments sync` has not been run against this account. One variant with a field
  discriminator rather than two kinds, following `auth-input-invalid`'s precedent: the caller does the
  same thing in both cases (tell the buyer this plan is unavailable) and only the operator's next step
  differs. A gate asserts on `priceLookupFailure`, which is an enum, rather than on message text.
- **Neither price nor customer resolution asks Stripe to tell us the thing is missing.** The catalog
  arm is a local map lookup; the Stripe arm is an empty `prices.list` result, which is a 200 response
  with no data rather than an error; and `payments-customer-not-found` is an empty
  `payments_customer` query. So all three producers are deterministic and two of them need no network.
  Depending on `error.code === 'resource_missing'` was rejected deliberately: it is an API-level string
  this repo cannot measure offline, and `resource_already_exists` sits in the same union as a
  ready-made near miss.
- **`payments-customer-not-found` has exactly one producer, and that is by design.**
  `createCheckoutSession` creates the Stripe customer and the local row when neither exists, so it can
  never report this. `createCustomerPortalSession` never creates anything — opening a billing portal for
  a person who has never paid is not a thing to do quietly — so it is the only producer. The plugin
  reaches the same conclusion: `CUSTOMER_NOT_FOUND` is thrown in its dist in exactly one place, its
  billing-portal route.
- **`payments-webhook-signature-invalid` carries `signatureFailureReason`**, either
  `'signature-header-missing'` or `'signature-verification-failed'`, plus `stripeFailureDetail` holding
  the SDK's message. Both mean "this request did not come from Stripe" and the caller does the same
  thing with both — answer 400 and write nothing — so they are one kind with a discriminator.
- **The wrong-secret message has a near-miss in the same file, and a gate matching loosely will assert
  the wrong thing.** Measured in `Webhooks.js`, a wrong secret throws with a message beginning
  `No signatures found matching the expected signature for payload.`, while a header that parses but
  carries no `v1=` entry throws `No signatures found with expected scheme`. **A substring test on
  `No signatures found` matches both.** Two further messages exist on the same path:
  `Unable to extract timestamp and signatures from header` for a malformed header, and
  `Timestamp outside the tolerance zone` when the signature is older than
  `DEFAULT_TOLERANCE`, measured as `300` seconds. This package maps all four to one variant, so the
  hazard is not in the implementation — it is in a gate that means to prove "wrong secret" and matches
  a string that four different causes satisfy.
- **The signature round trip is fully offline and deterministic, so `STRIPE_WEBHOOK_SECRET` is a value
  the gates choose rather than one Stripe issues.** `stripe.webhooks.generateTestHeaderString({
payload, secret })` builds `t=<unix seconds>,v1=<hmac>` with no network, and
  `constructEvent(payload, header, secret)` verifies it. The Stripe CLI is therefore **not** a
  dependency of the webhook gates. Plan 4.8 names `stripe listen`, which stays the right tool for local
  development per plan section 6, but a gate that shells out to a CLI to obtain a value it can compute
  is slower, less deterministic and skippable — and a skipped gate is not a passing gate.
- **`payments-stripe-unauthorized` covers 401 and 403 in one variant.** 401 is a wrong or revoked key
  (`StripeAuthenticationError`); 403 is a restricted key without the permission
  (`StripePermissionError`). The caller does the same thing with both — fail the request and page the
  operator — so the taxonomy follows the caller, per `auth`'s Decision 4. `stripeErrorStatus` is carried
  so a reader sees which. This is the first-run state of every project that pasted the wrong key, and
  without a name it would arrive as an opaque catch-all in the one package that is holding somebody's
  money.
- **`payments-stripe-unreachable` is measured and cheaply gateable.** At the pin, a request-level
  failure becomes `StripeConnectionError` with the message
  `An error occurred with our connection to Stripe.` — plus ` Request was retried N times.` when it was
  retried — and a timeout becomes `Request aborted due to timeout being reached (Nms)`. **A closed
  connection is retried once even when retries are disabled**, per the SDK's own `_shouldRetry`, so a
  gate should not assert a retry count of zero. This is the sibling of `db`'s
  `database-server-unreachable` and `email`'s transport-unreachable variant, and it is what
  `stripeApiBaseUrl` exists for: pointed at a closed local port it produces this failure with no
  network and no Stripe account.
- **`payments-database-unavailable` reuses `@hearthkit/auth`'s four-code allowlist verbatim**, and the
  reasoning transfers with it: `ECONNREFUSED` when the server refuses, `42P01` when a table is absent,
  `3D000` when the named database does not exist, `28P01` when the password is wrong. All four arrive
  as a `DrizzleQueryError` that carries **no code of its own**, with the code exactly one `.cause` hop
  down, and one call can throw from two unrelated error families — an `AggregateError` and pg's
  `DatabaseError`. It is an allowlist and not "any cause carrying a code", for auth's reason:
  `23505` is a unique violation, which is a caller error rather than an unavailable database, and this
  package has three unique constraints that a concurrent webhook delivery can race into. Everything
  outside the four stays in `payments-request-failed`. One spelling of one concept across two
  packages — if the list ever changes, it changes in both.
- **`payments-database-unavailable`'s detail is built from the `.cause`, never from the
  `DrizzleQueryError` wrapper.** The wrapper's message repeats the failing SQL and its bound
  parameters, which here would put a customer's email address and Stripe ids into a returned failure.
  This is the same judgement the `auth` implementor made and it is written into the contract this time
  so it is not rediscovered.
- **`payments-catalog-invalid` carries a list, not a first failure.** `catalogIssues` names every
  problem in one pass, the way `config` reports every bad variable at once, because fixing a catalog one
  error per boot is miserable. Each issue is
  `{ catalogIssueKind, catalogEntryName, catalogIssueReason }` with `catalogIssueKind` one of
  `'catalog-has-no-products'`, `'product-has-no-prices'`, `'duplicate-product-name'`,
  `'duplicate-price-name'` or `'entry-invalid'`. `catalogIssueReason` states the rule that was broken
  ("must be a positive integer of minor currency units"), never the value, matching
  `auth-input-invalid`'s discipline.
- **`payments-input-invalid` never echoes the rejected value.** `invalidFieldReason` states the rule;
  `invalidFieldName` is an enum, and a gate asserts on that rather than on message text.
- **`successUrl` and `cancelUrl` are passed to Stripe verbatim, byte for byte.** They are validated
  with `z.url({ protocol: /^https?$/ })` and then handed over unchanged — **never normalised through
  `new URL(value).href`**. Stripe supports a `{CHECKOUT_SESSION_ID}` placeholder in `success_url`, and
  round-tripping the string through `URL` percent-encodes the braces, which turns the placeholder into
  literal text that Stripe never substitutes. The symptom is a success page that receives
  `%7BCHECKOUT_SESSION_ID%7D` as its session id, which reads like a Stripe bug.
- **Neither secret ever leaves this package.** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are
  branded as secrets and must not appear in any message, any returned value or any log line. Because
  failure details quote text produced by a third-party library, the implementation scrubs both
  configured secrets out of that text before quoting it — the same rule `@hearthkit/email`'s
  `redactEmailSecrets` follows, and for the same reason: the rule is absolute but the words are
  somebody else's.
- **`payments-request-failed` carries `stripeErrorCode`, `stripeErrorStatus` and `stripeErrorParam`**
  when Stripe supplied them, plus `paymentsFailureDetail`. It is the catch-all that keeps "never
  throws" a promise rather than an aspiration, exactly as `storage-request-failed`,
  `email-send-failed` and `auth-request-failed` do, and carrying the code is what stops it being a
  dead end.
- **`payments-request-failed` carries no discriminator, so its several producers are not
  distinguishable programmatically, and nobody should assume otherwise.** Three of them are named in
  this contract — a `null` `checkoutUrl`, a `null` `session.currency` and a `null`
  `session.amount_total` — and a caller receiving the failure cannot tell which fired, because the
  three optional Stripe fields are all absent on these paths and only `paymentsFailureDetail` differs.
  That is accepted rather than fixed: adding a discriminator would mean enumerating every internal
  invariant in the public type, which is what a catch-all exists to avoid. **The detail text is for a
  human reading a log, and a gate asserts the `kind` and a non-empty detail, never which producer it
  was.** Anything that genuinely needs branching gets its own variant instead.

### Verified

Read off a real install of `stripe@22.6.1`, `@better-auth/stripe@1.7.2` and `better-auth@1.7.2` on
2026-09-06, in the probe workspace the orchestrator created. These are file contents, not inference,
and where one disagrees with a documentation page, this list wins.

#### `@better-auth/stripe@1.7.2`

- Its `peerDependencies` are `better-call: "1.4.0"` (exact), `stripe: "^18 || ^19 || ^20 || ^21 || ^22"`,
  `@better-auth/core: "^1.7.2"` and `better-auth: "^1.7.2"` — `package.json`.
- `better-auth@1.7.2` depends on `better-call: "1.4.0"` exactly, so the two agree at the pin —
  `better-auth/package.json`.
- **`better-auth@1.7.2` mentions `stripe` nowhere in its manifest**: no `./plugins/stripe` export, no
  peer. The plugin is only ever the separate package.
- **One checkout mode literal, `mode: "subscription"`, and zero occurrences of `mode: "payment"` or
  `payment_intent`** — `dist/index.mjs:1069`.
- **No catalog sync.** Its only price API calls are `prices.list` and `prices.retrieve`
  (`dist/index.mjs:512`, `:519`); `products.create`, `products.update` and `prices.create` appear
  nowhere in the dist.
- Webhook events handled: `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`, and a `default` branch that only
  forwards to `onEvent` — `dist/index.mjs:1567-1587`.
- **It makes a network call inside its checkout webhook handler, and this is the corroboration that a
  delivery carries no `line_items`.** `onCheckoutSessionCompleted` calls
  `await client.subscriptions.retrieve(checkoutSession.subscription)` at `dist/index.mjs:186` and then
  `resolvePlanItem(options, subscription.items.data)` at `:187` — never
  `checkoutSession.line_items`. Grepping every `retrieve(` in the dist confirms `:186` is the **only**
  one inside any of its four handlers (`onCheckoutSessionCompleted` `:181`, `onSubscriptionCreated`
  `:246`, `onSubscriptionUpdated` `:320`, `onSubscriptionDeleted` `:413`).
- **Its two subscription handlers make no call at all**, reading `event.data.object.items.data`
  directly — `dist/index.mjs:276`, `:324` — and `resolvePlanItem` at `:132-147` reads `item.price.id`
  and `item.price.lookup_key` off those items. That is independent confirmation that a
  `customer.subscription.*` payload embeds the full price object.
- Endpoints registered: `/stripe/webhook` always, and `/subscription/upgrade`, `/subscription/cancel`,
  `/subscription/restore`, `/subscription/list`, `/subscription/success`,
  `/subscription/billing-portal` when subscriptions are enabled — `dist/index.mjs:1693-1707`.
- **`getSchema` spreads `user: { fields: { stripeCustomerId } }` in BOTH branches of its only
  conditional** — `if (options.subscription?.enabled)` gives `{ ...subscriptions, ...user }` and the
  `else` gives `{ ...user }` — so no configuration removes that field. It adds
  `organization: { fields: { stripeCustomerId } }` when `organization.enabled`; the `subscription`
  model is added only when `subscription.enabled` — `dist/index.mjs:1664-1688`. Re-read and confirmed
  by the orchestrator in correction round 1.
- The `subscription` model's fields are `plan`, `referenceId` (both required), `stripeCustomerId`,
  `stripeSubscriptionId`, `status` (default `"incomplete"`), `periodStart`, `periodEnd`, `trialStart`,
  `trialEnd`, `cancelAtPeriodEnd` (default `false`), `cancelAt`, `canceledAt`, `endedAt`, `seats`,
  `billingInterval`, `stripeScheduleId` — `dist/index.mjs:1597-1663`.
- Org-scoped billing is supported through the required `referenceId` plus an `authorizeReference`
  option hook, and `customerType` is `z.enum(["user", "organization"])` — `dist/index.mjs:469-501`,
  `:1475`.
- Its error codes, read from `dist/version-6BnbVvhV.mjs`, include `CUSTOMER_NOT_FOUND`, thrown in
  exactly one place: the billing-portal route, when no customer id can be found
  (`dist/index.mjs:1523`).
- `isActiveOrTrialing(sub)` is `sub.status === "active" || sub.status === "trialing"` —
  `dist/index.mjs:89-91`.
- It reads `subscriptionItem.current_period_start` and `…_end`, never a subscription-level field —
  `dist/index.mjs:210`, `:287`, `:374`, `:1446`.

#### `@better-auth/drizzle-adapter@1.7.2`

- A missing model throws
  `[# Drizzle Adapter]: The model "<model>" was not found in the schema object. Please pass the schema
directly to the adapter options.` — `dist/index.mjs:61`.
- A missing field throws
  `The field "<field>" does not exist in the schema for the model "<model>". Please update your schema.`
  — `dist/index.mjs:124`.

#### `stripe@22.6.1`

- The SDK's default API version is `2026-08-26.dahlia` — `esm/apiVersion.js:2`.
- **`StripeError.type` is the class name, `error.rawType` is Stripe's own type string.** The
  constructor sets `this.type = type || this.constructor.name` and `this.rawType = raw.type`, alongside
  `statusCode`, `code`, `param`, `requestId`, `doc_url` and `headers` — `esm/Error.js:69-99`.
- `generateV1Error` maps `429` (or `400` with `code: 'rate_limit'`) to `StripeRateLimitError`,
  **`400` or `404` to `StripeInvalidRequestError`**, `401` to `StripeAuthenticationError`, `402` to
  `StripeCardError`, `403` to `StripePermissionError`, and everything else to `StripeAPIError` —
  `esm/Error.js:4-26`.
- `StripeSignatureVerificationError` carries `header` and `payload` in addition to the base fields —
  `esm/Error.js:178-184`.
- Signature failures and their exact opening words — `esm/Webhooks.js`:
  - wrong secret → `No signatures found matching the expected signature for payload.` (line 184)
  - header parsed but no `v1=` entry → `No signatures found with expected scheme` (line 130)
  - malformed header → `Unable to extract timestamp and signatures from header` (line 125)
  - stale signature → `Timestamp outside the tolerance zone` (line 196)
  - parsed object instead of raw body → `Webhook payload must be provided as a string or a Buffer …`
    (line 175)
  - no body → `No webhook payload was provided.` (line 105)
- `DEFAULT_TOLERANCE` is `300` seconds and `EXPECTED_SCHEME` is `'v1'` — `esm/Webhooks.js:12`, `:65`.
- `generateTestHeaderString({ payload, secret })` computes an HMAC locally and returns
  `t=<unix seconds>,v1=<signature>`; the timestamp defaults to now — `esm/Webhooks.js:42-56`,
  `:231-253`.
- `const secretContainsWhitespace = /\s/.test(secret)` — `esm/Webhooks.js:68`, `:81`.
- A request-level failure becomes `StripeConnectionError` with the message
  `An error occurred with our connection to Stripe.` plus ` Request was retried N times.` when
  retried, or `Request aborted due to timeout being reached (Nms)` on timeout —
  `esm/RequestSender.js:159-173`, `:469`. Its comment on `_shouldRetry` states that **a closed
  connection is retried once even when retries are disabled** — `:176`.
- `StripeConfig` accepts `host`, `port`, `protocol`, `timeout`, `maxNetworkRetries` (default 1),
  `httpClient`, `stripeAccount` and `apiVersion` — `esm/lib.d.ts:14-99`.
- Every Stripe object carries `livemode: boolean`, documented as "If the object exists in live mode,
  the value is `true`. If the object exists in test mode, the value is `false`." —
  `esm/resources/Products.d.ts:85-88`, and 131 files carry the same field.
- `products.create` accepts a caller-supplied `id`: "An identifier will be randomly generated by
  Stripe. You can optionally override this ID, but the ID must be unique across all products in your
  Stripe account." — `esm/resources/Products.d.ts:196-199`.
- `Price.lookup_key` is `string | null`, "up to 200 characters"; `PriceCreateParams` accepts
  `lookup_key` and `transfer_lookup_key` ("will atomically remove the lookup key from the existing
  price, and assign it to this price"); `PriceListParams` accepts up to ten `lookup_keys` —
  `esm/resources/Prices.d.ts:74-76`, `:304-344`, `:663-669`.
- `Price.Type` is `'one_time' | 'recurring'` and `Price.Recurring.Interval` is
  `'day' | 'month' | 'week' | 'year'` — `esm/resources/Prices.d.ts:230`, `:271`.
- Checkout `Session.Mode` is `'payment' | 'setup' | 'subscription'`; `Session.PaymentStatus` is
  `'no_payment_required' | 'paid' | 'unpaid'`; `Session.Status` is `'complete' | 'expired' | 'open'`;
  `Session.url` is `string | null`, "Applies to Checkout Sessions with `ui_mode: hosted_page` … only
  present when the session is active" — `esm/resources/Checkout/Sessions.d.ts:537`, `:607`, `:688`,
  `:308-314`.
- **`Checkout.Session.line_items` is `line_items?: ApiList<LineItem>` — an optional property** —
  `esm/resources/Checkout/Sessions.d.ts:182`, and the SDK's own comment on `listLineItems` at `:44`
  says "When **retrieving** a Checkout Session, there is an **includable** `line_items` property
  containing the first handful of those items." **A webhook delivery does not expand it**, which is
  what forces the purchase path onto session metadata.
- **The `Session` fields the purchase path reads instead, and which of them are expandable.** Plain,
  never a reference union: `id: string` (`:52`), `object: 'checkout.session'` (`:56`),
  `amount_total: number | null` (`:76`), `currency: string | null` (`:117`), `metadata: Metadata |
null` (`:198`), `mode: Session.Mode` (`:202`), `payment_status: Session.PaymentStatus` (`:241`).
  Expandable, and therefore a string id in a delivery:
  `customer: string | Customer | DeletedCustomer | null` (`:134`),
  `payment_intent: string | PaymentIntent | null` (`:215`),
  `subscription: string | Subscription | null` (`:295`). **`amount_total` and `currency` are nullable
  but not expandable**, so they need no retrieve; `line_items` is the only thing on this object that
  does.
- **`SubscriptionItem.price` is typed `Price`, not `string | Price`** —
  `esm/resources/SubscriptionItems.d.ts:90`. It is always the full object, so `price.lookup_key` is
  readable straight off a `customer.subscription.*` payload with no retrieve.
- **`SubscriptionItem.quantity` is optional: `quantity?: number`** —
  `esm/resources/SubscriptionItems.d.ts:94`, documented at `:92` as "The quantity of the plan to which
  the customer should be subscribed."
- **Neither Stripe email field on a checkout session is a reliable billing address, and the second
  one's own documentation says so in its second sentence.** `Session.customer_email` is
  `string | null` (`esm/resources/Checkout/Sessions.d.ts:154`), documented at `:147-153` as a prefill:
  "If provided, this value will be used when the Customer object is created. If not provided,
  customers will be asked to enter their email address. Use this parameter to prefill customer data if
  you already have an email on file. **To access information about the customer once the payment flow
  is complete, use the `customer` attribute.**" `Session.customer_details` is
  `Session.CustomerDetails | null` (`:146`) and `CustomerDetails.email` is `string | null` (`:491`),
  documented at `:488-489`: "The email associated with the Customer, if one exists, on the Checkout
  Session after a completed Checkout Session or at time of session expiry. **Otherwise, if the customer
  has consented to promotional content, this value is the most recent valid email provided by the
  customer on the Checkout form.**" That second sentence is why it cannot stand in for a billing
  address; it is easy to stop reading after the first.
- `SessionCreateParams` carries `client_reference_id`, `subscription_data.metadata` and
  `payment_intent_data.metadata` — `esm/resources/Checkout/Sessions.d.ts:2153`, `:2949`, `:2613-2629`.
- **`Subscription` has no `current_period_start` or `current_period_end`.** It has
  `cancel_at_period_end`, `cancel_at`, `canceled_at`, `ended_at`, `trial_start`, `trial_end`. The
  period fields are on the item: `SubscriptionItem.current_period_start` and `…_end` —
  `esm/resources/Subscriptions.d.ts:132-283`, `esm/resources/SubscriptionItems.d.ts:51-58`.
- `Subscription.Status` is
  `'active' | 'canceled' | 'incomplete' | 'incomplete_expired' | 'past_due' | 'paused' | 'trialing' | 'unpaid'`
  at `esm/resources/Subscriptions.d.ts:478`. **`SubscriptionListParams.Status` at line 2703 in the same
  file adds `'all'` and `'ended'` and is not a status.**
- `BillingPortal.Session.url` is `string`, non-nullable — `esm/resources/BillingPortal/Sessions.d.ts:59`.
- `resource_missing` and `resource_already_exists` are adjacent members of the same generated error-code
  union — `esm/resources/Invoices.d.ts:837`.
- The webhook signature header is `stripe-signature`; the SDK's own error text names it and
  `@better-auth/stripe` reads exactly that string — `esm/Webhooks.js:101`,
  `@better-auth/stripe/dist/index.mjs:1552`.

Established earlier in this repo and built on rather than re-derived: `composeEnvSchemaFragments`
silently discards a refinement attached to a fragment, so no pairing rule may live on the fragment;
`getTableConfig` from `drizzle-orm/pg-core` is public and returns each column's `name`, `getSQLType()`,
`notNull` and `primary`, which is enough for a gate to build `CREATE TABLE` from a shipped schema;
Drizzle failures arrive as a `DrizzleQueryError` with the code one `.cause` hop down; bare Node refuses
`.tsx`, which is why `ui`, `email` and `auth` publish a contract subpath; Postgres is already a service
container in `ci.yml`.

### Still not verified

Everything above was read off a file. These were not, and saying so is the point of this section.

- **Whether Stripe accepts a lowercase kebab-case custom product id.** `products.create` documents an
  optional `id` and requires it to be unique in the account; it does not document a character set, and
  no offline source states one. If Stripe rejects `'pro'` as a product id, `syncPaymentsCatalog`'s
  product step needs a different identity mechanism and this contract comes back for one line.
  **The first gate to write is the one that settles this**, because everything else in sync depends on
  it.
- **Whether `prices.list({ lookup_keys, active: true })` really returns an empty list rather than an
  error for an unknown lookup key.** The `'absent-from-stripe'` arm of `payments-price-not-found`
  assumes it does. Cheap to settle with the live key.
- **Whether `billing_portal.sessions.create` works on a fresh test account.** Stripe's hosted portal
  needs a portal configuration to exist, and a test account that has never saved one may have no
  default. If `createCustomerPortalSession` fails on the gate account, the account needs its test-mode
  portal configuration saved once in the Stripe dashboard — a one-off human step, not a code change.
  **Flagged because it would otherwise read as a bug in this package.** The exact error is unmeasured.
- **Whether a wrong-but-well-formed API key gives 401 rather than some other status.**
  `payments-stripe-unauthorized`'s gate depends on it. `generateV1Error`'s mapping of 401 is measured;
  what Stripe actually answers with is not.
- **The exact prefix of a Stripe test-mode secret key.** Deliberately not encoded anywhere in this
  contract — `stripeLivemode` is the guard instead. Recorded here so nobody adds a prefix check later
  believing it was merely forgotten.
- **Whether `z.url()` at `zod@4.4.3` accepts a URL containing `{CHECKOUT_SESSION_ID}`.**
  `paymentsRedirectUrlSchema` is `z.url({ protocol: /^https?$/ })`, and Stripe's documented
  `success_url` placeholder puts braces in the query string. Zod 4's URL check is built on `new URL()`,
  which accepts braces in a query, so this is expected to pass — **expected, not measured**, and no
  offline source here settles it. A one-line gate settles it, and if it fails the schema loosens to a
  protocol-and-authority check.
- **The customer-linked insert branch with no address anywhere.** A `checkout.session.completed`
  needing to insert a customer row, where `customer_details.email` and `customer_email` are both null,
  is ruled `payments-request-failed`. **No gate covers it**: every gate that synthesises a session
  supplies an address, and the fixture only omits `customer_details` when the caller omits the email
  entirely. It is the one branch here pinned by the contract text alone.
- **That the webhook never overwrites an existing row's `billingContactEmail`.** Stated as a rule and
  argued from the two Stripe fields being buyer-influenced, but **no gate delivers a second checkout
  session for a reference that already has a row**, so nothing fails if an implementation overwrites.
- **The character and length limits on Stripe metadata keys and values.** This package writes
  `hearthkit_billing_reference_id` (30 characters) and `hearthkit_billing_scope` (23), both well inside
  any plausible limit, and the values are Better Auth ids and one of two literals. Not measured, and
  not believed to be near a limit.
- **`payments-contract.ts` typechecking in isolation, and `format:check`.** `packages/payments` has no
  manifest yet, so `pnpm --filter @hearthkit/payments` reports no matching project **and exits 0** —
  the trap that has caught this repo six times, and that exit 0 is evidence of nothing. The contract's
  `stripe`, `drizzle-orm/node-postgres` and `@hearthkit/auth/auth-contract` imports are all type-only
  and cannot be resolved until the implementor adds the manifest and the dependencies. Prettier has
  not been run over either file.

### Decisions

Settled here rather than left to the implementor.

1. **Eight functions, each tied to a plan line.** `createCheckoutSession`,
   `createCustomerPortalSession`, `handleStripeWebhook` and `syncPaymentsCatalog` are plan 4.8's four
   named outputs, unrenamed. `hearthkitPaymentsDrizzleSchema` is its fifth. `createPaymentsClient` is
   the construction step the other four need, exactly as `createAuthServerInstance` is for `auth`, and
   it is where the catalog is validated so a malformed catalog fails at boot rather than at checkout.
   `readPaymentsSubscription` and `listPaymentsPurchases` exist because otherwise the three tables are
   write-only from the package's point of view and every app writes its own Drizzle query against our
   column names — which is the coupling shipping a package is supposed to prevent. `readPaymentsSubscription`
   is also what plan 4.8's gate uses to "confirm the subscription row exists".
   `verifyPaymentsTablesExist` mirrors `verifyAuthTablesExist`: it gives the gates a setup check that
   fails once, loudly and by name, instead of making every downstream gate fail with
   `relation "payments_customer" does not exist`, and it is what `observability`'s `/health` calls when
   it grows a billing check.
2. **This package owns three tables and does not use `@better-auth/stripe`.** Argued at length under
   The Better Auth Stripe plugin, and the decisive fact is that the plugin cannot be installed without
   adding a `stripeCustomerId` column to `@hearthkit/auth`'s `user` table — a package this one may not
   edit, whose contract forbids Stripe knowledge, and whose table objects cannot be extended from
   outside. **If the orchestrator wants the plugin instead, that is an `auth` contract change first**,
   and it would still leave `syncPaymentsCatalog` and one-time purchases here.
3. **Nine failure variants where the plan names three.** Plan's three are
   `payments-webhook-signature-invalid`, `payments-price-not-found` and
   `payments-customer-not-found`. `payments-input-invalid` and `payments-catalog-invalid` are the two
   ordinary shapes of "the app got it wrong", and both are checkable with no network, which matters in
   a package whose other gates need one. `payments-stripe-unauthorized` and
   `payments-stripe-unreachable` are the two first-run states of every deployment and the siblings of
   `db`'s `database-server-unreachable`. `payments-database-unavailable` is auth's variant reused
   verbatim. `payments-request-failed` is the catch-all that makes "never throws" a promise.
4. **One `payments-price-not-found` with a discriminator, not two kinds.** Argued under Details. The
   same rule produced auth's single `auth-input-invalid`.
5. **`stripeApiBaseUrl` is public surface added for one reason and it is stated plainly.** It makes
   `payments-stripe-unreachable` gateable against a closed local port with no network and no Stripe
   account, and it has a real production use — `host`, `port` and `protocol` are first-class
   `StripeConfig` options for proxies and for `stripe-mock`. It is the same category as
   `createAuthBrowserClient`'s `baseUrl`, which `auth` accepted for a split deployment, and **not** the
   same category as the `customFetchImpl` option `auth` refused, because it changes nothing about the
   shape of what this package returns. **It is the one addition here most worth vetoing if the
   orchestrator disagrees**; the cost of removing it is that the unreachable failure needs a real
   network outage to produce, so it would have to be dropped.
6. **The webhook handler takes `rawRequestBody` and `requestHeaders`, not a `Request`.** Taking a
   `Request` would prevent the parsed-body mistake by construction, which is tempting. It was rejected
   because the gate replays a recorded payload — a string — and would then have to synthesise a
   `Request` around it for no gain, and because `requestHeaders` is already this repo's spelling, from
   `readAuthSession`. The raw-body rule is stated with its measured symptom instead.
7. **The Stripe CLI is not a dependency.** `generateTestHeaderString` computes the header offline and
   deterministically, so the webhook gates need neither a network nor an installed binary. `stripe
listen` remains what a developer runs locally, per plan section 6.
8. **Idempotency by unique Stripe id, not by an events table.** Argued under What
   `handleStripeWebhook` does. It keeps the schema at the plan's three tables and produces a stronger
   gate.
9. **`status` is a string column with an exported list of known values, not an enum column.** Stripe's
   own union ends in `OtherString` because it can grow; a strict enum would turn a new Stripe status
   into a failed write in production, and the near-miss `'ended'` sitting one union away makes a
   hand-written enum a live hazard.
10. **Table names are prefixed `payments_` and the Drizzle key equals the SQL name.** The prefix keeps
    `subscription` free, which is the model name `@better-auth/stripe` would claim if a project ever
    adopts it, and it groups the additive metering table plan section 13 anticipates. Key-equals-name
    is the rule `auth` already follows, and it means `verifyPaymentsTablesExist` and the schema share
    one list.

### Rulings and corrections

Correction round 1, 2026-09-06. Every question raised in the first draft has been ruled on and folded
into the body above. The corrections are recorded here rather than silently absorbed, because a future
reader should see what was wrong and not only the conclusion.

**All four open questions ruled, every default confirmed.**

1. **Keep the SDK route; do not adopt `@better-auth/stripe`.** The orchestrator re-read `getSchema`
   and found the argument **stronger** than the first draft stated: `...user` is spread in both
   branches, so there is no option that removes `user.stripeCustomerId`. Also confirmed independently:
   the adapter throw text at `@better-auth/drizzle-adapter/dist/index.mjs:124`, and that
   `packages/auth/src` contains **zero** occurrences of `stripeCustomerId`. Wording tightened from
   "unconditionally" to "in both branches", because the first phrasing invited a reader to go hunting
   for a switch that does not exist.
2. **Both environment variables stay required.**
3. **`stripeApiBaseUrl` stays, and the first draft's own recommendation to consider vetoing it was
   overruled with a better precedent.** `@hearthkit/storage` makes the endpoint a first-class
   **environment variable** (`STORAGE_ENDPOINT`) precisely so MinIO and R2 are the same code; a
   constructor option is strictly less surface than that. Dropping a named failure mode covering a real
   first-run and outage state would have been the worse trade.
4. **Both read functions stay.** `readPaymentsSubscription` is what plan 4.8's own gate uses to confirm
   the subscription row exists, so on that one it is not an addition at all.

**One real defect, found by the orchestrator and fixed here: the first draft read a field that a
webhook delivery never carries.** It defined `'price-not-in-catalog'` as "no **line item's** price
carries a `lookup_key`", and sourced `payments_purchase.priceName`, `stripePriceId` and `quantity`
from line items. `Checkout.Session.line_items` is an **optional, includable** property that only a
retrieve expands, so on the checkout path all four reads would have been `undefined` on every real
delivery and the purchase path could not have been implemented as written.

- Fixed **without** adding a `checkout.sessions.retrieve` call, which would have dragged the whole
  webhook gate set behind a live Stripe key — the opposite of what this package needs, since that
  handler is its one fully offline surface. The purchase path now reads three new metadata keys
  `createCheckoutSession` writes, and every remaining column off plain `Session` fields. The full
  column-to-source table is under A webhook delivery does not carry `line_items`.
- `'price-not-in-catalog'` split into `'checkout-price-metadata-missing'` and
  `'subscription-price-not-in-catalog'`, because it had come to mean two different things on two paths
  with two different fixes.
- **The subscription path was correct and is unchanged.** `SubscriptionItem.price` is typed `Price`
  rather than `string | Price`, and the plugin's own subscription handlers read
  `event.data.object.items.data` with no retrieve, so that half is genuinely offline.
- A rule the fix produced that no gate would have forced: **the price metadata goes on the session and
  never on `subscription_data.metadata`**, because a portal upgrade changes a subscription's price
  without touching metadata stamped at creation, and a stale price name reported as fact is worse than
  no price name at all.

**Correction round 2: two `NOT NULL` columns had no stated source, both found by the gate-writer
building 45 gates against the contract.** Third time in three loops that the gate step has found
contract gaps this way. Both fixes are documentation and routing rules only — **no exported name, no
`kind`, and no enum value changed**, so the gate verification stands.

- **`payments_customer.billingContactEmail` on the webhook path. Ruled the orchestrator's way —
  `customer_details.email ?? customer_email` — after an attempt to rule the other way was killed by
  reading the gates.** The first attempt made the path update-only, so the column would have had one
  writer and the `NOT NULL` question would have disappeared instead of being answered. **The approved
  gate forbids it.** `handle-stripe-webhook-subscription.test.ts:111-143` hands a synthesised
  `checkout.session.completed` straight to the handler with **no prior `createCheckoutSession` call**
  and then asserts "a subscription checkout must leave a customer row for its reference". Update-only
  would ignore that delivery and write nothing, making an approved, verified gate unsatisfiable —
  worse than the name change the orchestrator warned about, because it changes asserted behaviour.
  The fixture settles the second half too: `payments-gate-stripe-events.ts:113-117` populates **both**
  `customer_email` and `customer_details.email` with the same address, with a comment saying a gate
  naming only one would be brittle, so either read satisfies it.
  - **The part of the losing argument that survives, in narrower form: the webhook writes the column
    on insert and never on update.** Both Stripe fields are influenced by the buyer on a page the app
    does not control, so an update would let a buyer silently redirect receipts and dunning. No gate
    forces this — the gate's assertion is about a row that did not previously exist — so it is a rule
    the contract states rather than one a test pins.
  - `CustomerDetails.email`'s **second** documented sentence widens it to a promotional-consent
    address typed on the Checkout form. Quoting only the first sentence is how it comes to look like a
    billing address. That is why it may seed a row and may not overwrite one.
  - **The both-null-on-insert branch is `payments-request-failed`**, chosen partly because it needs no
    new `ignoredReason` value and so cannot invalidate the gate run, and partly on its own merit: a
    completed checkout this package cannot record should not vanish quietly. **A new ignore reason
    would read better and no gate covers this branch either way** — flagged to the orchestrator rather
    than taken, per the standing instruction not to add an exported value unasked.
  - `'billing-reference-missing'` was briefly widened to cover "reference names no row" and has been
    **reverted**, because restoring the insert branch removes that case entirely.
- **`payments_subscription.quantity`.** Ruled: `SubscriptionItem.quantity`, defaulting to 1 when
  absent, since the SDK types it optional. The contract states why this default is right where the
  `hearthkit_quantity` rule's refusal to default was also right — absence has a defined meaning on
  Stripe's own object, and no defined meaning in a string this package wrote and read back.
- **`payments-request-failed` has no discriminator**, so its producers are not distinguishable
  programmatically. Recorded under the failure details rather than fixed, so nobody later assumes they
  can branch on it.

**Plan 4.8's gate wording does not match this contract's event routing, and that is now stated rather
than left for the gate-writer to trip over.** The plan says to replay `checkout.session.completed` and
confirm the subscription row; here that event produces `'customer-linked'` and the subscription row
comes from `customer.subscription.created`. The deviation, the three-step replacement sequence, and
why the plan's literal reading would cost a network call are set out under Deviation from plan 4.8's
gate wording.

## 2026-09-09: AUTH CONTRACT REWRITE (step 5)

Sections removed from `packages/auth/CONTRACT.md` when it was rewritten from 1043 lines to 193 on
`refactor/exports-auth`. Moved here unchanged (headings demoted one level). The line ranges are
those of the file at main `b2d7632`. Research notes, measurements and rulings that argued the
contract into its shape; the current contract states each surviving fact once.

### What the organizations flag does and does not change on the browser client

**The client is a Proxy whose target is a function, and it answers every property access.** Measured
at the pin with `organizationClient()` **absent**: `typeof authBrowserClient.organization` is
`'function'`, `typeof authBrowserClient.organization.create` is `'function'`, and
`typeof authBrowserClient.definitelyNotAPlugin` is `'function'` as well. The `in` operator does not
separate the two modes either: `'organization' in authBrowserClient` is `false` in **both**
configurations. There is no property read, no `typeof`, no truthiness check and no `in` test that
tells the two modes apart.

Three things follow, and each one has already been got wrong once.

1. **`authBrowserClientSchema` can only assert the root value.** `typeof value === 'function'`, which
   is what a Proxy over a function target reports. Every deeper check is **vacuous**:
   `typeof value.useSession === 'function'` passes against a client that has no `useSession` at all,
   because the Proxy answers a name no plugin ever defined the same way. A check that asserts nothing
   while reading as though it does is worse than no check, so **do not "harden" this schema with
   property checks.** The same sentence is a comment above the schema in `auth-contract.ts`, because
   that is where somebody will be standing when they think of it.
2. **An app author must not expect `authBrowserClient.organization` to be `undefined` in user-scoped
   mode.** `if (authBrowserClient.organization)` always takes the true branch. Feature detection on
   this client does not work. An app that needs to know which mode it is in branches on the same
   `organizations` literal the scaffold wrote, which it already has, because it passed it to both
   `createAuthServerInstance` and `createAuthBrowserClient`.
3. **The flag's observable effect is at the network boundary, not in the client's shape.** Build the
   browser client with `organizationsEnabled: false`, route its `organization.create` call to a server
   instance built with `organizationsEnabled: false`, and the server answers **404 with an empty
   body** — it has no such route. The property read never fails; the request does.

**A gate asserts that 404 together with its control, as a pair, because the control is the half that
carries the meaning.** One POST to `/api/auth/organization/create`, handed to
`authServerInstance.handler(request)`, was measured against both instances — the same request both
times:

| Server instance                          | Status  | Body  |
| ---------------------------------------- | ------- | ----- |
| built with `organizationsEnabled: false` | **404** | empty |
| built with `organizationsEnabled: true`  | **401** | empty |

The 404 on its own asserts very little, because a misspelled path returns 404 as well: a gate that
stopped there would keep passing after the route it means to probe stopped existing under that name.
**The 401 from the flag-on instance is the load-bearing half.** It is the identical request, with no
session on it, and it proves the route _exists_ and was rejected for want of a session rather than for
want of a route. Only with both does the 404 mean "this server has no organization endpoint at all".
This is the same reasoning `email`'s STARTTLS gate and `storage`'s presign gates already rest on: the
negative control is what stops the positive assertion being satisfiable by an unrelated mistake.

The failure arrives as the client's ordinary `{ data: null, error }` arm rather than as a thrown
value, because that is how every browser client call reports a non-2xx — and **that last step is now
measured through the real client, not taken from the documentation**. The gate points one client,
built with `organizationsEnabled: false`, at a loopback listener carrying each server instance in
turn, and reads `{ data: null, error: { status: 404 } }` from the flag-off server and
`{ status: 401 }` from the flag-on control, with the listener recording
`POST /api/auth/organization/create` both times. **Both bodies are empty**, so the status is the
whole of what a gate can match on and there is nothing further to assert. **`statusText` is not one
of the things to assert**: the same 401 reads `UNAUTHORIZED` handed straight to a fetch stub and
`Unauthorized` once Node's HTTP server has written it out, so it varies with how the response was
delivered rather than with what happened. The two
statuses are exported as `organizationRouteAbsentHttpStatus` and
`organizationRouteUnauthorizedHttpStatus`, so a gate names them instead of writing two bare numbers
whose relationship to each other is invisible. What stays ungated is the positive arm —
`organization.create` actually creating an organization through the route handler — because that path
is session-scoped by construction and needs a signed-in session cookie, which is why the server-side
provisioning path exists as a separate pair of functions.

Observing this needs the client's requests to reach the server instance, and **this package exposes no
option for that** — `createAuthBrowserClient` takes `organizationsEnabled` and `baseUrl` and nothing
else. A gate arranges the route itself, either by stubbing global `fetch` to call
`authServerInstance.handler(request)` or by putting the handler behind a real listener and pointing
`baseUrl` at it.

**Those two options look interchangeable and are not.** `createAuthClient` binds its fetch
implementation at **construction time**: at the pin, the client config passes `customFetchImpl: fetch`
into `createFetch`, capturing the value `globalThis.fetch` holds at the moment the client is built. A
stub assigned to `globalThis.fetch` **after** the client exists is therefore never consulted — the
client keeps the real one and makes real network requests, and nothing reports that the stub was
ignored. Measured while writing the gates: a probe that stubbed late reached `http://localhost:3000`,
and something already running on the machine answered with a full Next.js page, so the gate was
asserting against a stranger. On CI the same probe is `ECONNREFUSED` instead. Non-deterministic in
both directions. **Install the stub before the client is constructed, or use the listener, which has
no ordering hazard at all** because the client is pointed at it by `baseUrl` rather than by a mutated
global. Both remain permitted; only the stub carries a rule.

**`createAuthBrowserClient` grows no `customFetchImpl` option to make any of this easier** — the name
appears above only as the internal key Better Auth sets for itself, not as something this package
forwards — and no other public surface is
added either: **wrapping the client so that `organization` is genuinely absent, and returning the flag
alongside the client, were both put to the user and rejected**, because either one stops the returned
value being a plain Better Auth client — a surprise app authors would pay for every day, to make one
gate read better.

### What the magic link URL looks like, and how to read it back

The link `@hearthkit/email` sends always carries **exactly two query parameters**:

```
{AUTH_BASE_URL}/api/auth/magic-link/verify?token=<TOKEN>&callbackURL=%2F
```

`callbackURL` is appended whether or not `callbackUrl` was supplied. Omit it and the value is `%2F`;
supply `/dashboard` and it is `%2Fdashboard`. **There is no single-parameter case at all.**

That is what makes the extraction rule unconditional rather than a precaution. React Email escapes
`&` to `&amp;` in both the `href` attribute and the visible link text, so a two-parameter URL does
**not** appear verbatim in `htmlBody` — it appears verbatim only in `textBody`.
`@hearthkit/email`'s contract records the measurement and instructs this package to read the plain
text part. Plan 4.7's gate is "request magic link, read it from Mailpit, complete sign in", so:

> **Extract the magic link from the plain text part of the Mailpit message, never the HTML part.
> This holds for every link this package sends, including one requested with no `callbackUrl`.**

A single-parameter URL _would_ survive the escaping in `htmlBody` as well, which is what makes the
opposite assumption look correct. This package never produces one, so a "no callbackUrl" gate that
asserts HTML-verbatim behaviour is asserting something this package cannot do — it would pass for
the wrong reason and then rot. `completeMagicLinkSignIn` accepts the whole URL precisely so nobody
has to reassemble it.

**`completeMagicLinkSignIn` sends only the `token` and drops the link's `callbackURL`.** That is
what makes a successful verification answer `200` with JSON `{ token, user, session }` and a
`set-cookie`, rather than a 302 the function would then have to follow. It also makes the failure
arm unambiguous: with no `callbackURL` in the request, **any** 302 from this call is a rejected
token. Better Auth still redirects on failure, against `errorCallbackURL ?? callbackURL ?? '/'`, so
the rejection lands on `/?error=INVALID_TOKEN`.

Two more things about the mail this package sends, both of which a gate will otherwise trip over:

- The template is `@hearthkit/email`'s shipped `magicLinkEmailTemplate` (`magic-link-sign-in`), fed `{ signInUrl, productName?, expiryMinutes? }`. No second, competing template is defined here.
- **`expiryMinutes` is passed only when `magicLinkExpirySeconds` is 60 or more**, computed as `Math.floor(seconds / 60)`. `email`'s `emailLinkExpiryMinutesSchema` has a floor of one whole minute, so a shorter expiry has no representable value and the prop is omitted, which the template already handles by reading generically. This matters because the "expired magic link" gate sets the expiry to one second, and passing `0` would make every send fail as a render error instead.

### How a Better Auth signal becomes a failure

The mapping is part of the contract, not an implementation choice. Anything not listed here lands in the catch-all.

| Better Auth signal                                                                   | Failure                         |
| ------------------------------------------------------------------------------------ | ------------------------------- |
| 302 redirect whose `error` parameter is `INVALID_TOKEN`                              | `auth-magic-link-invalid`       |
| `APIError` with code `INVALID_EMAIL_OR_PASSWORD`                                     | `auth-invalid-credentials`      |
| `APIError` with code `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`                         | `auth-email-already-registered` |
| A `DrizzleQueryError` whose `.cause` has `ECONNREFUSED`, `42P01`, `3D000` or `28P01` | `auth-database-unavailable`     |
| An `EmailFailure` from `sendTransactionalEmail`                                      | `auth-email-send-failed`        |
| The endpoint is absent from `api`                                                    | `auth-organizations-disabled`   |
| Anything else                                                                        | `auth-request-failed`           |

**Where each of those values is read.** Reaching for the obvious property name finds `undefined`
every time, which routes every case into the catch-all. That failure is total and invisible, so the
access paths are part of the contract rather than an implementation detail:

- The error **code** is at `error.body?.code`. **`error.code` is `undefined`.** `error.body` carried
  exactly `{ message, code }` on every `APIError` measured that had a body at all — the 401 invalid
  credentials, the 422 duplicate sign-up, the 400 slug collision — but **that is a list of measured
  cases, not a rule, and an earlier revision of this contract wrote it down as a rule.** `error.body`
  is itself `undefined` on the 401 from calling `createOrganization` with a headers option. There is
  no guaranteed shape to lean on, so the optional chain is **required rather than stylistic**: a plain
  `error.body.code` throws a `TypeError` out of the handler on that path and turns "this package never
  throws" into a lie in exactly the case where the caller is already confused.
- The HTTP **status number** is at `error.statusCode`. `error.status` is the string name, such as
  `'UNAUTHORIZED'` or `'UNPROCESSABLE_ENTITY'`.
- A **magic link rejection** carries no code anywhere at all. Its value is the `error` query
  parameter of the redirect `location`, and nothing else. The thrown value carries that header, so
  the read is `error.headers.get('location')`. **`error.headers` is a real `Headers` instance, so the
  property access `error.headers.location` is `undefined`.** That is the same shape of trap as
  `error.code` versus `error.body?.code`, one level further out: the obvious spelling returns
  `undefined` rather than throwing, so the mistake looks like a missing header rather than a wrong
  access path.
- A **database failure** carries no code on the thrown error. The code is one `.cause` hop down.

**Those access paths are two instances of one recurring shape, and naming the shape is worth more
than the two fixes.** Four times now in this package, the obvious spelling has returned a **wrong
answer rather than an error**. One: `error.code` gives `undefined` where the code should be. Two:
`error.headers.location` gives `undefined` where the header should be. Three: the error-code enums
hold a plausible near-miss beside the real literal, and have done so three times over. Four, one
section away: a `globalThis.fetch` stub installed **after** `createAuthBrowserClient` has run is
silently ignored, because the client captured `fetch` at construction time. None of the four throws,
none of them logs, and each surfaces far from its cause — as a catch-all failure, as a gate that never
matches, or as a request that quietly went somewhere real. **The rule this package works to: when a
read or an assignment looks obvious, check it against a measured value before relying on it, because
this library reliably has something plausible sitting at the wrong spelling.** That is the general
form of the error-code rule stated further down, widened to cover the fetch case, which is not an
error code at all.

Details the gates and the implementation both depend on:

- **`auth-magic-link-invalid` is recognised from a redirect, not from a thrown coded error.** Better
  Auth's `GET /magic-link/verify` handler always answers a bad token by redirecting with
  `?error=INVALID_TOKEN` appended to `errorCallbackURL`, which defaults to `callbackURL`, which
  defaults to `/`. Measured at the pin, the call throws a plain `Error` with `statusCode: 302`, an
  **empty** `message`, `instanceof APIError === false`, and **no code anywhere**. So an
  implementation that inspects thrown error codes lets a rejected link look like a success, and one
  that matches on message text has nothing to match. The variant carries `betterAuthErrorValue` so a
  gate asserts the mechanism rather than the outcome, which means the implementation has to reach
  the redirect's `location` header. **The throw itself carries it**, measured at the pin: the thrown
  value's `headers` is a real `Headers` instance and `headers.get('location')` returns the whole
  redirect URL. So `asResponse: true` is a **choice, not a requirement**. It stays a reasonable
  choice, because the same call style also hands back `set-cookie` and the JSON body on the success
  arm and one call shape then serves both arms; but catching the throw and reading
  `error.headers.get('location')` is equally correct, and no gate may assume either style.
- **Better Auth cannot tell an expired token from a consumed or unknown one.** All three produce the identical `INVALID_TOKEN`. Plan 4.7 names "expired magic link" as a failure mode; this is the variant that covers it, and the honest statement is that it covers the other two as well. A gate produces the expired case by building an instance with `magicLinkExpirySeconds: 1`, requesting a link, waiting, and verifying.
- **A token is consumed atomically on the first verification.** Better Auth removed multi-attempt redemption, so calling `completeMagicLinkSignIn` twice with the same link always fails the second time — which is a second, faster producer for the same variant.
- **`auth-input-invalid` never echoes the rejected value.** `invalidFieldReason` states the rule that was broken ("must be a valid mailbox", "must be at least 8 characters"), not the input. That makes the secret rule absolute with no exceptions to remember, and a gate asserts on `invalidFieldName`, which is an enum, rather than on message text.
- **The password length check runs in this package before Better Auth sees it**, and the same `minimumAuthPasswordLength` / `maximumAuthPasswordLength` values are passed to `betterAuth()` as `minPasswordLength` and `maxPasswordLength`. Two layers checking with one set of numbers cannot disagree, so a password this package accepts can never be rejected downstream with a different message.
- **`auth-email-already-registered` matches one exact code, and it is the long one.** A duplicate
  sign-up throws `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` at HTTP 422, with the message
  `User already exists. Use another email.` **`USER_ALREADY_EXISTS` also exists in
  `auth.$ERROR_CODES`, as a separate entry, and is never what this endpoint throws** — so a reader
  who checks the library can confirm the wrong answer. The match is **exact equality**, never a
  substring test, because `'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'.includes('USER_ALREADY_EXISTS')`
  is `true`: a substring match would appear to work and would hide the day the value changes. That
  is the mirror of the `'19000:9000'.includes('9000:9000')` defect `docs/STATUS.md` records. Exact
  equality is safe here only because a gate pins it — a dependency bump that renames the code fails
  the duplicate sign-up gate, instead of quietly re-routing every duplicate into the catch-all.
- **Two Better Auth options would delete that failure's only producer, and both are measured.** The
  sign-up route returns a deliberately generic success instead of throwing when
  `emailAndPassword.requireEmailVerification` is on **or** `emailAndPassword.autoSignIn` is `false`.
  All three configurations were run against the pin; the table is under Measured. The default this
  package ships throws. Either guard active returns `{ token: null, user: {...} }` and throws
  nothing. **That generic response is indistinguishable from a real sign-up** — the same shape, a
  populated `user`, `token: null` — so a caller cannot detect the duplicate at all. Under those
  options the failure is not reported differently; it is not reported. The suppression is deliberate
  upstream: it stops the sign-up endpoint being a user-enumeration oracle, so whoever restores the
  throw is trading a security property for a named failure and should not "fix" it back without
  knowing that. This package pins `requireEmailVerification` off and leaves `autoSignIn` at its
  default `true`, which is the only reason the error is observable. Changing **either** — turning
  `requireEmailVerification` on, or setting `autoSignIn` to `false` — removes this variant's only
  producer and breaks its gate, and `autoSignIn` is the one nobody would think to check. Anyone doing
  it has to re-home the failure at the same time.
- **`auth-email-send-failed` carries `emailFailureKind` and `emailFailureDetail`.** The detail is the `EmailFailure`'s own `message`, which already starts with one of `email`'s six prefixes, so a gate can assert the underlying cause (`hearthkit email transport unreachable:`) without this package restating email's taxonomy. Without this variant, a magic link request against a dead SMTP server would report success and the user would wait for mail that never comes.
- **`auth-organizations-disabled` is detected structurally**, by the organization endpoint being
  absent from `authServerInstance.api`, not by a flag stored alongside the instance. That keeps the
  instance the single thing an app passes around, and it stays correct even for an instance built by
  hand. The endpoints are genuinely absent, not present-and-erroring: measured at the pin,
  `typeof authServerInstance.api.createOrganization` is `'function'` with the organization plugin
  and `'undefined'` without it.
- **`auth-database-unavailable` carries `databaseFailureDetail`, and every producer arrives as a raw
  Drizzle error rather than an `APIError`.** Measured at the pin, all four are a `DrizzleQueryError`
  with **no code of its own**, carrying the code exactly one `.cause` hop down: a dead port gives an
  `AggregateError` with `code: 'ECONNREFUSED'`; absent tables give a pg `DatabaseError` with
  `code: '42P01'` and `relation "user" does not exist`; a `DATABASE_URL` naming a database that does
  not exist gives `code: '3D000'`; a wrong password in `DATABASE_URL` gives `code: '28P01'`. Two
  things follow, and neither is guessable. First, the code is **exactly one `.cause` hop down**, so
  an implementation that checks the thrown error itself finds nothing. Second, one call can throw
  from **two unrelated error families** — an `AggregateError` and pg's `DatabaseError` — so the
  handler must not assume everything it catches is an `APIError`, nor that every `.cause` is the same
  type. All four are one class of problem, the kind an operator fixes with a corrected `DATABASE_URL`
  or with `hearthkit db migrate`, and all four are ordinary first-run states that otherwise surface
  as an opaque 500 with no hint of either fix. The last two are the cheapest of the four to gate:
  they need nothing but a different connection string, no dead port and no dropped table.
- **The four codes are an allowlist, not a catch-all, and the distinction is load-bearing.** The rule
  is deliberately **not** "any `.cause` carrying a code". `23505` is a unique violation, which is a
  caller error rather than an unavailable database, and the organization slug path can race into one;
  routing it here would tell an operator to go fix their infrastructure over a duplicate row. Every
  code outside `ECONNREFUSED`, `42P01`, `3D000` and `28P01` stays in `auth-request-failed`, which
  carries `authFailureDetail` so nothing is lost. Whoever wants a fifth code has to argue first that
  it is the same operator-fix class, and not a caller error wearing a database code.
- **`auth-request-failed` carries `authErrorCode` and `authErrorStatus`** when Better Auth supplied
  them, plus `authFailureDetail`. `authErrorCode` comes from `error.body?.code` and `authErrorStatus`
  from `error.statusCode`, per the access paths above; `error.code` and `error.status` are the two
  wrong properties to reach for. It is the catch-all that keeps "never throws" honest, exactly as
  `storage-request-failed` and `email-send-failed` do. Carrying the code is what stops it being a
  dead end: an organization slug collision, for example, arrives here with
  **`authErrorCode: 'ORGANIZATION_ALREADY_EXISTS'` and `authErrorStatus: 400`**, so a caller can
  branch on it and a gate can assert it. Both halves are exported —
  `betterAuthOrganizationAlreadyExistsErrorCode` and
  `betterAuthOrganizationAlreadyExistsHttpStatus` — so the caller and the gate share one spelling for
  each. The status has a name for the same reason the 404 and the 401 do: every HTTP status this
  contract pins is named, so **no gate writes one of these numbers bare**, and a status left as a
  literal is the one a reader cannot trace back to the measurement that produced it.
- **Two wrong values for that slug collision are easy to reach, and one of them was in this
  contract.** `SLUG_TAKEN` is **not an error code in this library at all** — an earlier revision
  illustrated the case with it, and a gate asserting it would have failed against every correct
  implementation. `ORGANIZATION_SLUG_ALREADY_TAKEN` **is** a real entry in the organization plugin's
  `$ERROR_CODES`, sitting one line away from `ORGANIZATION_ALREADY_EXISTS`, and it is not what this
  endpoint throws — the decoy has the same shape as `USER_ALREADY_EXISTS` beside
  `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, one level down. Checking the library confirms the wrong
  answer in both directions, so the measurement is the authority: a real collision throws
  `ORGANIZATION_ALREADY_EXISTS` at HTTP 400, message `Organization already exists`, with `body`
  present. **That is the third near-miss constant to bite this package** — the short
  `USER_ALREADY_EXISTS` beside the long form, the fabricated `SLUG_TAKEN`, and now
  `ORGANIZATION_SLUG_ALREADY_TAKEN` one line from the right answer — so the rule generalises:
  **never take an error code for this library from documentation or from memory; read it off a thrown
  error, because the enum reliably holds a plausible near-miss.** Naming the decoy here is what stops
  the fourth.

### Upstream behaviour at this pin that changes how a call must be made

Not failure modes, and not defects in this package. Each one was measured at `better-auth@1.7.2` and
each one produces a symptom that points at the wrong cause, which is why they are in the contract
rather than in a comment somebody writes after losing an afternoon.

- **The server-side `api` calls disagree about `headers`, and there is no rule that covers all
  three.** `signInMagicLink` and `magicLinkVerify` **require** a `headers` value: omit it and the call
  throws `APIError` 400 `VALIDATION_ERROR` with the message `Headers is required`, even though neither
  call is session-scoped. `createOrganization` must be
  called **without** one: passing `new Headers()` throws `UNAUTHORIZED` 401 with `body: undefined` and
  an **empty message**. Only the symptom was measured; the likely cause is that a headers option makes
  the endpoint resolve a session rather than take the owner from `body.userId`. A 401 with no message
  and no body reads like a bug in the caller's own code rather than an argument mistake, and it is the
  shape that produced the `error.body?.code` correction above. `addMember` tolerates either. **Pass
  `headers` to the two magic link calls; do not pass it to `createOrganization`.**
- **Verifying a magic link for a user who already has a password deletes that user's `account`
  rows.** Reproduced twice at the pin. Afterwards, password sign-in for that same user fails with
  `INVALID_EMAIL_OR_PASSWORD`, which this package reports as `auth-invalid-credentials` — a correct
  report of a state the user never asked for. Two consequences. **No gate may mix the two sign-in
  paths on one user**, or it will assert a failure that has nothing to do with the code under test.
  And **nobody may design a "link your password account by magic link" flow on top of this
  package** while the behaviour stands; it is upstream, this package does not cause it and cannot
  correct it from where it sits.

### Clauses no gate covers

Recorded so a future reader does not assume coverage exists. Everything else in this contract has a gate.

- **`nextCookies()` being last in the plugin list.** Its effect — a Next server action's `Set-Cookie` reaching the browser — needs a running Next app, not Vitest. So it cannot be proven by the gates. **It can break them, and the earlier claim that it could not was wrong.** The plugin loads `next/headers` dynamically inside both of its hooks. The `before` hook swallows everything; the `after` hook, which is the one that sets cookies, swallows exactly two error shapes: a message starting with `` `cookies` was called outside a request scope. `` or one that includes `Cannot find module`. **Everything else is rethrown.** With `next` not installed, Node's ESM resolver produces `Cannot find package 'next' imported from …`, which matches **neither** string, so the hook rethrows and **every cookie-setting call fails** — sign-up, sign-in and magic-link verification all returned `auth-request-failed` until `next@16.3.3` was installed. `next` is therefore a **devDependency of this package**, listed under Dependencies, and it stays an optional peer for consumers. The clause is now "it cannot break the gates **because `next` is installed**", which is a stated dependency rather than an accident.
- **The Google and GitHub sign-in redirect.** Configuring a provider is gated (fake credentials are enough to prove the provider is registered); completing a sign-in needs a real client ID at a real provider, which plan section 6 puts outside local development.
- **`sendResetPassword`.** The callback is wired to `email`'s `passwordResetEmailTemplate`, but reaching it needs `POST /request-password-reset` through the route handler, and this package exposes no wrapper for it. On an email failure the callback throws an `Error` whose message starts with `hearthkit auth email send failed:`, so the 500's log line is greppable even though no gate produces it.

### Verified

Checked 2026-09-03 against current docs.

- `better-auth` latest is **1.7.2**. Its exports map includes `./next-js`, `./react`, `./client`, `./client/plugins`, `./plugins`, `./plugins/organization`, `./plugins/magic-link`, `./api`, `./adapters/drizzle`; `next`, `react`, `drizzle-orm` and `pg` are optional peer dependencies — https://registry.npmjs.org/better-auth/latest
- `@better-auth/drizzle-adapter` latest is **1.7.2** and peer-depends on `drizzle-orm@^0.45.2 || >=1.0.0-rc.1 <2.0.0`, which the workspace's pinned `drizzle-orm@0.45.2` satisfies exactly — https://registry.npmjs.org/@better-auth/drizzle-adapter/latest
- The adapter is configured as `drizzleAdapter(db, { provider: 'pg', schema })`, imported from `@better-auth/drizzle-adapter`; `schemaName` selects a Postgres schema and `usePlural` renames tables — https://www.better-auth.com/docs/adapters/drizzle
- Better Auth reads `BETTER_AUTH_SECRET` then `AUTH_SECRET` for `secret`, and `BETTER_AUTH_URL` for `baseURL`; `basePath` defaults to `/api/auth`; `secret` must be at least 32 characters and falls back to a hardcoded literal when unset — https://www.better-auth.com/docs/reference/options and https://www.better-auth.com/docs/installation
- Core tables are `user`, `session`, `account`, `verification`. `user` carries `id, name, email, emailVerified, image, createdAt, updatedAt`; `session` carries `id, userId, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt`; `account` carries `id, userId, issuer, accountId, providerId, accessToken, refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt`; `verification` carries `id, identifier, value, expiresAt, createdAt, updatedAt` — https://www.better-auth.com/docs/concepts/database
- The organization plugin adds `organization`, `member` and `invitation`, optionally `team`, `teamMember` and `organizationRole`, and **adds `activeOrganizationId` to the existing `session` table**. It adds `activeTeamId` as well **only when teams are enabled**, which the default configuration this package ships does not do, so `session` gains `activeOrganizationId` alone. Default roles are `owner`, `admin`, `member`; `creatorRole` defaults to `owner`. `auth.api.createOrganization({ body: { name, slug, userId } })` works server-only without session headers, and `auth.api.addMember({ body: { userId, role, organizationId } })` is documented as server-only and does not require session headers. The same page also says of `createOrganization` that "this endpoint requires session cookies", which describes the session-scoped path an app's own button takes; measured at the pin, **omitting `headers` entirely and putting `userId` in the body succeeds, and passing `new Headers()` fails with 401**, so the two statements are about two different call styles and this package uses the first — https://www.better-auth.com/docs/plugins/organization
- Magic link is a plugin: `magicLink({ sendMagicLink })` from `better-auth/plugins`, `magicLinkClient()` from `better-auth/client/plugins`. The callback signature is `sendMagicLink: async ({ email, token, url, metadata }, ctx) => {}`. `expiresIn` is in seconds and defaults to 300. Its endpoints are `POST /sign-in/magic-link` (`signInMagicLink`) and `GET /magic-link/verify` (`magicLinkVerify`), the latter taking `token` and optional `callbackURL`, `newUserCallbackURL`, `errorCallbackURL` — https://www.better-auth.com/docs/plugins/magic-link
- **The verify handler always redirects on failure, it never throws a coded error.** It calls `redirectWithError('INVALID_TOKEN')` against `errorCallbackURL ?? callbackURL ?? '/'`, so the observable signal is a redirect carrying `?error=INVALID_TOKEN`. On success it calls `setSessionCookie` and then either redirects or, with no `callbackURL`, returns JSON `{ token, user, session }`. `allowedAttempts` is deprecated because a token is now consumed atomically on the first verification — https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/magic-link/index.ts
- Next.js route handler: `import { toNextJsHandler } from 'better-auth/next-js'` in `app/api/auth/[...all]/route.ts`, returning `{ GET, POST, PATCH, PUT, DELETE }`. Server session read is `auth.api.getSession({ headers: await headers() })`. `nextCookies()` must be the last plugin, and it loads `next/headers` dynamically inside its hooks — https://www.better-auth.com/docs/integrations/next and https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/integrations/next-js.ts
- **What `nextCookies()` swallows is narrower than "the failure outside a request scope", and the difference decides whether the gates can pass.** Read at the **v1.7.2 tag**, not at `main`: the `before` hook swallows everything, but the `after` hook catches and returns quietly only when the message starts with `` `cookies` was called outside a request scope. `` or includes `Cannot find module`, and **rethrows anything else**. A missing `next` package produces neither string, which is why `next` is a devDependency here — https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/integrations/next-js.ts
- **Both `ORGANIZATION_ALREADY_EXISTS` and `ORGANIZATION_SLUG_ALREADY_TAKEN` exist at the v1.7.2 tag**, as adjacent entries in the organization plugin's error codes, with the messages `Organization already exists` and `Organization slug already taken`. Reading the library therefore confirms either answer for a slug collision, and only the measurement below separates them. `SLUG_TAKEN` appears nowhere — https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/organization/error-codes.ts
- Next 16 route files support `GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS`; `context.params` has been a Promise since 15.0, and the catch-all `[...slug]` convention is unchanged. Docs version 16.3.4, matching the pinned 16.3.3 — https://nextjs.org/docs/app/api-reference/file-conventions/route
- Server calls take `{ body, headers, query }` and support `asResponse: true` and `returnHeaders: true` (which gives `{ headers, response }`, and is how the session cookie is read out). They **throw** on failure; the error is an `APIError` from `better-auth/api`, recognised with `isAPIError`, carrying `message` and `status`. **Do not stop reading here** — measured below, `status` is the string name, the number is `statusCode`, and the code is at `body.code` — https://www.better-auth.com/docs/concepts/api
- Client calls **return** `{ data, error }` with `error.message`, `error.status`, `error.statusText` and `error.code`; `useSession()` returns `{ data, isPending, error, refetch }`; `createAuthClient` comes from `better-auth/react` and its `baseURL` may be omitted when the auth server is on the same domain as the client. The client exposes `$ERROR_CODES` — https://www.better-auth.com/docs/concepts/client
- `INVALID_EMAIL_OR_PASSWORD` is the code for a wrong email or password, returned with HTTP 401 — https://www.better-auth.com/docs/reference/errors
- **A taken sign-up email throws `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, not `USER_ALREADY_EXISTS`.** The route reads `throw APIError.from("UNPROCESSABLE_ENTITY", BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL)`, so the status is 422. An earlier revision of this contract recorded the short code, which is a distinct entry in the same object and is never thrown here — https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/api/routes/sign-up.ts
- **That throw is guarded.** The same route computes `shouldReturnGenericDuplicateResponse = ctx.context.options.emailAndPassword.requireEmailVerification || ctx.context.options.emailAndPassword.autoSignIn === false` and returns a generic success instead of throwing when it holds. This package pins the first off and leaves the second at its default, so the throw is reachable. **Both guards are measured at the 1.7.2 pin, one instance each — see the table under Measured.** The source read is kept only because it explains why; the behaviour itself is no longer inferred from it — same URL
- Better Auth exports **no stable public type** for the value `betterAuth()` returns; the documented convention is `export type Auth = typeof auth` in the app. This is why `AuthServerInstance` is structural here — https://www.better-auth.com/docs/concepts/typescript
- **`createAuthClient` binds its fetch implementation at construction time, and the docs do not say so.** Read at the **v1.7.2 tag**, the client config builds its fetcher with `createFetch({ …, customFetchImpl: fetch, …restOfFetchOptions })`, so the value `globalThis.fetch` holds when the client is constructed is captured then and a later reassignment of the global is never consulted. The client documentation page describes `fetchOptions` and **never mentions `customFetchImpl`**, so this is readable only in the source, which is why the ordering rule for a gate's `fetch` stub is written into this contract — https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/client/config.ts and https://www.better-auth.com/docs/concepts/client

Established earlier in this repo and built on rather than re-derived: `composeEnvSchemaFragments` silently discards a refinement attached to a fragment; React Email escapes `&` in `htmlBody` so a multi-parameter URL appears verbatim only in `textBody`; `@hearthkit/email` ships `magic-link-sign-in` with props `{ signInUrl, productName?, expiryMinutes? }` and `password-reset` with props `{ passwordResetUrl, productName?, expiryMinutes? }`; bare Node refuses `.tsx`, which is why `ui` and `email` publish a contract subpath; Postgres and Mailpit are already in `ci.yml`.

#### Measured against a real install at the pin, 2026-09-03

Run by the orchestrator against `better-auth@1.7.2`, `@better-auth/drizzle-adapter@1.7.2`,
`drizzle-orm@0.45.2`, a real Postgres and real Drizzle tables. These are command output, not
inference, and where one disagrees with a doc statement above, this list wins.

- **A rejected magic link is a redirect and nothing else.** Bad token with a `callbackURL`: status
  `302`, `location: http://localhost:3000/dash?error=INVALID_TOKEN`. The thrown value is an `Error`
  with `statusCode: 302`, an empty `message`, `instanceof APIError === false`, and no code anywhere.
- **That thrown value carries the redirect location, so `asResponse: true` is optional.** Catching
  the throw from `magicLinkVerify` with a bad token and no `asResponse`: the constructor is `Error`,
  `isAPIError` is `false`, `statusCode` is `302`, and `Object.keys` gives
  `['status', 'body', 'headers', 'statusCode', 'name']`. `headers` is a real `Headers` instance:
  `error.headers.get('location')` returns `http://localhost:3000/dash?error=INVALID_TOKEN`, and
  `error.headers.location` is `undefined`.
- **Unknown, consumed and expired tokens are indistinguishable.** All three produced the identical
  302, no code, empty message. `TOKEN_EXPIRED` does exist in `$ERROR_CODES`, but magic link never
  emits it, so nothing here may reach for it.
- **A valid verify with no `callbackURL` returns 200 JSON `{ token, user, session }`** and sets a
  cookie.
- **The emailed link always carries two query parameters.** With no `callbackUrl` supplied at request
  time: `.../api/auth/magic-link/verify?token=<TOKEN>&callbackURL=%2F`. Supplying `/dashboard` gives
  `&callbackURL=%2Fdashboard`. There is no single-parameter case.
- **`INVALID_EMAIL_OR_PASSWORD` at HTTP 401**, for both a wrong password and an unknown email.
- **A duplicate sign-up throws `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` at HTTP 422**, message
  `User already exists. Use another email.` Both that code and the shorter `USER_ALREADY_EXISTS`
  exist in `auth.$ERROR_CODES` as distinct entries.
- **An `APIError` carries its code at `error.body?.code`.** `error.code` is `undefined`. `error.body`
  had exactly `{ message, code }` **on the errors probed in this round**, which is not the same thing
  as a rule — a later round measured an `APIError` whose `body` is `undefined`, recorded below.
  `error.statusCode` is the number; `error.status` is the string name, such as `'UNAUTHORIZED'` or
  `'UNPROCESSABLE_ENTITY'`.
- **A database failure is not an `APIError`, and four codes reach it.** Dead port:
  `DrizzleQueryError`, no code, `.cause` an `AggregateError` with `code: 'ECONNREFUSED'`. Tables
  absent: `DrizzleQueryError`, no code, `.cause` a pg `DatabaseError` with `code: '42P01'` and
  `relation "user" does not exist`. A connection string naming a database that does not exist:
  `DatabaseError` with `code: '3D000'` and `database "definitely_absent_db" does not exist`. A
  connection string with the wrong password: `DatabaseError` with `code: '28P01'` and
  `password authentication failed for user "hearthkit"`. One `.cause` hop in every case. The last two
  were produced by changing the connection string and nothing else.
- **Organization endpoints are structurally absent without the plugin.**
  `typeof auth.api.createOrganization` is `'function'` with the plugin and `'undefined'` without it.
- **`getAuthTables()` reports exactly seven tables** — `user`, `session`, `account`, `verification`,
  `organization`, `member`, `invitation` — with `session.activeOrganizationId` present, and
  `account.issuer` present and required.
- **`autoSignIn` is on by default**: `signUpEmail` returned a token and a `set-cookie`.
- **`drizzleAdapter` requires the `schema` option**, which makes it mandatory rather than
  conventional. `drizzleAdapter(db, { provider: 'pg' })` against a `drizzle(pool)` with no schema
  throws `BetterAuthError: [# Drizzle Adapter]: The model "user" was not found in the schema object.`
- **`@better-auth/cli`'s latest is 1.4.21**, three minors behind the pin;
  `npx @better-auth/cli@1.7.2` fails with `ETARGET: No matching version found`; and
  `better-auth@1.7.2` ships no `bin` at all.
- **`getTableConfig` from `drizzle-orm/pg-core` is public** and returns each column's `name`,
  `getSQLType()`, `notNull` and `primary` — enough to build `CREATE TABLE` from the shipped schema.
- **The conformance check bites.** `getAuthTables()` compared against a hand-written seven-table
  schema immediately reported `invitation.createdAt MISSING from drizzle schema`.
- **`better-auth/adapters/drizzle` and `@better-auth/drizzle-adapter` export the identical function
  object**: `inlined.drizzleAdapter === standalone.drizzleAdapter` is `true`.

**Both guards on the duplicate sign-up throw are real, one instance each.** The same duplicate
sign-up, run against three `emailAndPassword` configurations:

| `emailAndPassword` config         | Duplicate sign-up                                    |
| --------------------------------- | ---------------------------------------------------- |
| default (what this package ships) | **throws** `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`   |
| `autoSignIn: false`               | **no throw**, returns `{ token: null, user: {...} }` |
| `requireEmailVerification: true`  | **no throw**, returns `{ token: null, user: {...} }` |

The generic response is **indistinguishable from a real sign-up**: the same shape, a populated
`user`, `token: null`. A caller cannot detect the duplicate at all. That is the point of it
upstream — the sign-up endpoint must not be a user-enumeration oracle — which is why the right
reading of this table is "a named failure was traded for a security property", not "a bug".

#### Measured while building the gates, 2026-09-03

Run by the orchestrator at the same pins while the gates were being written, so the provenance is one
round later than the list above. Three of these contradicted the contract as it stood and are folded
into the body; two are upstream behaviours that no sentence here implied.

- **The browser client is a Proxy whose target is a function.** `typeof authBrowserClient` is
  `'function'`. With the organization plugin **absent**: `typeof authBrowserClient.organization` is
  `'function'`, `typeof authBrowserClient.organization.create` is `'function'`, and
  `typeof authBrowserClient.definitelyNotAPlugin` is `'function'`.
  `'organization' in authBrowserClient` is `false` in **both** configurations. Against the schema as
  it stood, `authBrowserClientSchema.safeParse(realClient).success` was **`false`** — three of its
  five checks failed, including the root — so the implementor could not both return a Better Auth
  client and satisfy the contract. Corrected: the schema now asserts the root value only, and the
  reason every deeper check is vacuous is recorded beside it.
- **A duplicate organization slug throws `ORGANIZATION_ALREADY_EXISTS` at HTTP 400**, read at
  `error.body?.code` and `error.statusCode`. The contract's earlier illustration, `SLUG_TAKEN`,
  appears **zero times** in `better-auth`'s dist.
- **`headers` is required by two of the wrapped endpoints and rejected by a third.**
  `signInMagicLink` and `magicLinkVerify` without it: `APIError` 400 `VALIDATION_ERROR`, message
  `Headers is required`. `createOrganization` with `new Headers()`: `UNAUTHORIZED` 401,
  **`body: undefined`**, empty message. `addMember` works either way.
- **Verifying a magic link for a user who already has a password deletes that user's `account`
  rows**, so password sign-in for them afterwards gives `INVALID_EMAIL_OR_PASSWORD`. Reproduced twice.
- **With `next` not installed, every cookie-setting call fails.** Sign-up, sign-in and magic-link
  verification all returned `auth-request-failed` until `next@16.3.3` was added, because
  `nextCookies()`'s `after` hook rethrows a message it does not recognise and
  `Cannot find package 'next' imported from …` is not one of the two it swallows.

#### Measured while closing the contract, 2026-09-03

Run by the orchestrator at the same pins, one round later again. The first two close items that were
sitting on Still not verified. The third is a correction to the orchestrator's own earlier text in
this file, not to anything a subagent wrote.

- **The organizations flag's effect at the network boundary, with its own negative control.** One
  POST to `/api/auth/organization/create` handed to `authServerInstance.handler(request)`, the same
  request against two instances: built with `organizationsEnabled: false` the answer is **404**;
  built with `organizationsEnabled: true`, with no session on the request, it is **401**. **Both
  bodies are empty**, so the status is all there is to match on. Why a gate must assert the pair
  rather than the 404 alone is argued under What the organizations flag does and does not change on
  the browser client; the two values are exported as `organizationRouteAbsentHttpStatus` and
  `organizationRouteUnauthorizedHttpStatus`.
- **`ORGANIZATION_ALREADY_EXISTS` confirmed as the slug-collision code, and the near-miss confirmed
  as a near-miss.** A real collision throws it at **HTTP 400**, message `Organization already
exists`, with `body` **present**. Both `ORGANIZATION_ALREADY_EXISTS` and
  `ORGANIZATION_SLUG_ALREADY_TAKEN` exist at the v1.7.2 tag as adjacent `$ERROR_CODES` entries, and
  only the first is thrown here.
- **`error.body` has no guaranteed shape, which corrects an earlier line in this file.** A previous
  round recorded that `error.body` "has exactly `{ message, code }`". That was measured only on the
  paths probed at the time and is false in general: the `createOrganization`-with-headers 401 carries
  `body === undefined`. So `error.body?.code` is required, and a plain `error.body.code` throws a
  `TypeError` on that path and breaks the never-throws promise.

#### Measured while writing the gates, second pass, 2026-09-03

Found by the gate-writer at the same pins and confirmed before being written down. The first two were
re-checked against this repo's own files by this agent; the third and fourth are the gate-writer's
command output, recorded with that provenance rather than restated as first-hand.

- **The workspace has exactly one peer-suffixed `drizzle-orm` resolution.** `pnpm-lock.yaml` holds
  one `drizzle-orm@0.45.2` snapshot and no second one. Read directly in the lock file, and still one
  entry when the lock was re-read on 2026-09-04 after this package was installed — but **the suffix
  on it has changed since this round measured it**, from
  `(@opentelemetry/api@1.9.1)(@types/pg@8.23.1)(pg@8.23.0)` to
  `(@opentelemetry/api@1.9.1)(@types/pg@8.23.1)(kysely@0.29.5)(pg@8.23.0)`, because `better-auth`
  brings `kysely`. The count is the durable half of this measurement and the suffix is not; see
  Dependencies.
- **`@hearthkit/db` declares both halves of the peer pair.** `packages/db/package.json` has
  `pg@8.23.0` under `dependencies` and `@types/pg@8.23.1` under `devDependencies`. Read directly in
  the manifest. Together with the bullet above, this is why the dev list for this package must name
  `@types/pg@8.23.1` as well as `pg@8.23.0`.
- **Omitting `@types/pg` produces a type error, not a warning.** A manifest with `pg` and no
  `@types/pg` resolved a second `drizzle-orm@0.45.2` and typechecking then reported
  `TS2322 … Property 'dialect' is protected but type 'PgSession<…>' is not a class derived from 'PgSession<…>'`
  at the point `@hearthkit/db`'s client is passed as `drizzleClient`.
- **A `globalThis.fetch` stub installed after the client was built was ignored, and the request went
  somewhere real.** The browser client kept the genuine `fetch`, reached `http://localhost:3000`, and
  received a full Next.js page from whatever was already listening on the machine. The same probe on
  CI would fail with `ECONNREFUSED`. This is the measurement behind the ordering rule under What the
  organizations flag does and does not change on the browser client.

#### Still not verified

Four items sat here through the contract rounds and are now closed by the implementation and its
gates. They are closed **in place**, with the evidence attached, rather than deleted: this is the
section a reader checks to see what is **not** covered, and an item that silently vanishes reads the
same as one that was never raised.

- **Closed: the manifest, and with it the typecheck.** `packages/auth/package.json` exists, and
  `packages/auth typecheck: Done` appears explicitly in the project list — locally and on CI run
  33835915997, **checked by grep rather than inferred from exit 0**. So `auth-contract.ts` really is
  checked with `strict`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly` and
  `isolatedModules` from `tsconfig.base.json`, and its type-only `@hearthkit/email/email-contract`
  import really does resolve under this package's own `tsconfig.json`. The isolated-typecheck harness
  that stood in for this while there was no manifest is no longer needed here. **The trap it guarded
  against is still live and has caught this repo six times**: `pnpm --filter` against a package with
  no manifest reports no matching project and exits 0, so the green is evidence of nothing. It is
  closed **for this package** by the manifest; the next package into this workspace has to close it
  again.
- **Closed: Prettier.** `pnpm run format:check` exits 0 across the repo with this file and
  `auth-contract.ts` exactly as committed, orchestrator-run — every hand-padded table and hand-wrapped
  line held, so the instruction that used to stand here, to run `pnpm run format` once before
  committing rather than assuming, has been replaced by the run itself. **What the check still does
  not cover is the comment blocks in `auth-contract.ts`**: Prettier does not reflow comment interiors
  at all, so the wrapping there is house style a reader maintains by hand, and `format:check` passing
  says nothing about it. That holds for every later edit too — the check is the evidence, and
  reasoning about `proseWrap` and column counts is not the same evidence.
- **Closed: `authBrowserClientSchema` parsed against a real client.** It used to be a deduction from
  `typeof authBrowserClient === 'function'` rather than the evidence itself. A gate now parses a real
  client with it, in all four combinations of the flag and the optional `baseUrl` —
  `create-auth-browser-client.test.ts`, "returns a client `authBrowserClientSchema` accepts, in both
  modes and with or without a baseUrl".
- **Closed: the 404 and the 401 through the browser client, not only at the handler.** The same gate
  file drives the **real** browser client over a loopback listener carrying a server instance, and
  reads `{ data: null, error: { status: 404 } }` from the flag-off server and `{ status: 401 }` from
  the flag-on control, with the listener recording `POST /api/auth/organization/create` both times.
  That the client surfaces both on its `{ data, error }` arm rather than throwing was the one part
  previously taken from documentation rather than measured; it is measured now.

What is still not covered are the three clauses under Clauses no gate covers — `nextCookies()`'s
effect, which needs a running Next app rather than Vitest; the Google and GitHub sign-in redirect,
which needs a real client ID at a real provider; and `sendResetPassword`, which is wired but reachable
only through the route handler, for which this package exposes no wrapper. Add to those the positive
arm of the organization route: `organization.create` actually creating an organization through the
route handler is session-scoped by construction, which is why the server-side provisioning pair
exists.

Resolved earlier and struck from this list: whether the thrown 302 `Error` carries the redirect
`location` — it does, at `error.headers.get('location')`; and what the organizations flag's effect at
the network boundary actually is — 404 from the flag-off instance against 401 from the flag-on one,
both with empty bodies. Both are measured above.

### Rulings and corrections

Seven rounds. Every question raised in any of them has been ruled on and folded into the body above.
The corrections are recorded here rather than silently absorbed, because in each case a future reader
should see what was wrong and not only the conclusion.

**Corrected against measured evidence.** The orchestrator ran, at the pin, the probes this agent
could not. Five things in round one did not hold:

1. **The sign-up error code was wrong, and it was a live defect.** The contract encoded
   `USER_ALREADY_EXISTS`. What is thrown is `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, HTTP 422. Both
   exist in `$ERROR_CODES`, so checking the library would have confirmed the wrong answer. Fixed in
   the mapping table, in the failure detail, and at `betterAuthEmailAlreadyRegisteredErrorCode` —
   renamed from `betterAuthUserAlreadyExistsErrorCode` so the symbol no longer mirrors the decoy.
2. **The magic link URL always carries two query parameters.** Round one said `callbackURL` appears
   only when `callbackUrl` was supplied, which implied a single-parameter case exists. None does:
   the value defaults to `%2F`. That makes the "read the text part" rule unconditional, and it means
   a "no callbackUrl" gate asserting HTML-verbatim behaviour would pass for the wrong reason.
3. **The mapping table did not say where the error code lives.** It is at `error.body.code`;
   `error.code` is `undefined`. An implementation reading the obvious property routes every case
   into the catch-all, and the failure is total and invisible.
4. **The shape of a database failure was an assumption; it is now measured.** The code sits exactly
   one `.cause` hop below a `DrizzleQueryError` that carries no code itself, and every producer
   arrives as a raw Drizzle error rather than an `APIError`. Round three then found the list of codes
   too short; see below.
5. **Two Verified bullets overstated.** `activeTeamId` is added only when teams are enabled, and
   `drizzleAdapter`'s `schema` option is mandatory rather than conventional.

Found while applying those corrections, and not part of them: turning `requireEmailVerification` on
would delete `auth-email-already-registered`'s only producer. Recorded under How a Better Auth
signal becomes a failure, and the Out of scope claim that said the change was additive is corrected.

**Questions ruled.**

1. **`sendResetPassword` wired, no reset wrappers exported — accepted** as recommended. Decision 6.
2. **`requestedSocialProviders` — accepted** as recommended, optional, defaulting to empty.
3. **`verifyAuthTablesExist` — accepted** as recommended, and given a second job in Decision 2.
4. **`drizzle-kit` as a devDependency — rejected.** Replaced by Decision 9.
5. **`npx @better-auth/cli generate` — rejected, the premise was false.** Replaced by Decision 10.
6. **Prettier — done by the orchestrator.** See Still not verified.

**Round three.** Three flags were raised against the round-two text and all three were probed at the
pin. Two resolved in the flag's favour; one went against it, because the fact the flag rested on had
expired.

1. **The duplicate sign-up guard is measured, not inferred.** Round two read
   `shouldReturnGenericDuplicateResponse` from upstream source and reasoned from it. All three
   configurations were then run at the pin and both guards were confirmed independently, one instance
   each. The table is under Measured. The two facts that make this the sharpest edge in the contract
   are now stated outright rather than implied: the generic response is indistinguishable from a real
   sign-up, so the duplicate is not reported differently but not reported at all; and
   `autoSignIn: false` breaks the gate exactly as `requireEmailVerification: true` does, which
   matters because `autoSignIn` is the trigger nobody would think to check.
2. **`asResponse: true` is not mandatory for the magic link failure arm.** Round two pinned the
   signal but not how to read `location` off a thrown value that is not an `APIError`, and parked the
   question on Still not verified. Measured: the throw carries a real `Headers` instance, so
   `error.headers.get('location')` returns the redirect URL and `error.headers.location` is
   `undefined`. `asResponse: true` is now recorded as a choice with a reason to prefer it, not a
   requirement, and the property-versus-`get` trap is paired with `error.code` versus
   `error.body.code` so a reader sees one pattern instead of two coincidences.
3. **`auth-database-unavailable` was too narrow, and the reason it was narrow had expired.** Round
   two limited it to `ECONNREFUSED` and `42P01` on the stated grounds that no gate produced any other
   code. The rule was right — never widen a failure past its evidence — but the evidence then
   arrived: `3D000` and `28P01` were produced at the pin by changing the connection string and
   nothing else, both are ordinary wrong-`DATABASE_URL` first-run states, and both are cheaper to
   gate than either code already listed. The variant now names four codes as an **explicit
   allowlist**, and the contract says why it is not "any cause carrying a code": that would swallow
   `23505`, a unique violation the organization slug path can race into, which is a caller error and
   must never be reported as an unavailable database.

Two further things were settled in round three and are recorded so they are not reopened.
`verifyAuthTablesExist` and the Decision 10 conformance gate are **separate jobs** — one asks a live
database whether the tables were created, the other asks whether the shipped schema still matches
`getAuthTables()` — and both decisions now say so instead of sitting adjacent and confusable. And
`betterAuthEmailAlreadyRegisteredErrorCode` keeps the name that describes the failure rather than
mirroring the upstream literal, because a symbol that mirrors the decoy is exactly how the wrong code
stayed invisible in round one.

**Round four — three defects found by writing the gates against this contract, one of them a hard
blocker.** All three were measured by the orchestrator at the pin rather than taken from a report,
and the gates were not yet approved, so nothing already banked was lost.

1. **`authBrowserClientSchema` rejected the value its own function is specified to return.** Three of
   its five checks failed against a real client, including the root: `createAuthClient` returns a
   Proxy whose target is a **function**, so `typeof client` is `'function'` and so are `signIn` and
   `signUp`. The implementor could not have satisfied it. The schema now checks the root value alone.
   **The larger half of this fix is the reason, not the check**: every deeper property assertion is
   vacuous against a blanket Proxy, because `typeof client.definitelyNotAPlugin` is `'function'` too,
   so `typeof client.useSession === 'function'` would pass against a client with no `useSession`. That
   is recorded in a comment above the schema and in What the organizations flag does and does not
   change on the browser client, so nobody "hardens" it later with checks that assert nothing.
2. **The organizations flag has no client-side observable effect, and the ruling was to relocate the
   observation rather than drop it.** The contract said `organization` is present only with the flag
   on, and that its presence-or-absence is what a gate asserts. Measured, it is readable in both modes
   and `'organization' in client` is `false` in both. **Ruled by the user: keep the intent, assert it
   at the network boundary** — a client built with the flag off, calling through a server instance
   built with the flag off, fails because the server has no such route. Two alternatives were put to
   the user and rejected: narrowing the promise and deleting the gate, which makes the flag decorative
   on the client; and wrapping the client so `organization` is genuinely absent, which adds public
   surface and stops the returned value being a plain Better Auth client. No public surface was added.
3. **`SLUG_TAKEN` does not exist.** It appears zero times in `better-auth`'s dist, and a gate
   asserting it would have failed against every correct implementation. The real code is
   `ORGANIZATION_ALREADY_EXISTS` at HTTP 400. The near-miss `ORGANIZATION_SLUG_ALREADY_TAKEN` **is**
   real and is not what this endpoint throws, so the fix records both the right answer and the decoy.

Three things were added in the same round that were not defects in the contract but that no sentence
here implied: `next@16.3.3` as a **devDependency**, without which `nextCookies()` rethrows and every
cookie-setting call fails; the `headers` disagreement between `signInMagicLink`, `magicLinkVerify` and
`createOrganization`; and magic-link verification deleting the `account` rows of a user who already
has a password. The first also corrects the ungated-clauses claim that `nextCookies()` "cannot break
the gates" — true only because `next` is now installed on purpose. The second forced a smaller
correction of its own: `error.body` is `undefined` on that 401, so the code must be read as
`error.body?.code` or the handler throws where it promised not to.

**Round five — the network boundary pinned, and four rulings that left the text as it stood.** The
measurement round four asked for was run, so the last "does not succeed" in this contract is gone.

1. **The 404 is pinned, and so is its control.** Round four ruled that the organizations flag be
   asserted at the network boundary, but could only say the call "does not succeed", because no status
   had been measured. Both are measured now, and they are pinned **as a pair** rather than the 404
   alone: a gate asserting only the 404 could be satisfied by a typo in the path, and the 401 from the
   flag-on instance — same request, no session on it — is what proves the route exists and rules that
   out. Two constants carry the pair so a gate never writes the numbers bare. Both bodies are empty,
   so there is nothing else to assert.
2. **`authBrowserClientSchema` stays pinned to `'function'` alone.** Widening it to accept `'object'`
   as well would reduce the check to "not null and not a primitive", which asserts nothing. Pinning
   the measured reality means a release that stops proxying fails this check loudly. That is the same
   argument this contract already makes for exact-equality error-code matching, and staying consistent
   with it is worth the one-line change a future non-Proxy client would cost.
3. **`organization` stays optional on `AuthBrowserClient`.** Making it required would reject the
   flag-off client at the annotation site. The truth — that a runtime read never returns `undefined`
   in either mode — belongs in the comment on the property and in the prose, not in the type, and it
   is stated in both because a type that reads like a feature test and is not one has to be
   contradicted out loud.
4. **`betterAuthOrganizationAlreadyExistsErrorCode` stays exported.** It matches how the other three
   Better Auth literals are exported and hands a gate a symbol instead of a hand-typed string, which
   is what stopped the `USER_ALREADY_EXISTS` decoy surviving.
5. **`error.body?.code` confirmed, and the sentence that would have justified the plain form is
   retracted.** The optional chain was kept for the right reason: the `createOrganization`-with-headers
   401 carries `body === undefined`. What was wrong is an earlier round's claim that `error.body`
   "carries exactly `{ message, code }`" — measured on the paths probed at the time, and false in
   general. Both places that stated it now say which cases it covers, and the doc comments naming the
   access path spell it with the optional chain so the unsafe form is not there to be copied.

One thing was added rather than ruled. `ORGANIZATION_SLUG_ALREADY_TAKEN` is now named in the body as
the near-miss this endpoint does **not** throw, alongside the code it does. Three near-misses have
bitten this package — the short `USER_ALREADY_EXISTS`, the fabricated `SLUG_TAKEN`, and this one —
which is enough to state the habit as a rule: never take an error code for this library from
documentation or from memory, read it off a thrown error.

Line width was checked against the repo rather than settled by preference: the longest line in
`packages/email/CONTRACT.md` is 975 characters and in `packages/storage/CONTRACT.md` 923, Prettier's
`proseWrap` is `preserve`, and `prettier --check` passes on either style. Unwrapped prose is the
convention here, so the mixed wrapping in this file was left as it is and nothing was rewrapped.

**Round six — three items from writing the gates. No behaviour changed; one export was added.** All
three are documentation of facts that already held, which is why none of them reopens a decision.

1. **`@types/pg@8.23.1` was missing from the dev list, and its absence would have broken the
   implementor.** The list named `pg@8.23.0` alone. Written verbatim, this package would resolve a
   `drizzle-orm@0.45.2` with a different peer suffix from `@hearthkit/db`'s, pnpm would materialise a
   second copy, and passing db's client as `drizzleClient` would fail to typecheck against a
   `protected` member. Added to the list **with the reason attached**, because an `@types` entry that
   no `import` justifies is exactly what a later reader prunes. The lock-file and manifest evidence is
   under Measured while writing the gates, second pass.
2. **The two ways of routing the browser client to the server are not equivalent, and the contract
   presented them as if they were.** `createAuthClient` captures `fetch` at construction time, so a
   stub installed afterwards is silently ignored and the client makes real requests. Both options are
   kept — the intent was never to mandate one — but the stub now carries an ordering rule and the
   listener is noted as free of the hazard. This is the **fourth** instance of the shape where the
   obvious spelling returns a wrong answer rather than an error, so the shape itself is now named
   under How a Better Auth signal becomes a failure rather than left as three coincidences and a
   fourth.
3. **`betterAuthOrganizationAlreadyExistsHttpStatus` added.** The slug collision had a named code and
   a bare `400`, while the 404 and the 401 both had names. The asymmetry was small enough that the
   gate-writer correctly declined to spend a round on it; taken here because a round was already
   being spent. The rule it restores is worth more than the export costs: **every HTTP status this
   contract pins has a name**, so a number in a gate is always traceable to the measurement that
   produced it.

**Round seven — the contract reconciled against a green implementation, 2026-09-04. Documentation
only: no schema, no signature and no failure mode changed, so nothing already verified was
invalidated.** The package is implemented, with 40 of 40 gates passing and CI green on run 33835915997. That turned four Still not verified items into measurements, answered one open question
in the services list, and made one Dependencies fact stale.

1. **Four items closed on Still not verified, in place rather than deleted.** The manifest and the
   typecheck it makes real; Prettier; `authBrowserClientSchema` parsed against a real client; and the
   404/401 pair observed through the real browser client rather than at the handler. Each carries the
   evidence that closed it, because a section that only ever loses lines stops being readable as a
   map of what is not covered — and what genuinely remains uncovered is now stated there too.
2. **The exact drizzle peer suffix is no longer named as the check.** Installing this package added
   `kysely@0.29.5` to the resolved peer set — `better-auth` brings it and `drizzle-orm` lists it as an
   optional peer — so the literal string this contract pinned went stale inside one loop. Swapping in
   the new string was **rejected**: `@hearthkit/payments` is next into this workspace and may change
   it again. The durable statements are that `@types/pg` must be declared here, and that the check is
   `packages/auth/node_modules/drizzle-orm` and `packages/db/node_modules/drizzle-orm` resolving to
   the same real path, which they do. The suffix is quoted only as an example that will drift.
3. **The browser-client gate needs no database, which was an open question in the services list.**
   Both halves run against instances built over a Drizzle client aimed at a closed port and still
   answer their pinned statuses, so route resolution and the no-session rejection both happen before
   the adapter is touched.

No question is open. Nothing in this contract is waiting on an answer.

## 2026-09-09: completion plan step 4, first release 0.1.0 and trusted publishing confirmed at 0.1.1

Orchestrator work with the user running the account steps. Evidence, in order:

- PR #21 (`chore/release-workflow`, head 5193c99, CI run 34382207493 green, no skipped gates):
  `.github/workflows/release.yml` on `changesets/action@v2` (the branch for `@changesets/cli` 3;
  inputs are `version-script` and `publish-script`), permissions contents, pull-requests and
  id-token write, no `NPM_TOKEN`. `scripts/assert-npm-supports-trusted-publishing.ts` asserts npm
  11.5.1 or later before the action runs (the runner had 11.19.0).
  `scripts/assert-package-publishable.ts` is `prepublishOnly` in all ten packages: fails on
  private, version 0.0.0, missing `src/index.ts`, or an `exports`/`bin` target that is absent or
  outside `files`; accepts config's one JavaScript module. Verified under `pnpm publish --dry-run`.
  `repository` and `homepage` on every manifest. The CI changeset check skips on
  `changeset-release/main`.
- Repo made public; `can_approve_pull_request_reviews` set true so the action can open PRs.
- 0.1.0: `pnpm changeset version` locally (ten packages), committed as 77bf165, published by the
  user with `pnpm changeset publish` while logged in as the org owner, pushed with ten tags. The
  registry answered 404 on the packuments for about two minutes after publish while the tarball
  URLs already returned 200; `npm access list packages hearthkit` showed all ten at once.
- 4.3, verified against the registry from an empty scratchpad directory with no `package.json` or
  `pnpm-workspace.yaml` above it: `pnpm create @hearthkit@0.1.0 my-app --packages auth` exited 0
  (seven `@hearthkit/*` at 0.1.0 installed, Postgres and Mailpit up, database created). The first
  attempt failed at `infra up` because the repo's own compose Postgres held port 5432; stopping the
  repo compose fixed it, and it was restarted afterwards. `npm view @hearthkit/create version`
  printed 0.1.0, and 0.1.1 after the confirmation.
- Confirmation: PR #24 (real patch changeset on config; an empty changeset bumps nothing and
  cannot publish 0.1.1) merged, the action opened Version Packages PR #25, merged. Release run
  34405598187 on 92bcca7 first failed with `E403 OIDC permission denied for this action` on config
  and ui, then succeeded on rerun after the fix below. All ten at 0.1.1 with provenance
  attestations, ten tags, ten GitHub releases.

Traps found:

- **npm trusted publishers default to staged publishing.** The npmjs.com form has an "Allowed
  actions" section where only `npm stage publish` is allowed unless "Allow `npm publish`" is
  ticked. The workflow publishes directly, so the box must be ticked on every package or the
  registry returns `OIDC permission denied for this action` even when owner, repository and
  workflow filename are exact. The plan's 4.2 runbook predates this field.
- **The Version Packages PR gets no CI.** The action pushes with the built-in `GITHUB_TOKEN`, and
  GitHub does not run workflows on those pushes, so PR #25 showed no checks. The CI run on `main`
  after merge is the coverage; the changeset-check skip on `changeset-release/main` is moot for
  the PR itself.
- **Changesets for the private template are not inert.** Changesets 3 ignores
  `@hearthkit/app-template` in `changeset version`, so five `app-template-*` changesets survived
  the 0.1.0 version, and `changeset status` showed nothing pending, but the action still saw
  pending files and opened an empty Version Packages PR on every push to main (#23). They were
  deleted in PR #24; their text is in git history. Open question for the plan: whether template
  changes should carry changesets at all, since the private package is ignored either way.
- **The publish itself was blocked by the Claude Code auto-mode classifier.** The user ran
  `pnpm changeset publish` by hand. Expect the same for any future manual publish.
- No `LICENSE` file or `license` field existed at 0.1.0 and 0.1.1. Added on the user's instruction the
  same day (PR #26, MIT, Chris Lloyd 2026, a copy in every package directory because npm only
  ships a LICENSE from the package root) and published as 0.1.2 through the workflow (PR #27).

## 2026-09-07: completion plan step 3, `create`, stopped at the three-round cap

Branch `pkg/create`. Resolved 2026-09-08: the user authorized a fourth round moving the hook to
`@hearthkit/config` (subpath `register-node-modules-type-stripping`; cli gains config as a direct
dependency). After it, all three scaffold variants pass: 20 of 20 in the scaffold tier, verified by
the orchestrator. State at the stop on 2026-09-07:

- Contract approved (101 lines). Rulings: `organizations` is a tenth declared rewrite target
  `organizations-flag-literal` (the one value substitution in source); `templateDirectoryPath` is a
  programmatic-only option and the published tarball bundles `templates/app` at `prepack`, keeping
  only `src/app-template-contract.ts` under `src/`; no `.env` is written. Six gaps found by the
  gate-writer's satisfiability run were folded in: manifest location at publish time,
  `pnpm.overrides` for tarballs, `appTemplateNeverCopiedFileNames`, `installOutputExcerpt`, marker
  disambiguation, removal of `app-workflow-content-missing` and `appTemplatePrunerModulePath`.
- Gates: 20 in `create` (17 fast, 3 scaffold variants behind `HEARTHKIT_SCAFFOLD_GATES=1`), 4 new
  `payments sync` gates in `cli`, template pruned from 28 to 18. All 20 verified failing before
  implementation.
- Fast gates green after round 3: cli 46, create 17, template 18; `pnpm typecheck` 11 projects,
  `pnpm lint` 0 findings, `pnpm format:check` clean. `verify:container` passes; it was broken on
  `main` since step 1.1 because `pnpm pack` rewrites `workspace:*` to `0.0.0`, and the materializer
  now writes `pnpm.overrides` like the scaffold harness.
- Scaffold tier after round 3 plus two fixture fixes: `every-package` and `auth-with-organizations`
  pass end to end (install, typecheck, build, boot, Playwright flows including live Stripe
  checkout). `no-package` fails: its `test:e2e` script preloads
  `@hearthkit/cli/register-node-modules-type-stripping`, and the empty selection has no
  `@hearthkit/cli` because the template lists it only under each optional package's
  `devDependencyNames`. `ERR_MODULE_NOT_FOUND: Cannot find package '@hearthkit/cli'`.

### NODE REFUSES TYPE STRIPPING UNDER node_modules

The plan-level finding of this step. Node 24.20.0 throws
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` for any `.ts` under a `node_modules` path segment, and
no flag lifts it (docs: "Node.js refuses to handle TypeScript files inside folders under a
node_modules path", https://nodejs.org/docs/latest-v24.x/api/typescript.html). Every prior check ran
inside the workspace, where pnpm links resolve to real paths outside `node_modules`, so it was never
seen. In an installed project every `hearthkit` command and `pnpm create @hearthkit` were
unrunnable. Ruling: keep shipping source, no build step; one JavaScript module registers a
`module.registerHooks` load hook that runs `module.stripTypeScriptTypes` on exactly that set, and
the two bins plus the template's `test:e2e` script (Playwright workers are separate processes and
the payments spec imports `@hearthkit/payments/payments-contract`) load it. Proven by hand: installed
`hearthkit doctor`, `db migrate`, `dev infra down` and the create bin all run with empty stderr. The
hook currently lives in `@hearthkit/cli`, which is why the empty variant fails; see STATUS Open
issues.

### TYPE PACKAGES ARE RUNTIME DEPENDENCIES WHEN SOURCE SHIPS

A consumer's `tsc` and `next build` compile the packages' `.ts` source, so `@types/pg` (db) and
`@types/nodemailer` (email) must be in `dependencies`. The first scaffolded project failed typecheck
with eight `TS7016`/`TS7006` errors until they were. Audit of every other runtime dependency: all
ship their own types. React types stay dev: `react` is a peer dependency and the template declares
`@types/react`.

### pnpm 10 PASSES `--` THROUGH TO THE SCRIPT

`pnpm run s -- --reporter=json` hands the script `["--","--reporter=json"]`;
`pnpm run s --reporter=json` hands it `["--reporter=json"]`. A probe using `node -e` shifted argv by
one and gave the opposite answer. Playwright treated the literal `--` as a filter and wrote no JSON
report.

### Other facts

- `stripe@22.6.1` prints its Claude Code hint at module init, so `payments sync` imports the SDK
  lazily inside the command; the bin's "no stderr on success" gate would fail otherwise.
- `@hearthkit/create` is not a devDependency of the template: a static import drags cli source into
  the template's TypeScript program where Next's globals make `NODE_ENV` required on `ProcessEnv`
  (13 spawn errors), and it would ship into every generated project's devDependencies. The
  materializer spawns the create bin from the workspace path instead.
- `packages/create/tsconfig.json` uses `module: preserve` and `moduleResolution: bundler` because the
  gate fixture re-exports the template manifest from a package without `"type": "module"`.
- Playwright's JSON reporter reports `spec.file` relative to `testDir`, so expected paths drop `e2e/`.
- The orchestrator edited one gate line by hand (`installStderrExcerpt` to `installOutputExcerpt`, a
  rename the contract revision forced) and ran prettier on three CONTRACT.md files; both are
  ownership deviations. The cli CONTRACT.md is at 296 lines, over the 200 cap before this step, and
  cli now has 13 fixture files; both left for step 5.

## Verified facts this session

- **PHASE 5's TEMPLATE SECTIONS MERGED AS `c698c1a` (PR #16), AND THE DoD EVIDENCE IS A REAL PURCHASE
  ROW RATHER THAN AN INFERENCE.** Orchestrator-run, not taken from a subagent: **6 Playwright flows
  passed, 0 failed, 0 skipped**, against real Postgres, real MinIO, an isolated Mailpit and Stripe test
  mode; `verify:container` **passed all seven steps** against an empty-selection materialization.
  - The payments flow wrote `payments_purchase` carrying a **real Stripe test-mode session id**
    (`cs_test_a1YNDgqICyfq…`, `hearthkit-app-lifetime`, 1900, usd). That row cannot exist unless the
    whole chain ran — session created, redirect reached `checkout.stripe.com` with that session, signed
    `checkout.session.completed` posted, route answered `purchase-recorded`. **The webhook half had
    never executed before that run.**
  - **Mailpit isolation held in both directions, measured:** the isolated container held 2 messages and
    the repo's shared Mailpit held **0**, so `packages/email`'s nine exact-count assertions could not
    have been disturbed. The collision that cost a loop during `auth` did not recur.
  - The auth flow read a **real** magic link; the spec has no fallback path, so the pass is the proof.

- **POST-MERGE BASELINE ON `main` AT `c698c1a`, so any later regression is attributable.**
  `pnpm --recursive --if-present run test` **exit 0, 10 projects, 322 tests** — config 12, ui 27,
  observability 14, storage 21, db 24, email 25, auth 40, cli 42, **payments 45**, **app-template 58**.
  `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check` and `pnpm install --frozen-lockfile`
  all exit 0. **`payments` is 45/45 with no skip segment now the repo secret exists**, both locally and
  on CI run 34074124711.

- **TWO FLOW SPECS PASSED FOR THE WRONG REASON ON THEIR FIRST RUN, AND A THIRD CLASS WAS SWEPT AFTER.**
  The first execution was 4/6. Both failures were **races in the specs**, not bugs in the sections:
  `.innerText()` satisfies actionability against an element that already exists and never retries on
  _content_, so it read `''` while the POST was still in flight; and `page.waitForResponse().json()`
  cannot work when the page navigates on its own fetch resolving, because Chromium discards the body.
  - **The email really was sent** — confirmed in Mailpit's API afterwards. The assertion raced the app
    rather than catching anything, which is the failure mode that looks like a product bug.
  - Fixed with `expect(locator).not.toHaveText('')` and with `route.fetch()` / `route.fulfill()`
    interception, which buffers the body in the test process so the app behaves as it would unobserved.
  - **The gate-writer then swept the same class and found two more non-retrying reads that happened to
    be winning their races**, in the storage and billing specs. Generalised: **passing is not the same
    as not racing**, and a non-retrying read next to a value the page fills asynchronously is a latent
    failure whatever today's timing says.

- **`next start` IS UNSUPPORTED WITH `output: 'standalone'`, AND THE OBVIOUS FIX WAS ALSO WRONG.** Next
  16.3.3 warns verbatim: `"next start" does not work with "output: standalone" configuration.` It
  serves `.next/` while the container serves `.next/standalone/` plus two hand-copied directories —
  **different artifacts**, so guiding rule 1 was not being met. Predates this work; found by running the
  flows.
  - **The literal `node .next/standalone/server.js` fails here and passes in a generated project**,
    which is the worst possible direction. Next roots tracing at the workspace because
    `pnpm-workspace.yaml` sits above `templates/app`, so the server lands at
    **`.next/standalone/templates/app/server.js`** in this repo and at the root in a materialized
    project. Measured, not reasoned. `outputFileTracingRoot` is not an escape — the contract forbids it,
    and setting it would drop the symlinked `@hearthkit/*` packages from the traced output.
  - Fixed with `start-standalone-server.ts`: locate the emitted server across both layouts, `cpSync`
    `public/` and `.next/static` beside it, spawn it. **Orchestrator-verified**: home 200, **CSS 200**
    — the request that 404s without the copy step — health 200, and **zero** occurrences of either the
    standalone warning or `MODULE_TYPELESS_PACKAGE_JSON`.
  - The script is **CommonJS deliberately**: an ESM `.ts` entry point under a typeless `package.json`
    prints a four-line warning on every `pnpm start`, and its own advice is to add the one field the
    contract forbids because it breaks the standalone server.

- **ORCHESTRATOR ERROR WORTH RECORDING: a 500 from the new start script was the orchestrator's own bad
  environment, not the script.** A dummy `STORAGE_BUCKET="x"` failed validation, and the 500 was plan
  4.1's boot-validation property working correctly — it named the offending variable. `.next/static`
  had been copied fine. **The lesson is the one this file keeps relearning: check the log before
  attributing a failure to the thing you just changed.**

- **CI GREEN ON PR #14 WITH THE PROOF THAT MATTERS: `packages/payments test: Tests 45 passed (45)`,
  NO SKIP SEGMENT, on the branch head `3b5b7ed` (run 34055944950), after the repo secret was set.**
  All ten projects green in the same run — auth 40, cli 42, config 12, db 24, email 25,
  observability 14, storage 21, ui 27, app-template 27, **payments 45** = **277 tests, zero failed,
  zero skipped** — and `packages/payments typecheck: Done` on the runner. **PR #14 is ready to
  merge.**
  - **A RERUN LANDED ON THE WRONG COMMIT FIRST, and this is the `email` loop's trap repeating exactly.**
    The user set the secret at 19:57:56Z and reran **34055706857**, whose head is `aac3087`. But two
    docs commits sit on top of the implementation commit, so the branch head is `3b5b7ed`, covered by
    a **different** run (34055944950) that had completed at 19:46:42Z — eleven minutes **before** the
    secret existed, therefore skipping. **Rerunning a run does not move it to the head.** Fixed by
    rerunning 34055944950 specifically.
  - **Generalised, because this has now cost time twice: after any docs commit, identify the run by
    `headSha` matching `git rev-parse HEAD`, never by "the latest run" or by the run you looked at
    before.** `gh run list --json databaseId,headSha,status` is the query that answers it.

- **SUPERSEDED, kept because the failure shape is the point: the FIRST CI run was green with
  `packages/payments test: Tests 37 passed | 8 skipped (45)`.** Exit 0, every other project
  green — auth 40, cli 42, config 12, db 24, email 25, observability 14, storage 21, ui 27,
  app-template 27 — and `packages/payments typecheck: Done` confirmed on the runner. **But the 8
  live-Stripe gates skipped, because `gh secret set STRIPE_SECRET_KEY` has not been run.**
  - **This is the exact failure shape the top of this file warns about, now observed rather than
    hypothesised: a passing CI run that has not exercised the package's Stripe surface at all.** The
    workflow wiring is correct and in place; `secrets.STRIPE_SECRET_KEY` simply resolves to an empty
    string, and the contract counts empty as unset.
  - **(Resolved — see the entry above. Kept for the reasoning.)** DO NOT MERGE ON _THAT_ RUN: Set the secret, re-run CI, and require
    `packages/payments test: Tests 45 passed (45)` with **no skip segment** before merging. That line
    is the merge criterion for this PR.
  - Locally the same suite is **45/45 with 0 skipped**, so the gates and the implementation are known
    good; what is unproven is only that they run on a runner.
  - **Reading this log needed ANSI stripped first** (`perl -pe 's/\e\[[0-9;]*m//g'`), per the trap
    already recorded here — without it the `Tests` counts match nothing and a skipping suite is
    indistinguishable from one that never ran.

- **`payments` GREEN IN ONE IMPLEMENTOR ROUND, 2026-09-06. 45/45 GATES PASS WITH ZERO SKIPPED, and
  both the orchestrator's own run and the gate-runner's independent run agree.** Orchestrator-run:
  `pnpm --filter @hearthkit/payments test` **16 files, 45/45**, exit 0; `pnpm run typecheck` exit 0
  with **`packages/payments typecheck: Done` grep-confirmed** in the project list and zero `error TS`;
  `pnpm run lint` exit 0; `pnpm run format:check` exit 0; full sweep
  `pnpm --recursive --if-present run test` **exit 0, 10 projects, zero failures**.
  - Gate-runner's independent table, written to `.reports/`: **45/45 payments, 277/277 workspace-wide,
    74 test files, 0 failed, 0 skipped**, all five commands exit 0.
  - **Zero skipped is the number that matters, and it is the first time this phase has been able to
    claim it.** The gate-runner corroborated the key loaded by the skip count itself rather than by a
    printed boolean — 0 of 8 live gates skipping is only possible if the key took effect.
  - **The only implementor round needed was one.** A second was spent on nothing; the two failures
    that appeared when the key landed were a gate fixture, not the implementation.
  - Rule scan clean, orchestrator-run: **28 implementation files, zero `export *`, zero TypeScript
    `any`, 80 exports with 103 doc comments, no `console` call anywhere in the implementation**, and
    the only bare-role filename is the sanctioned `index.ts`, which is a thin named re-export.

- **`ci.yml` NOW PASSES `STRIPE_SECRET_KEY` THROUGH FROM REPO SECRETS, closing the new-service-class
  trap before it could bite.** Added to the `pnpm --recursive --if-present run test` step, with a
  comment naming the failure shape to watch for: `37 passed | 8 skipped` is a **green exit code that
  is not a passing run**. `STRIPE_WEBHOOK_SECRET` is deliberately **not** wired up, confirmed by grep
  that the gates read only `STRIPE_SECRET_KEY` from the environment
  (`test-fixtures/payments-gate-values.ts`) — signatures are verified by local HMAC, so the gates
  choose that value themselves.
  - **THE REPO SECRET IS STILL NOT SET.** Until the user runs `gh secret set STRIPE_SECRET_KEY`,
    `secrets.STRIPE_SECRET_KEY` resolves to an empty string on the runner and those 8 gates skip.
    **Check the CI count, not the exit code, on the first run of this PR.**

- **`stripe@22.6.1` WRITES AN AGENT-DIRECTED TAG TO STDERR WHEN IT DETECTS CLAUDE CODE, and it is
  benign.** `esm/stripe.core.js:137-140` tests `env?.CLAUDECODE || env?.CLAUDE_CODE_CHILD_SESSION` and
  emits `<claude-code-hint v="1" type="plugin" value="stripe@claude-plugins-official" />`, once per
  file that constructs a client — 16 lines in a local payments run. It carries no imperative content,
  appears in **zero** of this repo's own source, and will not appear on CI, which sets no such
  variable. Recorded only so a future reader does not mistake it for something this repo emits or for
  injected content in a test log.

- **THE LIVE GATES RAN FOR THE FIRST TIME AND CLOSED FIVE OF THE CONTRACT'S "STILL NOT VERIFIED"
  ITEMS BY MEASUREMENT. 43 passed / 2 failed (45), and both failures are a GATE-FIXTURE BUG, not an
  implementation bug.** Only `create-checkout-session.test.ts` failed, 2 of its 5;
  `sync-payments-catalog.test.ts` (4 live gates) and `create-customer-portal-session.test.ts` (1)
  passed outright.
  - **Settled by a passing gate rather than by argument:** Stripe **accepts a lowercase kebab-case
    custom product id**, which the contract called the one part of sync no offline measurement could
    settle and told the gate-writer to test first; `prices.list({ lookup_keys, active: true })` really
    does return an **empty list** rather than an error for an unknown key, so the `'absent-from-stripe'`
    arm is sound; **`billing_portal.sessions.create` works on this account with no saved test-mode
    portal configuration**, so the feared one-off dashboard step is not needed; a wrong-but-well-formed
    key really does answer **401**, so `payments-stripe-unauthorized` has a producer; and the
    `'replaced'` path — `prices.create({ transfer_lookup_key: true })` then archiving the old price —
    works end to end. `stripeLivemode` observed `false`.
  - **The two failures are an UNBOUND METHOD in the gate's own fixture**, at
    `test-fixtures/payments-gate-stripe-account.ts:108-114`: it extracts
    `client.checkout?.sessions?.retrieve` into a local and then calls `retrieve(id)` with no receiver,
    so `this` is `undefined` inside the SDK and it throws
    `TypeError: Cannot read properties of undefined (reading '_makeRequest')`.
  - **This is the same shape as every other trap this file collects — the obvious spelling fails in a
    way that points at the wrong thing — and it was INVISIBLE UNTIL A LIVE KEY EXISTED.** The
    `typeof retrieve !== 'function'` guard one line above passes happily, because the method does
    exist; only calling it unbound breaks. It is the strongest argument yet for the user's ruling that
    the live gates must actually run rather than be allowed to skip.
  - **It also retroactively justifies the skipped-gate warning at the top of this file.** Had the key
    never arrived, this package would have merged with two gates permanently skipped and a broken
    fixture nobody had executed.

- **CONTRACT CORRECTION ROUND 2 CLOSED BOTH GAPS WITHOUT CHANGING A SINGLE EXPORTED VALUE, so the gate
  verification survived rather than needing a re-run from scratch.** Orchestrator-checked afterwards:
  still **183 exports / 183 doc comments**, the six `ignoredReason` values unchanged, all 20 `kind`
  literals unchanged. Gates re-run against the edited contract: **37 failed / 8 skipped, exit 1**, no
  setup errors — identical to before. Every edit was prose or a comment block.

- **THE CONTRACT-AUTHOR TRIED TO OVERTURN AN ORCHESTRATOR RULING, READ THE GATES, FOUND ITS OWN
  ARGUMENT UNSATISFIABLE, AND REVERSED ITSELF — which is the behaviour this loop is supposed to
  produce.** It wanted the customer-linked webhook path to be **update-only**, making the insert branch
  unreachable and giving `billingContactEmail` exactly one writer. `handle-stripe-webhook-subscription.test.ts:111-143`
  hands a synthesised `checkout.session.completed` to the handler **with no prior
  `createCheckoutSession` call** and asserts `'a subscription checkout must leave a customer row for
its reference'`. Update-only would write nothing and fail it. Verified by the orchestrator at those
  exact lines. **That is a change to asserted behaviour, not to a label**, which is why it was dropped.

- **ORCHESTRATOR PROCESS NOTE, SECOND OF ITS KIND: the orchestrator quoted a truncated documentation
  string and the subagent caught it.** In correction round 2 the orchestrator quoted
  `CustomerDetails.email`'s doc as "The email associated with the Customer, if one exists, on the
  Checkout Session after a completed Checkout Session or at time of session expiry" and stopped there.
  **The doc has a second sentence** (`Sessions.d.ts:489`): "Otherwise, if the customer has consented to
  promotional content, this value is the most recent valid email provided by the customer on the
  Checkout form."
  - So the field is **not unconditionally a billing address** — it can be a marketing-consent address.
    Stopping after the first sentence is exactly what makes a quoted fragment look authoritative.
  - It changed the outcome rather than being a footnote: it is why the surviving rule is that the
    webhook may **seed** `billingContactEmail` on insert and **never overwrite** it on update. Both
    Stripe email fields are buyer-influenced on a page the app does not control, so an update would let
    a buyer silently redirect receipts and dunning. **No gate forces this** — the gate's row did not
    previously exist — so it is recorded in the contract's "Still not verified" as a rule the text pins
    and no test does.
  - Generalises with the earlier invented-100-character-limit note: **the orchestrator's own quoted
    evidence needs the same scrutiny it demands of subagents.** Both times the subagent was right.

- **Gap 2 settled as a RULE rather than an exception, which is the better outcome:** a default is
  allowed where absence has a **defined meaning**, and forbidden where absence means the data is
  **untrustworthy**. `SubscriptionItem.quantity` is Stripe's own optional field where absence means the
  item has no explicit quantity, so `payments_subscription.quantity` defaults to 1. `hearthkit_quantity`
  is a string this package wrote and read back, where a bad value means something went wrong in
  transit, so it counts as missing metadata and is never defaulted. Stated in both files so the next
  reader sees one rule instead of two contradictory precedents.

- **Both-null-on-insert for `billingContactEmail` lands in `payments-request-failed`**, so a completed
  checkout this package cannot record does not vanish quietly — Stripe's bounded retry then gives an
  operator a signal. **The contract-author flagged that a new `ignoredReason` would read better and did
  not take it**, per the orchestrator's instruction not to add exported values in that round. Worth
  revisiting if the branch ever acquires a gate; no gate covers it today, and it is in Still not
  verified.

- **`payments` GATES WRITTEN 2026-09-06: 45 gates in 16 files, 37 offline and 8 live-Stripe, and the
  ORCHESTRATOR RAN ALL THREE VERIFICATION RUNS ITSELF against a harness byte-identical to the
  committed files (`diff -r` clean, no implementation, no manifest — the repo's actual state).**

  | Run                                                 | Result                                | What it establishes                                           |
  | --------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- |
  | Repo state, no `STRIPE_SECRET_KEY`                  | **37 failed, 8 skipped (45)**, exit 1 | every offline gate fails for lack of implementation           |
  | Dummy `STRIPE_SECRET_KEY`                           | **45 failed, 0 skipped**, exit 1      | the 8 live gates skip **only** for the key, not a setup fault |
  | Distinguishing control (stub `index.ts` + manifest) | **44 failed, 1 passed**, exit 1       | the gates exercise the **contract**                           |
  - **The control run is the load-bearing one.** `could not load the public entry point` goes from 17
    blocks to **zero**, and the text becomes `gate expected @hearthkit/payments to export …` (34) and
    `must re-export these by name` (2). An all-fail run alone would look identical whether the gates
    were good or garbage, since nothing resolves. The single pass is the bare-node subpath gate, correct
    because the control supplies exactly the manifest it tests.
  - **The middle run is the one this repo has never done before, and it closes the skip hazard by
    measurement.** STATUS has warned since the phase opened that a skipped gate is not a passing gate.
    Running with a dummy key drives the skip count to **0**, proving the 8 skips are keyed on the
    environment variable alone rather than masking a broken fixture.
  - Zero `TypeError`, `ReferenceError`, `SyntaxError` or unhandled errors in any run — every failure is
    a deliberate gate diagnostic, not a collection or setup error.
  - Structural audit, orchestrator-run: **zero mocks** (`vi.mock`/`vi.fn`/`vi.spyOn`/`vi.stubGlobal`
    all absent from gates _and_ fixtures), **zero `beforeAll` and zero `beforeEach`** — so the no-skip
    property is structural rather than incidental — 45 `it()` blocks, 8 `skipIf`, and **exactly one**
    dynamic `import('@hearthkit/payments')`, in the entry fixture. No gate imports an implementation
    module.
  - Coverage mapped by the orchestrator rather than taken from the report: **all 9 failure kinds, all 6
    `ignoredReason` values, all 3 `webhookOutcome` values and all 3 `syncAction` values** are asserted.
  - **`pnpm --filter @hearthkit/payments test` printed `No projects matched the filters` and exited 0 —
    the SEVENTH time this repo has hit that trap.** That exit 0 is evidence of nothing, which is why
    every number above comes from the harness.

- **SATISFIABILITY IS THE ONE THING NOT ESTABLISHED, and it is a tooling limitation rather than a
  judgement call.** The `auth` gate-writer proved its gates satisfiable with a throwaway reference
  implementation; this one could not, because the ownership hook blocks `Write`/`Edit` on any path that
  is not `*.test.ts`, `test-fixtures/**` or `vitest.config.ts` — **including scratchpad paths outside
  the repo**. It reported this rather than routing around it, which was right. Consequence: the gate
  assertions have not been shown to be passable by any implementation, so an unsatisfiable gate would
  surface as an implementor round rather than here. The fixtures themselves were exercised directly
  against real Postgres, which covers the riskiest part. **Worth loosening the hook's path check to the
  repo boundary before the next package.**

- **TWO CONTRACT GAPS FOUND BY THE GATE-WRITER BUILDING AGAINST THE CONTRACT — both `NOT NULL` columns
  with no stated source, both verified by the orchestrator before being sent back.** Third loop running
  where the gate step earns its place this way (`email` four, `auth` three, now `payments` two).
  1. **`payments_customer.billingContactEmail` has no source on the webhook path.** The contract gives a
     complete column-to-source table for the purchase path and none for the customer-linked path, yet a
     subscription-mode `checkout.session.completed` upserts a row whose email column is `text NOT NULL`.
     **`customer_email` and `customer_details` appear nowhere in `CONTRACT.md`** — confirmed by grep.
     Measured and handed over: `customer_email: string | null` (`Sessions.d.ts:154`) is documented as a
     **prefill** field, while `customer_details.email` (`:146`, `:489`) is documented as populated
     "after a completed Checkout Session" — the webhook case. Both nullable, so a null rule is needed.
     Underneath it sits a second unstated question: whether that event ever **inserts** the row or only
     updates it, given `createCheckoutSession` already wrote it.
  2. **`payments_subscription.quantity` has no source**, and the only candidate is typed **optional** —
     `SubscriptionItem.quantity?: number` at `SubscriptionItems.d.ts:94`. Flagged to the contract-author
     that its earlier "a bad quantity counts as missing, never defaults to 1" ruling must **not** be
     reflexively reapplied: that rule governs caller-supplied metadata that could be wrong, whereas this
     is Stripe's own object where absence genuinely means no explicit quantity.

- **`payments` CONTRACT APPROVED 2026-09-06 after ONE correction round, at 1166 lines of `CONTRACT.md`
  and 1007 of `payments-contract.ts`, 183 exports / 183 doc comments.** Orchestrator rule scan clean:
  zero TypeScript `any` (all six `\bany\b` hits are the English word in prose), no `export *`, no
  barrel, nine unique literal error prefixes — one per failure kind. Nine failure variants where plan
  4.8 names three, the plan's three marked as such.

- **THE CONTRACT'S DECISIVE CLAIM IS THAT `@better-auth/stripe` CANNOT BE ADOPTED AT ALL, AND IT IS A
  BETTER REASON THAN THE ONE PLAN 4.8 ANTICIPATED. Verified by the orchestrator, and it is STRONGER
  than the contract-author first stated.** In `getSchema` (`dist/index.mjs:1664-1688`), `...user` is
  spread in **both** the `if (options.subscription?.enabled)` branch **and** the `else` branch, so a
  `stripeCustomerId` column lands on the `user` model **whatever options are passed** — there is no
  configuration that avoids it, which the word "unconditionally" alone did not convey.
  - `packages/auth/src` contains **zero** occurrences of `stripeCustomerId`, and
    `@better-auth/drizzle-adapter` throws `The field "<field>" does not exist in the schema for the
model "<model>". Please update your schema.` at `dist/index.mjs:124`, `:509` and `:517`.
  - So adopting the plugin means editing `@hearthkit/auth`'s tables — a package `payments` may not
    edit, whose contract forbids Stripe knowledge — plus a migration for anything deployed. **The
    one-time-purchase gap the plan asked about is real but not the load-bearing reason.**

- **ORCHESTRATOR FOUND A REAL CONTRACT DEFECT THE CONTRACT-AUTHOR MISSED: `handleStripeWebhook` read a
  field that is NEVER in a webhook payload.** The first draft resolved the purchase price from
  `Checkout.Session.line_items`. Measured at `stripe@22.6.1`,
  `esm/resources/Checkout/Sessions.d.ts:182` declares `line_items?: ApiList<LineItem>` — an **optional
  property**, and the comment at `:44` says "When **retrieving** a Checkout Session, there is an
  **includable** `line_items` property". Includable means expanded on a retrieve; a delivery does not
  carry it. `payments_purchase` requires `priceName`, `stripePriceId` and `quantity`, so the purchase
  path was unimplementable as written.
  - **Corroborated by the plugin hitting the same wall and paying the price we refused.**
    `onCheckoutSessionCompleted` calls `await client.subscriptions.retrieve(...)` at
    `dist/index.mjs:186` and resolves the plan from `subscription.items.data`, never from
    `checkoutSession.line_items`. That is the **only** `retrieve` in any of its four webhook handlers.
  - **Fixed with metadata rather than a retrieve, to protect a property worth protecting.** Three keys
    — `hearthkit_price_name`, `hearthkit_stripe_price_id`, `hearthkit_quantity` — written by
    `createCheckoutSession` on the **session**. A retrieve would have dragged every webhook gate behind
    a live Stripe key; the webhook handler is the one part of `payments` that gates fully offline.
  - **The subscription half was correct and was left alone**, and the reason it is offline **by
    construction rather than by luck** is that `SubscriptionItem.price` is typed `Price`, not
    `string | Price` (`SubscriptionItems.d.ts:90`, the only `price:` declaration in the file). So the
    full price object with its `lookup_key` is always inline. `onSubscriptionUpdated` reads
    `event.data.object.items.data` directly with no retrieve, confirming it independently.
  - **A staleness rule the contract-author derived unprompted, and no gate would have forced it:** the
    price metadata goes on the session and **never** on `subscription_data.metadata`, because a portal
    upgrade changes a subscription's price without touching metadata stamped at creation — a stamped
    `hearthkit_price_name` would go stale and then be reported as fact. The subscription path reads
    `lookup_key` live, which cannot go stale.

- **PLAN 4.8's GATE WORDING CANNOT PASS AGAINST THIS CONTRACT, and the deviation is now recorded in
  the contract rather than left for the gate-writer to trip over.** The plan says "replay a
  `checkout.session.completed` event through the webhook handler, confirm the subscription row exists".
  Under this routing that event upserts the **customer** row; subscription rows come only from
  `customer.subscription.*`. The plan's line was written before anyone measured the payload — doing
  what it literally says requires the `subscriptions.retrieve` call above. **The replacement is a
  three-event sequence** (`checkout.session.completed` → assert customer row;
  `customer.subscription.created` → assert subscription row; deliver it again → assert still exactly
  one row), all synthesised locally and signed with `generateTestHeaderString`, so it needs no key.
  **`docs/PLAN.md` is not edited by the orchestrator; this is a plan-versus-code disagreement for the
  user, like the missing `auth` row in section 6.**

- **Four contract questions ruled, and one was an ORCHESTRATOR OVERRULE OF THE SUBAGENT'S OWN
  RECOMMENDATION.** The contract-author flagged `stripeApiBaseUrl` as "the one addition most worth
  vetoing". Kept instead: `@hearthkit/storage` already makes the endpoint a first-class **environment
  variable** (`STORAGE_ENDPOINT`) so MinIO and R2 are the same code, which makes a constructor option
  strictly _less_ surface than existing precedent. Dropping it would have cost the
  `payments-stripe-unreachable` variant, which is a real first-run and outage state. The other three
  accepted as recommended: keep the SDK route, keep both env vars required, keep both read functions
  (`readPaymentsSubscription` is what plan 4.8's own gate uses to "confirm the subscription row
  exists", so it is not an addition on that line at all).

- **PLAN 4.8's BUILD-TIME QUESTION IS ANSWERED, MEASURED AGAINST A REAL INSTALL RATHER THAN DOCS: the
  Better Auth Stripe plugin covers SUBSCRIPTIONS ONLY, so one-time purchases fall to the Stripe SDK.**
  Plan section 14 lists "Better Auth 1.7 … Stripe plugin scope (subscriptions only or one-time too)"
  as a fact to confirm when the phase starts. Confirmed 2026-09-06 by installing
  `@better-auth/stripe@1.7.2` in the scratchpad and reading its `dist`.
  - **The decisive measurement is a literal count: exactly one checkout mode appears in the dist,
    `mode: "subscription"`, and there are ZERO occurrences of `mode: "payment"` or `payment_intent`.**
  - Endpoints registered: `/stripe/webhook`, `/subscription/billing-portal`, `/subscription/cancel`,
    `/subscription/list`, `/subscription/restore`, `/subscription/success`, `/subscription/upgrade`.
  - Webhook events handled, and nothing else: `checkout.session.completed`,
    `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
  - One model, `subscription`, 17 fields, `referenceId` required.
  - **It has NO catalog sync of any kind**, so `syncPaymentsCatalog` and `hearthkit payments sync` are
    entirely ours on the Stripe SDK. Plan 4.8 pre-authorized the fallback, so this needs no ruling.
  - **Org-scoped billing IS supported by the plugin** via the required `referenceId` field plus an
    `authorizeReference` option hook. That is the mechanism by which billing scope follows auth's
    `organizations` flag, so plan 4.8's note holds without inventing anything.

- **THE VERSION THAT MATCHES OUR PIN IS `@better-auth/stripe@1.7.2`, AND `latest` WOULD SILENTLY NOT
  FIT.** `latest` is 1.7.3 and peers on `better-auth: ^1.7.3`, against our `better-auth@1.7.2` pin.
  1.7.2's peer set is `stripe: ^18 || ^19 || ^20 || ^21 || ^22`, `better-auth: ^1.7.2`,
  `@better-auth/core: ^1.7.2`, and **`better-call: 1.4.0` — an EXACT pin**, which is a live conflict
  hazard with whatever `better-auth` itself resolves for `better-call`. Also confirmed:
  **`better-auth@1.7.2` ships no stripe plugin at all** — its `exports` map has no `./plugins/stripe`,
  so the separate package is not optional indirection the way `@better-auth/drizzle-adapter` was.
  `stripe` SDK latest is `22.6.1`, inside the peer range.

- **WEBHOOK SIGNATURE VERIFICATION IS FULLY OFFLINE, so the whole "webhook signature mismatch" failure
  mode of plan 4.8 is gateable with no network and no Stripe account.** Measured against
  `stripe@22.6.1`: `stripe.webhooks.generateTestHeaderString({payload, secret})` and
  `stripe.webhooks.constructEvent(payload, header, secret)` complete a round trip with a
  **gate-chosen** secret, and a wrong secret throws `StripeSignatureVerificationError`, message
  beginning `No signatures found matching the expected signature for payload`.
  - **Consequence worth more than the fix: `STRIPE_WEBHOOK_SECRET` is a value the gates pick, not one
    Stripe issues.** So the user only ever needs to supply `STRIPE_SECRET_KEY`, and the webhook gates
    are deterministic rather than dependent on a `stripe listen` session.

- **Local environment measured before the loop started:** `STRIPE_SECRET_KEY` **not set**, no `.env`
  at the repo root, and **`gh secret list` empty**. The Stripe CLI **is** installed (1.50.10) and
  authenticated to a real account (`acct_1AUMcqLSC1xluFh7`). `.gitignore` already covers `.env` and
  `.env.local`, so there is a safe local home for the key. `ci.yml` currently uses `env:` only for the
  Postgres service container and references no secret.

- **POST-AUTH AUDIT FOUND A REAL GAP OF THE SAME CLASS AS THE STORAGE-BUCKET ONE: a project depending
  on `@hearthkit/auth` gets ZERO local infra services.** Found by auditing for unfinished work after
  PR #13 went green, not by a failing test. `localInfraServiceByHearthkitPackage` in the `cli`
  contract mapped `db`→postgres, `storage`→minio, `email`→mailpit and **had no `auth` entry**, while
  `readInfraServicesFromDependencies` reads the project's **direct** dependencies only and never walks
  transitive ones (`read-project-infra-manifest.ts:83-95`). So `hearthkit dev infra up` starts nothing
  for such a project, succeeds with an empty service list, and auth then fails at runtime with a
  connection error that points nowhere near the manifest.
  - **The plan is incomplete here, not just the code.** `docs/PLAN.md` section 6's table has three
    rows and **no `auth` row**. Its implicit model is that leaf packages pull services and that Phase
    6's `create` does "dependency resolution", which would add `db` and `email` to a project selecting
    `auth`. That may be the intent, but nothing enforces it today. **Raised with the user; `PLAN.md`
    deliberately not edited by the orchestrator.**
  - Fixed by making the map **one-to-many** and renaming it to `localInfraServicesByHearthkitPackage`:
    `auth` → `['postgres', 'mailpit']`. Robust either way — if `create` does add the leaf packages
    directly the entry is redundant and harmless, because duplicates collapse.
  - **Three alternatives run down and rejected by the contract-author**, recorded so nobody re-derives
    them: a second key for `auth` is impossible (object keys are unique); making `create` add the
    leaf packages fixes only manifests `create` wrote, does not exist yet, and puts the knowledge in
    something that runs once at scaffold time rather than on every `dev infra up`; and walking
    transitive dependencies is correct in principle but would make a pure derivation depend on an
    installed `node_modules`, so `dev infra up` would behave differently before and after
    `pnpm install`. Left open as a resolver that could replace the map without changing a signature.
  - **The rename was an orchestrator override.** The contract-author wanted to keep the singular name,
    arguing a rename turns one breaking change into two. It does not: every consumer must already
    adapt to `'postgres'` → `['postgres']`, so updating the identifier on the same line is free, while
    a public name saying _one service per package_ when it means several is a permanent inaccuracy.
    Blast radius verified first — two readers, `index.ts:53` and `read-project-infra-manifest.ts`,
    and **no cli gate asserts the export list by name**, unlike `storage` and `email`.
  - **The shape change was confirmed to bite before any gate was written:**
    `pnpm --filter @hearthkit/cli run typecheck` now fails at `read-project-infra-manifest.ts:92` with
    `TS2345: Argument of type 'string' is not assignable to …`. The repo is knowingly broken there
    until the implementor lands the `flatMap`.

- **The `auth` contract's "Still not verified" section had gone STALE IN FIVE PLACES, describing the
  pre-implementation state after the package shipped.** A reader — most likely the `payments`
  contract-author — would have inherited all five as current. Rewritten in place with evidence rather
  than shrunk, because the section's value is that it is where a reader looks for what is _not_
  covered. Closed: the no-manifest claim (`packages/auth typecheck: Done` now grep-checked locally and
  on CI), the run-Prettier instruction (`format:check` exit 0), `authBrowserClientSchema` never parsed
  against a real client (a gate now does), the 404/401 measured only at the handler (a gate now drives
  the real client through a loopback listener), and — found by the contract-author, not the audit —
  whether either half of that gate needs a reachable database (it does not; both instances use a
  Drizzle client aimed at a closed port). `auth-contract.ts` was **not** touched, so nothing verified
  was invalidated.
  - **The drizzle peer-suffix pin was rewritten rather than corrected.** It named the literal
    `…(@types/pg@8.23.1)(pg@8.23.0)`, which installing `auth` changed to
    `…(@types/pg@8.23.1)(kysely@0.29.5)(pg@8.23.0)` because `better-auth` brings `kysely`. **Naming an
    exact peer suffix in a contract is fragile by construction** — `payments` will change it again —
    so the durable facts now carry the weight: `@types/pg` must be declared, and the check is that the
    two packages' `drizzle-orm` resolve to the same real path.

- **CI GREEN ON PR #13 (run 33835915997), and the proof that matters is that the new gates RAN on the
  runner rather than being skipped: `packages/auth test: Test Files 12 passed (12), Tests 40 passed
(40)`.** All nine projects green in the same run — config 12, ui 27, observability 14, storage 21,
  db 24, email 25, app-template 27, **auth 40**, cli 39 = **229 tests, zero failed, zero skipped** —
  and `packages/auth typecheck: Done` on the runner too.
  - **`packages/email test: 25 passed (25)` in the SAME CI run as auth's 40 is the load-bearing line.**
    It proves the own-Mailpit-container decision holds on a runner and not merely on this machine,
    which is the half that local runs cannot establish. `packages/cli test: 39 passed (39)` confirms no
    port regression from the container the auth suite starts.
  - The auth gates start a Docker container on the runner successfully with **no change to `ci.yml`**,
    which was the design goal: self-sufficient on any runner that has Docker.
  - **Reading the CI log needs ANSI stripped first.** `gh run view --log` embeds escape sequences
    _between_ `Tests` and the count, so a plain `rg "Tests +[0-9]+ passed"` matches nothing and looks
    exactly like a suite that never ran. Pipe through `perl -pe 's/\e\[[0-9;]*m//g'` first. Recorded
    because the false negative is indistinguishable from the real failure it would be reporting.

- **`auth` IMPLEMENTED AND GREEN IN ONE IMPLEMENTOR ROUND, 2026-09-03.** Orchestrator-run, not taken
  from the subagent: `pnpm --filter @hearthkit/auth test` **12 files, 40/40 passed**, exit 0;
  `pnpm --recursive --if-present run test` exit 0 — **9 projects, 229 tests, 0 skipped** (config 12,
  ui 27, observability 14, storage 21, db 24, email 25, app-template 27, **auth 40**, cli 39);
  `pnpm run typecheck`, `pnpm install --frozen-lockfile` and `pnpm run format:check` all exit 0.
  A second implementor round was spent on one missing doc comment only.
  - **`packages/auth typecheck: Done` genuinely appears in the project list, checked by grep rather
    than inferred from exit 0.** That trap has now caught this repo six times; the manifest closes it.
  - **`email` is 25/25 in the SAME sweep as `auth` 40/40, which is the proof the Mailpit isolation
    decision was right.** The two suites run in parallel against different containers and neither
    disturbs the other — exactly the collision measured earlier in this loop.
  - **The drizzle single-copy risk is closed and verified:** both `packages/auth/node_modules/
drizzle-orm` and `packages/db/node_modules/drizzle-orm` resolve to the identical real path. The
    peer suffix has **changed** from what the contract records, to
    `…(@types/pg@8.23.1)(kysely@0.29.5)(pg@8.23.0)` — `better-auth` brings `kysely`, which drizzle
    declares an optional peer. **The contract's literal suffix string is therefore stale, though its
    conclusion is not.** The lesson is not to update the string: naming an exact peer suffix in a
    contract is fragile by construction, because the next package added to the workspace will change
    it again. `@types/pg` being load-bearing is the durable fact; the suffix is not.
  - Rule scan clean, orchestrator-run: no `export *`, no barrel, no `any`, no bare-role filenames
    beyond the sanctioned `index.ts`, 23 implementation files. **Exactly one lint warning in the whole
    implementation** — a documented `as unknown as AuthBrowserClient` — against a 72-warning
    pre-existing repo baseline.
  - **Best judgement call of the round, and no gate forced it:** `databaseFailureDetail` is built from
    the `.cause`, not from the `DrizzleQueryError` wrapper, because the wrapper's message repeats the
    failing SQL **and its bound parameters** — which would put caller-supplied values into a returned
    failure that the gates sweep for secrets. Reasoned from the contract's rule rather than from a
    failing test.
  - Other implementor judgement calls accepted: `returnHeaders: true` over `asResponse: true`
    uniformly, because it keeps failures _thrown_, which is what the `error.body?.code` and
    `error.headers.get('location')` access paths are specified against; a `WeakMap` keyed on the
    instance to carry the magic-link send outcome, since Better Auth answers `{status: true}`
    regardless of what `sendMagicLink` did (`AsyncLocalStorage` rejected to keep `node:async_hooks`
    out of an entry point a client component imports) — **consequence: an instance not built by
    `createAuthServerInstance` gets `auth-request-failed` from `requestMagicLinkSignIn`, and no gate
    covers that path**; nameless Drizzle columns so every SQL name equals its Better Auth field name;
    and the organizations-disabled check running before input validation, because telling a caller
    their slug is malformed when the instance has no organization endpoints is the worse diagnostic.

- **`auth` GATES APPROVED 2026-09-03 at 40 gates, ORCHESTRATOR-VERIFIED FAILING 40/40 FROM THE
  COMMITTED FILES, with the distinguishing control run separately.** Harness rebuilt by copying the
  final committed files (`diff -r` clean, byte-identical), no implementation, no manifest.
  - Repo state: **12 files failed, 40/40 gates failed, 0 skipped**, exit 1. No `AssertionError`,
    `TypeError`, `ReferenceError` or `SyntaxError` from setup — every failure a gate diagnostic
    (34 "could not load the public entry point", 2 "expected a package manifest").
  - **Distinguishing control** (stub `index.ts` exporting one unrelated value, plus a manifest):
    **39 failed, 1 passed, 0 skipped**, and the failure text _changed_ to
    `gate expected @hearthkit/auth to export …` (32) and `must re-export these by name` (2). **This is
    the run that proves the gates exercise the contract**; the all-fail run alone would look identical
    whether the gates were good or garbage, since nothing resolves. The single pass is the
    manifest/subpath gate, correct because the control supplies exactly the manifest it tests.
  - The re-export list reads **100** contract values, up one from 99 — matching the
    `betterAuthOrganizationAlreadyExistsHttpStatus` added in the last contract round, so the derived
    list tracks the contract rather than being hand-maintained.
  - Contract final at **166 exports / 166 doc comments**, isolated typecheck exit 0, `format:check`
    exit 0. Five correction rounds total, every one driven by a measurement rather than an opinion.

- **A MISSING `@types/pg` WOULD HAVE BROKEN THE IMPLEMENTOR, and it is invisible in the dependency
  list it is missing from.** Found by the gate-writer typechecking the gates, confirmed by the
  orchestrator in the repo: `packages/db` devDepends on **both** `pg@8.23.0` and `@types/pg@8.23.1`,
  and `pnpm-lock.yaml` holds exactly **one** peer-suffixed resolution,
  `drizzle-orm@0.45.2(@opentelemetry/api@1.9.1)(@types/pg@8.23.1)(pg@8.23.0)`. The contract's dev list
  for `auth` named `pg` and **not** `@types/pg`.
  - Written verbatim, `auth` resolves a drizzle-orm with a **different peer suffix**, pnpm materialises
    a **second physical copy**, and `@hearthkit/db`'s client stops being assignable to
    `@hearthkit/auth`'s `drizzleClient`. **Not a soft mismatch a cast could hide**: `PgSession.dialect`
    is `protected`, so the declarations are structurally incompatible and TypeScript refuses outright —
    `TS2322 … Property 'dialect' is protected but type 'PgSession<…>' is not a class derived from
'PgSession<…>'`, reproduced.
  - **The diagnostic points at Drizzle, not at the dependency list**, which is what makes it expensive:
    an implementor would debug the client type rather than the manifest. The contract now says why the
    `@types` package is there, so nobody prunes it later as unused.

- **FOURTH INSTANCE OF THIS PACKAGE'S RECURRING SHAPE — the obvious spelling returns a WRONG ANSWER
  rather than an error.** `createAuthClient` binds its fetch implementation at **construction time**
  (`customFetchImpl: fetch` into `createFetch`), so a gate that assigns `globalThis.fetch` _after_
  building its client silently keeps the real one and makes real network requests. The gate-writer's
  first probe did exactly that, and something on the machine answered `http://localhost:3000` with a
  full Next.js page — **the gate would have been asserting against a stranger**, and on CI it would
  have been `ECONNREFUSED` instead. Joins `error.code`, `error.headers.location` and the decoy error
  constants. The gates use a real loopback listener, which has no ordering hazard.
  - Trap recorded in the gate: **never assert `statusText` here.** The same 401 reads `UNAUTHORIZED`
    from a fetch stub and `Unauthorized` once Node's HTTP server has written it. Only `status` is
    stable.

- **`auth` GATES WRITTEN 2026-09-03: 40 gates in 12 files (was 38; the browser-client file went 1 → 3
  after the Proxy finding), ORCHESTRATOR-VERIFIED FAILING with
  ZERO SKIPPED**, against a harness built by copying the committed files (`diff -r` clean, no
  implementation, no manifest — the repo's actual state). No `AssertionError`, `TypeError`,
  `ReferenceError` or `SyntaxError` anywhere in the output, so no collection or setup errors: every
  failure is a deliberate gate diagnostic (34 "could not load the public entry point", 2 "expected a
  package manifest").
  - **The old single browser-client gate held six assertions and EVERY ONE WAS VACUOUS** under the
    Proxy finding — zero coverage in the shape of coverage. Replaced by three: one non-vacuous root
    check, one that **pins the vacuity itself** (it fails if a release stops proxying or if anyone
    wraps the client), and the relocated network-boundary pair. Structurally audited by the
    orchestrator afterwards: 40 `it()` blocks across 12 files, 0 mocks, exactly one dynamic
    `import('@hearthkit/auth')`, and **zero `beforeAll` in any gate file**, which is what keeps the
    no-skip property structural rather than incidental.
  - **`pnpm --filter @hearthkit/auth test` prints `No projects matched the filters` and exits 0 — the
    SIXTH time this repo has hit that trap.** That exit 0 is evidence of nothing.
  - **The distinguishing control was run by the orchestrator, because an all-fail run proves almost
    nothing on its own.** With a resolvable stub `index.ts` exporting one unrelated value plus a
    manifest: **37 failed, 1 passed**, and the failure text _changed_ from "could not load the public
    entry point" to `gate expected @hearthkit/auth to export resolveAuthRuntimeConfig` and `src/index.ts
must re-export these by name`. So the gates exercise the contract rather than merely failing to
    resolve it. The single pass is the bare-node subpath gate, which is correct — the control handed it
    exactly the manifest it tests. Reconciles with 38/38 in the repo, where no manifest exists.
  - Import discipline audited, not taken on trust: the only route into the package is one dynamic
    `import('@hearthkit/auth')` in `test-fixtures/hearthkit-auth-entry.ts`. Gate files import only
    `./auth-contract.ts`, `../test-fixtures/*`, `vitest`, node builtins, `zod`, `pg`, `drizzle-orm`,
    `@hearthkit/db`, `@hearthkit/config`, `@hearthkit/email/email-contract`, and `better-auth/db` +
    `better-auth/plugins` for the conformance gate. **No implementation module.**
  - **Zero mocks** — `vi.mock`, `vi.fn`, `vi.spyOn` all return 0 hits. The sanctioned Resend-style
    exemption went unused again.
  - Gate-writer judgement calls accepted: Mailpit via bare `docker run --rm` on the default bridge
    rather than a compose project, because `cli`'s fixtures show the compose _network_ is the part that
    leaks; DDL built from `hearthkitAuthDrizzleSchema` via `getTableConfig` with columns, not-null,
    primary and unique but deliberately **no** foreign keys, indexes or defaults (measured sufficient);
    rows read through Drizzle rather than raw SQL, since the contract leaves SQL column naming to the
    app — the reference run used snake_case on purpose to prove it; and **a lazy per-file context
    instead of `beforeAll`, because a throwing `beforeAll` makes Vitest report every test in the file
    as SKIPPED, and a skipped gate is not a failing gate** (the first draft reported "12 files failed,
    29 skipped").
  - It also proved the gates _satisfiable_, beyond what was asked: a throwaway reference implementation
    in the harness only reached **38/38 passing in ~20 s**. And it proved the Mailpit isolation works —
    auth and `email` suites started two seconds apart both went green, 38/38 and 25/25.

- **THREE CONTRACT DEFECTS FOUND BY BUILDING AGAINST IT, all measured by the orchestrator rather than
  taken from the report, and ONE IS A HARD BLOCKER.** This is the gate step doing its job — the same
  pattern as the `email` loop, where the gate-writer found four contract gaps.
  1. **`authBrowserClientSchema` REJECTS THE VALUE ITS OWN FUNCTION IS SPECIFIED TO RETURN.**
     `createAuthClient` returns a **Proxy whose target is a function**, so measured against the real
     client: `typeof client` is `'function'` not `'object'` (fails the schema's first check),
     `typeof client.signIn` is `'function'` not `'object'`, and `typeof client.signUp` likewise.
     **`authBrowserClientSchema.safeParse(realClient).success` is `false`**; only the `useSession`
     check passes. The implementor cannot both return a Better Auth client and satisfy the schema.
     **The gate-writer reported this as one wrong check; it is three** — it missed the root
     `typeof value === 'object'`.
  2. **The browser client cannot observe the organizations flag at all.** The contract says
     `organization` is present only when the flag is on and "that presence-or-absence is the flag's
     observable effect on the client and it is what a gate asserts". Measured: the client is a blanket
     Proxy — with the plugin **absent**, `typeof client.organization` is `'function'`,
     `typeof client.organization.create` is `'function'`, and even
     `typeof client.definitelyNotAPlugin` is `'function'`. `'organization' in client` is **`false` in
     both** configurations. There is no client-side distinction to assert.
     - **USER DECISION 2026-09-03: keep the contract's intent and relocate where the effect is
       observed — assert it at the NETWORK BOUNDARY.** Building the browser client with the flag off
       and routing its `organization` call through a server instance built with the flag off fails,
       because the server has no such endpoint. The client carries `organization` in both modes and
       that cannot be changed; the failure surfaces when the call reaches a server with no such route,
       not when the property is read.
     - Two alternatives were put to the user and rejected: narrowing the promise and deleting the gate
       (loses a real assertion, makes the client-side flag decorative), and wrapping the client so
       `organization` is genuinely absent (adds public surface and the returned value stops being a
       plain Better Auth client, which would surprise app authors).
     - **Corollary worth more than the fix: every property check on this Proxy is vacuous.**
       `typeof client.useSession === 'function'` would pass against a client with no `useSession` at
       all, because `typeof client.definitelyNotAPlugin` is also `'function'`. The only non-vacuous
       assertion is on the root value. Recorded in the contract so nobody "hardens"
       `authBrowserClientSchema` with checks that assert nothing.
  3. **`SLUG_TAKEN` DOES NOT EXIST.** The contract illustrates `auth-request-failed` with
     `authErrorCode: 'SLUG_TAKEN'`. It appears **zero times** in `better-auth`'s dist. The real code
     for a slug collision is `ORGANIZATION_ALREADY_EXISTS` at HTTP 400, which the orchestrator had
     already seen in `$ERROR_CODES` during the earlier probe. A gate asserting the contract's value
     would have failed against every correct implementation.

- **The network-boundary gate needs NO reachable database, measured.** With the Drizzle adapter
  pointed at a dead port, the flag-off instance still returns **404** and the flag-on instance still
  returns **401** — route resolution and the session check both happen before any query. So that gate
  is database-free: faster, and it cannot flake on database setup. Answers the contract-author's two
  open questions in one probe.

- **THE NETWORK-BOUNDARY MEASUREMENT THAT MAKES THE USER'S RULING GATEABLE, and it comes with its own
  negative control.** Same POST to `/api/auth/organization/create` handed to
  `authServerInstance.handler(request)`:

  | Server instance                          | Status  | Body  |
  | ---------------------------------------- | ------- | ----- |
  | built with `organizationsEnabled: false` | **404** | empty |
  | built with `organizationsEnabled: true`  | **401** | empty |

  **The 401 is the load-bearing half.** The same request with no session on it returns 401 from the
  flag-on instance, which proves the route _exists_ and was rejected for want of a session rather than
  for want of a route — so the 404 means "no such endpoint" and not "typo in the path". A gate
  asserting only the 404 could be satisfied by a misspelled URL. Same argument as the STARTTLS and
  presign gates.

- **`ORGANIZATION_ALREADY_EXISTS` CONFIRMED AS THE SLUG-COLLISION CODE (HTTP 400, message
  `Organization already exists`, `body` present) — AND THE DECOY IS ONE LINE AWAY.** Both
  `ORGANIZATION_ALREADY_EXISTS` and `ORGANIZATION_SLUG_ALREADY_TAKEN` exist at the tag as adjacent
  `$ERROR_CODES` entries; only the first is thrown. **Third time this package has been bitten by that
  shape** — `USER_ALREADY_EXISTS` vs `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, the fabricated
  `SLUG_TAKEN`, and now this. Naming the decoy in the contract is what stops the fourth. **Generalised
  rule for this library: never take an error-code constant from documentation or memory — read it off
  a thrown error, because the enum reliably contains a plausible near-miss.**

- **`error.body` IS `undefined` ON AT LEAST ONE PATH, so `error.body?.code` is required rather than
  stylistic — a correction ON THE ORCHESTRATOR'S OWN TEXT, caught by the contract-author.** Correction
  round 1 said `error.body` "carries exactly `{ message, code }`". Measured on more paths since: the
  `createOrganization`-with-headers 401 carries `body === undefined`, so `error.body.code` throws a
  `TypeError` and breaks the package's "never throws" promise on that path. The original claim was
  measured only on the cases probed at the time and is false in general.

- **IMPLEMENTOR INSTRUCTION, measured, that no contract sentence implies: `packages/auth/package.json`
  must carry `next@16.3.3` in devDependencies or the gates cannot pass.** The contract lists `next` as
  an optional peer and claims `nextCookies()` "swallows the failure when `cookies()` is called outside
  a request scope". At the pin the plugin's hook swallows only errors whose message starts with
  `` `cookies` was called outside a request scope. `` or includes `Cannot find module`. With `next`
  absent, Node's ESM resolver says `Cannot find package 'next' imported from …`, which matches
  **neither**, so the error is rethrown and every cookie-setting call fails. Sign-up, sign-in and
  magic-link verification all returned `auth-request-failed` until `next@16.3.3` was installed. It
  stays an optional peer for consumers.

- **Two measured hazards for the implementor, neither a contract defect.** Server-side `api` calls
  disagree about `headers`: `signInMagicLink` and `magicLinkVerify` **require** one (`APIError` 400
  `VALIDATION_ERROR`, `Headers is required`, without it — the orchestrator hit this too), while
  `createOrganization` must be called **without** one (passing `new Headers()` gives `UNAUTHORIZED`
  401 with `body: undefined` and an empty message, which reads like a bug in your own code).
  `addMember` tolerates either. And **verifying a magic link for a user who already has a password
  deletes that user's `account` rows** at this pin, so password sign-in for them fails afterwards;
  reproduced twice. The gates never mix the two paths on one user.

- **`auth` GATES MUST NOT SHARE THE REPO'S MAILPIT, AND THIS WAS PROVEN BEFORE THE GATES WERE
  COMMISSIONED RATHER THAN DISCOVERED IN CI.** `email`'s gates call `clearMailpitInbox()` —
  `DELETE /api/v1/messages`, which wipes **every** message in the container, not just its own — in a
  `beforeEach`, and make **nine** assertions on the exact total message count. The recursive sweep
  runs projects **in parallel** (measured: storage, email, observability and db all started within
  one second of each other). `auth` would be sending magic-link mail into the same container.
  - **Demonstrated, not reasoned about.** With a second process sending one message into Mailpit
    every 250 ms — exactly what an `auth` suite looks like from outside —
    `pnpm --filter @hearthkit/email test` went **25/25 → 23/25, two failures, exit 1**:
    `delivers the magic link to Mailpit with the same subject and both body parts` and
    `returns email-transport-rejected … when the server refuses the recipient`.
  - **Negative control run immediately after, same command, intruder stopped: 25/25, exit 0.** So the
    failures were caused by the second suite and nothing else. It breaks in **both** directions —
    `email`'s `beforeEach` DELETE would equally wipe an `auth` message before `auth` could read it.
  - **Same class as the port collision one loop ago**, and the third shared-resource collision in this
    phase: compose lacked a service CI needed (PR #10), then compose held ports another package's
    gates published (`email` loop), now a container's _contents_ are shared mutable state across
    packages. **Generalised: a service in the repo compose is shared mutable state, and any gate that
    clears or counts its whole contents cannot coexist with another package's gates.**
  - **Ruled: `auth` gates start their own Mailpit on reserved ports**, following the precedent this
    file already endorses for the `cli` bucket gates — "they start their own compose stack on reserved
    ports rather than borrowing the repo's MinIO, so they are self-sufficient on a runner that only
    has Docker". Helpers exist: `reserveFreeHostPort` and `gate-compose-project-runs.ts` in
    `packages/cli/test-fixtures/`. Postgres is still borrowed from compose, which is safe because
    `auth` creates its own scratch **database** per run — isolation is already per-database there.
  - Bonus: this touches neither `docker-compose.yml` nor `ci.yml`, so the new-service trap that failed
    PR #10 has nothing to bite on.

- **ORCHESTRATOR PROCESS NOTE: an invented constraint made a file worse, and the subagent was right to
  push back rather than comply.** While closing two doc comments the orchestrator told the
  contract-author to "keep them under 100 characters". That ceiling exists nowhere in the repo.
  Measured after the subagent challenged it: `auth-contract.ts` doc comments run 38 to 135 characters
  with a **median of 114, and 120 of 162 exceed 100**; the eight sibling prefix constants run 111 to
  129; `email-contract.ts` has **67 of 84** over 100 and `storage-contract.ts` **51 of 67**. Prettier
  passes all of them because it does not reflow comments.
  - The cost was real: to fit 100 characters the agent had to drop "of the failure message" from the
    stem, making line 30 **the only one of nine prefix constants** not matching the shared phrasing —
    breaking a grep target that `CLAUDE.md`'s discoverability rule exists to protect. Reversed.
  - **The generalisable rule: check the file before imposing a style number on it.** `format:check`
    passing is not evidence a self-imposed limit is the convention, because Prettier never touches
    comment interiors. Two of the three ruling errors this session were the orchestrator asserting a
    norm it had not measured; the other was rewrapping, caught the same way.

- **THE SHARPEST EDGE IN THE `auth` CONTRACT, found by the contract-author reading upstream source
  and then MEASURED at the 1.7.2 pin by the orchestrator: `auth-email-already-registered` has a
  producer ONLY because of two defaults this package happens to keep.** Upstream `sign-up.ts`
  computes `shouldReturnGenericDuplicateResponse = requireEmailVerification || autoSignIn === false`
  and returns a generic success instead of throwing when it holds. All three configurations run:

  | `emailAndPassword` config         | Duplicate sign-up                                    |
  | --------------------------------- | ---------------------------------------------------- |
  | default (what this package ships) | **THREW** `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`    |
  | `autoSignIn: false`               | **NO THROW** — returned `{token: null, user: {...}}` |
  | `requireEmailVerification: true`  | **NO THROW** — returned `{token: null, user: {...}}` |
  - **The generic response is indistinguishable from a real sign-up** — same shape, populated `user`,
    `token: null`. The duplicate is not reported differently, it is not reported at all.
  - **Enabling `requireEmailVerification` deletes the variant's only producer and breaks its gate**,
    and so does `autoSignIn: false` — the one nobody would think to check. Both are named in the
    contract's out-of-scope bullet.
  - Upstream does this deliberately: suppressing the throw stops the sign-up endpoint being a
    user-enumeration oracle. So enabling verification trades a named failure for a security property.
    Recorded so nobody "fixes" it back.

- **The magic-link 302 throw DOES carry the location header, so `asResponse: true` is a choice rather
  than a requirement.** Caught from `magicLinkVerify` with a bad token and no `asResponse`: a plain
  `Error`, `isAPIError: false`, `statusCode: 302`, own keys `[status, body, headers, statusCode,
name]`, `headers` a real `Headers` instance, and **`e.headers.get('location')` returns
  `http://localhost:3000/dash?error=INVALID_TOKEN`** while **`e.headers.location` is `undefined`**.
  Same shape of trap as `error.code` vs `error.body.code` — the value is only reachable through the
  accessor. Closed a gap the contract-author flagged as possibly costing an implementor round.

- **`auth-database-unavailable` WIDENED from two Postgres codes to four, because the contract-author's
  rule was right but the fact under it had stopped being true.** It had limited the variant to
  `42P01` and `ECONNREFUSED` on the stated grounds that no gate could produce another code. Both of
  these were then produced with nothing but a different connection string: a database that does not
  exist gives `DatabaseError` `code: '3D000'`, and a wrong password gives `code: '28P01'`. Both are
  the same operator-fix class, both are ordinary wrong-`DATABASE_URL` first-run states, and both are
  **cheaper to gate than either original producer** — no dead port, no dropped table.
  - Ruled an **explicit four-code allowlist** (`ECONNREFUSED`, `42P01`, `3D000`, `28P01`), not "any
    cause carrying a code": the general form would swallow a `23505` unique violation, which is a
    caller error rather than an unavailable database, and the organization slug path can produce one
    under a race. Everything outside the four stays in `auth-request-failed`.

- **BETTER AUTH 1.7.2 PROBED DIRECTLY BY THE ORCHESTRATOR, 2026-09-03, against a real install plus
  real Postgres and real Drizzle tables. Most of the contract held; FIVE claims did not, and TWO of
  the contract-author's questions rested on a false premise.** Probe lives in the scratchpad, not the
  repo. Sent back as correction round 1.

  **Confirmed, so nobody re-derives them:**
  - The magic-link failure signal **is** a redirect. Bad token with a `callbackURL` → **302**,
    `location: …/dash?error=INVALID_TOKEN`. It throws an `Error` with `statusCode: 302`, empty
    message, `instanceof APIError === false`, **no code anywhere**.
  - **Unknown, consumed and expired tokens are genuinely indistinguishable** — all three give the
    identical 302/no-code/empty-message. So one variant covering all three is honest, not lazy.
    `TOKEN_EXPIRED` exists in `$ERROR_CODES` but magic-link never emits it.
  - Valid verify with no `callbackURL` → 200 JSON `{token, user, session}` plus a `set-cookie`.
  - `INVALID_EMAIL_OR_PASSWORD` / HTTP 401 for **both** a wrong password and an unknown email.
  - Org endpoints are structurally absent without the plugin: `typeof api.createOrganization` is
    `'function'` with it, `'undefined'` without. Structural detection works.
  - `getAuthTables()` for the pinned version returns exactly seven tables — `user, session, account,
verification, organization, member, invitation` — with `session.activeOrganizationId` present and
    **`account.issuer` required**.
  - `autoSignIn` is **on by default**: `signUpEmail` returned a token and a `set-cookie`.

  **Wrong, and the first is a live defect:**
  - **THE SIGN-UP ERROR CODE IS `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` (HTTP 422), NOT
    `USER_ALREADY_EXISTS`.** The contract encoded the wrong one at `auth-contract.ts:55`. **Both
    constants exist in `$ERROR_CODES` as distinct entries**, so a reader checking the library would
    have confirmed the wrong answer. An exact match never fires and every duplicate sign-up would
    land in the catch-all with its own gate failing. **Mirror of the `19000:9000` `String.includes`
    defect already recorded below**, in the opposite direction: here a sloppy _substring_ match would
    accidentally work and an exact one fails. The contract now pins the exact code and says the match
    is equality, so nobody "fixes" it into a substring test.
  - **The magic link URL ALWAYS carries two parameters.** With no `callbackUrl` supplied the link is
    `…/magic-link/verify?token=<…>&callbackURL=%2F` — `callbackURL` is always appended, defaulting to
    `%2F`. The contract said "plus `&callbackURL=…` when supplied". **This makes the repo's existing
    `textBody`-extraction rule unconditional rather than a precaution**, which is why it matters: as
    written it implied a single-parameter link exists, and a single-parameter URL _does_ survive
    React Email's escaping verbatim in `htmlBody`. A gate written against the old sentence would have
    passed for the wrong reason and rotted.
  - **The error code lives at `error.body.code`. `error.code` is `undefined`.** `error.body` is
    exactly `{message, code}`; `error.statusCode` is the number and `error.status` the string name
    (`'UNAUTHORIZED'`, `'UNPROCESSABLE_ENTITY'`). An implementation reading `error.code` gets
    `undefined` for every case and routes everything to the catch-all — total and invisible.
  - **Database failures arrive as raw Drizzle errors with the code exactly one `.cause` hop down**,
    never as an `APIError`. Dead port → `DrizzleQueryError` (**no code**) → cause `AggregateError`
    `code: 'ECONNREFUSED'`. Tables absent → `DrizzleQueryError` (**no code**) → cause `DatabaseError`
    `code: '42P01'`, `relation "user" does not exist`. So the implementation must handle two
    unrelated error families from one call, and a top-level code check finds nothing.
  - `activeTeamId` is added **only when teams are enabled**; with the shipped configuration `session`
    gains `activeOrganizationId` alone. Also: **`drizzleAdapter` requires the `schema` option** —
    omitting it throws `BetterAuthError: … The model "user" was not found in the schema object.`

  **BOTH TOOLING QUESTIONS REJECTED ON MEASURED FACTS, and the replacement is better than either
  option offered.**
  - **`npx @better-auth/cli generate` CANNOT RUN AT OUR PIN.** `npx @better-auth/cli@1.7.2` fails
    `ETARGET: No matching version found`. **`@better-auth/cli`'s latest is 1.4.21** — three minors
    behind `better-auth@1.7.2` — and **`better-auth@1.7.2` ships no `bin` at all**. A 1.4.21 CLI is
    precisely what would miss the 1.7 `issuer` column the suggestion existed to protect against.
  - **`drizzle-kit` is not needed either.** `getTableConfig` from `drizzle-orm/pg-core` is public and
    returns each column's `name`, `getSQLType()`, `notNull` and `primary` — enough for a gate to
    build `CREATE TABLE` from the shipped `hearthkitAuthDrizzleSchema` itself, using a dependency the
    package already has. Deriving DDL from the shipped schema beats a SQL fixture _and_ drizzle-kit,
    because the gate then cannot test a schema different from the one the package exports.
  - **Replacement ruled: a conformance gate** asserting every table and field `getAuthTables()`
    reports has a matching column in `hearthkitAuthDrizzleSchema`. Re-checks on every dependency
    bump instead of only at authoring time. **Proven to bite before being prescribed** — run against
    a hand-written seven-table schema it immediately reported `invitation.createdAt MISSING`, a real
    omission made without noticing.
  - Recorded, not a required change: `better-auth/adapters/drizzle` and `@better-auth/drizzle-adapter`
    export the **identical function object** (`===` is `true`), so the separate dependency is
    optional indirection and the two import paths carry no version-skew risk.

- **`auth-contract.ts` TYPECHECKS IN ISOLATION, and the check was proven load-bearing.** `tsc
--noEmit` with `strict`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`
  and `isolatedModules`, against a scratchpad harness with `zod`, `drizzle-orm`, `@types/node` and
  `packages/email` symlinked: **exit 0, no diagnostics**. This matters because `pnpm run typecheck`
  still exits 0 **without checking this package** — `packages/auth` has no manifest, the fifth time
  this repo has hit that trap. **Negative control run**: repointing the import to
  `@hearthkit/email/NOPE-contract` fails with `TS2307`, so the exit 0 really did resolve the
  `./email-contract` subpath and the `drizzle-orm/node-postgres` type import rather than skipping
  them. 162 exports, 162 doc comments — full coverage. No `any`, no `export *`.

- **POST-MERGE BASELINE ON `main` AT `6a8dbb5`, orchestrator-run, so any later `auth` regression is
  attributable.** `pnpm --recursive --if-present run test` **exit 0, 8 projects, 189 tests across 46
  files** — config 12/2, ui 27/5, observability 14/4, storage 21/8, db 24/6, email 25/5,
  app-template 27/9, cli 39/7. `pnpm run typecheck` exit 0 (9 projects), `pnpm run lint` exit 0
  (three pre-existing `no-unsafe-type-assertion` warnings in `config` and an `email` gate, unchanged),
  `pnpm run format:check` exit 0. `docker compose up -d --wait postgres minio mailpit` exit 0, all
  three healthy.

- **`email` MERGED 2026-09-03 as `6a8dbb5`, squash-merge of PR #12, branch `pkg/email` deleted.** CI
  was green on the PR's actual head commit `b576144` (run 33301005140), not only on the earlier
  `3411332` (run 33300843861) — checked before merging, because the docs commit sat on top of the
  implementation commit and it is the head that CI's rollup reports. `pkg/auth` cut from `main` at
  `6a8dbb5`, working tree clean.

- **`auth` opens WITHOUT the new-service trap that cost PR #10 a red CI, and this was checked rather
  than assumed.** `auth`'s gates need Postgres and Mailpit. `ci.yml` already runs Postgres as a
  service container (`postgres:17`, line 12) and already runs
  `docker compose up -d --wait minio mailpit` (line 58), added during the `email` loop. So the
  standing rule — adding a service to `docker-compose.yml` is only half the job — has nothing to bite
  on here. If the `auth` gates turn out to need a service beyond those two, `ci.yml` must be taught
  about it in the same commit.

- **CI GREEN on PR #12 (run 33300843861), and the proof that matters is that the new gates RAN on the
  runner rather than being skipped: `packages/email test: Test Files 5 passed (5), Tests 25 passed
(25)`**, against a real Mailpit started from the repo's compose file. `packages/cli test: 39 passed
(39)` on the same run is the other load-bearing line — that is where the port-collision regression
  would have surfaced, so it confirms the remap works on a runner and not just locally.
  `packages/storage test: 21 passed (21)`, unregressed. Commit `3411332`, branch `pkg/email`, not yet
  merged.

- **`email` IMPLEMENTED AND GREEN IN ONE IMPLEMENTOR ROUND, 2026-08-30.** Orchestrator-run, not taken
  from the subagent: `pnpm --filter @hearthkit/email test` **5 files, 25/25 passed**, exit 0;
  `pnpm run typecheck` exit 0; `pnpm run lint` exit 0; `pnpm run format:check` exit 0;
  `pnpm install --frozen-lockfile` exit 0. Full sweep `pnpm --recursive --if-present run test`:
  **all 8 projects green, 189 tests across 46 files** (config 12, ui 27, observability 14, storage
  21, db 24, email 25, app-template 27, cli 39).
  - **`packages/email typecheck: Done` now appears in the project list (8 of 9 projects).** Before
    the manifest existed the same exit 0 checked nothing. That distinction is what makes this run
    evidence.
  - Rule scan clean, orchestrator-run: no `export *`, no barrel, no `any`, no bare-role filenames
    beyond the sanctioned `index.ts`, and **40 exports across 16 implementation files with 40 doc
    comments** — full coverage.
  - Implementor judgement calls accepted: `redactEmailSecrets` scrubs the configured password and API
    key out of **third-party** error text before it is quoted into a failure detail, because the
    contract's rule is absolute but the words come from a library — no gate forces this, since the
    sentinel sweep only proves the values the package itself controls are clean; the subject is
    re-parsed even when the caller supplied a branded one, so a hand-cast value cannot carry a CR
    into the SMTP headers; `buildEmailSubject` is not called at all when `subject` is supplied;
    `renderFailureDetail` never echoes a rejected subject, so a control-character subject cannot
    inject a newline into the message it produced; and generic template copy contains **no digits**,
    because a render gate asserts `15` is absent when `expiryMinutes` is omitted — an invisible
    constraint on future copy edits, recorded here so it is not tripped over.
  - `tsconfig.json` follows `ui` rather than `storage` (`module: preserve`, `moduleResolution:
bundler`, `jsx: react-jsx`, DOM lib), because this package has `.tsx` and React types.

- **ORCHESTRATOR-CAUSED REGRESSION, found and fixed in the same session: adding Mailpit to the repo
  compose broke three `cli` gates, and it would have broken CI.** `cli` went 39/39 → 36/39 with
  `Bind for :::1025 failed: port is already allocated`. The generated compose publishes `1025:1025`
  and `8025:8025`; the repo's new Mailpit now holds them. **CI would have hit this too**, because
  `ci.yml` starts Mailpit and then runs the recursive sweep that includes those gates.
  - **The irony is recorded in `cli`'s own gate file:** `run-hearthkit-cli-dev-infra.test.ts:82` says
    those gates use `mailpit` rather than `postgres` precisely **because** its ports were free.
  - **It surfaced only because the orchestrator ran the full workspace sweep.**
    `pnpm --filter @hearthkit/email test` was green throughout and said nothing about it. This is the
    same class of gap that failed PR #10, in the opposite direction: that time compose had a service
    CI lacked, this time compose has a service that collides with another package's gates.
    **Generalised rule: after touching `docker-compose.yml`, run the recursive sweep, never just the
    package in flight.**
  - Fixed by extending the established precedent rather than inventing one:
    `remapGeneratedMailpitHostPorts` is now a sibling of `remapGeneratedMinioHostPorts`, moving only
    the **published** host ports onto ports from `reserveFreeHostPort`, leaving `mailpit:1025` inside
    the compose network untouched. Moving the repo compose to nonstandard ports was **considered and
    rejected**: 1025/8025 are what every developer, the generated project and the `email` gates
    expect, and the MinIO precedent already settled that the repo compose keeps the standard ports
    while the `cli` gates yield.

- **A LATENT DEFECT IN THE EXISTING MINIO GUARD, shipped in PR #11 and described in this very file as
  the reason the remap is trustworthy. The claim was false for a whole class of inputs.**
  `docs/STATUS.md` said `remapGeneratedMinioHostPorts` "throws a named error if the generated file
  ever stops publishing `9000:9000`, so the remap cannot silently no-op and test nothing." It used
  `String.includes`, and **`'19000:9000'.includes('9000:9000')` is `true`** — so a generated file
  publishing a different host port passed the guard and the replace silently produced the nonsense
  `154321:9000`. Verified by the orchestrator directly:

  | input        | old substring guard          | new anchored guard |
  | ------------ | ---------------------------- | ------------------ |
  | `9000:9000`  | passes                       | passes             |
  | `19000:9000` | **passes**, rewrites to junk | **throws**         |
  | `9000:90001` | **passes**                   | **throws**         |

  Both guards now match with digit lookarounds, `/(?<!\d)9000:9000(?!\d)/`, with the counterexample
  named in a comment so nobody simplifies it back. The gate-writer fixed the MinIO one unprompted
  while adding the Mailpit sibling, which was right — leaving a known silent-corruption path in the
  guard would have been worse than the collision that exposed it.

- **`email` gates APPROVED 2026-08-30 at 25 gates, orchestrator-verified failing 25/25 from the
  committed files.** The 25th was commissioned after the contract correction: the existing gates all
  used single-parameter URLs, so the multi-parameter case — the only one `auth` actually depends on —
  was untested. It asserts both directions against a 90-character two-parameter URL, deliberately
  longer than the plain-text renderer's 80-column wrap width: the text part carries it verbatim and
  contains no `&amp;`, the HTML part does **not** contain it verbatim, does contain
  `href="<escaped>"` and at least two occurrences of the escaped form, and does **not** contain
  `encodeURIComponent(url)`. The elegant one is the last assertion — undoing the escaping restores
  the caller's URL byte-for-byte, which rules out any transformation escaping alone would not produce.
  - **The gate-writer proved it satisfiable AND load-bearing with three mutation states**, which is
    beyond what was asked: a correct stub passes; a tracking wrapper on both button and text fails on
    the text assertion; and — the one that matters — **a tracking wrapper on the button only, with the
    text part left byte-perfect, still fails**, on the `href="<escaped>"` assertion. That third state
    is exactly what a positive-only gate would have waved through.
  - A three-parameter case was measured (107 characters, identical behaviour) and deliberately not
    added, since it would restate the same fact at the cost of another gate.
  - The gate-writer also corrected a stale comment in the single-parameter gate that still carried the
    pre-correction claim that `auth` reads the URL from the HTML part — the exact sentence a future
    reader would have inherited. No assertion changed.

- **`email` gates written 2026-08-30 and ORCHESTRATOR-VERIFIED FAILING: 5 files, 24/24 gates failed,
  every one with a "not implemented yet" diagnostic, no collection error and no syntax error.** Run
  against a harness built by copying the committed gate files, fixtures, contract and
  `vitest.config.ts` into the scratchpad with `node_modules` symlinked to `packages/storage`, because
  `pnpm --filter @hearthkit/email test` still prints `No projects matched the filters` and exits 0.
  - **The clean run alone proves almost nothing, and this is the part worth keeping.** All 24 fail
    because `@hearthkit/email` cannot be resolved at all, which would happen whether the gates were
    good or garbage. The control that matters: with a resolvable stub `index.ts` exporting one
    unrelated value **plus** a manifest carrying the correct `./email-contract` subpath, the failures
    change to `gate expected @hearthkit/email to export resolveEmailTransportConfig, …` — so the
    gates genuinely exercise the contract and the silent-`undefined` guard fires. **23 failed, 1
    passed** under that stub; the passing one is the bare-node subpath gate, which is correct
    behaviour because the control handed it exactly the manifest it tests. The gate-writer's own
    control was stricter (stub only, no manifest) and reported 24/24, so the two numbers reconcile.
  - **Import discipline audited by the orchestrator, not taken on trust.** The only route into the
    package is a single dynamic `import('@hearthkit/email')` in `test-fixtures/hearthkit-email-entry.ts`.
    Every other specifier across all 12 gate and fixture files is `vitest`, a fixture, the contract,
    a `node:` builtin, `zod`, or `@hearthkit/config`. No internal implementation module.
  - **There are NO MOCKS anywhere — `vi.mock`, `vi.fn`, `vi.spyOn` all return zero hits.** Plan
    section 4.6 explicitly permits a mocked Resend HTTP layer "since it cannot run offline"; that
    exemption went **unused**, because `EMAIL_RESEND_BASE_URL` points the real SDK at an in-process
    `node:http` server. The one sanctioned mock in the whole phase was not needed.
  - 24 gates over 5 files, ~2060 lines including fixtures. In line with the repo (observability 14,
    storage 21, db 24, cli 25). `vitest.config.ts` sets `fileParallelism: false` because Mailpit is
    one shared server and its Chaos triggers are **global process state** — one file switching
    recipient rejection to 100% would fail every other file's send.
  - Gate-writer judgement calls accepted: dead ports reserved-then-closed rather than hardcoded
    (better than storage's fixed 59998); gate tokens letters-only, because a hex token can contain
    `15` and the render gate asserts `15` is absent when `expiryMinutes` is omitted — a real
    flakiness source it hit, not a hypothetical; `transportMessageId` asserted to _contain_ Mailpit's
    `MessageID` rather than equal it, since nodemailer's value carries angle brackets; and the
    `user-agent` assertion pinned to `resend-node` without the version, proving the SDK made the call
    without pinning a patch release.

- **`email` contract correction round 2 on 2026-08-30, documentation only — `email-contract.ts` was
  not touched, so no verified gate work was invalidated. The gate-writer found four contract gaps by
  building against it, and the first was a defect that would have broken the NEXT package in the
  phase.** `pnpm run format:check` exit 0 afterwards, orchestrator-run.
  - **THE CONTRACT PROMISED THE ACTION URL APPEARS VERBATIM IN `htmlBody`. IT DOES NOT.** Reproduced
    independently by the orchestrator against the pinned `react-email@6.9.3` +
    `@react-email/render@2.1.0`: React escapes `&` to `&amp;` in **both** the `href` attribute and
    the visible link text.

    | URL                                          | verbatim in `htmlBody` | verbatim in `textBody` |
    | -------------------------------------------- | ---------------------- | ---------------------- |
    | `…/sign-in?token=abc123`                     | yes, 3 occurrences     | yes                    |
    | `…/sign-in?token=abc123&callbackURL=%2Fdash` | **no, 0 occurrences**  | yes                    |
    | `…/sign-in?a=1&b=2&c=3`                      | **no, 0 occurrences**  | yes                    |

    This is correct HTML — `&amp;` is the proper encoding and a browser decodes it, so the link
    works. But **a single-parameter URL matches and a multi-parameter one does not**, which is
    exactly what makes it the sort of assumption that ships. The contract also said `auth`'s gate
    extracts the link from Mailpit, and **Better Auth magic-link callbacks routinely carry
    `?token=…&callbackURL=…`** — so plan 4.7's "request magic link, read it from Mailpit, complete
    sign in" would have failed on a naive HTML substring search. Fixed: `textBody` is now named the
    reliable extraction point, `htmlBody` is documented as HTML-escaped, and the `auth` bullet under
    "Out of scope" instructs `auth` to read the text part. **A gate pinning both directions has been
    commissioned**, because the existing gates deliberately used single-parameter URLs and therefore
    never exercised the case that matters.

  - **The secret rule forbade the contract's own output.** It said `SmtpPassword` and `ResendApiKey`
    "never appear in a returned value", but `EmailTransportConfig` — what `resolveEmailTransportConfig`
    returns — carries exactly those fields. Narrowed to failures, log lines and render/send results,
    with `EmailTransportConfig` named as the one legitimate carrier. Checked against the gates before
    ruling: `expectValueCarriesNoSecret` runs inside `expectEmailFailure` only, so they already
    matched the narrowed rule.
  - **`EPROTOCOL` keeps its catch-all mapping and the optimistic sentence went instead.** A listener
    that is not an SMTP server (someone pointing `EMAIL_SMTP_HOST`/`PORT` at a web server) yields
    `code: 'EPROTOCOL'`, `command: 'CONN'`, `Invalid greeting. response=HTTP/1.1 400 Bad Request`, so
    "the catch-all should stay empty in practice" was false. Reclassifying it to unreachable — for
    consistency with the `ETLS` ruling — was **considered and rejected**: it would leave
    `email-send-failed` with no producer and therefore no gate, and a gated catch-all is worth more
    than a tidier taxonomy.
  - Three clauses that no gate can cover are now recorded with their reasons rather than left to look
    covered: `implicitTlsSmtpPort` (deriving `secure` from port 465 needs a privileged port, so only
    the negative half is covered — **an implementation that never sets `secure: true` at all passes
    every gate**), `EAUTH` (not producible against unauthenticated Mailpit), and `smtpSocketTimeoutMs`
    (needs a server that greets then stalls after `DATA`, plus 20 s of runtime).

- **`email` contract APPROVED 2026-08-29 after one correction round. Both corrections were the
  orchestrator catching a subagent's reasoning that was wrong on the facts while its conclusion was
  right — and in both cases the true reason was stronger than the stated one.** Checks run by the
  orchestrator: `pnpm run format:check` exit 0 (after a Prettier pass on `CONTRACT.md` whose diff was
  **whitespace only** — one table column a single character too wide, no wording touched, confirmed by
  diffing with whitespace collapsed); `email-contract.ts` typechecked **in isolation**, `tsc --noEmit`
  with `strict` and `verbatimModuleSyntax`, zod 4.4.3 and `@types/react` 19.2.18 linked, **exit 0, no
  diagnostics**, re-run after the schema change.
  - **`pnpm run typecheck` exits 0 WITHOUT CHECKING THIS PACKAGE**, because `packages/email` has no
    manifest and is therefore not in the workspace project list. Third time this repo has hit that
    trap (`templates/app`, `storage`, now `email`). The isolated run above is the only real evidence.
  - **Correction A — the contract justified its central design decision on two claims about `config`,
    and both were false.** It said a cross-field refinement on the env fragment was rejected because
    `config` merges with `.extend` and guards with `instanceof z.ZodObject`. Verified: `config` does
    **not** use `.extend`, and a refined fragment **passes** `instanceof z.ZodObject` with `.shape`
    intact. The real reason, found by reading `packages/config/src/compose-env-schema-fragments.ts:18-31`,
    is worse and therefore decisive: `composeEnvSchemaFragments` iterates `Object.entries(fragment.shape)`
    and returns a **brand-new `z.object(composedShape)`**, so a refinement attached to a fragment is
    **silently discarded** — not rejected, not errored, simply never run. `EMAIL_TRANSPORT=resend`
    with no API key would sail through as if no rule had been written. A silent no-op is worse than a
    failure, which is what makes `resolveEmailTransportConfig` forced rather than merely preferable.
    Second independent reason, also verified: a refinement failure arrives as `{code:'custom',path:[]}`
    with an empty path, so it could not name the offending variable even if it did run.
  - **Correction B — the contract proposed shipping a TLS security rule with NO GATE, on a premise
    that was wrong.** It reasoned that gating `requireTLS` needed Mailpit to accept authentication. It
    needs the opposite: Mailpit not **offering** STARTTLS, which it already does not, since no cert is
    configured. Orchestrator-run against the repo's own Mailpit, **no compose change needed**:
    `requireTLS: true` plus credentials fails with `code: 'ETLS'`, `command: 'STARTTLS'`,
    `502 5.5.1 Command not implemented` — and the **negative control is the load-bearing half**: the
    identical send with `requireTLS` omitted **succeeds with `250` and the password crosses in clear**.
    So an implementation that drops the flag fails the gate.
  - **That correction exposed a real hole rather than just a wording problem:** `ETLS` appeared nowhere
    in the failure mapping, so a security-relevant failure was landing in the unnamed catch-all — which
    the contract's own Decision 7 argues against. Ruled: `ETLS` → `email-transport-unreachable` (no
    message was sent, the transport was unusable, the operator's fix is the same class as a down relay).
    The contract-author then found the mirror case unprompted and mapped `EAUTH` →
    `email-transport-rejected` (server reached, answered, refused the session), widening that variant's
    wording to "the session or the message". Both confirmed. The contract now carries a complete
    signal-to-failure mapping table, which is the right artefact — the hole was a missing mapping, not
    a missing sentence.
  - `transportErrorCode` became **required** on `email-transport-unreachable` (the only schema change
    this round). Accepted: the variant is recognised _by_ the code, so the code is always in hand, and
    without it the STARTTLS gate could only assert the outcome — an implementation that failed to
    connect for an unrelated reason would satisfy it by accident.
  - Seven of the contract-author's eight first-round questions confirmed as recommended: the extra
    resolver function and its failure mode; `email-transport-unreachable` plus the `email-send-failed`
    catch-all (same precedent as `storage-endpoint-unreachable` / `storage-request-failed`); no
    `EMAIL_SMTP_SECURE` with `secure` derived as `port === 465`; `EMAIL_SMTP_PORT` required with no
    default; no `re_` prefix pin on the Resend key; and no email-verification or org-invitation
    templates, to be revisited inside the `auth` loop.
  - **Every cross-package claim the contract made was checked rather than taken on trust, and all
    held:** `maximumPresignedUrlExpirySeconds` is 604800, matching the contract's 10080 minutes;
    `healthCheckNameSchema` in `observability` is byte-identical in shape to `emailTemplateNameSchema`;
    `config` does treat an empty string as unset; and all five version pins match
    `packages/storage/package.json` (`zod` 4.4.3, `vitest` 4.1.11, `typescript` 7.0.2,
    `@types/node` 24.13.3).
  - Contract shape: three public functions (`resolveEmailTransportConfig`,
    `renderTransactionalEmail`, `sendTransactionalEmail`), two shipped templates
    (`magic-link-sign-in`, `password-reset`), six failure variants where the plan names three, and a
    `./email-contract` subpath mirroring `@hearthkit/ui`'s, because the `.` entry transitively imports
    `.tsx` that bare Node refuses.
  - **Process note: the contract-author's first run died mid-response to an API error** (the machine
    slept). It had written nothing, so resuming it with its reading intact cost one message instead of
    a full restart. Worth remembering — check the filesystem before assuming a dead agent left a mess.

- **`email` loop opened 2026-08-29 on `pkg/email`. Mailpit is in the repo compose AND in `ci.yml` in
  the same breath, which is the rule the `storage` loop paid for.** Orchestrator-run, cold:
  `docker compose up -d --wait minio mailpit` — both **healthy in 6.4 s, exit 0** — and that is now
  literally the CI step, so the gap that failed PR #10 cannot repeat here. `pnpm format:check` exit 0.
  Mailpit needs no volume: it stores messages in a temp SQLite file (`/tmp/mailpit-*.db`) and its
  image already declares a `/mailpit readyz` healthcheck, overridden only to cut the 15 s interval
  and 10 s start period down to 2 s. Image `axllent/mailpit:v1.31` matches
  `localInfraServiceImageByName` in the `cli` contract, so repo compose and generated compose agree.

- **Mailpit Chaos is enabled on the repo's Mailpit (`MP_ENABLE_CHAOS: 'true'`), and it is what lets
  the "transport rejects" failure mode be gated against a REAL server instead of a fake.** Verified
  end to end: `GET /api/v1/chaos` → `200` with all three triggers at `Probability: 0`;
  `PUT {"Recipient":{"ErrorCode":451,"Probability":100}}` → 200; a send then fails with
  `responseCode=451`, `command='RCPT TO'`, `response='451 Chaos recipient error'`,
  `rejected=['c@d.test']`; reset to 0 and the next send returns `250 2.0.0 Ok: queued as …`.
  Inert at rest, survives a cold `compose up`. **Gates must reset all three triggers to
  `Probability: 0` afterwards**, and should leave `Authentication`'s default `ErrorCode` at 535 —
  the probe overwrote it to 451 by passing it explicitly, which is state left behind.

- **HAZARD for the contract: `EENVELOPE` cannot distinguish an invalid recipient from a transport
  rejection.** Both nodemailer failures carry `code: 'EENVELOPE'`. They differ only in
  `responseCode` — `451` with `command: 'RCPT TO'` for a server rejection, **`undefined` with no
  command** for a bad address. Worse, the bad-address case never reaches the server at all:
  `to: 'not-an-email'` is silently dropped by nodemailer's address parser and reported as
  `'No recipients defined'`, with Mailpit's message count still 0. That diagnostic points at the
  wrong thing, so **the package should validate recipients with Zod before calling nodemailer** and
  return its own named failure, rather than translating `EENVELOPE` after the fact.

- **nodemailer 9.0.6 against Mailpit, orchestrator-run.** Unauthenticated send on 1025 works
  (`secure: false`, no `auth`); `verify()` returns `true`. A success returns
  `250 2.0.0 Ok: queued as <ID>` where **that ID is byte-identical to the Mailpit message `ID`** in
  `GET /api/v1/messages`, so a gate can correlate directly instead of searching by subject — though
  that is Mailpit-specific and must not leak into the contract's promises. An unreachable transport
  throws `ESOCKET` / `errno -61` / `command 'CONN'` / `connect ECONNREFUSED 127.0.0.1:1099` — well
  named, unlike the empty `AggregateError` the storage loop had to wrap.

- **Resend CAN be gated offline against a real in-process HTTP server, so plan section 4.6's "mocked
  HTTP layer only, since it cannot run offline" is wrong in a useful direction.** `ResendOptions`
  publicly types `baseUrl?: string` (`index.d.mts:2691`, `constructor(key?, options?: ResendOptions)`),
  and `RESEND_BASE_URL` works too — **no `any` cast needed**, so CLAUDE.md's no-`any` rule holds.
  Verified against a `node:http` server: happy path POSTs `/emails` with `Authorization: Bearer <key>`,
  `User-Agent: resend-node:6.25.0`, body keys `from,html,subject,text,to`, returning
  `{data:{id}, error:null}`.
  - **The SDK returns errors, it does not throw them.** A 422 gives
    `{data:null, error:{statusCode:422, name:'validation_error', message:…}}`, and an unreachable
    base URL gives `{data:null, error:{name:'application_error', statusCode:null, message:'Unable to
fetch data. The request could not be resolved.'}}`. So unreachable and rejected are told apart by
    `name`/`statusCode`, not by catching. The **constructor throws synchronously** on a missing key.
  - Nuisance for gate output: `logError` writes to `console.error` whenever `NODE_ENV !== 'production'`.

- **React Email dependency settled by USER DECISION 2026-08-29: unified `react-email@6.9.3` plus
  `@react-email/render@2.1.0`.** `@react-email/components` and all 20 individual component packages
  are deprecated (npm's generic message, every version, last publish 2026-04-09); `react-email` 6.9.3
  (published 2026-08-25) is the maintainers' replacement and exports the components — 67 exports
  including `Html`, `Body`, `Button`, `Heading`, `Text`, `Container`, `Preview`. `@react-email/render`
  is **not** deprecated and is the part that actually renders.
  - **The bundle-size objection was measured and is not real.** Issue resend/react-email#3556 closed
    2026-07-10. esbuild bundle: **603136 bytes unified vs 601580 bytes components — 1.5 KB apart**.
    `@vercel/nft`, the tracer Next standalone itself uses: **21 files / 2.0 MB either way**. The cost
    is install weight only — 75M/101 packages vs 30M/22 — which lands in the Docker build stage.
    Recorded because "the unified package adds ~80 MB per function" is widely repeated and is false
    for a bundled app.
  - `render(el)` → `Promise<string>`, a full XHTML-doctype document. `render(el, {plainText: true})`
    → readable text with link URLs inlined (`"SIGN IN\n\nClick below.\n\nSign in https://…"`), so one
    template yields both parts of a multipart message. Verified against the unified import, not just
    the deprecated one.
  - A throwing template throws a plain `Error` carrying the original message, at both element
    construction and render time — **no distinctive shape**, so the render failure mode must be
    produced by wrapping, not by matching an error type.
  - Templates are `.tsx`, so bare Node cannot import them (it does not strip JSX). Vitest and Next
    both transform, so gates and consumers are fine — but this is the same publish-time-build
    constraint already recorded for `ui`, and it applies to `email` in Phase 6.

- **BOTH PHASE 5 BRANCHES MERGED 2026-08-29.** `f387155` (PR #10, `@hearthkit/storage`) then
  `96b5271` (PR #11, `cli` local storage bucket), both squash-merged, both branches deleted, working
  tree clean on `main`, no open PRs.
  - **The combined state was verified before #11 was merged, not after.** #11's earlier green run was
    against a branch that did not contain `storage`, so `main` was merged into it first and CI re-run:
    `packages/storage test: 8 files, 21/21` and `packages/cli test: 7 files, 39/39` in the **same**
    run, plus a local sweep of all seven projects, `pnpm install --frozen-lockfile` exit 0 (the two
    branches' lockfile edits reconcile), typecheck, lint and format:check all exit 0.
  - The `docs/STATUS.md` conflict predicted at the start of the `cli` loop happened exactly as
    written and was resolved as a **union**: both loops' verified facts kept, since discarding either
    side would have thrown away findings that cost real time. The Position, checklist and loop-state
    rows were rewritten rather than merged, because those describe a single current state.
  - **`hearthkit dev infra up` now closes the loop end to end:** a project depending on
    `@hearthkit/storage` gets MinIO, a healthcheck, and a bucket named `<project>-uploads`, and
    `@hearthkit/storage` can presign an upload into it. The 404-on-first-upload gap that opened this
    phase is gone.

- **CI GREEN on PR #11 (run 33274160723, 2m34s), and the new Docker gates really ran on the runner:
  `packages/cli test: Test Files 7 passed (7), Tests 39 passed (39)`.** Notable because this branch is
  cut from `main` and therefore does **not** carry PR #10's MinIO step in `ci.yml` — it does not need
  it. The bucket gates start their own compose stack on reserved ports rather than borrowing the
  repo's MinIO, so they are self-sufficient on a runner that only has Docker.

- **`cli` local-storage-bucket amendment COMPLETE 2026-08-29. PR #11, commit `8b402c9`. Not merged.**
  Two implementor rounds, the second a comment-wording fix only. Orchestrator-run:
  `pnpm --filter @hearthkit/cli test` **7 files, 39/39 passed** (25 pre-existing plus 14 new),
  `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check` all exit 0, and
  `pnpm --recursive --if-present run test` gives **143/143 across six projects**.
  - **The gate-writer proved a text-only gate would NOT have caught the `--wait` defect**, by running
    the Docker gates against an implementation with and without the `tail`. Without it:
    `exitCode=1 kind=infra-compose-failed` **while the signed S3 PUT still returned 200**. So the
    load-bearing assertion is the exit code, not the upload — an S3-only gate would have passed a
    broken implementation. Worth remembering for `email`: proving the service works is not the same
    as proving the command that starts it succeeded.
  - The Docker gates remap only the _published_ host ports, because the repo's own `hearthkit-minio`
    holds 9000/9001, and `remapGeneratedMinioHostPorts` throws a named error if the generated file
    ever stops publishing `9000:9000` — so the remap cannot silently no-op and test nothing.
    **CORRECTED 2026-08-30 during the `email` loop: that last clause was FALSE as written.** The
    guard used `String.includes`, which also matches inside `19000:9000`, so a generated file
    publishing a different host port passed it and was silently rewritten into a nonsense port. Now
    anchored with digit lookarounds. See the latent-defect entry near the top of this section.
  - Round 2 existed because the comment emitted into **every generated project's** compose file did
    not parse ("calls a service that has exited a failed startup"). That comment is the only thing
    standing between a future reader and deleting the `tail`, so garbled text there is a real defect,
    not a typo. Rewritten and re-verified against real generated output for both properties that
    matter: 2-space indent so it lands in neither service block, and no `restart:`/`ports:`/
    `volumes:`/`environment:` that would trip the gates' absent-key regexes.
  - Implementor judgement calls accepted: `LocalStorageBucketName` and `DeriveLocalStorageBucketName`
    re-exported as types (without the first, Phase 6 can only write
    `ReturnType<typeof deriveLocalStorageBucketName>`); `localStorageServiceEndpoint` as a named
    constant rather than built from the published port, since the gate remaps the published port and
    the in-network address must never be remapped; `buildBucketInitBlock` kept private beside the
    existing private helpers.
  - **Orchestrator false alarm worth recording.** A `pnpm lint` run appeared to fail with
    `Unable to locate a Java Runtime` — an earlier `cd packages/cli/src` had persisted in the shell,
    and from there `pnpm lint` resolved to Homebrew's `/opt/homebrew/bin/lint` (Android
    command-line tools) instead of the package script. Re-run from the repo root, everything is
    green. **Use `pnpm run <script>` rather than `pnpm <script>`, and do not trust a shell cwd across
    calls.** The implementor's green report was correct and the doubt was mine.

- **`cli` contract amendment APPROVED 2026-08-29 after one correction round, and the correction was
  a real defect that would have shipped a permanently-failing command.** `pnpm format:check` exit 0.
  - **`docker compose up -d --wait` returns exit 1 when any service it started has EXITED, whatever
    its exit code.** The first draft specified `minio-init` as a one-shot container that exits 0.
    The emitted YAML was correct by inspection; `dev infra up` would still have reported
    `infra-compose-failed` on **every** run, fresh or repeat, with the bucket created perfectly.
    `composeUpArguments` in `src/docker-compose-commands.ts` passes `--wait` unconditionally.
    Compose issue 10596 is open on this; the flag's own reference documents no exception.
  - **Fix: the entrypoint ends `&& tail -f /dev/null`, so the container stays alive by design.**
    Verified under every invocation: fresh `up -d --wait` exit 0, repeat `up -d --wait` exit 0,
    plain `up -d` exit 0, presigned PUT into the created bucket **200**, `down -v` exit 0 with every
    container removed. The `&&` chain still fails loudly the right way — a failed `mc mb`
    short-circuits before `tail`, the container exits nonzero, and the existing
    `infra-compose-failed` reports it. Staying alive is the success path only.
  - **Three alternatives run and rejected, recorded so nobody re-derives them:** stating
    `restart: 'no'` explicitly changes nothing (compose objects to the exit, not the missing key);
    `profiles: ['init']` plus `docker compose run --rm` works for the CLI but leaves a plain
    `docker compose up` with no bucket; and MinIO's own healthcheck cannot run `mc mb` because the
    server image's built-in `local` alias is unauthenticated and returns `Access Denied`.
  - **Why the idle container won over the profile variant**, which is the part worth remembering:
    `resolveLocalInfraComposeFile` never overwrites an existing compose file, so users own and run
    these files by hand from then on. A file that works under `docker compose up` but fails under
    `docker compose up --wait` is a landmine in something the CLI hands over and never touches
    again. One idle container is a visible, explainable cost; a sharp edge on a common flag is not.
  - **Orchestrator process note, twice bitten this session:** the first probe's "idempotent, exits 0"
    claim was WRONG — `docker compose up` was piped through `tail`, so `$?` captured tail's status,
    not compose's, and `docker inspect` was reporting the _init container's_ exit code rather than
    compose's. The pattern was fine; the verification of it missed the thing that mattered.
    **Capture exit codes directly, never through a pipeline**, or use `${pipestatus[1]}` in zsh.
  - Contract-author's two open questions ruled on: `deriveHearthkitProjectName` promoted to public
    (without it `create` re-implements the sanitiser and drifts, the exact failure this amendment
    prevents), and `-uploads` with no S3 reserved-prefix screening (screening would trade a total
    function for a rule R2 does not impose).

- **The `mc` init-container pattern is verified working against our exact pinned images, before any
  contract was commissioned.** `minio/mc:RELEASE.2025-08-13T08-35-41Z` (frozen alongside the server
  image; last Docker Hub push 2025-09-07) as a sidecar with
  `depends_on: {minio: {condition: service_healthy}}`, running
  `mc alias set` then `mc mb --ignore-existing`. Probe on shifted ports 9100/9101 so it could not
  collide with the repo's MinIO:
  - Created the bucket and exited **0**, having waited for the healthcheck rather than racing it.
  - ~~**Idempotent** — a second `docker compose up -d --wait` exited 0 again.~~ **CORRECTED: this
    claim was wrong.** `docker compose up` was piped through `tail`, so the captured status was
    tail's, and the exit code checked with `docker inspect` was the init container's, not compose's.
    Compose actually returns **1** whenever a service it started has exited. See the `--wait` entry
    above; `mc mb --ignore-existing` is genuinely idempotent, but that was never the failing part.
  - **The bucket is genuinely usable over the S3 API**, which is the point: a presigned PUT that
    returns **404 today** returned **200** into the init-created bucket, and the object was then
    listed. Probe torn down; the repo's own MinIO was never touched.
- **`MINIO_DEFAULT_BUCKETS` is a Bitnami-image feature and does nothing on the official
  `minio/minio` image this repo pins.** Recorded so nobody reaches for it as the "simpler" option.
- **The design constraint that decides this contract, found by reading the call site rather than
  assuming:** `resolveLocalInfraComposeFile` builds compose from the project's `package.json`
  manifest — it has `hearthkitProjectName` and `infraServices` and **no bucket name**, and reads no
  `.env`. So an explicit `storageBucketName` input cannot be satisfied by the `dev infra up` path
  without adding `.env` I/O to a function the contract calls pure and deterministic. Deriving the
  name from the project name through one exported function, which `create` later uses for the value
  it writes to `STORAGE_BUCKET`, keeps a single source of truth with no new I/O.
  Escape hatch already exists and needs no new code: `resolveLocalInfraComposeFile` never overwrites
  an existing compose file, so anyone with a custom `STORAGE_BUCKET` owns their compose file.

- **`mc` IS bundled in the pinned MinIO server image, so the generated `minio` healthcheck is sound.**
  This was the one fact contract-author flagged that it could not verify and correctly refused to
  assert. Settled directly: `docker exec hearthkit-minio mc ready local` prints
  `The cluster 'local' is ready` and exits **0**. Worth keeping: the server image bundles
  `mc version RELEASE.2025-08-13T08-35-41Z` — byte-identical to the standalone `minio/mc` release the
  contract pins for the init container, so the two pins are consistent rather than coincidentally
  close. (The image has no `which`, so probe with the binary itself.)

- **The bucket-name derivation is total, checked against the worst inputs rather than assumed.**
  `hearthkitProjectNameSchema` is `/^[a-z][a-z0-9-]*$/` with `max(63)`, so a project name can be one
  character, can end in a hyphen, and can be 63 characters. Truncate-to-55 → strip trailing hyphens →
  append `-uploads` was run over all of those: output stays **9 to 63 characters** and satisfies
  `localStorageBucketNameSchema` every time. The two that could have broken it both hold —
  `a` + 62 hyphens collapses to `a-uploads` rather than a trailing-hyphen name, and `my-app-` yields
  `my-app-uploads` rather than `my-app--uploads`. This is what justifies the function having no
  failure mode.

- **CI GREEN on PR #10 after the MinIO fix (run 33269760070, 2m15s).** The proof that matters is that
  the storage gates **ran** on the runner rather than being skipped: `packages/storage test: Test
Files 8 passed (8), Tests 21 passed (21)`, against a real MinIO started from the repo's compose
  file. All seven projects green (config 2, ui 5, observability 4, db 6, storage 8, app-template 9,
  cli 5). `docker compose up -d --wait minio` verified locally first: healthy in 6.1 s, exit 0.

- **CI FAILED ON PR #10 WHILE EVERY LOCAL COMMAND WAS GREEN, and the cause is a gap in the loop
  itself rather than in the package.** The repo-root `docker-compose.yml` gained a `minio` service so
  local gates could run, but `.github/workflows/ci.yml` was never taught about it, so CI ran the
  storage gates against nothing: 6 files failed, 5 tests passed, 16 skipped. Orchestrator's omission,
  fixed in this PR.
  - **The general rule, which every remaining Phase 5 package will hit:** adding a service to
    `docker-compose.yml` is only half the job. `email` needs Mailpit and will fail exactly the same
    way. **Local gates passing is not evidence CI will pass when a package introduces a new service.**
    The loop's step 4 has the orchestrator re-run gates locally, which cannot catch this by
    construction — the check that matters is whether CI can reach the same services.
  - **MinIO cannot be a GitHub Actions service container, unlike Postgres.** The image needs
    `server /data` arguments to start at all, and a service container has no field for a command —
    `options` maps to `docker create` flags, which cannot supply arguments either. So it starts from
    the repo's own compose file with `docker compose up -d --wait minio`, which is the better shape
    regardless: image tag, credentials, ports and healthcheck then have exactly one definition shared
    by CI and local gates, instead of a bespoke `docker run` line drifting from compose. `--wait`
    blocks on the compose healthcheck, so the gates cannot race the service. Teardown is
    `docker compose down -v` guarded with `if: always()`. Postgres stays a service container; it works
    and mixing the two mechanisms is not worth churning a green setup over.
  - **The failure output was actively misleading, which is its own defect.** With MinIO absent,
    `beforeAll` could not create a bucket, the module-level `gateBucket` stayed `undefined`, and
    `afterAll` then dereferenced it and threw `TypeError: Cannot read properties of undefined
(reading 'storageConnection')` — burying the real cause and pointing at a teardown helper. Nothing
    in the output said "MinIO is not running". Same family as the standing silent-`undefined` hazard:
    a fixture reporting a symptom far from the cause. Sent to gate-writer to fix the diagnostic; no
    assertion changes.

- **`storage` implemented and VERIFIED GREEN IN ONE IMPLEMENTOR ROUND, 2026-08-29. PR #10, commit
  `ec228f1`. Not yet merged.** Orchestrator-run, not taken from the subagent's summary:
  `pnpm --filter @hearthkit/storage test` **8 files, 21/21 passed**, exit 0; `pnpm typecheck` exit 0
  (7 projects); `pnpm lint` exit 0; `pnpm format:check` exit 0. Gate-runner independently confirmed
  the same and added the workspace sweep — `pnpm --recursive --if-present run test` gives **39 files,
  150/150 passed**, so `storage` regressed nothing. Reports in `.reports/storage-*.txt`. MinIO left
  with zero buckets, checked at three points.
  - **The gate-writer's satisfiability claim held.** It was the one thing the orchestrator could not
    verify without doing the implementor's job, and round 1 passing confirms the gates were
    satisfiable as written.
  - **The implementor ran the right negative control rather than trusting the recorded spike:**
    deleting `signableHeaders` from its own upload presign flipped the smuggled-`text/html` PUT from
    403 back to **200**, failing the gate at `create-presigned-upload-url.test.ts:56`. Restored. The
    pin is real in the shipped code, and the gate is load-bearing rather than decorative.
  - Rule scan clean, orchestrator-run: no `export *`, no barrel, no `any`, no bare-role filenames
    (only `index.ts`, a thin named re-export), and **22 exports across 11 implementation files with
    22 doc comments** — full coverage. Implementation is ~640 lines excluding the contract and entry.
  - Load-bearing details confirmed present in the shipped source rather than merely claimed:
    `signableHeaders` in the upload presign, `forcePathStyle: true` with a per-call `destroy()`, and
    `safeParse` for both range checks so they run before any client is built.
  - **`packages/storage/tsconfig.json` sets `noEmit: true` and no `rootDir`, byte-identical to
    `db`'s.** This does not contradict the standing TS 7 note that emit needs an explicit `rootDir`:
    these packages do not emit. Verified by comparison rather than argument.
  - Two SDK error-shape facts the implementor established that go beyond the earlier spikes: the
    `AggregateError` from a dead port carries `code: 'ECONNREFUSED'` **on the aggregate itself**, not
    only on its `errors` entries; and a bodyless response yields `name: 'Unknown'` with `Code`
    undefined, so `HeadObject` against a 500 gives `storageErrorCode: 'Unknown'` while
    `DeleteObject`/`ListObjectsV2` against the same server give `'InternalError'` from the XML body.
    A future gate pinning a specific code on the download path would be pinning `'Unknown'`.
  - **Implementor judgement calls the contract did not settle, all accepted:**
    1. **Listed keys are branded WITHOUT re-validating the strict key pattern**, using a lax
       `z.string().brand<'StorageObjectKey'>()` that produces the identical type. `StorageObjectKey`
       is deliberately stricter than S3, and a bucket can hold keys written by other tools, so strict
       parsing a listing would either drop those keys silently or fail the whole page. Both are worse
       than reporting what is there. Self-consistent: the strict schema still guards every key this
       package _writes_, while a key it merely _reports_ stays actionable — you can delete a file you
       can see. Reason stated in-file.
    2. Missing metadata falls back (`?? new Date(0)`, `?? 0`) rather than failing, keeping the result
       total. A successful HEAD always carries `Last-Modified`, so the fallback is unreachable in
       practice.
    3. `IsTruncated` true with no token is reported as page-complete: the token decides, because a
       truncated page a caller cannot continue is useless.
    4. `expiresAt` is computed just before signing, so it is at most milliseconds early and never
       late — the safe direction for a caller deciding whether a URL is still good.

- **`storage` contract correction round 2026-08-29, documentation only — `storage-contract.ts` was
  not touched, so no verified gate work was invalidated.** Two inaccuracies the gate-writer found
  while building against the contract, both confirmed by the orchestrator before being sent back.
  1. **A wrong status code, and it corrects the orchestrator's own earlier spike reading.**
     `CONTRACT.md` claimed a `PUT` that "omits it or sends a different value" is rejected with 403.
     Sending a different value is 403; **omitting the header entirely is 400**. The orchestrator's
     original spike recorded 403 for the omitted case because it used a _string_ body, and `fetch`
     silently adds `content-type: text/plain;charset=UTF-8` — so that check was measuring the
     wrong-value case a second time. Only a **binary** body tests true omission, which is what the
     gate does. The gate asserts `[400, 403]` and never encoded the error.
  2. **An ambiguity that would have let the entry point drift.** "each function's options and result
     schemas" did not say whether the four success-only schemas must be re-exported. Resolved as
     **required**, with a mechanical rule: every value `storage-contract.ts` exports is re-exported
     from `src/index.ts`, no exceptions. That created a contract requirement no gate enforced, so the
     entry-point gate is being widened in the same breath — additive only, and it cannot make a
     failing empty implementation pass.
  - `pnpm format:check` exit 0 after both edits, orchestrator-run. The contract-author had no shell
    tool in either of its sessions and correctly declined to claim the check passed.

- **Entry-point gate widened 2026-08-29 to enforce the contract's new mechanical rule, and it is now
  derived rather than hand-maintained.** `contractValuesTheEntryMustReExport`, 36 hand-typed string
  literals, is replaced by `Object.keys(contractModule).toSorted()` — 40 names, the delta being
  exactly the four success-only schemas, measured with a throwaway probe rather than reasoned about.
  The gate asserts three whole-array comparisons so a failure names every wrong export at once:
  missing from the entry point, rebuilt instead of re-exported (identity, not just presence), and a
  four-name literal anchor asserting those names still exist on the contract.
  - **The anchor is the part worth keeping.** A purely derived list can silently shrink: delete a
    contract export and the gate happily requires one fewer name. The anchor stops that for the four
    names the contract calls out by name.
  - **Honest tradeoff the gate-writer named rather than hid:** the old list failed loudly if any of
    the other 36 contract names was renamed; the derived list simply tracks the rename. That is
    arguably correct — the contract is the source of truth and the entry must follow it — but the
    residual risk is an accidental _deletion_ of one of those 36 going unnoticed by this gate. The
    other gates that import the deleted name would catch it, subject to the standing
    silent-`undefined` hazard.
  - Proven to bite before being accepted: three fake entry points in the harness only — old 36 only
    (failed, naming exactly the four missing), all 40 (passed), 39 plus a rebuilt copy of
    `storedObjectSummarySchema` (failed, naming exactly that one). Fakes deleted, 21/21 failing again.

- **`storage` gates APPROVED 2026-08-29 after one round. 21 gates across 8 files (~1525 lines with
  fixtures), orchestrator-verified failing: 8 files failed, 21/21 gates failed, and every one of the
  21 failed with the SAME diagnostic** — `gate could not load the public entry point of
@hearthkit/storage (not implemented yet?)`. No collection error, no fixture error, no syntax error.
  The `beforeAll` hooks reached MinIO and created and destroyed their buckets on every run, and
  `ListBuckets` returned `[]` afterwards, so the suite leaves no state behind.
  - **The prescribed loop command still does not work for a package with no manifest.**
    `pnpm --filter @hearthkit/storage test` prints `No projects matched the filters` and exits **0**,
    orchestrator-confirmed, because `packages/storage/package.json` is implementor-owned and does not
    exist yet. Identical to the `templates/app` situation. Real evidence came from running Vitest
    directly against a scratch harness (workspace root with `@hearthkit/config` symlinked, no
    manifest and no `index.ts` for storage, gate files re-copied from the repo immediately before the
    run so the run tested exactly what is committed). **Do not read that exit 0 as a pass.**
  - Import discipline audited by the orchestrator rather than taken on trust: every runtime call to
    the package goes through a single dynamic `import('@hearthkit/storage')` inside
    `test-fixtures/hearthkit-storage-entry.ts`. Gate files import only `./storage-contract.ts`, the
    fixtures, `vitest`, and — in the env-fragment gate alone — `@hearthkit/config`. No gate reaches
    into an internal implementation module.
  - Services are real: MinIO from compose for everything except two variants that cannot use it —
    `storage-request-failed` (in-process `node:http` server answering 500, the technique the
    observability gates established and the contract sanctions) and `storage-endpoint-unreachable`
    (a dead local port). The S3 SDK itself is never mocked.
  - **The gate-writer built a throwaway reference implementation to prove the gates are satisfiable,
    which is beyond what it was asked for and caught two defects that would otherwise have shipped:**
    the never-throws gate passed against a stub that resolved with `{kind:'stub'}` (it now also
    asserts each settled value is the correct contract failure, so a stub cannot pass it), and the
    secret-leak sweep produced a false positive on every failure because MinIO's secret is the word
    `hearthkit`, which is also the first word of every contract message prefix (it now forbids only a
    distinctive sentinel secret). **This is the one claim the orchestrator did NOT independently
    verify** — confirming it would mean writing the implementation, which is the implementor's job.
    The implementor's first round will confirm or refute it.
  - Gate count is in line with the rest of the repo (observability 14, `storage` 21, `db` 24, `cli`
    25, `ui` and `templates/app` 27), and each gate is a multi-step integration scenario rather than
    a per-schema unit test.

- **`storage` contract APPROVED 2026-08-29, no revision round** (one small correction round for
  documented facts followed, see below). Both files read by the orchestrator;
  `pnpm format:check` exit 0 across the repo, which answers the contract-author's question 5 (it had
  no shell tool and asked for the check to be run at review time). All four plan-mandated functions
  present with the exact plan names, all three plan failure modes present, nothing invented without a
  justification. The four open questions resolved as follows.
  1. **`STORAGE_REGION` confirmed** as a fifth optional env var defaulting to `auto`, beyond plan
     section 4.5's four. The SDK requires a region, R2 documents `auto`, and a defaulted variable
     leaves an escape hatch for a MinIO site region while keeping the plan's four working unchanged.
  2. **The `HEAD` in `createPresignedDownloadUrl` confirmed**, round trip and all. Without it
     `storage-object-not-found` has no producer anywhere in the package, and the plan names it as a
     failure mode; it also supplies the returned metadata and makes the plan's "delete it, confirm it
     is gone" gate direct. The time-of-check race is real, stated in the contract, and accepted.
  3. Local bucket ownership → moved to Open issues, not fixed here.
  4. **Widened failure union confirmed** — `storage-endpoint-unreachable` (forced by the empty
     `AggregateError`), `storage-parameter-out-of-range` (without it a bad expiry throws, breaking
     the never-throws promise) and the `storage-request-failed` catch-all that keeps that promise
     honest.

- **Two load-bearing contract claims verified by orchestrator spike before approval, 7/7 — the
  contract-author cited SDK source but could not execute anything, and both claims drive
  implementation requirements and gates.**
  - **The content-type pin is genuinely decorative without `signableHeaders`, and this is a real
    security finding rather than a theoretical one.** Presigning a `PUT` with `ContentType:
'text/plain'` and no `signableHeaders`, then uploading with `content-type: text/html`, returned
    **200 and stored the object as `text/html`** — the client's choice silently won. Adding
    `signableHeaders: new Set(['content-type'])` to `getSignedUrl` flipped the same mismatch to
    **403**, while the matching type still returned 200. That is the stored-XSS hazard Decisions 6
    names, confirmed end to end. **The implementation MUST pass `signableHeaders` or the pin, the
    contract's `requiredRequestHeaders`, and any gate asserting on them are all theatre.**
  - **`HeadObject` cannot distinguish a missing key from a missing bucket**, so the contract's
    second bucket-level `HEAD` is genuinely required, not defensive padding. Both cases returned
    byte-identical `name=NotFound`, `Code=undefined`, `status=404`. `HeadBucket` disambiguates
    cleanly (present → ok, absent → `NotFound`/404). For reference, `GetObject` on a missing key
    _does_ carry `NoSuchKey`, which confirms the stated mechanism: a `HEAD` has no XML body, so the
    S3 error code never arrives.
  - Consequence for the gate-writer and for Phase 6, worth stating once: because the signed
    content-type must match **exactly**, a browser `fetch` with a string body sends
    `text/plain;charset=UTF-8` and gets a 403 against a URL signed for `text/plain`. Uploading a
    `Blob` whose type is set to the signed value is the working pattern. `storageContentTypeSchema`
    rejects parameters such as `; charset=utf-8`, so the charset form cannot be signed either. This
    is inherent to pinning the type, not a defect, but it will bite whoever writes the template's
    storage section.

- **Phase 5 opened on `storage` 2026-08-29. MinIO added to the repo-root `docker-compose.yml`
  (orchestrator-owned, plan section 6) and spiked before any contract was written: 13/13 checks
  green against `minio/minio:RELEASE.2025-09-07T16-13-09Z` on `localhost:9000`, creds
  `hearthkit`/`hearthkit`, console 9001, healthcheck `mc ready local`.** Image tag and credentials
  deliberately match `localInfraServiceImageByName` in `packages/cli/src/cli-contract.ts` so the repo
  compose and a generated project's compose agree. AWS SDK v3.1121.0
  (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, 27 transitive packages).
  - **The MinIO community image is frozen and that is now a confirmed fact, not a worry.** Docker Hub
    shows no push since 2025-09-07 — ~12 months — and `latest` points at the same digest as the
    pinned tag. The `cli` contract's "final choice deferred to Phase 5" is hereby resolved as: keep
    the pin. It is local-development only, it passes every check the plan entry requires, and plan
    section 4.5's "R2 and MinIO both speak S3, so the only difference is the endpoint" is exactly
    what makes swapping the local server later a one-line change. Not escalated to the user.
  - **`forcePathStyle: true` is required for MinIO** — presigned URLs come out as
    `http://localhost:9000/<bucket>/<key>`, not virtual-host style. R2 accepts path style too, so one
    setting serves both, but the contract has to name it rather than leave it to the implementor.
  - **The plan entry's four env vars are not sufficient.** The SDK requires a `region` even though
    MinIO ignores its value (R2 wants `auto`). Either a fifth variable or a documented constant is
    needed; the contract must settle which.
  - **"Object not found" cannot be a failure mode of delete.** S3 delete is idempotent: removing a
    key that never existed returned success, not an error. The failure mode is real for download and
    head only, so either delete does a HEAD first or the contract narrows where the mode applies.
  - **An unreachable endpoint throws `AggregateError` with an EMPTY message** — the one error shape
    here that is useless as-is, so it needs wrapping into a named failure with the endpoint in the
    text. Contrast with the well-named ones: `NoSuchBucket`/404 for a missing bucket,
    `InvalidAccessKeyId`/403 for bad credentials, `NotFound`/404 for a missing key.
  - Also confirmed working, each worth a gate: presigned PUT accepted from plain `fetch` (200);
    presigned GET round-tripped bytes; `ResponseContentDisposition` survived presigning, so
    download-filename control needs no server-side proxying; list honoured `Prefix` and `MaxKeys` and
    returned a continuation token, so pagination is available; **an expired presigned URL was
    rejected with 403**, so expiry is enforced by the server rather than merely advisory.
  - Gap noted, not this loop's call: the `cli` compose generator emits no healthcheck for its `minio`
    service (postgres gets one), so `hearthkit dev` has nothing to wait on. Repo compose has one.

- Throwaway probe deleted by the user 2026-08-29; orchestrator confirmed
  `chrisdevelops/hearthkit-template-probe-80cr2w` no longer resolves. **Not confirmed:** whether the
  linked GHCR container package went with it — the orchestrator's `gh` token lacks `read:packages`,
  so the query returns 403 rather than an answer. Check
  https://github.com/users/chrisdevelops/packages if a stray package matters later. Nothing blocks
  on it, which is why this sits here rather than under Open issues.

- **`@hearthkit/ui/ui-contract` subpath round merged 2026-08-29 (PR #9, cf0e84d); the contract
  mirror is deleted.**
  `packages/ui/package.json` now publishes a third subpath, `./ui-contract` → `./src/ui-contract.ts`,
  which is JSX-free and imports only zod. `templates/app/src/app-template-contract.ts` takes its two
  theme constants from that subpath instead of the `@hearthkit/ui` entry, so the whole template
  contract is importable from bare Node — and `src/verify-app-container-contract-mirror.ts`, 118
  lines re-declaring 13 contract values, is gone. `verify-app-container.ts` and
  `materialize-app-template-project.ts` import the contract directly. Net −44 lines.
  - **All six commands orchestrator-run and green.** `pnpm --filter @hearthkit/ui test` 27/27 (was
    23), `pnpm --filter @hearthkit/app-template test` 27/27 (was 26), `pnpm typecheck` exit 0 all
    six projects, `pnpm lint` exit 0, `pnpm format:check` exit 0.
  - **`pnpm --filter @hearthkit/app-template run verify:container` passed all seven steps with the
    mirror deleted**, which is the proof that matters: the script read the real contract. `/health`
    answered 200 after 1145 ms, container stdout carried `hearthkit app started`, Playwright smoke
    2/2 against the image, clean teardown.
  - Bare Node importing `templates/app/src/app-template-contract.ts` confirmed directly by the
    orchestrator: exit 0, 49 exports, `appTemplateGlobalsCssRequiredLines` carrying both
    ui-sourced literals.
  - **Four new gates, and one of them exists because the first design of it was wrong.** Bare-Node
    loadability covers only the `.tsx` half of the rule "`ui-contract.ts` stays JSX-free and imports
    nothing but zod". `@hearthkit/config`'s entry is a `.ts` file that pnpm's symlink resolves
    outside `node_modules`, so a sibling-package import would load cleanly from bare Node while
    breaking the rule and leaving every runtime check green. A static scan of the file's import
    specifiers against `['zod']` closes that half; neither check subsumes the other. The same
    finding corrected an overstated sentence in `packages/ui/CONTRACT.md`.
  - The gate proving bare Node can import the subpath spawns a real `node` (never an in-process
    import) for two reasons worth keeping: Vite transforms `.tsx` happily, so the wall is invisible
    inside Vitest; and `packages/ui/vitest.config.ts` aliases the string `@hearthkit/ui`, which Vite
    also applies to `@hearthkit/ui/…`, so an in-process subpath import never reaches the exports map.
    The child resolves the real specifier through Node's **self-referencing** rule — a manifest with
    `name` + `exports` can be imported by its own name from inside itself — so the ui gate needs no
    self-link and never borrows another package's `node_modules`. `NODE_OPTIONS` is stripped from
    the child so a parent loader cannot decide the answer.
  - A control gate pins the wall: bare Node still refuses the `.` entry. Green before and after, by
    design. If it ever goes red, the subpath's reason for existing has changed.
  - **Phase 6 limit, recorded now so it is not rediscovered:** this works in-workspace because
    pnpm's symlink resolves to a real path outside `node_modules`. Node refuses to strip types from
    a file whose resolved path is under `node_modules`, so once `@hearthkit/ui` is installed from
    npm as a real directory, `@hearthkit/create` hits that wall — a different one from the JSX wall
    this round removed. Same constraint the 2026-08-27 hybrid-TS decision already recorded for
    `cli` and `create`: a registry install of a Node-executed package needs a publish-time build.
    Stated in `packages/ui/CONTRACT.md` as a Phase 6 packaging decision, not decided here.

- **PHASE 4 DEFINITION OF DONE FULLY VERIFIED 2026-08-28**, against a real throwaway repository
  (`chrisdevelops/hearthkit-template-probe-80cr2w`, private, user-authorised). The template was
  materialized exactly as `@hearthkit/create` will do it, using the loop's own
  `materializeAppTemplateProject`, then pushed to a repo with no relationship to this workspace.
  - **The generated project stands alone.** Outside the monorepo, with `@hearthkit/*` resolved from
    packed tarballs rather than `workspace:*`: `pnpm install` exit 0, `pnpm lint` exit 0,
    `pnpm typecheck` exit 0, `pnpm build` exit 0, `.next/standalone/server.js` produced. This is the
    first evidence the template survives being copied out of the workspace.
  - **Pruning is correct in practice, not just in gates.** 27 files committed: no `CONTRACT.md`, no
    `src/`, no `test-fixtures/`, no `vitest.config.mts`, no `node_modules`, no build output.
    `gitignore` arrived as `.gitignore`. `test` and `verify:container` scripts and the `vitest`/`zod`
    dev dependencies were all removed from the manifest.
  - **`ci.yml` passes on a pull request:** install, lint, typecheck, Chromium install, then
    `pnpm test:e2e` → `Running 2 tests using 1 worker`, both specs `✓`, `2 passed`.
  - **`deploy.yml` passes on push to main**, and the guard behaves: the image built and pushed to
    `ghcr.io/chrisdevelops/hearthkit-template-probe-80cr2w` tagged with **both** the commit SHA and
    `latest` on one digest (`sha256:8f2df8d9…`), matching plan section 7 — and the
    `Trigger the Dokploy deployment` step reported **`skipped`, not `failed`**, with no secret set.
    That is the user's Q4 decision working end to end.
  - **The CI-built image runs and `/health` is green.** Local `verify:container` proves an arm64
    image built on the orchestrator's machine; that is not the same claim as the amd64 image GitHub
    built. A throwaway-only `probe-run-image.yml` (added to the probe repo, **never** to
    `templates/app`) pulled the pushed image on a runner and asserted three things:
    `status=200`, `body={"status":"ok","checks":[]}`, and container stdout carrying
    `{"level":30,…,"pid":1,…,"msg":"hearthkit app started"}`. Passed.
    Deliberately not added to the shipped `deploy.yml`: plan section 7 specifies exactly three steps
    for it, and silently adding a fourth to every future project is not the loop's call.
  - Still untested, unchanged: the Dokploy webhook call, until Phase 7 provisions an instance.
  - Cosmetic issue for Phase 6, not blocking: the materializer copies `next-env.d.ts` when it is
    present in the template working tree. It is gitignored so it never reaches a commit, and Next
    regenerates it, but `@hearthkit/create` should skip it rather than copy cruft.

- **SUPERSEDED — TypeScript 7 now works with Next.js.** The Phase 4 constraint recorded below
  ("`templates/app` must ship TS 5.x or `next.config.mjs`") was true for Next 16.1.4 and is
  false for Next 16.3.3. Verified 2026-08-28 by orchestrator spike, both directions:
  - Next **16.3.3** + `typescript@7.0.2` + `next.config.ts` + `output: 'standalone'`, with **no**
    experimental flag set: `✓ Running next.config.ts took 1679ms`, `next build` exit 0,
    `tsc --noEmit` exit 0, standalone `server.js` served HTTP 200 with the expected body.
  - Negative control, Next **16.1.4** + same TS 7.0.2: reproduces the exact recorded error,
    `Failed to transpile "next.config.ts" … TypeError: Cannot read properties of undefined
(reading 'fileExists')`.
  - `experimental.useTypeScriptCli` is **already `true` in `defaultConfig`** in the published
    16.3.3 tarball (`dist/server/config-shared.js:257`, inside the frozen defaults from line 89),
    so it must NOT be set explicitly — doing so would only restate a default and imply we depend
    on an experimental opt-in. `dist/build/load-jsconfig.js:107-113` branches on it to choose
    `tscPath` over `apiPath`; `dist/build/next-config-ts/transpile-config.js` no longer touches
    the TypeScript API at all (SWC, or Node native type stripping).
  - Consequence: the whole repo stays on TS 7.0.2. `templates/app` pins **Next 16.3.3**, not
    16.1.4. Any Phase 4 or Phase 6 work that assumed a second TypeScript version is void.
  - Note for the template's tsconfig: `next build` rewrites `jsx` to `react-jsx` and appends
    `.next/dev/types/**/*.ts` to `include`. Ship both pre-set so builds do not mutate the file.
- `templates/app` gates written and orchestrator-verified failing 2026-08-28. 24 gates across 7
  Vitest files (~900 lines), plus one Playwright smoke spec in the batched tier. Orchestrator ran
  them against a byte-copy of `templates/app` in the scratchpad with node_modules symlinks to
  workspace `vitest`, `zod`, and the three `@hearthkit/*` packages: **7 files failed, 24/24 gates
  failed in 1.42 s**, every failure either a diagnostic `gate could not read templates/app/<path>
(not written yet?)` or a clean assertion diff — no collection error, no syntax error, no
  unresolved import belonging to the gates.
  **Note the prescribed loop command does not work for this package yet.**
  `pnpm --filter @hearthkit/app-template test` prints `No projects matched the filters` and exits
  **0**, because `templates/app/package.json` is implementor-owned and does not exist. The
  repo-root `pnpm --recursive --if-present run test` is therefore also a no-op for the template
  today. Until the implementor writes that manifest, the scratch-copy run above is the only real
  evidence; do not read an exit 0 from the filter command as a pass.
  Tier split verified: `vitest.config.ts` scopes `include` to `src/**/*.test.ts`, so
  `e2e/*.spec.ts` can never run in the fast tier that fires on every pull request.
- `templates/app` implementor round 1 complete 2026-08-28. Orchestrator-run results:
  - `pnpm --filter @hearthkit/app-template test` — **8 files, 26/26 gates pass**, exit 0, 1.70 s.
    This command works for real now; before the manifest existed it exited 0 having run nothing.
  - `pnpm lint` — exit 0. The nested `templates/app/.oxlintrc.json` risk the contract flagged did
    **not** materialise: root lint exits 0 with it present and does lint template files.
  - `pnpm typecheck` — exit 1 on the first run, one error in the whole workspace and it was in a
    gate file (see below). **After the gate fix: exit 0, all 6 projects Done.**
  - `pnpm --filter @hearthkit/app-template run verify:container` — **exit 0, all seven steps**.
    Docker image built, container ran, `/health` answered 200 after 661 ms, container stdout
    carried `hearthkit app started`, Playwright smoke 2/2 passed against the container, teardown
    clean. **This is the local half of the Phase 4 definition of done: an image builds and runs
    with `/health` green.** The CI half still needs the throwaway-repo run (user decision Q4).
  - `git diff --stat`: 45 files, 4488 insertions. Rule scan clean — no `export *`, no barrel, no
    `any`, no bare-role filenames, and every export in every implementor-owned file carries a doc
    comment.
- **Gate defect found by `tsc`, exactly as the silent-import hazard predicted — in reverse.**
  `src/app-template-tree.test.ts:83` raises TS2367: `guaranteedPath === directoryName` compares the
  23-literal union from `appTemplateGuaranteedPaths` against the 4-literal union from
  `appTemplateNeverCopiedDirectoryNames`, which provably cannot overlap. It went unnoticed through
  two gate rounds because the template had no `package.json`, so no typecheck ran over the gates;
  writing the manifest turned `tsc` on for the first time. Fix sent to gate-writer: the same
  widening cast already used one line above (`as readonly string[]`), which weakens no assertion —
  the runtime question stays the one that matters, since a future contract edit could legitimately
  put a never-copied directory name into the guaranteed list.
  The implementor reported it and stopped rather than working around it, and explicitly rejected
  both available workarounds because each would have weakened something: excluding
  `src/**/*.test.ts` from the template tsconfig would have deleted exactly the `tsc` coverage that
  guards against silently-stale contract imports, and the `typecheck` script string is pinned by
  both the contract and a gate.
  **Fixed and orchestrator-verified**: the widening cast landed, and gate-writer audited every
  other comparison across the eight gate files and two fixtures — all have at least one
  `string`-typed side, so none can go disjoint. Confirmed by a fresh non-incremental
  `tsc --noEmit` over the whole template with `tsbuildinfo` deleted, which is positive evidence
  rather than an absent second error, since `tsc` reports every TS2367 in a file rather than
  stopping at the first.
  One near-miss deliberately left un-widened, and this is the right call: the two-list agreement
  check's `rename.templatePath === templatePath` type-checks today only because `gitignore` appears
  in both `appTemplateRenamedPaths` and `appTemplateGuaranteedPaths`. If a rename source were ever
  dropped from the guaranteed list, that comparison would raise the same TS2367 — and it should,
  because at that point the two lists genuinely disagree and the gate would be asserting nonsense.
  Compile-time failure is the correct outcome there.
- **All four repo-root commands green after the gate fix, orchestrator-run 2026-08-28:**
  `pnpm --filter @hearthkit/app-template test` exit 0 (26/26), `pnpm typecheck` exit 0,
  `pnpm lint` exit 0 (47 warnings, all pre-existing in `packages/*`), `pnpm format:check` exit 0.
  `format:check` needed one fix of its own: `docs/STATUS.md` had drifted out of Prettier style from
  this session's own edits. Orchestrator-owned file, reformatted in place.
- `templates/app` implementor judgement calls the contract did not settle, accepted 2026-08-28:
  1. **SUPERSEDED 2026-08-29 — the mirror is gone.** This entry recorded that
     `verify:container` mirrored the contract because `src/app-template-contract.ts` imported
     `@hearthkit/ui`, whose only entry resolves through `.tsx` and which bare Node refuses
     (`ERR_UNKNOWN_FILE_EXTENSION`, reproduced with and without `--experimental-transform-types`).
     The predicted fix was the right one: `@hearthkit/ui` now publishes the JSX-free
     `./ui-contract` subpath, the contract imports its two theme constants from there, and
     `src/verify-app-container-contract-mirror.ts` is deleted. See the subpath round entry at the
     top of this section.
  2. `instrumentation.ts` throws rather than calling `process.exit`. Next compiles the file for the
     Edge runtime too, where `process.exit`/`process.stderr` produced two Turbopack warnings per
     build. Verified in a container with `LOG_LEVEL=nope GLITCHTIP_DSN=not-a-url`: stderr carries
     `hearthkit config invalid:` naming both variables, and `/` and `/health` both return 500,
     never 200. The container stays up serving 500, so the `HEALTHCHECK` is what marks it
     unhealthy. The contract permits ("may exit") rather than requires the exit.
  3. `tsconfig.json` carries `allowJs`, `incremental`, `plugins:[{name:'next'}]` and
     `.next/types/**/*.ts` because without them `next typegen` rewrites and reformats the tracked
     file on every run. Verified `next typegen` now leaves it byte-identical.
  4. Dockerfile copies the whole project before installing (pnpm's documented Docker layout) rather
     than a package.json-only deps stage; a source change re-runs the install. Noted in-file.
  5. Job-level `env` for the Dokploy guard, `ENV NODE_ENV=production` in the runner stage, and the
     Playwright smoke run from the materialized project rather than from `templates/app` — so the
     shipped `playwright.config.ts` and `e2e/` are exercised the way a generated project uses them.
- `templates/app` gates APPROVED 2026-08-28 after round 2. Orchestrator-run against an empty copy:
  **8 files, 26/26 gates fail in 1.77 s, zero Vite warning lines.** 22 fail with a
  `gate could not read/import templates/app/<path> (not written yet?)` diagnostic, 4 with assertion
  diffs; no collection error. Round 2 added `src/app-workflow-content.test.ts` (one gate per
  workflow, pinning both halves of the deploy secret guard) and closed the silent-`undefined`
  hazard with an `expectNonEmptyStringList(value, exportName)` guard in the fixtures, which now
  throws a named error when a contract export goes missing. All eight new or renamed contract
  exports are referenced by exactly one gate file each (orchestrator-checked). `vitest.config.ts`
  is now `vitest.config.mts`; Vitest discovers it with no flag.
- Ownership hook widened twice more 2026-08-28, both prompted by gate-writer hitting it and
  **stopping rather than working around it with a shell `mv`** — the correct behaviour:
  1. gate-writer may write `vitest.config.@(ts|mts)` under `packages/*` and `templates/*`.
  2. The implementor is now blocked from `vitest.config.ts`, `vitest.config.mts`, and
     `*/test-fixtures/*` as well as `*.spec.ts` and `playwright.config.ts`. These files decide
     which tier a gate runs in, so an implementor could otherwise have widened or narrowed its own
     gates. Thirteen role/path combinations retested; packages unaffected.
- **Hazard found 2026-08-28 — a stale contract import fails SILENTLY in this repo's Vitest setup.**
  The round-2 contract renamed `appTemplateRepoOnlyDirectoryName` to
  `appTemplateRepoOnlyDirectoryNames`. `app-template-tree.test.ts` still imported the old name, and
  the suite re-ran with the same 24 failures and **no import error**: Vite's module runner resolves
  a missing named export to `undefined` rather than throwing. `repoOnlyDirectoryPrefix` silently
  became `"undefined/"`, so the pruning-safety invariant — the most important gate in the set —
  would have passed while checking nothing once the implementation landed. `tsc` catches this as
  TS2305, but the template has no `package.json` yet so no typecheck runs.
  **General rule for this repo:** a contract rename does not reliably break its gates at test time.
  After any contract revision, diff gate imports against contract exports directly rather than
  trusting a red suite to stay red for the right reason. Applies to packages too, not just
  templates.
- `templates/app` contract round 2 completed 2026-08-28; `pnpm format:check` now passes on both
  contract files. Notable finding by contract-author, verified against GitHub's contexts reference:
  **the `secrets` context is not available in any `if` key**, job-level or step-level (only in
  `env` mappings). The obvious `if: ${{ secrets.DOKPLOY_DEPLOY_WEBHOOK_URL != '' }}` would have
  been an invalid workflow. `appTemplateDeployWorkflowRequiredContent` pins both halves of the
  correct pattern — the `env` mapping and the `env.`-based `if` — so the guard that makes
  build-and-push testable without Dokploy cannot silently disappear.
- `templates/app` contract round 2 opened 2026-08-28 — the gates exposed six real gaps, all
  orchestrator-verified before being sent back:
  A. `test-fixtures/` would ship into every generated project (it is in neither
  `appTemplateRepoOnlyPaths` nor under `src/`, and the rule is "everything not listed is copied").
  B. The Dockerfile copies `public/`, which is not a guaranteed path; `COPY` fails when it is
  absent and Next never creates it.
  C. `tailwindcss`/`@tailwindcss/postcss` 4.3.3 and `@playwright/test` 1.62.1 are prose-only, so
  the manifest gate retypes them; the other three version pins have constants.
  D. `verify:container` has no defined command, leaving `app-image-build-failed` and
  `app-container-not-healthy` with no gate anywhere. Resolution is to define the script's
  observable contract and state the under-coverage honestly, not to fabricate a broken build.
  E. `ci.yml` and `deploy.yml` are existence-only. A `deploy.yml` that lost the "skip the webhook
  when the secret is unset" guard would pass everything — and that guard is the user decision that
  makes build-and-push testable without Dokploy.
  F. `vitest.config.ts` triggers a real Vite warning (`ESM syntax in a file loaded as CommonJS`);
  that loader becomes the default in a future Vite major. `"type": "module"` is correctly ruled
  out by the standalone `server.js` reasoning, so the file becomes `vitest.config.mts`.
  Also outstanding: `pnpm format:check` fails on `templates/app/CONTRACT.md` and
  `src/app-template-contract.ts`; contract-author asked to leave both Prettier-clean.
- `templates/app` contract approved 2026-08-28. Its seven questions resolved as follows — three
  were facts, and were settled by test rather than by decision:
  1. `docs/theming.md` was wrong and is fixed. The `next.config.ts` section no longer tells apps to
     pin TS 5.x; it states the TS 7 + Next 16.3.3 position and explicitly warns against setting
     `experimental.useTypeScriptCli`. Orchestrator edit.
  2. Root `.gitignore` gained `test-results/`, `playwright-report/`, `next-env.d.ts`, with a comment
     explaining why the template's dotless ignore file does not cover them. Orchestrator edit.
  3. Implementor write access was already correct (its rule is a denylist), but the agent exposed a
     real gap: `e2e/*.spec.ts` and `playwright.config.ts` were not blocked, so an implementor could
     have edited its own Playwright gates. Both now blocked. All twelve role/path combinations
     retested; packages unaffected.
  4. `.oxlintrc.json` ships inside the template — confirmed. That a nested oxlint config still lets
     the repo-root `pnpm lint` exit 0 is an orchestrator step-7 check, not provable by the contract.
  5. `SMOKE_TEST_BASE_URL` and `DOKPLOY_DEPLOY_WEBHOOK_URL` accepted as new vocabulary.
  6. **Fact, verified — relative `.ts`/`.tsx` import specifiers work under Turbopack.** The repo-wide
     rule holds with no template exception. Spike: `app/page.tsx` importing `'../app-runtime-config.ts'`
     and `'../components/probe-card.tsx'`, with `allowImportingTsExtensions`, `erasableSyntaxOnly`,
     and `verbatimModuleSyntax` set — `tsc --noEmit` exit 0, `next build` exit 0, standalone server
     HTTP 200 rendering the imported component's output.
  7. **Fact, disproven — Prettier does not touch the `@source` literal.** Ran the repo's own Prettier
     config over a `globals.css` holding all three required lines: output byte-identical, double
     quotes preserved. No Prettier override is needed and none should be added.
     Accepted with two notes for later, neither worth a revision round: `appRuntimeConfigSchema`
     composes the two env fragments statically while `appEnvSchemaFragments` lists them at runtime
     (`HearthkitConfigOf` would avoid the duplication — the contract requires a gate asserting the two
     agree, which covers the drift risk); and the template's `tsconfig.json` deliberately cannot
     `extend` `tsconfig.base.json`, so it is a hand-maintained mirror that a gate must hold to the base.
- Phase 4 decisions 2026-08-28 (user):
  1. Ownership hook widened to accept `templates/*` for contract-author and gate-writer, plus
     `templates/*/e2e/*.spec.ts` and `templates/*/playwright.config.ts` for gate-writer.
     All twelve role/path combinations retested; packages unaffected.
  2. Optional-package sections (`storage`, `email`, `auth`, `payments`) are left OUT of the
     template for now. Each is added during that package's own Phase 5 loop, against a real
     contract.
  3. Slow gates (Docker build, Playwright) do not run per change. A local command runs them once
     at Verify before committing; CI runs them on manual trigger and on push to `main`, never on
     pull requests. Accepted tradeoff: the local run is the real gate, main is checked after merge.
  4. Project `deploy.yml` is written in full. Build and GHCR push get tested on a throwaway repo;
     the Dokploy webhook call stays untested until Phase 7 and must be recorded as such.
- `ui` cleanup round completed 2026-08-28 (23/23 gates, workspace typecheck and lint exit 0,
  all orchestrator-run), closing the five gaps the theming-doc work recorded:
  1. `buttonVariants` is now in `hearthkitUiMinimumExportNames` — the only `*Variants` recipe in
     the package, so the rule is "any recipe the fork pattern makes public API is guaranteed".
  2. `packages/ui/components.json` and a `@/*` → `./src/*` alias now ship in the package;
     `shadcn add` writes to `src/components/ui/`. Documented contract surface.
  3. Not fixed, by design: CLI output still needs its class-merge import and `cn` call sites
     fixed by hand, and `--overwrite` still strips doc comments. Stated as accepted tension in
     `packages/ui/CONTRACT.md`; `docs/theming.md` gives the procedure.
  4. `hearthkitThemeCssImportSpecifier` (`'@hearthkit/ui/hearthkit-theme.css'`) is exported and
     guaranteed, so scaffolder, template, and docs stop hardcoding the string.
  5. Closed favourably — no change needed to `tailwindSourceDirectiveForUi`. Tailwind 4.3.3
     `@source` follows pnpm symlinks in BOTH layouts Phase 4 can hit: a `workspace:*` direct
     symlink to the source dir, and the registry-style `.pnpm` virtual-store chain. Verified
     with negative controls in each (removing `@source` dropped the package's utilities while the
     app's own control class still compiled) and through `@tailwindcss/postcss`, byte-identical
     to the CLI, which is the path `templates/app` will actually use. The remaining Phase 4 risk
     on that literal is path depth (`globals.css` one level below app root), not symlink
     resolution.
- Correction to `docs/theming.md` found during the `ui` cleanup round: the tsconfig snippet
  prescribed `baseUrl`, which TypeScript 7 has REMOVED — `error TS5102` fails the workspace
  typecheck (orchestrator-verified against tsc 7.0.2). `paths` alone is what shadcn CLI 4.19.0
  needs; proven with a positive and a negative run. The doc and the package now both omit
  `baseUrl`. Applies to every future tsconfig in this repo, not just `ui`.
- Gate-writing note (2026-08-28): Tailwind escapes arbitrary-value class names in compiled CSS
  (`.tracking-\[0\.31em\]`), so any future gate asserting on compiled CSS must match the escaped
  form or assert on the declaration value instead.
- Phase 3 DoD completed 2026-08-28: `docs/theming.md` written with every example verified live
  in the scratch app (shadowed `IconLeadingButton` rendered beside package `Button`, both bound
  to app token overrides; dropping `@source` shrank compiled CSS 37 KB → 11 KB with utilities
  gone but tokens present — components silently unstyled, not an error; shadcn CLI 4.19.0 run
  against a scratch copy of `packages/ui`).
- Phase 3 DoD scratch-app half verified 2026-08-28 on merged main (7a25800): a scratch Next
  16.1.4 app (file: deps on `ui` + `observability`, `transpilePackages`, ui-contract globals.css
  with `@source`) rendered themed shadcn markup (SSR HTML shows `data-slot="button"` with
  `bg-primary` etc.; compiled CSS defines the hearthkit tokens in `:root` + `.dark` and generates
  the bound utilities) and `/health` returned 200 `{"status":"ok"}` with a REAL `pg` check
  against compose Postgres 17 (85 ms). Phase 3 stays unticked: `docs/theming.md` and the
  shadowed-component example are still owed from the `ui` loop.
  **Phase 4 constraint found (NOW SUPERSEDED — see the TypeScript 7 entry at the top of this
  section):** Next 16.1.4's `next.config.ts` loader needs the installed TypeScript's JS API,
  which `typescript@7.0.2` (tsgo native preview) does not provide (`Cannot read properties of
undefined (reading 'fileExists')`); `typescript@5.9.3` in the app fixed it. This held for
  16.1.4 only. Next 16.3.3 loads `next.config.ts` without the TypeScript API, so the template
  ships TS 7 and Next 16.3.3, and the TS 5.x workaround is not used.
- `observability` verified 2026-08-28 on pkg/observability: 14/14 gates (real compose
  Postgres for the db-reachability check; in-process node:http Sentry ingest mock), workspace
  typecheck and lint exit 0 (orchestrator-run; gate-runner reports in `.reports/observability-*.txt`).
  Implementor round 1 surfaced two gate-fixture defects (envelope path compared with the
  protocol's auth query string attached; an `import()` type annotation violating
  `consistent-type-imports`) — fixed by gate-writer, no assertion weakened, implementation
  untouched. Known accepted warnings: one `no-unsafe-type-assertion` in
  `create-health-route-handler.ts` caused by `z.input` stripping the `HealthCheckName` brand
  from option types (contract property, unreachable branch for type-correct callers).
- `observability` contract approved 2026-08-28 (orchestrator decisions, user may veto):
  `errorSampleRate` defaults 1, `tracesSampleRate` defaults 0 (conservative = no tracing volume;
  never silently sample out errors); `/health` failed checks expose the first line (max 200
  chars) of the thrown error in all environments (single-maintainer stack; production stripping
  is additive later); error reporting uses module-level singleton state matching the Sentry SDK
  global model, last `initializeErrorReporting` call wins. Health checks are app-wired named
  functions so observability never imports `@hearthkit/db`; the Phase 4 template owns the db
  ping wiring. `flushErrorReporting` added beyond the plan entry (capture is async under the
  hood; gates and graceful shutdown need it).
- `ui` verified 2026-08-28 on merged main (108367b): 23/23 gates (jsdom, no services),
  workspace typecheck and lint exit 0 (orchestrator-run; gate-runner reports in
  `.reports/ui-*.txt`), CI green after a STATUS.md-only prettier fix. Notable implementation
  facts: unified `radix-ui` package (current shadcn registry output) instead of per-primitive
  `@radix-ui/react-*`; `packages/ui/tsconfig.json` deviates from base NodeNext with
  `module: preserve` + `moduleResolution: bundler` (bundler-consumed package; NodeNext
  mis-models `@testing-library/user-event` types); doc comments on shadcn-generated exports
  would be stripped by a future `shadcn add --overwrite` (standing tension, unresolved).
  `docs/theming.md` + shadowed-component example still owed for the Phase 3 DoD.
- `ui` contract approved 2026-08-27 (orchestrator decisions, user may veto): shadcn-generated
  components keep canonical single-word names (`Button`, `Card` …) — renaming would break the
  plan-mandated shadcn-CLI workflow; hearthkit-authored exports follow the 2–4-word rule.
  Component set: button, card, input, label, dialog, dropdown-menu families + `PageContainer`,
  `PageHeader`, theme-mode trio, `mergeTailwindClasses`. `--destructive-foreground` omitted per
  current shadcn vocabulary (additive if needed). `tailwindSourceDirectiveForUi` literal assumes
  `app/globals.css` one level below app root; Phase 4 template must match.
- Phase 2 definition of done verified 2026-08-27 on merged main (7fd2b2d): in a scratch app
  (deps `@hearthkit/db` + Next 16.1.4, no docker-compose.yml), `hearthkit dev` run as bare
  `node .../hearthkit-bin.ts dev` generated the compose file, brought `postgres:17` up healthy,
  and started Next (page served 200). `dev infra down` removed container and network cleanly;
  repo compose restored after, db gates re-verified 24/24.
- `cli` verified 2026-08-27: 25/25 gates pass against compose Postgres 17 + Docker
  (orchestrator-run), workspace typecheck and lint exit 0 (lint warnings only, all in test
  fixtures). Gate-runner reports in `.reports/cli-*.txt`.
- User decision 2026-08-27 (hybrid TS execution): relative import specifiers are written
  `.ts`, not `.js`, in every package; `tsconfig.base.json` adds `allowImportingTsExtensions`,
  `rewriteRelativeImportExtensions`, `erasableSyntaxOnly`. Bare `node` runs any source file
  directly (the `hearthkit` bin is `src/hearthkit-bin.ts`, shebang + executable bit, no
  resolver hook). Verified on Node 24.20.0 + TS 7.0.2, including symlinked workspace packages.
  Constraint (Node policy, all versions through 26): TS in a REAL `node_modules` dir is refused
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so registry installs of Node-executed
  packages (`cli`, later `create`) need a publish-time build (`rewriteRelativeImportExtensions`
  emits clean `.js`) — deferred until publishing starts. Next-consumed packages need no build
  (`transpilePackages`). New relative imports must use `.ts`; typecheck will NOT catch a stray
  `.js` specifier (NodeNext maps it silently) — only bare-node execution or `rg` does.
- `cli` contract approved 2026-08-27 with these defaults: admin URL precedence is
  `--admin-database-url` flag > `HEARTHKIT_ADMIN_DATABASE_URL` env > compose default
  `postgresql://hearthkit:hearthkit@localhost:5432/hearthkit`; `db create` prints the
  connection string once, writes nothing; `db drop` has no confirmation prompt (scriptable;
  `--confirm` layer is additive later); generated compose goes to project-root
  `docker-compose.yml`, never overwriting an existing file; MinIO image pinned to the last
  Docker Hub community tag, final choice deferred to Phase 5.
- Phase 1 definition of done verified 2026-08-27: on merged main (886785b), local gates pass
  (config 12/12, db 24/24 against compose Postgres 17) and CI run 33121562483 on main is
  green with a Postgres 17 service container, PGDG `postgresql-client-17` (PATH-prepended —
  the runner's v16 client shadows v17 otherwise), and the workspace test step.
- Root lint flag `--no-error-on-unmatched-pattern` removed after Phase 1 landed; `pnpm lint`
  exits 0 without it.
- `db` contract approved 2026-08-27 with these decisions: admin connection is always an
  explicit `adminDatabaseUrl` parameter, never env; `DATABASE_URL` is always project-scoped;
  `createDrizzleClient` returns `{ drizzleClient, closeDatabaseClient }`; restore requires an
  existing target database (create-then-restore after a drop); credentials are returned once
  in the connection string and never persisted (persistence is future CLI scope).
- User decision 2026-08-27: backup/restore shell out to host `pg_dump`/`pg_restore` in all
  environments. Installed `postgresql@17` (17.11) via brew and force-linked it locally.
  CI must install `postgresql-client-17` and add a Postgres 17 service container plus a test
  step. Phase 7 `hearthkit vps bootstrap` must install `postgresql-client-17` on the VPS.
- Repo-root `docker-compose.yml` created (orchestrator, plan section 6): Postgres 17,
  admin URL `postgresql://hearthkit:hearthkit@localhost:5432/hearthkit`. Verified running
  (17.11).
- User decision 2026-08-27: staying with Zod (Valibot/TypeBox considered and rejected —
  server-side only, Better Auth brings Zod transitively anyway). Zod pinned exact 4.4.3
  in `@hearthkit/config`.
- `config` contract defaults accepted: config owns `NODE_ENV` (default `development`);
  empty-string env values are unset; `configEnvSchemaFragment` is passed explicitly,
  never auto-included. Downstream packages and the scaffolder must follow these.

Things checked against current docs that later steps can rely on. Clear when a phase completes.

- Switched to TypeScript 7.0.2 + oxlint 1.80.0 (user decision 2026-08-27), dropping
  eslint/typescript-eslint/jiti. oxlint-tsgolint 7.0.2001 provides type-aware rules
  (no-floating-promises verified working) and is versioned in lockstep with TS 7.
- TS 7 migration facts: `@types/node` is not auto-included — `tsconfig.base.json` sets
  `"types": ["node"]`, so every package must add `@types/node` as a dev dependency. Emit
  requires an explicit `rootDir` in each package tsconfig (error TS5011 otherwise).
  Declaration emit verified working.
- Root `typecheck` is now only `pnpm -r --if-present run typecheck` (no root tsconfig; there
  are no root TS files).
- Changesets is now 3.0.1 (config schema `@changesets/config@4.0.0`); `changeset init` is
  interactive-only, so `.changeset/config.json` was written by hand from the package's defaults.
- CI actions: `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6` are current
  majors (v4 triggers a Node 20 deprecation annotation).
