"""Tests for skill_models/qmatrix.py (KN-158)"""

import pytest
from kankyouken.skill_models.qmatrix import (
    SkillType,
    Skill,
    QMatrixEntry,
    KanjiQMatrix,
    compute_transfer_matrix,
)


class TestSkillType:
    def test_recognition_value(self):
        assert SkillType.RECOGNITION.value == "recognition"

    def test_production_value(self):
        assert SkillType.PRODUCTION.value == "production"

    def test_radical_value(self):
        assert SkillType.RADICAL.value == "radical"


class TestSkill:
    def test_basic_skill(self):
        skill = Skill(
            skill_id="recognition:学",
            skill_type=SkillType.RECOGNITION,
            name="Recognize 学",
        )
        assert skill.skill_id == "recognition:学"
        assert skill.skill_type == SkillType.RECOGNITION
        assert skill.prerequisites == []

    def test_production_skill_with_prereq(self):
        skill = Skill(
            skill_id="production:学",
            skill_type=SkillType.PRODUCTION,
            name="Produce 学",
            prerequisites=["recognition:学"],
        )
        assert "recognition:学" in skill.prerequisites


class TestQMatrixEntry:
    def test_basic_entry(self):
        entry = QMatrixEntry(
            item_id="学:recognition",
            skills={"radical:子", "radical:冖"},
            modality="recognition",
        )
        assert entry.item_id == "学:recognition"
        assert len(entry.skills) == 2


class TestKanjiQMatrix:
    @pytest.fixture
    def mock_resourcehub(self):
        """Mock ResourceHub returning minimal KRADFILE data."""
        class MockHub:
            def load(self, resource_name):
                if resource_name == "kradfile_u":
                    return {
                        "data": {
                            "kanji_to_radicals": {
                                "学": ["子", "冖"],
                                "語": ["言", "吾"],
                                "力": ["力"],
                            },
                            "radical_catalog": {
                                "子": {"meaning": "child", "stroke_count": 3},
                                "冖": {"meaning": "cover", "stroke_count": 2},
                                "言": {"meaning": "speech", "stroke_count": 7},
                                "吾": {"meaning": "I/myself", "stroke_count": 7},
                                "力": {"meaning": "power", "stroke_count": 2},
                            },
                        }
                    }
                return {}
        return MockHub()

    def test_build_from_resourcehub(self, mock_resourcehub):
        qmatrix = KanjiQMatrix()
        qmatrix.build_from_resourcehub(mock_resourcehub)
        assert qmatrix._built is True
        assert len(qmatrix.items) > 0

    def test_items_have_recognition_and_production(self, mock_resourcehub):
        qmatrix = KanjiQMatrix()
        qmatrix.build_from_resourcehub(mock_resourcehub)
        item_ids = list(qmatrix.items.keys())
        assert "学:recognition" in item_ids
        assert "学:production" in item_ids

    def test_skills_contain_radicals(self, mock_resourcehub):
        qmatrix = KanjiQMatrix()
        qmatrix.build_from_resourcehub(mock_resourcehub)
        skills = qmatrix.get_skills_for_item("学:recognition")
        assert "radical:子" in skills
        assert "radical:冖" in skills

    def test_kanji_subset_filtering(self, mock_resourcehub):
        qmatrix = KanjiQMatrix()
        qmatrix.build_from_resourcehub(mock_resourcehub, kanji_subset=["学"])
        item_ids = list(qmatrix.items.keys())
        # Only 学 items should be present
        assert "学:recognition" in item_ids
        assert "語:recognition" not in item_ids

    def test_get_skills_for_unknown_item(self, mock_resourcehub):
        qmatrix = KanjiQMatrix()
        qmatrix.build_from_resourcehub(mock_resourcehub)
        skills = qmatrix.get_skills_for_item("nonexistent:recognition")
        assert skills == set()

    def test_get_items_for_skill(self, mock_resourcehub):
        qmatrix = KanjiQMatrix()
        qmatrix.build_from_resourcehub(mock_resourcehub)
        items = qmatrix.get_items_for_skill("radical:子")
        assert "学:recognition" in items
        assert "学:production" in items

    def test_get_skill_overlap(self, mock_resourcehub):
        qmatrix = KanjiQMatrix()
        qmatrix.build_from_resourcehub(mock_resourcehub)
        # 学 and 語 share no radicals in our mock data
        overlap = qmatrix.get_skill_overlap("学:recognition", "語:recognition")
        assert overlap == set()

    def test_to_binary_matrix(self, mock_resourcehub):
        qmatrix = KanjiQMatrix()
        qmatrix.build_from_resourcehub(mock_resourcehub)
        matrix = qmatrix.to_binary_matrix()
        assert "学:recognition" in matrix
        # Each row has values 0 or 1
        row = matrix["学:recognition"]
        assert all(v in (0, 1) for v in row.values())

    def test_binary_matrix_correct_values(self, mock_resourcehub):
        qmatrix = KanjiQMatrix()
        qmatrix.build_from_resourcehub(mock_resourcehub)
        matrix = qmatrix.to_binary_matrix()
        gaku_row = matrix["学:recognition"]
        assert gaku_row.get("radical:子") == 1
        assert gaku_row.get("radical:冖") == 1
        # 学 does not use 言
        assert gaku_row.get("radical:言") == 0

    def test_export_for_pyBKT(self, mock_resourcehub):
        qmatrix = KanjiQMatrix()
        qmatrix.build_from_resourcehub(mock_resourcehub)
        export = qmatrix.export_for_pyBKT()
        assert "skills" in export
        assert "items" in export
        assert "学:recognition" in export["items"]

    def test_modality_skills_with_subset(self, mock_resourcehub):
        qmatrix = KanjiQMatrix()
        qmatrix.build_from_resourcehub(mock_resourcehub, kanji_subset=["学"])
        # Modality skills should exist for 学
        assert "recognition:学" in qmatrix.skills
        assert "production:学" in qmatrix.skills

    def test_production_skill_has_recognition_prerequisite(self, mock_resourcehub):
        qmatrix = KanjiQMatrix()
        qmatrix.build_from_resourcehub(mock_resourcehub, kanji_subset=["学"])
        prod_skill = qmatrix.skills["production:学"]
        assert "recognition:学" in prod_skill.prerequisites


