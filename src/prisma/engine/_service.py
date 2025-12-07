"""
Service Engine - Connects to Prisma Bridge Service instead of Rust binary

This engine communicates with a TypeScript bridge service that wraps
the official @prisma/client. It maintains API compatibility with the
existing binary engine while enabling use with Prisma 6+/7.
"""

from __future__ import annotations

import os
import sys
import json
import time
import shutil
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

# Bridge startup timeout
BRIDGE_STARTUP_TIMEOUT = 30  # seconds


def _find_bridge_directory() -> Path | None:
    """Find the prisma-bridge directory in various locations.

    Search order:
    1. PRISMA_BRIDGE_DIR environment variable
    2. Bundled with package (src/prisma/bridge/)
    3. Adjacent to package installation (../prisma-bridge from prisma package)
    4. Current working directory (./prisma-bridge)
    5. User's home directory (~/.prisma/bridge)
    """
    # 1. Environment variable override
    env_dir = os.environ.get('PRISMA_BRIDGE_DIR')
    if env_dir:
        path = Path(env_dir)
        if path.exists() and (path / 'package.json').exists():
            return path
        log.warning('PRISMA_BRIDGE_DIR=%s does not contain a valid bridge', env_dir)

    # 2. Bundled with package
    bundled = Path(__file__).parent.parent / 'bridge'
    if bundled.exists() and (bundled / 'package.json').exists():
        return bundled

    # 3. Adjacent to package (for development or git clone installs)
    # Go from src/prisma/engine/ up to root
    package_root = Path(__file__).parent.parent.parent.parent
    adjacent = package_root / 'prisma-bridge'
    if adjacent.exists() and (adjacent / 'package.json').exists():
        return adjacent

    # 4. Current working directory
    cwd_bridge = Path.cwd() / 'prisma-bridge'
    if cwd_bridge.exists() and (cwd_bridge / 'package.json').exists():
        return cwd_bridge

    # 5. User's home directory
    home_bridge = Path.home() / '.prisma' / 'bridge'
    if home_bridge.exists() and (home_bridge / 'package.json').exists():
        return home_bridge

    return None


