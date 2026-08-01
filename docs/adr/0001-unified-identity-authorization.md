# ADR 0001: Unified identity and scoped authorization contract

- **Status:** Accepted
- **Date:** 2026-08-01
- **Roadmap item:** `P0B-S1`
- **Decision owners:** CodeWithMee platform engineering

## Context

The current repository authenticates learners and companies as different MongoDB document types, embeds `accountType` in long-lived JWTs, and performs authorization through route-local string checks. A person therefore cannot safely be both a learner and provider staff, provider status is inconsistently enforced, and role claims become stale until the token expires. Course ownership is usually inferred from a company identifier rather than a current membership plus resource scope.

The target PostgreSQL schema is implemented in Phase 0C, but its identity, session and authorization semantics must be fixed before Phase 0B session and organization work. Otherwise the API, migration scripts and UI would each invent incompatible role meanings.

## Decision

### One human identity

- A `user` is the single human principal. Provider/company credentials do not remain a second login class.
- A user has one current platform role: `learner`, `moderator`, `superadmin`, or the optional least-privilege `support` role.
- Local and Google credentials are authentication identities attached to that user. A user may have both.
- An organization is a provider tenant. Users join it through independently revocable memberships and may belong to multiple organizations.
- Email verification is a principal attribute, not a role. Sensitive actions can require it in addition to permission.

### Session and token boundary

- Access tokens carry only `iss`, `aud`, `sub` (user ID), `sid` (session ID), `iat`, and `exp`.
- Platform role, account status, email verification, organization membership and course assignment are loaded from current server-side state. Clients and stale token claims are never authorization authorities.
- Web and extension sessions are separate client classes. Refresh-token storage, rotation, reuse detection and revocation are implemented in `P0B-S2`.
- Recent authentication is a separate policy fact derived from server-controlled session/authentication time. A caller cannot assert it in request data.

### Status contracts

- User status is `active`, `suspended`, `banned`, or `deletion_pending`. Only `active` principals can receive ordinary grants.
- Organization verification status is `draft`, `pending_review`, `approved`, `rejected`, or `suspended`.
- Membership status is `active`, `suspended`, or `revoked`; invitations remain separate records and do not confer membership.
- Course-staff assignment status is `active` or `inactive`.

### Role layers

Platform roles are independent from tenant roles. They grant platform operations such as moderation, provider verification or user administration, but never automatically grant private organization, course, submission, payment-proof, or file access.

Organization roles are `owner`, `admin`, `instructor`, `grader`, and `analyst`. The first two manage tenant and course lifecycle within their organization. Instructor, grader and analyst access is course-scoped except for the minimum organization profile or aggregate analytics needed by that role.

Course staff roles are `manager`, `instructor`, `grader`, `analyst`, and `payment_reviewer`:

- owner/admin memberships may hold any course role; owner/admin also retain their organization-level course powers;
- instructor, grader and analyst memberships may hold only the matching course role;
- a course assignment intersects with the organization membership and can never elevate it;
- instructor publishing requires the explicit `publishAllowed` grant and an approved organization;
- payment review requires an explicit `payment_reviewer` assignment, even for privileged organization members;
- all course checks bind the course to the same organization as the active membership.

Idea collaborator roles remain resource-specific and are implemented with Phase 4 policy work; they do not become organization or platform roles.

### Policy evaluation

Every protected operation supplies a server-built principal, a stable permission identifier, and only the applicable target context:

```text
principal(userId, sessionId, status, emailVerified, platformRole)
  + permission
  + target user / organization / membership / course / course assignment
  + server-derived recent-auth fact
  -> allow or deny(reason, grant source)
```

Evaluation is deny-by-default. It checks active account status, self scope, verified-email and recent-auth gates, exact tenant/parent scope, active membership, provider approval, role ceiling and resource assignment. Unknown permissions deny rather than throw or fall through. Decision reason and grant source are safe for structured audit metadata, not for disclosing protected resource existence.

Break-glass is a separately audited workflow. `superadmin` can request it after recent authentication but does not receive protected bytes or tenant content from ordinary role evaluation.

The executable contract lives in:

- `server/modules/identity/contracts.js`
- `server/modules/organizations/contracts.js`
- `server/modules/policies/permissions.js`
- `server/modules/policies/authorize.js`

Route middleware will adapt authenticated requests to this pure evaluator in `P0B-S4`; this ADR does not authorize continued `accountType` checks as a target design.

## Persistence consequences for Phase 0C

- `users.platform_role`, `users.status`, and `users.email_verified_at` are authoritative current state.
- identities and sessions use opaque IDs; access-token `sub`/`sid` map to those records.
- refresh-token hashes are normalized into session token rows with `current`/`consumed` state so rotation and reuse-triggered family revocation are transactional; the temporary Mongo adapter embeds this bounded-lifetime history inside the session document.
- membership uniqueness is `(organization_id, user_id)` and the last-active-owner invariant is transactional.
- `course_staff` stores the narrowed role, status and explicit instructor-publish flag and must reference a user with an active membership in the parent organization.
- provider approval gates are evaluated from the organization row, not copied into a token or course row.
- role/status/membership/assignment/ownership changes create append-only audit events.

## Transition from legacy accounts

Phase 0C migration matches normalized learner and company-admin emails. Unambiguous company admins become users plus owner memberships. Ambiguous or colliding records are quarantined and resolved through expiring provider-claim invitations; passwords are never copied into placeholder identities. Existing bearer tokens are invalidated at cutover unless the time-limited local compatibility mode in the roadmap is explicitly enabled. That compatibility mode is prohibited in production.

## Consequences

Benefits:

- one person can learn and work for multiple providers without multiple credentials;
- role/status changes take effect without waiting for JWT expiry;
- tenant and child-resource checks have an explicit, testable contract;
- course staffing supports least privilege without inventing company-shaped tokens;
- future web and extension sessions share identity while retaining distinct clients/scopes.

Costs:

- protected requests need current principal and membership data, requiring indexed queries or short-lived invalidatable caches;
- the company-account migration may log users out and requires collision reporting;
- every legacy protected route must be mapped to a stable permission before `accountType` can be removed;
- course/payment operations need explicit context rather than convenient global admin bypasses.

## Safe fallback and rollback

If identity matching is ambiguous, keep the record quarantined and require a verified provider-claim invitation. If rotating-session deployment cannot safely convert a legacy token, revoke it and require sign-in. During local migration only, a time-limited compatibility adapter may translate a valid legacy identity into the new principal shape; it may not invent memberships, run in production, or bypass current status checks.

Rollback restores the prior application and read-only MongoDB snapshot together. New membership/role state must not be silently projected back into company JWT claims.

## Acceptance evidence

`server/test/authorization-contract.test.js` verifies enum stability, known grants, self/status/email/recent-auth gates, organization hierarchy, cross-tenant denial, pending-provider publishing denial, course-role ceilings, separately granted instructor publishing, and the absence of implicit superadmin tenant access.
