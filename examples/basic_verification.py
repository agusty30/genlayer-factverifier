"""
Basic fact verification example.

Demonstrates how to submit a factual claim with multiple sources
and interpret the verification result.

Usage (after deploying the contract):
    genlayer call <contract_address> submit_claim \
        "The speed of light is approximately 299,792,458 meters per second" \
        '["https://en.wikipedia.org/wiki/Speed_of_light", "https://www.britannica.com/science/speed-of-light"]' \
        "physics" \
        "Fundamental physical constant"
"""


def example_submit_and_check():
    """
    Pseudocode for interacting with a deployed FactVerifier contract.
    Replace with actual GenLayerJS or genlayer-py client calls.
    """

    # 1. Submit a factual claim with independent sources
    claim_id = contract.submit_claim(
        claim="The speed of light is approximately 299,792,458 meters per second",
        source_urls=[
            "https://en.wikipedia.org/wiki/Speed_of_light",
            "https://www.britannica.com/science/speed-of-light",
        ],
        category="physics",
        context="Fundamental physical constant, measured in vacuum",
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

    # 5. Check global stats
    stats = contract.get_stats()
    print(f"\nTotal claims: {stats['total_claims']}")
    print(f"Verified: {stats['total_verified']}")
    print(f"Refuted: {stats['total_refuted']}")


def example_dispute():
    """
    Pseudocode for disputing an existing verified claim.
    """

    # Dispute a claim with new counter-evidence
    contract.dispute_claim(
        claim_id="claim_1",
        dispute_source_urls=[
            "https://factcheck.org/article/speed-of-light-corrections",
            "https://www.nature.com/articles/speed-measurement-updates",
        ],
    )

    # Check updated status
    updated = contract.get_claim("claim_1")
    print(f"Updated status: {updated['status']}")
    print(f"New consensus: {updated['consensus_score']}/100")
    print(f"Total sources now: {updated['source_count']}")