def _check_node_available() -> tuple[bool, str]:
    """Check if Node.js is available and return version."""
    try:
        result = subprocess.run(
            ['node', '--version'],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            version = result.stdout.strip()
            # Check minimum version (18+)
            version_num = version.lstrip('v').split('.')[0]
            if int(version_num) >= 18:
                return True, version
            return False, f'Node.js {version} found, but v18+ is required'
        return False, 'Node.js not working properly'
    except FileNotFoundError:
        return False, 'Node.js not found. Please install Node.js 18+ from https://nodejs.org'
    except subprocess.TimeoutExpired:
        return False, 'Node.js check timed out'
    except Exception as e:
        return False, f'Error checking Node.js: {e}'


def _check_npm_available() -> tuple[bool, str]:
    """Check if npm is available."""
    try:
        result = subprocess.run(
            ['npm', '--version'],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return True, result.stdout.strip()
        return False, 'npm not working properly'
    except FileNotFoundError:
        return False, 'npm not found. Please install Node.js 18+ from https://nodejs.org'
    except subprocess.TimeoutExpired:
        return False, 'npm check timed out'
    except Exception as e:
        return False, f'Error checking npm: {e}'


class BaseServiceEngine:
    """Base class for service-based engine communication."""

    service_url: str
    dml_path: Path
    _bridge_process: subprocess.Popen[bytes] | None
    _bridge_dir: Path | None

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
        self._bridge_dir = None

    def _is_bridge_running(self) -> bool:
        """Check if bridge is already running by connecting to health endpoint."""
        import socket
        from urllib.parse import urlparse

        parsed = urlparse(self.service_url)
        host = parsed.hostname or 'localhost'
        port = parsed.port or 4466

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        try:
            sock.connect((host, port))
            sock.close()
            return True
        except (ConnectionRefusedError, socket.timeout, OSError):
            return False
        finally:
            sock.close()

    def _wait_for_bridge_ready(self, timeout: float = BRIDGE_STARTUP_TIMEOUT) -> bool:
        """Wait for bridge to be ready by polling health endpoint."""
        import urllib.request
        import urllib.error

        health_url = f'{self.service_url}/health'
        start = time.monotonic()

        while time.monotonic() - start < timeout:
            try:
                req = urllib.request.Request(health_url, method='GET')
                with urllib.request.urlopen(req, timeout=2) as response:
                    if response.status == 200:
                        data = json.loads(response.read().decode())
                        if data.get('status') == 'ok':
                            log.info('Bridge service ready in %.2fs', time.monotonic() - start)
                            return True
            except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, OSError):
                pass

            # Check if process died
            if self._bridge_process and self._bridge_process.poll() is not None:
                returncode = self._bridge_process.returncode
                stderr = ''
                if self._bridge_process.stderr:
                    stderr = self._bridge_process.stderr.read().decode()
                log.error('Bridge process exited with code %d: %s', returncode, stderr)
                return False

            time.sleep(0.5)

        return False

    def _start_bridge_if_needed(self) -> None:
        """Start the bridge service if auto_start_bridge is enabled."""
        if not self._auto_start_bridge:
            return

        # Check if bridge is already running
        if self._is_bridge_running():
            log.debug('Bridge service already running at %s', self.service_url)
            return

        # Find bridge directory
        self._bridge_dir = _find_bridge_directory()
        if self._bridge_dir is None:
            raise errors.EngineConnectionError(
                'Prisma Bridge service not found.\n\n'
                'The bridge service is required for Prisma Client Python v0.13.0+.\n\n'
                'Options:\n'
                '1. Set PRISMA_BRIDGE_DIR to the bridge directory path\n'
                '2. Clone the repo and run from the project root\n'
                '3. Copy prisma-bridge/ to your project directory\n'
                '4. Set PRISMA_BRIDGE_AUTO_START=false and run bridge manually:\n'
                '   cd prisma-bridge && npm install && npm start\n\n'
                'See: https://github.com/RobertCraigie/prisma-client-py#quick-start'
            )

        # Check Node.js
        node_ok, node_msg = _check_node_available()
        if not node_ok:
            raise errors.EngineConnectionError(
                f'Node.js is required to run the Prisma Bridge service.\n\n'
                f'{node_msg}\n\n'
                'Alternatively, run the bridge in Docker:\n'
                '  cd prisma-bridge && docker-compose up -d\n'
                '  export PRISMA_BRIDGE_AUTO_START=false'
            )

        # Check npm
        npm_ok, npm_msg = _check_npm_available()
        if not npm_ok:
            raise errors.EngineConnectionError(
                f'npm is required to run the Prisma Bridge service.\n\n'
                f'{npm_msg}'
            )

        # Check if node_modules exists, if not run npm install
        node_modules = self._bridge_dir / 'node_modules'
        if not node_modules.exists():
            log.info('Installing bridge dependencies (npm install)...')
            try:
                result = subprocess.run(
                    ['npm', 'install'],
                    cwd=str(self._bridge_dir),
                    capture_output=True,
                    text=True,
                    timeout=120,  # 2 minutes for npm install
                )
                if result.returncode != 0:
                    raise errors.EngineConnectionError(
                        f'Failed to install bridge dependencies:\n{result.stderr}'
                    )
            except subprocess.TimeoutExpired:
                raise errors.EngineConnectionError(
                    'npm install timed out. Please run manually:\n'
                    f'  cd {self._bridge_dir} && npm install'
                )

        # Parse port from service URL
        from urllib.parse import urlparse
        parsed = urlparse(self.service_url)
        port = parsed.port or 4466

        # Start the bridge service
        log.info('Starting bridge service at %s...', self.service_url)

        env = os.environ.copy()
        env['PORT'] = str(port)
        env['PRISMA_BRIDGE_PORT'] = str(port)
        
        # Pass the schema path so the bridge can use the project's schema
        # Look for schema.prisma in common locations relative to the dml_path
        schema_candidates = [
            self.dml_path,  # Directly provided path
            self.dml_path.parent / 'schema.prisma' if self.dml_path.is_file() else None,
            Path.cwd() / 'schema.prisma',
            Path.cwd() / 'prisma' / 'schema.prisma',
        ]
        
        for candidate in schema_candidates:
            if candidate and candidate.exists():
                env['PRISMA_SCHEMA_PATH'] = str(candidate)
                log.debug('Found project schema at %s', candidate)
                break

        # Use npm start (compiled JS) instead of npm run dev (ts-node) for reliability
        # npm start runs the pre-compiled JavaScript, avoiding ts-node dependency issues
        cmd = ['npm', 'start']

        self._bridge_process = subprocess.Popen(
            cmd,
            cwd=str(self._bridge_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        atexit.register(self._stop_bridge)

        # Wait for bridge to be ready with proper health check
        if not self._wait_for_bridge_ready():
            self._stop_bridge()
            raise errors.EngineConnectionError(
                f'Bridge service failed to start within {BRIDGE_STARTUP_TIMEOUT}s.\n\n'
                'Check the bridge logs or try running manually:\n'
                f'  cd {self._bridge_dir} && npm run dev\n\n'
                'Common issues:\n'
                '- DATABASE_URL not set\n'
                '- Port 4466 already in use\n'
                '- Missing prisma generate'
            )

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
        auto_start_bridge: bool | None = None,
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
        """Fetch metrics from the bridge service."""
        try:
            if format == 'prometheus':
                # Fetch from /metrics endpoint
                data = self.request('GET', '/metrics')
                return data if isinstance(data, str) else ''
            else:
                # Return structured metrics
                return self.request('GET', '/metrics/json')
        except Exception:
            # Fallback to empty metrics if endpoint not available
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
        auto_start_bridge: bool | None = None,
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
        """Fetch metrics from the bridge service."""
        try:
            if format == 'prometheus':
                data = await self.request('GET', '/metrics')
                return data if isinstance(data, str) else ''
            else:
                return await self.request('GET', '/metrics/json')
        except Exception:
            if format == 'prometheus':
                return ''
            return {'counters': [], 'gauges': [], 'histograms': []}
