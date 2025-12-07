"""
Service Engine - Connects to Prisma Bridge Service instead of Rust binary

This engine communicates with a TypeScript bridge service that wraps
the official @prisma/client. It maintains API compatibility with the
existing binary engine while enabling use with Prisma 6+/7.
"""

from __future__ import annotations

import os
import json
import time
import logging
import subprocess
import atexit
from typing import TYPE_CHECKING, Any, overload
from pathlib import Path
from datetime import timedelta
from typing_extensions import Literal, override

from . import errors
from ._http import SyncHTTPEngine, AsyncHTTPEngine
from ..utils import time_since
from .._types import HttpConfig, TransactionId
from .._builder import dumps
from .._constants import DEFAULT_CONNECT_TIMEOUT

if TYPE_CHECKING:
    from ..types import MetricsFormat, DatasourceOverride


__all__ = (
    'SyncServiceEngine',
    'AsyncServiceEngine',
)

log: logging.Logger = logging.getLogger(__name__)

# Default bridge service URL
DEFAULT_SERVICE_URL = 'http://localhost:4466'


class BaseServiceEngine:
    """Base class for service-based engine communication."""

    service_url: str
    dml_path: Path
    _bridge_process: subprocess.Popen[bytes] | None

    def __init__(
        self,
        *,
        dml_path: Path,
        log_queries: bool = False,
        service_url: str | None = None,
        auto_start_bridge: bool | None = None,
    ) -> None:
        self.dml_path = dml_path
        self.service_url = service_url or os.environ.get('PRISMA_BRIDGE_URL', DEFAULT_SERVICE_URL)

        # Auto-start is enabled by default for seamless experience (like old binary engine)
        # Can be disabled with PRISMA_BRIDGE_AUTO_START=false for manual/Docker setups
        if auto_start_bridge is not None:
            self._auto_start_bridge = auto_start_bridge
        else:
            env_value = os.environ.get('PRISMA_BRIDGE_AUTO_START', 'true').lower()
            self._auto_start_bridge = env_value not in ('false', '0', 'no')

        self._log_queries = log_queries
        self._bridge_process = None

    def _start_bridge_if_needed(self) -> None:
        """Start the bridge service if auto_start_bridge is enabled."""
        if not self._auto_start_bridge:
            return

        # Check if bridge is already running
        # This is a simplified check - production would be more robust
        import socket
        from urllib.parse import urlparse

        parsed = urlparse(self.service_url)
        host = parsed.hostname or 'localhost'
        port = parsed.port or 4466

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.connect((host, port))
            sock.close()
            log.debug('Bridge service already running at %s', self.service_url)
            return
        except ConnectionRefusedError:
            pass

        log.info('Starting bridge service...')
        # Start the bridge service
        bridge_dir = Path(__file__).parent.parent.parent.parent / 'prisma-bridge'
        if not bridge_dir.exists():
            raise errors.EngineConnectionError(
                f'Bridge service directory not found at {bridge_dir}. '
                'Please ensure the bridge service is installed.'
            )

        env = os.environ.copy()
        env['PRISMA_BRIDGE_PORT'] = str(port)

        self._bridge_process = subprocess.Popen(
            ['npm', 'run', 'dev'],
            cwd=str(bridge_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        atexit.register(self._stop_bridge)

        # Wait for bridge to be ready
        time.sleep(2)

    def _stop_bridge(self) -> None:
        """Stop the bridge service if we started it."""
        if self._bridge_process is not None:
            log.debug('Stopping bridge service...')
            self._bridge_process.terminate()
            try:
                self._bridge_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._bridge_process.kill()
            self._bridge_process = None


class SyncServiceEngine(BaseServiceEngine, SyncHTTPEngine):
    """Synchronous engine that communicates with Prisma Bridge Service."""

    def __init__(
        self,
        *,
        dml_path: Path,
        service_url: str | None = None,
        auto_start_bridge: bool = False,
        log_queries: bool = False,
        http_config: HttpConfig | None = None,
    ) -> None:
        BaseServiceEngine.__init__(
            self,
            dml_path=dml_path,
            service_url=service_url,
            auto_start_bridge=auto_start_bridge,
            log_queries=log_queries,
        )
        SyncHTTPEngine.__init__(self, url=self.service_url, **(http_config or {}))

        atexit.register(self.stop)

    @override
    def close(self, *, timeout: timedelta | None = None) -> None:
        log.debug('Closing service engine connection...')
        self._close_session()
        log.debug('Closed service engine connection')

    @override
    async def aclose(self, *, timeout: timedelta | None = None) -> None:
        self.close(timeout=timeout)

    def stop(self, *, timeout: timedelta | None = None) -> None:
        """Stop the engine and cleanup resources."""
        self._stop_bridge()

    @override
    def connect(
        self,
        timeout: timedelta = DEFAULT_CONNECT_TIMEOUT,
        datasources: list[DatasourceOverride] | None = None,
    ) -> None:
        log.debug('Connecting to Prisma Bridge Service at %s', self.service_url)
        if datasources:
            log.debug('Datasources: %s', datasources)

        self._start_bridge_if_needed()

        start = time.monotonic()
        last_exc = None

        # Health check loop
        for _ in range(int(timeout.total_seconds() / 0.1)):
            try:
                # Use /status endpoint for compatibility with existing protocol
                data = self.request('GET', '/health/status')
                if data.get('status') == 'ok':
                    log.debug('Connected to Prisma Bridge Service in %s', time_since(start))
                    return
                if data.get('Errors'):
                    log.debug('Bridge returned errors, retrying...')
                    time.sleep(0.1)
                    continue
            except Exception as exc:
                last_exc = exc
                log.debug('Could not connect to bridge: %s; retrying...', exc)
                time.sleep(0.1)
                continue

            break

        raise errors.EngineConnectionError(
            f'Could not connect to Prisma Bridge Service at {self.service_url}'
        ) from last_exc

    @override
    def query(
        self,
        content: str,
        *,
        tx_id: TransactionId | None,
    ) -> Any:
        headers: dict[str, str] = {}
        if tx_id is not None:
            headers['X-transaction-id'] = tx_id

        if self._log_queries:
            log.info('Query: %s', content)

        return self.request(
            'POST',
            '/',
            content=content,
            headers=headers,
        )

    @override
    def start_transaction(self, *, content: str) -> TransactionId:
        result = self.request(
            'POST',
            '/transaction/start',
            content=content,
        )
        return TransactionId(result['id'])

    @override
    def commit_transaction(self, tx_id: TransactionId) -> None:
        self.request('POST', f'/transaction/{tx_id}/commit')

    @override
    def rollback_transaction(self, tx_id: TransactionId) -> None:
        self.request('POST', f'/transaction/{tx_id}/rollback')

    @overload
    def metrics(
        self,
        *,
        format: Literal['json'],
        global_labels: dict[str, str] | None,
    ) -> dict[str, Any]: ...

    @overload
    def metrics(
        self,
        *,
        format: Literal['prometheus'],
        global_labels: dict[str, str] | None,
    ) -> str: ...

    @override
    def metrics(
        self,
        *,
        format: MetricsFormat,
        global_labels: dict[str, str] | None,
    ) -> str | dict[str, Any]:
        # Metrics may need custom implementation for bridge service
        # For now, return empty metrics
        if format == 'prometheus':
            return ''
        return {'counters': [], 'gauges': [], 'histograms': []}


class AsyncServiceEngine(BaseServiceEngine, AsyncHTTPEngine):
    """Asynchronous engine that communicates with Prisma Bridge Service."""

    def __init__(
        self,
        *,
        dml_path: Path,
        service_url: str | None = None,
        auto_start_bridge: bool = False,
        log_queries: bool = False,
        http_config: HttpConfig | None = None,
    ) -> None:
        BaseServiceEngine.__init__(
            self,
            dml_path=dml_path,
            service_url=service_url,
            auto_start_bridge=auto_start_bridge,
            log_queries=log_queries,
        )
        AsyncHTTPEngine.__init__(self, url=self.service_url, **(http_config or {}))

        atexit.register(self.stop)

    @override
    def close(self, *, timeout: timedelta | None = None) -> None:
        log.debug('Closing service engine connection...')

    @override
    async def aclose(self, *, timeout: timedelta | None = None) -> None:
        log.debug('Async closing service engine connection...')
        await self._close_session()
        log.debug('Closed service engine connection')

    def stop(self, *, timeout: timedelta | None = None) -> None:
        """Stop the engine and cleanup resources."""
        self._stop_bridge()

    @override
    async def connect(
        self,
        timeout: timedelta = DEFAULT_CONNECT_TIMEOUT,
        datasources: list[DatasourceOverride] | None = None,
    ) -> None:
        log.debug('Connecting to Prisma Bridge Service at %s', self.service_url)
        if datasources:
            log.debug('Datasources: %s', datasources)

        self._start_bridge_if_needed()

        import asyncio
        start = time.monotonic()
        last_exc = None

        # Health check loop
        for _ in range(int(timeout.total_seconds() / 0.1)):
            try:
                # Use /status endpoint for compatibility with existing protocol
                data = await self.request('GET', '/health/status')
                if data.get('status') == 'ok':
                    log.debug('Connected to Prisma Bridge Service in %s', time_since(start))
                    return
                if data.get('Errors'):
                    log.debug('Bridge returned errors, retrying...')
                    await asyncio.sleep(0.1)
                    continue
            except Exception as exc:
                last_exc = exc
                log.debug('Could not connect to bridge: %s; retrying...', exc)
                await asyncio.sleep(0.1)
                continue

            break

        raise errors.EngineConnectionError(
            f'Could not connect to Prisma Bridge Service at {self.service_url}'
        ) from last_exc

    @override
    async def query(
        self,
        content: str,
        *,
        tx_id: TransactionId | None,
    ) -> Any:
        headers: dict[str, str] = {}
        if tx_id is not None:
            headers['X-transaction-id'] = tx_id

        if self._log_queries:
            log.info('Query: %s', content)

        return await self.request(
            'POST',
            '/',
            content=content,
            headers=headers,
        )

    @override
    async def start_transaction(self, *, content: str) -> TransactionId:
        result = await self.request(
            'POST',
            '/transaction/start',
            content=content,
        )
        return TransactionId(result['id'])

    @override
    async def commit_transaction(self, tx_id: TransactionId) -> None:
        await self.request('POST', f'/transaction/{tx_id}/commit')

    @override
    async def rollback_transaction(self, tx_id: TransactionId) -> None:
        await self.request('POST', f'/transaction/{tx_id}/rollback')

    @overload
    async def metrics(
        self,
        *,
        format: Literal['json'],
        global_labels: dict[str, str] | None,
    ) -> dict[str, Any]: ...

    @overload
    async def metrics(
        self,
        *,
        format: Literal['prometheus'],
        global_labels: dict[str, str] | None,
    ) -> str: ...

    @override
    async def metrics(
        self,
        *,
        format: MetricsFormat,
        global_labels: dict[str, str] | None,
    ) -> str | dict[str, Any]:
        # Metrics may need custom implementation for bridge service
        # For now, return empty metrics
        if format == 'prometheus':
            return ''
        return {'counters': [], 'gauges': [], 'histograms': []}
