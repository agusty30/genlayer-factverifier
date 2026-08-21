"""Tests for the FactVerifier economic staking layer.

Covers: submission stakes, challenge stakes, dispute settlement (winner takes
the loser's stake minus a protocol fee), the pull-payment ledger, submitter
finalization, treasury accounting, and value conservation.

Run with: pytest tests/direct/test_staking.py -v

Note on direct mode: emit_transfer (used by withdraw / withdraw_treasury) is a
PostMessage that the in-memory harness accepts but does not settle, so these
tests assert the deterministic internal ledger (claimable / treasury /
total_staked). Actual native-balance movement is covered by integration tests.
"""

import json

from tests.direct.conftest import to_hex

CONTRACT_PATH = "contracts/fact_verifier.py"

# Mirror the contract's economic constants.
MIN_STAKE = 10**16
PROTOCOL_FEE_BPS = 500
BPS_DENOMINATOR = 10000

SOURCES_A = [
    "https://www.reuters.com/article/a",
    "https://www.apnews.com/article/b",
]
SOURCES_B = [
    "https://factcheck.org/article/c",
    "https://snopes.com/article/d",
]


# ── Helpers ──────────────────────────────────────────────────────────────────

def _fee(amount):
    return amount * PROTOCOL_FEE_BPS // BPS_DENOMINATOR


def _mock_sources(vm, supports, confidence):
    vm.mock_web(r".*", {"status": 200, "body": "Factual content."})
    vm.mock_llm(
        r".*Analyze whether.*",
        json.dumps({
            "supports_claim": supports,
            "confidence": confidence,
            "extracted_evidence": "Evidence",
            "reasoning": "Reasoning",
        }),
    )


def _submit(contract, vm, sender, stake, claim="Test claim",
            sources=None, supports=True, confidence=90):
    sources = sources or SOURCES_A
    vm.sender = sender
    vm.value = stake
    _mock_sources(vm, supports, confidence)
    return contract.submit_claim(claim, sources, "test", "")


def _dispute(contract, vm, sender, stake, claim_id,
             sources=None, supports=False, confidence=90):
    sources = sources or SOURCES_B
    vm.clear_mocks()
    vm.sender = sender
    vm.value = stake
    _mock_sources(vm, supports, confidence)
    contract.dispute_claim(claim_id, sources)


# ── Submission stake requirement ──────────────────────────────────────────────

class TestSubmissionStake:

    def test_submit_below_min_stake_reverts(self, direct_vm, direct_deploy, direct_alice):
        contract = direct_deploy(CONTRACT_PATH)
        direct_vm.sender = direct_alice
        direct_vm.value = MIN_STAKE - 1
        with direct_vm.expect_revert("Submission requires a stake of at least"):
            contract.submit_claim("A claim", SOURCES_A, "test", "")

    def test_submit_zero_stake_reverts(self, direct_vm, direct_deploy, direct_alice):
        contract = direct_deploy(CONTRACT_PATH)
        direct_vm.sender = direct_alice
        direct_vm.value = 0
        with direct_vm.expect_revert("Submission requires a stake of at least"):
            contract.submit_claim("A claim", SOURCES_A, "test", "")

    def test_submit_exact_min_stake_ok(self, direct_vm, direct_deploy, direct_alice):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE)
        info = contract.get_stake_info(claim_id)
        assert info["stake"] == MIN_STAKE
        assert info["resolved"] is False
        assert info["challenger"] == ""
        assert info["winner"] == ""

    def test_submit_records_larger_stake(self, direct_vm, direct_deploy, direct_alice):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE * 3)
        assert contract.get_stake_info(claim_id)["stake"] == MIN_STAKE * 3

    def test_total_staked_accumulates(self, direct_vm, direct_deploy, direct_alice, direct_bob):
        contract = direct_deploy(CONTRACT_PATH)
        _submit(contract, direct_vm, direct_alice, MIN_STAKE)
        direct_vm.clear_mocks()
        _submit(contract, direct_vm, direct_bob, MIN_STAKE * 2, sources=SOURCES_B)
        assert contract.get_stats()["total_staked"] == MIN_STAKE * 3

    def test_validation_precedes_stake_check(self, direct_vm, direct_deploy, direct_alice):
        # An invalid claim is rejected on its own message even with no stake.
        contract = direct_deploy(CONTRACT_PATH)
        direct_vm.sender = direct_alice
        direct_vm.value = 0
        with direct_vm.expect_revert("At least 2 source URLs required"):
            contract.submit_claim("A claim", ["https://only-one.com"], "test", "")


# ── Dispute settlement ─────────────────────────────────────────────────────────

