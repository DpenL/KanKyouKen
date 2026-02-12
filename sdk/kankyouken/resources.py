"""
ResourceHub - Versioned research data access for KanKyouKen.

Provides on-demand access to kanji reference datasets following the
BioConductor AnnotationHub pattern. Resources are downloaded on first
use and cached locally.

Example::

    from kankyouken import ResourceHub

    hub = ResourceHub()
    hub.list_resources()
    data = hub.load("kanjidic2_core")
    print(data["metadata"]["character_count"])  # 13108
"""

import hashlib
import json
import logging
import requests
from dataclasses import dataclass, field
from importlib.resources import files
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ------------------------------------------------------------------ #
# ResourceMetadata                                                    #
# ------------------------------------------------------------------ #

@dataclass(frozen=True)
class ResourceMetadata:
    """Metadata for a single resource in the ResourceHub manifest."""

    id: str
    version: str
    tier: int
    type: str
    title: str
    size_bytes: int
    checksum: str
    url: str
    description: str = ""
    format: str = "json"
    license: Dict[str, str] = field(default_factory=dict)
    source: Dict[str, str] = field(default_factory=dict)
    dependencies: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    citation: str = ""

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ResourceMetadata":
        """Create ResourceMetadata from a manifest resource entry."""
        return cls(
            id=data["id"],
            version=data["version"],
            tier=data["tier"],
            type=data["type"],
            title=data["title"],
            size_bytes=data["size_bytes"],
            checksum=data["checksum"],
            url=data["url"],
            description=data.get("description", ""),
            format=data.get("format", "json"),
            license=data.get("license", {}),
            source=data.get("source", {}),
            dependencies=data.get("dependencies", []),
            tags=data.get("tags", []),
            citation=data.get("citation", ""),
        )

    @property
    def filename(self) -> str:
        """Extract filename from URL."""
        return self.url.rsplit("/", 1)[-1]


# ------------------------------------------------------------------ #
# ResourceHub                                                         #
# ------------------------------------------------------------------ #

