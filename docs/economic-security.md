# Economic Security

> **Milestone feature.** This layer was added on top of the accepted FactVerifier
> oracle. It turns verification from a free, advisory action into an economically
> secured one: submitting a claim and challenging a claim both require locking
> native stake, and the party consensus sides with is rewarded from the other's
> stake. See [MILESTONE.md](../MILESTONE.md) for the full delta.

## Why staking?

The original oracle answered *"do independent sources support this claim?"* but
attaching **no cost** to being wrong. Anyone could spam thousands of claims, or
file frivolous disputes, for free. For an oracle other contracts are meant to
*rely on*, that is the weak point: truth needs skin in the game.

The economic layer adds exactly that:

- **Submitting** a claim locks a stake (`MIN_SUBMISSION_STAKE`).
- **Challenging** a claim requires matching that stake.
- Re-running consensus decides the winner. The winner recovers their own stake
  **and** takes the loser's, minus a small protocol fee.

Honest participation is capital-preserving (you get your stake back); attacking
the oracle is expensive and, in expectation, loss-making.

## Parameters

| Constant | Value | Meaning |
|----------|-------|---------|
| `MIN_SUBMISSION_STAKE` | `10**16` (0.01 GEN) | Minimum stake to submit a claim |
| `PROTOCOL_FEE_BPS` | `500` (5%) | Fee taken from the **loser's** forfeited stake |
| `BPS_DENOMINATOR` | `10000` | Basis-point denominator |

Values are in the native token's smallest unit (1 GEN = `10**18`).

## Claim lifecycle

```
        submit_claim (payable, stake S locked)
                     │
                     ▼
              ┌──────────────┐
     open ──▶ │  UNRESOLVED  │
              └──────┬───────┘
        ┌────────────┴─────────────┐
        ▼                          ▼
 finalize_claim            dispute_claim (payable, challenge C ≥ S)
 (submitter only)                   │
        │                           ▼
        │                   consensus validates new
        │                   evidence + re-aggregates
        │                   with previously validated
        │                   evidence
        │                           │
        ▼                   ┌────────┴────────┐
   stake S returned         ▼                 ▼
   to submitter        verdict flips     verdict holds
   (RESOLVED)          challenger wins   submitter wins
                            │                 │
                            └───────┬─────────┘
                                    ▼
                        winner ← own stake + (loser stake − fee)
                        treasury ← fee
                                (RESOLVED)
                                    │
                                    ▼
                     withdraw()  →  emit_transfer to winner
```

A claim is settled exactly once (`resolved` flag). After settlement it can be
neither disputed nor finalized again.

## Settlement math

Let `S` = submission stake, `C` = challenge stake (`C ≥ S` enforced), and
`fee = loser_stake * PROTOCOL_FEE_BPS // BPS_DENOMINATOR`.

**Dispute succeeds** (consensus-validated re-aggregation flips the verdict) — challenger wins:

```
fee     = S * 500 // 10000
winner  = challenger
payout  = C + (S − fee)      → credited to claimable[challenger]
treasury += fee
```

**Dispute fails** (verdict unchanged) — submitter wins:

```
fee     = C * 500 // 10000
winner  = submitter
payout  = S + (C − fee)      → credited to claimable[submitter]
treasury += fee
```

**Finalize** (no challenge) — submitter simply reclaims `S`:

```
claimable[submitter] += S
```

### Value conservation

Every unit that enters the contract is always accounted for. After a dispute:

```
claimable[winner] + treasury
    = (own_stake + loser_stake − fee) + fee
    = own_stake + loser_stake
    = S + C
```

Nothing is minted or burned; stakes are only ever redistributed between the two
parties and the treasury. The direct test `test_value_conservation` asserts this
invariant, and `total_staked` (the sum of stakes on still-open claims) is
decremented by exactly `S` on every settlement.

## Pull payments (no push transfers)

Settlement never transfers tokens inline. Instead it **credits an internal
ledger** (`claimable: TreeMap[Address, u256]`), and recipients pull their funds
with `withdraw()`. This is the standard defense against the classic push-payment
failure modes:

- A recipient contract that reverts on receipt cannot brick settlement for the
  other party.
- No reentrancy surface during the settlement bookkeeping.

`withdraw()` follows **checks-effects-interactions**: it zeroes the caller's
balance *before* emitting the transfer.

```python
amount = int(self.claimable.get(sender, u256(0)))
if amount <= 0:
    raise gl.vm.UserError("Nothing to withdraw")
self.claimable[sender] = u256(0)          # effect first
gl.get_contract_at(sender).emit_transfer(value=u256(amount))  # then interaction
```

## Treasury

Protocol fees accumulate in `treasury` and are withdrawable only by `owner`
(the deployer, captured in the constructor). `withdraw_treasury()` uses the same
CEI pattern. Fees give the oracle a sustainable revenue path without charging
honest, un-disputed submitters anything beyond a temporary stake lock.

## Worked example

Alice submits a claim staking 0.01 GEN. Bob disputes with 0.01 GEN and the
consensus-validated re-aggregation flips the verdict (Bob is right):

```
S = C = 1e16, fee = 1e16 * 500 // 10000 = 5e14 (0.005 GEN)
Bob (winner):    claimable += 1e16 + (1e16 − 5e14) = 1.95e16 (0.0195 GEN)
Treasury:        += 5e14 (0.005 GEN)
Alice (loser):   forfeits her 1e16 stake
Check:           1.95e16 + 5e14 = 2e16 = S + C ✓
```

Bob then calls `withdraw()` and receives 0.0195 GEN; the owner can later call
`withdraw_treasury()` for the 0.005 GEN fee.

## Known limitations

1. **Single-round disputes.** A claim can be challenged once. This keeps
   settlement deterministic and the game simple. Escalation games (dispute of a
   dispute, bonded appeal ladders) are future work.

2. **Time-locked challenge window (enforced).** The contract stores a
   `submitted_at` epoch-seconds timestamp on every claim and refuses
   `finalize_claim` until `CHALLENGE_PERIOD_SECONDS` (300s = 5 minutes) have
   elapsed. The timestamp is read from the consensus-injected transaction
   context (`gl.message_raw['datetime']`), so it is identical for all
   validators and not influenced by the submitter's local clock. During the
   challenge window anyone may call `dispute_claim`, which settles the claim
   immediately regardless of when in the window it is called. After the
   window passes, the submitter is the only party who can settle (via
   `finalize_claim`).
   The 5-minute window is short enough for fast UX, long enough that a
   challenger can observe a freshly-submitted claim on a public explorer and
   call `dispute_claim` within the window. Pre-existing claims deployed
   before the field was introduced carry `submitted_at == 0` and bypass the
   check (`if submitted_at > 0`), preserving backward compatibility for any
   in-flight claims on the day of redeploy.

3. **Withdrawal to reverting contracts.** `withdraw()` zeroes the ledger before
   transferring (CEI). If the recipient is a contract that rejects the transfer,
   the emitted message errors and the value is refunded to this contract via the
   SDK's `__on_errored_message__` path; EOA recipients (the common case) are
   unaffected. A re-credit-on-failure escrow is future work.
