"""
Basic fact verification example.

Demonstrates how to submit a factual claim with multiple sources,
interpret the verification result, and handle the economic staking layer
(stake on submit, finalize to reclaim, withdraw the balance).

Note: submit_claim and dispute_claim are payable — a stake (native GEN) must
be sent as the call value. MIN_STAKE below mirrors the contract's
MIN_SUBMISSION_STAKE (0.01 GEN). How the value is attached depends on your
client (e.g. `value=` with genlayer-py, `--value` on the CLI).

Usage (after deploying the contract):
    genlayer call <contract_address> submit_claim \
        "The speed of light is approximately 299,792,458 meters per second" \
        '["https://en.wikipedia.org/wiki/Speed_of_light", "https://www.britannica.com/science/speed-of-light"]' \
        "physics" \
        "Fundamental physical constant" \
        --value 10000000000000000    # 0.01 GEN stake
"""

MIN_STAKE = 10**16  # 0.01 GEN — mirrors contract MIN_SUBMISSION_STAKE


def example_submit_and_check():
    """
    Pseudocode for interacting with a deployed FactVerifier contract.
    Replace with actual GenLayerJS or genlayer-py client calls.
    """

    # 1. Submit a factual claim with independent sources.
    #    submit_claim is payable — the stake is sent as the call value.
    claim_id = contract.submit_claim(
        claim="The speed of light is approximately 299,792,458 meters per second",
        source_urls=[
            "https://en.wikipedia.org/wiki/Speed_of_light",
            "https://www.britannica.com/science/speed-of-light",
        ],
        category="physics",
        context="Fundamental physical constant, measured in vacuum",
        value=MIN_STAKE,  # stake locked against the claim
    )
    print(f"Claim submitted: {claim_id}")
    # Output: Claim submitted: claim_1

    # 2. Check the verification result
    result = contract.get_claim(claim_id)
    print(f"Status: {result['status']}")
    print(f"Consensus Score: {result['consensus_score']}/100")
    print(f"Sources: {result['sources_supporting']} supporting, {result['sources_refuting']} refuting")
    # Output:
    # Status: verified
    # Consensus Score: 92/100
    # Sources: 2 supporting, 0 refuting

    # 3. Check if a claim is verified (boolean convenience method)
    is_verified = contract.is_claim_verified(claim_id)
    print(f"Is verified: {is_verified}")
    # Output: Is verified: True

    # 4. View per-source analysis details
    for source in result["source_results"]:
        print(f"\n  Source: {source['url']}")
        print(f"  Supports: {source['supports_claim']}")
        print(f"  Confidence: {source['confidence']}%")
        print(f"  Evidence: {source['evidence']}")

    # 5. Inspect the economic state of the claim
    stake_info = contract.get_stake_info(claim_id)
    print(f"\nStake: {stake_info['stake']} | resolved: {stake_info['resolved']}")

    # 6. Check global stats
    stats = contract.get_stats()
    print(f"\nTotal claims: {stats['total_claims']}")
    print(f"Verified: {stats['total_verified']}")
    print(f"Total staked (open claims): {stats['total_staked']}")

    # 7. No one disputed — the submitter finalizes to release the stake,
    #    then withdraws it from the pull-payment ledger.
    contract.finalize_claim(claim_id)
    balance = contract.get_claimable(my_address)
    print(f"\nClaimable after finalize: {balance}")  # == MIN_STAKE
    contract.withdraw()  # transfers the balance back to the caller


def example_dispute():
    """
    Pseudocode for disputing an existing verified claim, including the
    economic settlement (the winner takes the loser's stake minus a 5% fee).
    """

    # Dispute a claim with new counter-evidence. dispute_claim is payable —
    # the challenge stake must be at least the original submission stake.
    contract.dispute_claim(
        claim_id="claim_1",
        dispute_source_urls=[
            "https://factcheck.org/article/speed-of-light-corrections",
            "https://www.nature.com/articles/speed-measurement-updates",
        ],
        value=MIN_STAKE,  # challenge stake >= submission stake
    )

    # Check updated status
    updated = contract.get_claim("claim_1")
    print(f"Updated status: {updated['status']}")
    print(f"New consensus: {updated['consensus_score']}/100")
    print(f"Total sources now: {updated['source_count']}")

    # Inspect the settlement outcome
    info = contract.get_stake_info("claim_1")
    print(f"Resolved: {info['resolved']} | winner: {info['winner']}")

    # The winner pulls their payout (own stake + loser's stake - 5% fee)
    payout = contract.get_claimable(info["winner"])
    print(f"Winner claimable: {payout}")
    # winner then calls contract.withdraw() to receive it

