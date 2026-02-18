/**
 * Study roles supported by KanKyouKen
 *
 * These roles are used across:
 * - study_roles table (who has access to a study)
 * - study_invitations table (what role an invite grants)
 * - Edge Functions (RBAC enforcement)
 *
 * Future: Could be extended to support custom study-specific roles
 * (e.g., different participant groups with different permissions)
 */

export const STUDY_ROLES = [
  "owner",
  "supervisor",
  "researcher",
  "teacher",
  "participant",
] as const;

export type StudyRole = (typeof STUDY_ROLES)[number];

/**
 * Roles that can be granted via invite links
 * (owner is excluded - must be set directly via roles-assign)
 */
export const INVITABLE_ROLES = [
  { value: "supervisor", label: "Supervisor" },
  { value: "researcher", label: "Researcher" },
  { value: "teacher", label: "Teacher" },
  { value: "participant", label: "Participant" },
] as const;

/**
 * Role hierarchy for permission checks
 * Higher number = more permissions
 */
export const ROLE_LEVELS: Record<StudyRole, number> = {
  owner: 100,
  supervisor: 80,
  researcher: 60,
  teacher: 40,
  participant: 20,
};
