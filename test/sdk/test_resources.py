"""Unit tests for ResourceHub and ResourceMetadata."""

import hashlib
import json
import os

import pytest
from unittest.mock import patch, MagicMock

from kankyouken.resources import ResourceHub, ResourceMetadata


# ------------------------------------------------------------------ #
# Test data                                                           #
# ------------------------------------------------------------------ #

SAMPLE_DATA = '{"metadata": {}, "data": []}'
SAMPLE_DATA_CHECKSUM = hashlib.sha256(SAMPLE_DATA.encode()).hexdigest()

SAMPLE_MANIFEST = {
    "version": "1.0.0",
    "updated_at": "2026-01-02T07:09:24Z",
    "resources": [
        {
            "id": "test_dict",
            "version": "2025.1.0",
            "tier": 1,
            "type": "dictionary",
            "title": "Test Dictionary",
            "description": "A test resource",
            "size_bytes": len(SAMPLE_DATA.encode()),
            "checksum": SAMPLE_DATA_CHECKSUM,
            "url": "https://example.com/releases/download/v1/test_dict_v2025.1.0.json",
            "format": "json",
            "license": {"name": "MIT", "url": "https://example.com"},
            "source": {"name": "Test"},
            "dependencies": [],
            "tags": ["test", "dictionary"],
            "citation": "Test citation",
        },
        {
            "id": "test_analytics",
            "version": "2025.1.0",
            "tier": 1,
            "type": "analytics",
            "title": "Test Analytics",
            "size_bytes": 10,
            "checksum": "abc123" + "0" * 58,
            "url": "https://example.com/releases/download/v1/test_analytics_v2025.1.0.json",
            "format": "json",
            "tags": ["analytics"],
        },
        {
            "id": "remote_resource",
            "version": "2025.1.0",
            "tier": 2,
            "type": "benchmark",
            "title": "Remote Benchmark",
            "size_bytes": 50_000_000,
            "checksum": "def456" + "0" * 58,
            "url": "https://example.com/releases/download/v1/benchmark.json",
            "format": "json",
            "tags": ["benchmark"],
        },
    ],
}


def _mock_manifest():
    """Create a mock for importlib.resources.files('kankyouken.bundled')."""
    mock_pkg = MagicMock()

    def joinpath_side_effect(filename):
        mock_file = MagicMock()
        if filename == "manifest.json":
            mock_file.read_text.return_value = json.dumps(SAMPLE_MANIFEST)
        else:
            mock_file.read_text.side_effect = FileNotFoundError(filename)
        return mock_file

    mock_pkg.joinpath.side_effect = joinpath_side_effect
    return mock_pkg


# ------------------------------------------------------------------ #
# ResourceMetadata tests                                              #
# ------------------------------------------------------------------ #

class TestResourceMetadata:

    def test_from_dict_full(self):
        entry = SAMPLE_MANIFEST["resources"][0]
        meta = ResourceMetadata.from_dict(entry)

        assert meta.id == "test_dict"
        assert meta.version == "2025.1.0"
        assert meta.tier == 1
        assert meta.type == "dictionary"
        assert meta.title == "Test Dictionary"
        assert meta.filename == "test_dict_v2025.1.0.json"
        assert meta.citation == "Test citation"
        assert "test" in meta.tags

    def test_from_dict_minimal(self):
        entry = {
            "id": "minimal",
            "version": "1.0.0",
            "tier": 2,
            "type": "analytics",
            "title": "Minimal",
            "size_bytes": 100,
            "checksum": "aaa",
            "url": "https://example.com/data.json",
        }
        meta = ResourceMetadata.from_dict(entry)

        assert meta.description == ""
        assert meta.dependencies == []
        assert meta.tags == []
        assert meta.filename == "data.json"

    def test_frozen_immutability(self):
        meta = ResourceMetadata.from_dict(SAMPLE_MANIFEST["resources"][0])
        with pytest.raises(AttributeError):
            meta.id = "changed"

    def test_filename_extracts_from_url(self):
        meta = ResourceMetadata.from_dict(SAMPLE_MANIFEST["resources"][0])
        assert meta.filename == "test_dict_v2025.1.0.json"


# ------------------------------------------------------------------ #
# ResourceHub tests                                                   #
# ------------------------------------------------------------------ #

