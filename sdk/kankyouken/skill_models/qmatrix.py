"""
Q-Matrix and Skill Decomposition for Kanji Learning

A Q-matrix maps items (kanji) to skills (knowledge components).
This enables knowledge tracing models to:
1. Transfer learning between related kanji
2. Diagnose specific skill weaknesses
3. Optimize practice order

For kanji, we decompose into multiple skill types:
- Modality: Recognition vs Production (separate KCs per literature)
- Radical components (214 Kangxi radicals)
- Phonetic components (~130 sound-indicating components)
- Reading patterns (on'yomi families)

See Appendix A for literature justification of recognition/production split.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Set, Optional, Any
import json


class SkillType(Enum):
    """Categories of knowledge components for kanji."""
    RECOGNITION = "recognition"  # See kanji → produce meaning/reading
    PRODUCTION = "production"    # See meaning → produce kanji
    RADICAL = "radical"          # Recognition of radical components
    PHONETIC = "phonetic"        # Sound-indicating component knowledge
    SEMANTIC = "semantic"        # Meaning-indicating component knowledge
    READING_PATTERN = "reading"  # Specific reading (e.g., 生 as セイ vs なま)


@dataclass
class Skill:
    """A knowledge component in the Q-matrix."""
    skill_id: str
    skill_type: SkillType
    name: str
    description: str = ""
    prerequisites: List[str] = field(default_factory=list)

    # For radicals/components
    component: Optional[str] = None
    stroke_count: Optional[int] = None

    # For readings
    reading: Optional[str] = None
    reading_type: Optional[str] = None  # "on" or "kun"


@dataclass
class QMatrixEntry:
    """
    Maps one item (kanji) to its required skills.

    The binary Q-matrix indicates which skills are needed
    to correctly respond to each item.
    """
    item_id: str  # The kanji character
    skills: Set[str] = field(default_factory=set)  # skill_ids

    # Metadata
    modality: str = "recognition"  # or "production"
    difficulty: Optional[float] = None


class KanjiQMatrix:
    """
    Q-matrix for kanji knowledge tracing.

    Maps kanji to knowledge components based on:
    1. Modality (recognition vs production)
    2. Radical decomposition (from KRADFILE)
    3. Phonetic series (optional, from phonetic component data)

    Example:
        >>> qmatrix = KanjiQMatrix()
        >>> qmatrix.build_from_resourcehub(resource_hub)
        >>> skills = qmatrix.get_skills_for_item('学')
        >>> print(skills)  # ['radical:子', 'radical:冖', 'phonetic:学']
    """

    def __init__(self):
        self.skills: Dict[str, Skill] = {}
        self.items: Dict[str, QMatrixEntry] = {}
        self._built = False

    def build_from_resourcehub(
        self,
        resource_hub: Any,
        include_radicals: bool = True,
        include_phonetics: bool = False,
        kanji_subset: Optional[List[str]] = None,
    ) -> None:
        """
        Build Q-matrix from ResourceHub data.

        Args:
            resource_hub: ResourceHub instance
            include_radicals: Include radical-based skills
            include_phonetics: Include phonetic component skills
            kanji_subset: Limit to specific kanji (e.g., JLPT N5)
        """
        # Load KRADFILE for radical decomposition
        if include_radicals:
            kradfile = resource_hub.load("kradfile_u")
            self._add_radical_skills(kradfile)
            self._map_kanji_to_radicals(kradfile, kanji_subset)

        # Add recognition/production skills for each kanji
        if kanji_subset:
            for kanji in kanji_subset:
                self._add_modality_skills(kanji)

        self._built = True

    def _add_radical_skills(self, kradfile: Dict) -> None:
        """Create skills for each radical component."""
        radicals = kradfile.get("data", {}).get("radical_catalog", {})

        for radical, info in radicals.items():
            skill_id = f"radical:{radical}"
            self.skills[skill_id] = Skill(
                skill_id=skill_id,
                skill_type=SkillType.RADICAL,
                name=f"Radical {radical}",
                description=info.get("meaning", ""),
                component=radical,
                stroke_count=info.get("stroke_count"),
            )

    def _map_kanji_to_radicals(
        self,
        kradfile: Dict,
        kanji_subset: Optional[List[str]],
    ) -> None:
        """Map each kanji to its radical skills."""
        kanji_to_radicals = kradfile.get("data", {}).get("kanji_to_radicals", {})

        for kanji, radicals in kanji_to_radicals.items():
            if kanji_subset and kanji not in kanji_subset:
                continue

            # Recognition entry
            rec_entry = QMatrixEntry(
                item_id=f"{kanji}:recognition",
                skills={f"radical:{r}" for r in radicals},
                modality="recognition",
            )
            self.items[rec_entry.item_id] = rec_entry

            # Production entry (separate KC)
            prod_entry = QMatrixEntry(
                item_id=f"{kanji}:production",
                skills={f"radical:{r}" for r in radicals},
                modality="production",
            )
            self.items[prod_entry.item_id] = prod_entry

    def _add_modality_skills(self, kanji: str) -> None:
        """Add recognition and production skills for a kanji."""
        # Recognition skill
        rec_id = f"recognition:{kanji}"
        self.skills[rec_id] = Skill(
            skill_id=rec_id,
            skill_type=SkillType.RECOGNITION,
            name=f"Recognize {kanji}",
            description=f"See {kanji} and produce meaning/reading",
        )

        # Production skill (requires recognition as prerequisite)
        prod_id = f"production:{kanji}"
        self.skills[prod_id] = Skill(
            skill_id=prod_id,
            skill_type=SkillType.PRODUCTION,
            name=f"Produce {kanji}",
            description=f"See meaning and produce {kanji}",
            prerequisites=[rec_id],  # Hierarchy: production requires recognition
        )

    def get_skills_for_item(self, item_id: str) -> Set[str]:
        """Get all skills required for an item."""
        if item_id in self.items:
            return self.items[item_id].skills
        return set()

    def get_items_for_skill(self, skill_id: str) -> List[str]:
        """Get all items that require a skill (for transfer analysis)."""
        return [
            item_id for item_id, entry in self.items.items()
            if skill_id in entry.skills
        ]

    def get_skill_overlap(self, item1: str, item2: str) -> Set[str]:
        """Get shared skills between two items (transfer potential)."""
        skills1 = self.get_skills_for_item(item1)
        skills2 = self.get_skills_for_item(item2)
        return skills1 & skills2

    def to_binary_matrix(self) -> Dict[str, Dict[str, int]]:
        """
        Export as binary Q-matrix for knowledge tracing models.

        Returns dict of {item_id: {skill_id: 0 or 1}}
        """
        matrix = {}
        all_skills = list(self.skills.keys())

        for item_id, entry in self.items.items():
            matrix[item_id] = {
                skill: 1 if skill in entry.skills else 0
                for skill in all_skills
            }

        return matrix

    def export_for_pyBKT(self) -> Dict[str, Any]:
        """
        Export in format suitable for pyBKT library.

        Returns dict with 'skills' and 'items' suitable for BKT fitting.
        """
        return {
            "skills": {
                skill_id: {
                    "name": skill.name,
                    "type": skill.skill_type.value,
                }
                for skill_id, skill in self.skills.items()
            },
            "items": {
                item_id: list(entry.skills)
                for item_id, entry in self.items.items()
            },
        }


# Convenience functions

def build_jlpt_qmatrix(
    resource_hub: Any,
    jlpt_level: int,
) -> KanjiQMatrix:
    """
    Build Q-matrix for kanji at a specific JLPT level.

    Args:
        resource_hub: ResourceHub instance
        jlpt_level: 5 (easiest) to 1 (hardest)

    Returns:
        KanjiQMatrix for that JLPT level
    """
    # Get JLPT kanji list
    jlpt = resource_hub.load("jlpt_mappings")
    level_key = f"N{jlpt_level}"
    kanji_list = jlpt.get("data", {}).get("level_to_kanji", {}).get(level_key, [])

    # Build Q-matrix
    qmatrix = KanjiQMatrix()
    qmatrix.build_from_resourcehub(
        resource_hub,
        include_radicals=True,
        kanji_subset=kanji_list,
    )

    return qmatrix


def compute_transfer_matrix(qmatrix: KanjiQMatrix) -> Dict[str, Dict[str, float]]:
    """
    Compute pairwise transfer potential between items.

    Transfer = Jaccard similarity of skill sets.
    Higher values indicate more learning transfer expected.
    """
    items = list(qmatrix.items.keys())
    transfer = {}

    for i, item1 in enumerate(items):
        transfer[item1] = {}
        skills1 = qmatrix.get_skills_for_item(item1)

        for item2 in items:
            if item1 == item2:
                transfer[item1][item2] = 1.0
                continue

            skills2 = qmatrix.get_skills_for_item(item2)

            intersection = len(skills1 & skills2)
            union = len(skills1 | skills2)

            transfer[item1][item2] = intersection / union if union > 0 else 0.0

    return transfer