class ResourceHub:
    """Access point for versioned KanKyouKen research datasets.

    Resources are downloaded on first use and cached locally. The manifest
    (resource catalog) ships with the SDK package; data files are fetched
    from GitHub Releases.

    Args:
        cache_dir: Directory for caching downloaded resources.
            Defaults to ~/.cache/kankyouken/resources/.
        offline_mode: If True, only use already-cached resources.

    Example::

        hub = ResourceHub()
        hub.list_resources()
        data = hub.load("kanjidic2_core")
        print(data["metadata"]["character_count"])  # 13108
    """

    DEFAULT_CACHE_DIR = "~/.cache/kankyouken/resources"

    def __init__(
        self,
        cache_dir: Optional[str] = None,
        offline_mode: bool = False,
    ):
        self._cache_dir = Path(cache_dir or self.DEFAULT_CACHE_DIR).expanduser()
        self._offline_mode = offline_mode
        self._manifest: Optional[Dict[str, Any]] = None
        self._resources: Optional[Dict[str, ResourceMetadata]] = None
        self._loaded: Dict[str, Any] = {}

    # ------------------------------------------------------------------
    # Manifest loading (lazy)
    # ------------------------------------------------------------------

    def _ensure_manifest(self) -> None:
        """Load manifest from SDK package data if not already loaded."""
        if self._manifest is not None:
            return

        bundled_pkg = files("kankyouken.bundled")
        manifest_text = bundled_pkg.joinpath("manifest.json").read_text(encoding="utf-8")
        self._manifest = json.loads(manifest_text)

        self._resources = {}
        for entry in self._manifest.get("resources", []):
            meta = ResourceMetadata.from_dict(entry)
            self._resources[meta.id] = meta

        logger.debug(
            "Loaded manifest v%s with %d resources",
            self._manifest.get("version"),
            len(self._resources),
        )

    @property
    def manifest_version(self) -> str:
        """Version string of the loaded manifest."""
        self._ensure_manifest()
        return self._manifest["version"]

    # ------------------------------------------------------------------
    # Discovery
    # ------------------------------------------------------------------

    def list_resources(
        self,
        tier: Optional[int] = None,
        type: Optional[str] = None,
        tag: Optional[str] = None,
    ) -> List[ResourceMetadata]:
        """List available resources with optional filtering.

        Args:
            tier: Filter by tier (1, 2, or 3).
            type: Filter by resource type ('dictionary', 'analytics', etc.).
            tag: Filter by tag (e.g. 'jlpt', 'radicals').

        Returns:
            List of ResourceMetadata matching the filters.
        """
        self._ensure_manifest()
        results = list(self._resources.values())

        if tier is not None:
            results = [r for r in results if r.tier == tier]
        if type is not None:
            results = [r for r in results if r.type == type]
        if tag is not None:
            results = [r for r in results if tag in r.tags]

        return results

    def __getitem__(self, resource_id: str) -> ResourceMetadata:
        """Get metadata for a resource by ID.

        Raises:
            KeyError: If resource_id is not found in the manifest.
        """
        self._ensure_manifest()
        if resource_id not in self._resources:
            available = ", ".join(sorted(self._resources.keys()))
            raise KeyError(
                f"Resource '{resource_id}' not found. "
                f"Available: {available}"
            )
        return self._resources[resource_id]

    def __contains__(self, resource_id: str) -> bool:
        self._ensure_manifest()
        return resource_id in self._resources

    def __len__(self) -> int:
        self._ensure_manifest()
        return len(self._resources)

    # ------------------------------------------------------------------
    # Cache management
    # ------------------------------------------------------------------

    def _cache_path(self, metadata: ResourceMetadata) -> Path:
        """Return the local cache file path for a resource."""
        return self._cache_dir / metadata.filename

    def _is_cached(self, metadata: ResourceMetadata) -> bool:
        """Check if a resource is already cached locally."""
        return self._cache_path(metadata).exists()

    # ------------------------------------------------------------------
    # Loading
    # ------------------------------------------------------------------

    def load(self, resource_id: str, force_reload: bool = False) -> Dict[str, Any]:
        """Load a resource's data, returning the parsed JSON dict.

        Downloads the resource on first use and caches it locally.
        Subsequent calls return the in-memory cached copy unless
        force_reload=True.

        Args:
            resource_id: The resource identifier (e.g. 'kanjidic2_core').
            force_reload: If True, bypass in-memory cache (re-reads from
                disk, but does not re-download).

        Returns:
            Parsed JSON dict containing metadata and resource-specific data
            (e.g. 'characters', 'radicals', 'jlpt_levels').

        Raises:
            KeyError: If resource_id is not in the manifest.
            ConnectionError: If download fails and resource is not cached.
            RuntimeError: If checksum verification fails.
        """
        metadata = self[resource_id]

        if not force_reload and resource_id in self._loaded:
            return self._loaded[resource_id]

        if not self._is_cached(metadata):
            self._download(metadata)

        data = self._read_cached(metadata)
        self._loaded[resource_id] = data
        return data

    def _download(self, metadata: ResourceMetadata) -> None:
        """Download a resource and verify its checksum."""
        if self._offline_mode:
            raise ConnectionError(
                f"Resource '{metadata.id}' is not cached and offline_mode=True. "
                f"Run with offline_mode=False to download."
            )

        self._cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = self._cache_path(metadata)

        logger.info("Downloading '%s' from %s", metadata.id, metadata.url)

        resp = requests.get(metadata.url, stream=True, timeout=60)
        resp.raise_for_status()

        tmp_path = cache_path.with_suffix(".tmp")
        sha = hashlib.sha256()
        with open(tmp_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)
                sha.update(chunk)

        actual_checksum = sha.hexdigest()
        if actual_checksum != metadata.checksum:
            tmp_path.unlink()
            raise RuntimeError(
                f"Checksum mismatch for '{metadata.id}': "
                f"expected {metadata.checksum}, got {actual_checksum}"
            )

        tmp_path.rename(cache_path)
        logger.info("Cached '%s' (%d bytes)", metadata.id, metadata.size_bytes)

    def _read_cached(self, metadata: ResourceMetadata) -> Dict[str, Any]:
        """Read a resource from the local cache."""
        cache_path = self._cache_path(metadata)
        if not cache_path.exists():
            raise FileNotFoundError(
                f"Resource '{metadata.id}' not found in cache at {cache_path}. "
                f"Call hub.load('{metadata.id}') to download it."
            )

        with open(cache_path, encoding="utf-8") as f:
            data = json.load(f)

        logger.debug("Loaded '%s' from cache", metadata.id)
        return data

    # ------------------------------------------------------------------
    # Validation
    # ------------------------------------------------------------------

    def validate(self, resource_id: Optional[str] = None) -> Dict[str, bool]:
        """Verify SHA-256 checksums of cached resources.

        Args:
            resource_id: Validate only this resource. If None, validates
                all cached resources.

        Returns:
            Dict mapping resource IDs to True (valid) or False (mismatch).
            Only includes resources that are cached locally.
        """
        self._ensure_manifest()

        if resource_id is not None:
            targets = [self[resource_id]]
        else:
            targets = list(self._resources.values())

        results = {}
        for meta in targets:
            cache_path = self._cache_path(meta)
            if not cache_path.exists():
                continue

            sha = hashlib.sha256()
            with open(cache_path, "rb") as f:
                for chunk in iter(lambda: f.read(8192), b""):
                    sha.update(chunk)

            actual = sha.hexdigest()
            results[meta.id] = actual == meta.checksum
            if not results[meta.id]:
                logger.warning(
                    "Checksum mismatch for '%s': expected %s, got %s",
                    meta.id, meta.checksum, actual,
                )

        return results
