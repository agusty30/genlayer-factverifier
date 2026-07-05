"""Root conftest — ensure GenVM SDK takes precedence over project directory.

The project lives at /home/.../genlayer/ which has an __init__.py.
When pytest adds the parent directory to sys.path, Python resolves
`import genlayer` to the project root instead of the GenVM SDK.
This conftest forces the SDK path to be registered first and clears
any stale module cache.
"""

import sys
from pathlib import Path


def pytest_configure(config):
    """Pre-load SDK paths so `from genlayer import *` resolves correctly."""
    # Remove any cached genlayer that points to project root
    to_remove = [k for k in sys.modules if k == "genlayer" or k.startswith("genlayer.")]
    for k in to_remove:
        del sys.modules[k]

    try:
        from gltest.direct.sdk_loader import setup_sdk_paths

        contracts_dir = Path(config.rootdir) / "contracts"
        contract_files = list(contracts_dir.glob("*.py"))
        if contract_files:
            setup_sdk_paths(contract_files[0])

        # Remove parent dir from sys.path if it shadows the SDK
        parent = str(Path(config.rootdir).parent)
        if parent in sys.path:
            sys.path.remove(parent)

    except ImportError:
        pass
