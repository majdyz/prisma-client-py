# Prisma Client Python - Engine Layer
#
# This module provides the engine implementations for communicating with Prisma.
# As of version 0.13.0, the ServiceEngine (TypeScript Bridge) is the only supported engine.
# The old binary QueryEngine has been deprecated and removed.

from ._service import (
    SyncServiceEngine as SyncServiceEngine,
    AsyncServiceEngine as AsyncServiceEngine,
)
from .errors import *
from .._types import TransactionId as TransactionId
from ._abstract import (
    BaseAbstractEngine as BaseAbstractEngine,
    SyncAbstractEngine as SyncAbstractEngine,
    AsyncAbstractEngine as AsyncAbstractEngine,
)

# Backwards compatibility aliases - these now point to ServiceEngine
SyncQueryEngine = SyncServiceEngine
AsyncQueryEngine = AsyncServiceEngine

try:
    from .query import *  # noqa: TID251
    from .abstract import *  # noqa: TID251
except ModuleNotFoundError:
    # code has not been generated yet
    pass