class TestDisputeSettlement:

    def test_successful_dispute_challenger_wins(
        self, direct_vm, direct_deploy, direct_alice, direct_bob
    ):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE)
        assert contract.get_claim_status(claim_id) == "verified"

        # Bob challenges with refuting sources -> verdict flips -> Bob wins.
        _dispute(contract, direct_vm, direct_bob, MIN_STAKE, claim_id, supports=False)

        info = contract.get_stake_info(claim_id)
        assert info["resolved"] is True
        assert info["challenger"] == to_hex(direct_bob)
        assert info["winner"] == to_hex(direct_bob)

        fee = _fee(MIN_STAKE)  # loser is the submitter
        expected = MIN_STAKE + (MIN_STAKE - fee)  # own challenge + slashed stake
        assert contract.get_claimable(to_hex(direct_bob)) == expected
        assert contract.get_claimable(to_hex(direct_alice)) == 0
        assert contract.get_treasury() == fee

    def test_failed_dispute_submitter_wins(
        self, direct_vm, direct_deploy, direct_alice, direct_bob
    ):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE)

        # Bob challenges with supporting sources -> verdict holds -> Alice wins.
        _dispute(contract, direct_vm, direct_bob, MIN_STAKE, claim_id, supports=True)

        info = contract.get_stake_info(claim_id)
        assert info["resolved"] is True
        assert info["winner"] == to_hex(direct_alice)

        fee = _fee(MIN_STAKE)  # loser is the challenger
        expected = MIN_STAKE + (MIN_STAKE - fee)
        assert contract.get_claimable(to_hex(direct_alice)) == expected
        assert contract.get_claimable(to_hex(direct_bob)) == 0
        assert contract.get_treasury() == fee

    def test_challenge_below_submission_stake_reverts(
        self, direct_vm, direct_deploy, direct_alice, direct_bob
    ):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE * 2)

        direct_vm.clear_mocks()
        direct_vm.sender = direct_bob
        direct_vm.value = MIN_STAKE  # below the 2x submission stake
        _mock_sources(direct_vm, supports=False, confidence=90)
        with direct_vm.expect_revert("Challenge stake must be at least"):
            contract.dispute_claim(claim_id, SOURCES_B)

    def test_cannot_dispute_resolved_claim(
        self, direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
    ):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE)
        _dispute(contract, direct_vm, direct_bob, MIN_STAKE, claim_id, supports=False)

        # Second challenge must be rejected — the stakes are already settled.
        direct_vm.clear_mocks()
        direct_vm.sender = direct_charlie
        direct_vm.value = MIN_STAKE
        _mock_sources(direct_vm, supports=True, confidence=90)
        with direct_vm.expect_revert("Claim already resolved"):
            contract.dispute_claim(claim_id, SOURCES_A)

    def test_total_staked_released_after_dispute(
        self, direct_vm, direct_deploy, direct_alice, direct_bob
    ):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE)
        assert contract.get_stats()["total_staked"] == MIN_STAKE
        _dispute(contract, direct_vm, direct_bob, MIN_STAKE, claim_id, supports=False)
        assert contract.get_stats()["total_staked"] == 0
        assert contract.get_stats()["total_disputes"] == 1

    def test_value_conservation(
        self, direct_vm, direct_deploy, direct_alice, direct_bob
    ):
        contract = direct_deploy(CONTRACT_PATH)
        submit_stake = MIN_STAKE * 2
        challenge_stake = MIN_STAKE * 3
        claim_id = _submit(contract, direct_vm, direct_alice, submit_stake)
        _dispute(contract, direct_vm, direct_bob, challenge_stake, claim_id, supports=False)

        total_out = (
            contract.get_claimable(to_hex(direct_alice))
            + contract.get_claimable(to_hex(direct_bob))
            + contract.get_treasury()
        )
        # Every unit staked is either claimable by a party or held as fees.
        assert total_out == submit_stake + challenge_stake


# ── Submitter finalization ─────────────────────────────────────────────────────

class TestFinalize:

    def test_finalize_releases_stake(self, direct_vm, direct_deploy, direct_alice):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE)

        direct_vm.sender = direct_alice
        contract.finalize_claim(claim_id)

        assert contract.get_stake_info(claim_id)["resolved"] is True
        assert contract.get_claimable(to_hex(direct_alice)) == MIN_STAKE
        assert contract.get_stats()["total_staked"] == 0

    def test_only_submitter_can_finalize(
        self, direct_vm, direct_deploy, direct_alice, direct_bob
    ):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE)

        direct_vm.sender = direct_bob
        with direct_vm.expect_revert("Only the submitter can finalize"):
            contract.finalize_claim(claim_id)

    def test_cannot_finalize_twice(self, direct_vm, direct_deploy, direct_alice):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE)
        direct_vm.sender = direct_alice
        contract.finalize_claim(claim_id)
        with direct_vm.expect_revert("Claim already resolved"):
            contract.finalize_claim(claim_id)

    def test_cannot_dispute_after_finalize(
        self, direct_vm, direct_deploy, direct_alice, direct_bob
    ):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE)
        direct_vm.sender = direct_alice
        contract.finalize_claim(claim_id)

        direct_vm.clear_mocks()
        direct_vm.sender = direct_bob
        direct_vm.value = MIN_STAKE
        _mock_sources(direct_vm, supports=False, confidence=90)
        with direct_vm.expect_revert("Claim already resolved"):
            contract.dispute_claim(claim_id, SOURCES_B)

    def test_finalize_nonexistent_reverts(self, direct_vm, direct_deploy, direct_alice):
        contract = direct_deploy(CONTRACT_PATH)
        direct_vm.sender = direct_alice
        with direct_vm.expect_revert("Claim not found"):
            contract.finalize_claim("claim_999")