class TestComputeTransferMatrix:
    def test_self_transfer_is_one(self):
        qmatrix = KanjiQMatrix()
        qmatrix.items["学:recognition"] = QMatrixEntry(
            item_id="学:recognition",
            skills={"radical:子", "radical:冖"},
        )
        transfer = compute_transfer_matrix(qmatrix)
        assert transfer["学:recognition"]["学:recognition"] == 1.0

    def test_no_shared_skills_zero_transfer(self):
        qmatrix = KanjiQMatrix()
        qmatrix.items["学:recognition"] = QMatrixEntry(
            item_id="学:recognition",
            skills={"radical:子"},
        )
        qmatrix.items["力:recognition"] = QMatrixEntry(
            item_id="力:recognition",
            skills={"radical:力"},
        )
        transfer = compute_transfer_matrix(qmatrix)
        assert transfer["学:recognition"]["力:recognition"] == 0.0

    def test_shared_skills_nonzero_transfer(self):
        qmatrix = KanjiQMatrix()
        qmatrix.items["a:recognition"] = QMatrixEntry(
            item_id="a:recognition",
            skills={"radical:子", "radical:冖"},
        )
        qmatrix.items["b:recognition"] = QMatrixEntry(
            item_id="b:recognition",
            skills={"radical:子"},
        )
        transfer = compute_transfer_matrix(qmatrix)
        # Jaccard: |{子}| / |{子, 冖}| = 1/2
        assert abs(transfer["a:recognition"]["b:recognition"] - 0.5) < 0.001
