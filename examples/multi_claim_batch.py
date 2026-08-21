"""
Multi-claim batch verification example.

Demonstrates submitting multiple claims in sequence, querying results,
and using the submitter index to track a user's claims.

This pattern is useful for applications that need to verify
multiple facts as part of a larger workflow (e.g., news aggregation,
research validation, compliance checking).
"""

MIN_STAKE = 10**16  # 0.01 GEN — mirrors contract MIN_SUBMISSION_STAKE (payable submit)


def example_batch_verification():
    """
    Pseudocode for batch fact verification.
    Replace with actual GenLayerJS or genlayer-py client calls.
    """

    claims_to_verify = [
        {
            "claim": "The Amazon River is the longest river in the world",
            "sources": [
                "https://en.wikipedia.org/wiki/Amazon_river",
                "https://www.britannica.com/place/Amazon-River",
                "https://www.nationalgeographic.com/environment/article/amazon-river",
            ],
            "category": "geography",
            "context": "Comparing river lengths by different measurement methods",
        },
        {
            "claim": "Python was created by Guido van Rossum and first released in 1991",
            "sources": [
                "https://en.wikipedia.org/wiki/Python_(programming_language)",
                "https://docs.python.org/3/faq/general.html",
            ],
            "category": "technology",
            "context": "Programming language history",
        },
        {
            "claim": "The human body contains 206 bones in adulthood",
            "sources": [
                "https://en.wikipedia.org/wiki/Human_skeleton",
                "https://www.britannica.com/science/human-skeleton",
            ],
            "category": "biology",
            "context": "Adult human anatomy",
        },
    ]

    # Submit all claims
    claim_ids = []
    for item in claims_to_verify:
        claim_id = contract.submit_claim(
            claim=item["claim"],
            source_urls=item["sources"],
            category=item["category"],
            context=item["context"],
            value=MIN_STAKE,  # payable — stake sent as call value
        )
        claim_ids.append(claim_id)
        print(f"Submitted: {claim_id} - {item['claim'][:50]}...")

    # Query all results
    print("\n--- Verification Results ---\n")
    for claim_id in claim_ids:
        result = contract.get_claim(claim_id)
        status_icon = {
            "verified": "[OK]",
            "refuted": "[X]",
            "disputed": "[?]",
            "insufficient_sources": "[--]",
        }.get(result["status"], "[??]")

        print(f"{status_icon} {claim_id}: {result['claim_text'][:60]}...")
        print(f"    Score: {result['consensus_score']}/100 | "
              f"Sources: {result['sources_supporting']}+ / {result['sources_refuting']}-")

    # Query by submitter
    my_claims = contract.get_claims_by_submitter(my_address)
    print(f"\nMy total claims: {len(my_claims)}")

    # Global stats
    stats = contract.get_stats()
    print(f"Platform stats: {stats['total_claims']} claims, "
          f"{stats['total_verified']} verified, "
          f"{stats['total_refuted']} refuted")


def example_integration_pattern():
    """
    Pattern for integrating FactVerifier into another contract or application.

    Use case: A DAO wants to verify claims before executing governance actions.
    """

    # 1. Before executing a governance proposal, verify the underlying claim
    proposal_claim = "Company X reported Q3 revenue of $5.2 billion"

    claim_id = fact_verifier.submit_claim(
        claim=proposal_claim,
        source_urls=[
            "https://www.sec.gov/cgi-bin/browse-edgar",
            "https://finance.yahoo.com/quote/X",
        ],
        category="finance",
        context="Q3 2024 earnings verification for governance proposal",
        value=MIN_STAKE,  # payable — stake sent as call value
    )

    # 2. Check verification result before proceeding
    if fact_verifier.is_claim_verified(claim_id):
        print("Claim verified - proceeding with governance action")
        # dao.execute_proposal(proposal_id)
    else:
        result = fact_verifier.get_claim(claim_id)
        print(f"Claim not verified (status: {result['status']}) - "
              f"governance action blocked")
        print(f"Consensus score: {result['consensus_score']}/100")