# ── Pull-payment withdrawal ────────────────────────────────────────────────────

class TestWithdraw:

    def test_withdraw_zeroes_claimable(
        self, direct_vm, direct_deploy, direct_alice, direct_bob
    ):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE)
        _dispute(contract, direct_vm, direct_bob, MIN_STAKE, claim_id, supports=False)

        assert contract.get_claimable(to_hex(direct_bob)) > 0
        direct_vm.sender = direct_bob
        contract.withdraw()
        assert contract.get_claimable(to_hex(direct_bob)) == 0

    def test_withdraw_nothing_reverts(self, direct_vm, direct_deploy, direct_charlie):
        contract = direct_deploy(CONTRACT_PATH)
        direct_vm.sender = direct_charlie
        with direct_vm.expect_revert("Nothing to withdraw"):
            contract.withdraw()

    def test_double_withdraw_reverts(
        self, direct_vm, direct_deploy, direct_alice, direct_bob
    ):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE)
        _dispute(contract, direct_vm, direct_bob, MIN_STAKE, claim_id, supports=False)

        direct_vm.sender = direct_bob
        contract.withdraw()
        with direct_vm.expect_revert("Nothing to withdraw"):
            contract.withdraw()


# ── Treasury (owner-only) ──────────────────────────────────────────────────────

class TestTreasury:

    def test_owner_is_deployer(self, direct_deploy, direct_owner):
        contract = direct_deploy(CONTRACT_PATH)
        assert contract.get_owner() == to_hex(direct_owner)

    def test_withdraw_treasury_owner(
        self, direct_vm, direct_deploy, direct_alice, direct_bob, direct_owner
    ):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE)
        _dispute(contract, direct_vm, direct_bob, MIN_STAKE, claim_id, supports=False)

        assert contract.get_treasury() == _fee(MIN_STAKE)
        direct_vm.sender = direct_owner
        contract.withdraw_treasury()
        assert contract.get_treasury() == 0

    def test_withdraw_treasury_non_owner_reverts(
        self, direct_vm, direct_deploy, direct_alice, direct_bob
    ):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE)
        _dispute(contract, direct_vm, direct_bob, MIN_STAKE, claim_id, supports=False)

        direct_vm.sender = direct_alice  # not the owner
        with direct_vm.expect_revert("Only the owner can withdraw the treasury"):
            contract.withdraw_treasury()

    def test_withdraw_treasury_empty_reverts(self, direct_vm, direct_deploy, direct_owner):
        contract = direct_deploy(CONTRACT_PATH)
        direct_vm.sender = direct_owner
        with direct_vm.expect_revert("Treasury is empty"):
            contract.withdraw_treasury()


# ── Economic view methods ──────────────────────────────────────────────────────

class TestStakeViews:

    def test_get_stake_info_nonexistent_reverts(self, direct_vm, direct_deploy):
        contract = direct_deploy(CONTRACT_PATH)
        with direct_vm.expect_revert("Claim not found"):
            contract.get_stake_info("claim_999")

    def test_get_claimable_zero_by_default(self, direct_deploy, direct_alice):
        contract = direct_deploy(CONTRACT_PATH)
        assert contract.get_claimable(to_hex(direct_alice)) == 0

    def test_stats_include_economic_fields(self, direct_vm, direct_deploy, direct_alice):
        contract = direct_deploy(CONTRACT_PATH)
        _submit(contract, direct_vm, direct_alice, MIN_STAKE)
        stats = contract.get_stats()
        for key in ("total_claims", "total_verified", "total_refuted",
                    "total_disputes", "total_staked", "treasury"):
            assert key in stats
        assert stats["total_staked"] == MIN_STAKE
        assert stats["total_disputes"] == 0

    def test_get_stake_info_reflects_open_claim(
        self, direct_vm, direct_deploy, direct_alice
    ):
        contract = direct_deploy(CONTRACT_PATH)
        claim_id = _submit(contract, direct_vm, direct_alice, MIN_STAKE)
        info = contract.get_stake_info(claim_id)
        assert info["stake"] == MIN_STAKE
        assert info["challenge_stake"] == 0
        assert info["resolved"] is False
        assert info["status"] == "verified"