class TestResourceHub:

    @patch("kankyouken.resources.files")
    def test_list_resources_all(self, mock_files):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub()

        resources = hub.list_resources()
        assert len(resources) == 3

    @patch("kankyouken.resources.files")
    def test_list_resources_by_tier(self, mock_files):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub()

        tier1 = hub.list_resources(tier=1)
        assert len(tier1) == 2
        assert all(r.tier == 1 for r in tier1)

        tier2 = hub.list_resources(tier=2)
        assert len(tier2) == 1
        assert tier2[0].id == "remote_resource"

    @patch("kankyouken.resources.files")
    def test_list_resources_by_type(self, mock_files):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub()

        dicts = hub.list_resources(type="dictionary")
        assert len(dicts) == 1
        assert dicts[0].id == "test_dict"

    @patch("kankyouken.resources.files")
    def test_list_resources_by_tag(self, mock_files):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub()

        results = hub.list_resources(tag="analytics")
        assert len(results) == 1
        assert results[0].id == "test_analytics"

    @patch("kankyouken.resources.files")
    def test_getitem_found(self, mock_files):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub()

        meta = hub["test_dict"]
        assert isinstance(meta, ResourceMetadata)
        assert meta.id == "test_dict"

    @patch("kankyouken.resources.files")
    def test_getitem_not_found(self, mock_files):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub()

        with pytest.raises(KeyError, match="nonexistent"):
            hub["nonexistent"]

    @patch("kankyouken.resources.files")
    def test_contains(self, mock_files):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub()

        assert "test_dict" in hub
        assert "nonexistent" not in hub

    @patch("kankyouken.resources.files")
    def test_len(self, mock_files):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub()

        assert len(hub) == 3

    @patch("kankyouken.resources.files")
    def test_manifest_version(self, mock_files):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub()

        assert hub.manifest_version == "1.0.0"

    @patch("kankyouken.resources.files")
    def test_load_from_cache(self, mock_files, tmp_path):
        """Loading reads from local cache when file exists."""
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub(cache_dir=str(tmp_path))

        # Pre-populate cache
        cache_file = tmp_path / "test_dict_v2025.1.0.json"
        cache_file.write_text(SAMPLE_DATA)

        data = hub.load("test_dict")
        assert isinstance(data, dict)
        assert "metadata" in data

    @patch("kankyouken.resources.files")
    def test_load_caches_in_memory(self, mock_files, tmp_path):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub(cache_dir=str(tmp_path))

        (tmp_path / "test_dict_v2025.1.0.json").write_text(SAMPLE_DATA)

        data1 = hub.load("test_dict")
        data2 = hub.load("test_dict")
        assert data1 is data2

    @patch("kankyouken.resources.files")
    def test_load_force_reload(self, mock_files, tmp_path):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub(cache_dir=str(tmp_path))

        (tmp_path / "test_dict_v2025.1.0.json").write_text(SAMPLE_DATA)

        data1 = hub.load("test_dict")
        data2 = hub.load("test_dict", force_reload=True)
        assert data1 is not data2
        assert data1 == data2

    @patch("kankyouken.resources.files")
    def test_load_unknown_raises_key_error(self, mock_files, tmp_path):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub(cache_dir=str(tmp_path))

        with pytest.raises(KeyError, match="unknown"):
            hub.load("unknown")

    @patch("kankyouken.resources.requests.get")
    @patch("kankyouken.resources.files")
    def test_load_downloads_when_not_cached(self, mock_files, mock_get, tmp_path):
        """load() downloads the file if not in cache."""
        mock_files.return_value = _mock_manifest()

        mock_resp = MagicMock()
        mock_resp.iter_content.return_value = [SAMPLE_DATA.encode()]
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        hub = ResourceHub(cache_dir=str(tmp_path))
        data = hub.load("test_dict")

        mock_get.assert_called_once()
        assert "metadata" in data
        assert (tmp_path / "test_dict_v2025.1.0.json").exists()

    @patch("kankyouken.resources.files")
    def test_load_offline_mode_raises_when_not_cached(self, mock_files, tmp_path):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub(cache_dir=str(tmp_path), offline_mode=True)

        with pytest.raises(ConnectionError, match="offline_mode"):
            hub.load("test_dict")

    @patch("kankyouken.resources.requests.get")
    @patch("kankyouken.resources.files")
    def test_download_verifies_checksum(self, mock_files, mock_get, tmp_path):
        """Download with bad checksum raises RuntimeError."""
        mock_files.return_value = _mock_manifest()

        mock_resp = MagicMock()
        mock_resp.iter_content.return_value = [b"corrupted data"]
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        hub = ResourceHub(cache_dir=str(tmp_path))

        with pytest.raises(RuntimeError, match="Checksum mismatch"):
            hub.load("test_dict")

        # Temp file should be cleaned up
        assert not (tmp_path / "test_dict_v2025.1.0.json").exists()
        assert not (tmp_path / "test_dict_v2025.1.0.tmp").exists()

    @patch("kankyouken.resources.files")
    def test_validate_cached_resources(self, mock_files, tmp_path):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub(cache_dir=str(tmp_path))

        # Cache one valid file, one invalid
        (tmp_path / "test_dict_v2025.1.0.json").write_bytes(SAMPLE_DATA.encode())
        (tmp_path / "test_analytics_v2025.1.0.json").write_bytes(b"wrong data")

        results = hub.validate()

        assert results["test_dict"] is True
        assert results["test_analytics"] is False
        assert "remote_resource" not in results  # not cached

    @patch("kankyouken.resources.files")
    def test_validate_single_resource(self, mock_files, tmp_path):
        mock_files.return_value = _mock_manifest()
        hub = ResourceHub(cache_dir=str(tmp_path))

        (tmp_path / "test_dict_v2025.1.0.json").write_bytes(SAMPLE_DATA.encode())

        results = hub.validate(resource_id="test_dict")
        assert len(results) == 1
        assert results["test_dict"] is True

    @patch("kankyouken.resources.files")
    def test_lazy_manifest_loading(self, mock_files):
        mock_pkg = _mock_manifest()
        mock_files.return_value = mock_pkg
        hub = ResourceHub()

        mock_pkg.joinpath.assert_not_called()
        hub.list_resources()
        mock_pkg.joinpath.assert_called_with("manifest.json")

    def test_default_cache_dir(self):
        hub = ResourceHub()
        assert str(hub._cache_dir).endswith("kankyouken/resources")

    def test_custom_cache_dir(self):
        hub = ResourceHub(cache_dir="/tmp/custom_cache")
        assert str(hub._cache_dir) == "/tmp/custom_cache"
