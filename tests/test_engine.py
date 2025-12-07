"""Tests for the engine layer.

As of v0.13.0, Prisma Client Python uses a TypeScript bridge service
instead of Rust binaries. These tests verify the ServiceEngine functionality.
"""
import asyncio
import contextlib
from typing import Iterator, Optional

import pytest

from prisma import Prisma
from prisma.engine import errors
from prisma._compat import get_running_loop

from .utils import skipif_windows


@contextlib.contextmanager
def no_event_loop() -> Iterator[None]:
    try:
        current: Optional[asyncio.AbstractEventLoop] = get_running_loop()
    except RuntimeError:
        current = None

    # if there is no running loop then we don't touch the event loop
    # as this can cause weird issues breaking other tests
    if not current:  # pragma: no cover
        yield
    else:  # pragma: no cover
        try:
            asyncio.set_event_loop(None)
            yield
        finally:
            asyncio.set_event_loop(current)


@pytest.mark.asyncio
async def test_engine_connects() -> None:
    """Can connect to engine"""
    db = Prisma()
    await db.connect()

    with pytest.raises(errors.AlreadyConnectedError):
        await db.connect()

    await db.disconnect()


@pytest.mark.asyncio
@skipif_windows
async def test_engine_reconnect_after_disconnect() -> None:
    """Can reconnect after disconnecting"""
    db = Prisma()
    await db.connect()
    await db.disconnect()

    # Should be able to connect again
    await db.connect()
    await db.disconnect()


@pytest.mark.asyncio
async def test_engine_disconnect_without_connect() -> None:
    """Disconnecting without connecting doesn't raise an error"""
    db = Prisma()
    await db.disconnect()  # Should not raise


@pytest.mark.asyncio
async def test_query_after_disconnect_raises() -> None:
    """Querying after disconnect raises an error"""
    db = Prisma()
    await db.connect()
    await db.disconnect()

    with pytest.raises(errors.ClientNotConnectedError):
        await db.user.find_many()


# Note: The following tests related to binary engines have been removed in v0.13.0:
# - test_engine_binary_does_not_exist
# - test_engine_binary_does_not_exist_no_binary_paths
# - test_mismatched_version_error
# - test_ensure_local_path
# - test_ensure_env_override
# - test_ensure_env_override_does_not_exist
# - test_stopping_engine_on_closed_loop (QueryEngine no longer exists)
# - test_engine_process_sigint_mask (binary process management removed)
# - test_engine_process_sigterm_mask (binary process management removed)
#
# These tests were specific to the Rust binary query engine which is no longer used.
# The TypeScript bridge service handles all engine functionality now.
