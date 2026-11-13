"""Shared helpers for direct mode tests."""

import sys

import pytest


def to_hex(addr_bytes):
    """Convert address bytes to checksummed hex matching contract output.

    The contract's views return addresses via Address.as_hex, which produces
    EIP-55 checksummed hex. Call after direct_deploy so the SDK is on sys.path.
    """
    if hasattr(addr_bytes, "as_hex"):
        return addr_bytes.as_hex
    from genlayer.py.types import Address

    return Address(addr_bytes).as_hex


@pytest.fixture(autouse=True)
def _propagate_warp_to_message_raw(direct_vm):
    """Make ``direct_vm.warp(...)`` update ``gl.message_raw['datetime']``.

    The GenLayer SDK populates ``gl.message_raw`` once at contract load
    time from fd0; later ``warp`` calls update ``vm._datetime`` but not the
    cached message_raw dict. Contracts that read ``gl.message_raw['datetime']``
    (e.g. to enforce a challenge period) would otherwise see the contract's
    load-time timestamp no matter how far the test advances the clock.

    We patch ``warp`` to also refresh the datetime field on the cached
    message_raw dict so contract-side time checks observe the warp.
    """
    original_warp = direct_vm.warp

    def warp_with_propagation(timestamp: str):
        original_warp(timestamp)
        gl = sys.modules.get("genlayer.gl")
        if gl is not None and getattr(gl, "message_raw", None) is not None:
            gl.message_raw["datetime"] = timestamp

    direct_vm.warp = warp_with_propagation
    return direct_vm
