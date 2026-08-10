# P0E-S4 Product Surface Inventory

Date: 2026-08-01  
Scope: shipped Vite client modules/routes and mounted Express endpoint surfaces

## Client route inventory

| Route                | Access                           | Current disposition                                                                             | Owning next phase                              |
| -------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `/`                  | Public                           | Active marketing shell; remote placeholder artwork removed and capability copy narrowed.        | P0E-S5 media review, then feature owners       |
| `/auth`              | Public/signed-out                | Active versioned identity UX.                                                                   | P0F browser evidence                           |
| `/dashboard`         | Authenticated                    | Active; broken Notes/Job Simulation links and the unowned Job Simulation card removed.          | P1C progress integration                       |
| `/pathways`          | Authenticated                    | Active compatibility learning-path UI.                                                          | P1C                                            |
| `/sandbox`           | Authenticated                    | Active compatibility learning/practice UI.                                                      | P1B/P5A                                        |
| `/profile`           | Authenticated                    | Active compatibility profile UI.                                                                | P3A                                            |
| `/settings`          | Authenticated                    | Active theme/session/social-privacy UI; two inert “Coming Soon” sections removed.               | P2/P3 feature owners                           |
| `/provider`          | Authenticated, verified email    | Active organization onboarding, verification, staff invitation, and draft-course provider center. | P2A/P2B                                        |
| `/challenges`        | Authenticated                    | Active compatibility challenge catalog.                                                         | P1A/P1B                                        |
| `/challenges/new`    | Authenticated                    | Active compatibility authoring UI; not a secure provider workflow.                              | P1A                                            |
| `/challenges/:id`    | Authenticated                    | Active compatibility solver/comment UI.                                                         | P1A/P1B                                        |
| `/courses`           | Authenticated                    | Active learner compatibility catalog/viewer.                                                    | P1C/P2                                         |
| `/space`             | Authenticated                    | Active social/creative compatibility UI; fake direct messaging action removed.                  | P3/P4                                          |
| `/company/dashboard` | Authenticated bookmark tombstone | Always redirects to `/dashboard`; the unsafe/unreachable legacy provider component was removed. | P2A/P2B replace it with organization-scoped UI |
| `/admin`             | Authenticated superadmin         | Active versioned authority/provider-review UI.                                                  | P2A/P3D extensions                             |
| `*`                  | Any                              | Accessible unavailable-route state.                                                             | Permanent shell behavior                       |

The provider redirect is intentionally retained so an old bookmark fails closed without activating retired company-course handlers. It is not a provider feature flag.

The learner course route also no longer contains its unreachable private employee-ID modal; Phase 2 will add invitation-based private enrollment through the organization model.

## Shipped component inventory

Every file below is reachable from `client/src/main.tsx`; `scripts/tests/client-product-surface.test.mjs` fails if an orphan source/asset appears.

| Component              | Reuse/disposition                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `AnimatedBackground`   | Active decorative shell primitive; respects reduced motion.                                                                            |
| `AppDropdown`          | Active shared keyboard single-select primitive.                                                                                        |
| `AppErrorBoundary`     | Active top-level recovery boundary.                                                                                                    |
| `AppShell`             | Active shell/landmark/composition owner.                                                                                               |
| `CodeEditor`           | Active pinned Monaco compatibility boundary; self-hosted workers/assets remain owned by Phase 5.                                       |
| `CustomCursor`         | Active optional decorative effect; assistively hidden and motion-aware.                                                                |
| `Header`               | Active desktop/mobile navigation and timer/account composition.                                                                        |
| `HeroSection`          | Active home presentation.                                                                                                              |
| `LanguageNetwork`      | Active decorative home canvas; duplicate embedded CSS removed in favor of its imported stylesheet and static reduced-motion rendering. |
| `NotesWidget`          | Active compatibility Notes workflow; fake Share action and obsolete mobile-warning CSS removed.                                        |
| `PomodoroTimer`        | Active local timer with accessible settings/dialog behavior.                                                                           |
| `ProfileDropdown`      | Active account menu.                                                                                                                   |
| `ProviderCenter`       | Active organization-scoped provider onboarding and course-management surface.                                                          |
| `RestrictedMarkdown`   | Active safe React-node content renderer.                                                                                               |
| `ScrollProgress`       | Active decorative/navigation progress primitive.                                                                                       |
| `ScrollTrackRow`       | Active named horizontal-overflow primitive.                                                                                            |
| `SessionSecurityPanel` | Active versioned session list/revoke UI.                                                                                               |
| `AccessibleDialog`     | Active shared modal-focus primitive.                                                                                                   |
| `AccessibleMedia`      | Active sole direct video/audio renderer.                                                                                               |
| `AsyncState`           | Active shared loading/error/empty/status primitive.                                                                                    |

Removed unreachable source:

- `client/src/App.css`: never imported; duplicated global shell rules and would have hidden the system cursor.
- `client/src/components/MobileWarningOverlay.{js,css}`: no active import after responsive routes stopped blocking mobile users.
- `client/src/pages/company/CompanyDashboard.{js,css}`: no route/import, coupled to legacy `accountType`, and called company-course endpoints that already return `410`.
- The unused PrismJS theme/import/package was removed after Monaco became the sole challenge editor.

Preserved data/runtime compatibility:

- No user, course, provider, note, upload or Job Simulation data was deleted.
- The legacy `jobSims` Mongoose field remains migration/retention evidence even though the unowned broken dashboard card is removed.
- Retained compatibility endpoint families remain mounted only through the lifecycle registry and are retired by their recorded phase owners.

## Versioned `/api/v1` endpoint inventory

The generated OpenAPI document remains canonical. All current operations are listed here to freeze the P0E-S4 surface.

| Method   | Path under `/api/v1`                                 | Operation ID                      |
| -------- | ---------------------------------------------------- | --------------------------------- |
| `GET`    | `/openapi.json`                                      | `getOpenApiDocument`              |
| `GET`    | `/health/live`                                       | `getLiveness`                     |
| `GET`    | `/health/ready`                                      | `getReadiness`                    |
| `GET`    | `/health/dependencies`                               | `getDependencyReadiness`          |
| `POST`   | `/auth/register`                                     | `register`                        |
| `POST`   | `/auth/login`                                        | `login`                           |
| `POST`   | `/auth/refresh`                                      | `refreshSession`                  |
| `POST`   | `/auth/logout`                                       | `logout`                          |
| `POST`   | `/auth/logout-all`                                   | `logoutAll`                       |
| `POST`   | `/auth/email/verify/request`                         | `requestEmailVerification`        |
| `POST`   | `/auth/email/verify/confirm`                         | `confirmEmailVerification`        |
| `POST`   | `/auth/password/forgot`                              | `requestPasswordReset`            |
| `POST`   | `/auth/password/reset`                               | `resetPassword`                   |
| `GET`    | `/auth/google/start`                                 | `startGoogleLogin`                |
| `GET`    | `/auth/google/callback`                              | `completeGoogleLogin`             |
| `GET`    | `/me`                                                | `getMe`                           |
| `GET`    | `/me/preferences/theme`                              | `getMyTheme`                      |
| `PUT`    | `/me/preferences/theme`                              | `updateMyTheme`                   |
| `GET`    | `/me/sessions`                                       | `listMySessions`                  |
| `DELETE` | `/me/sessions/{sessionId}`                           | `revokeMySession`                 |
| `GET`    | `/organizations`                                     | `listMyOrganizations`             |
| `POST`   | `/organizations`                                     | `createOrganization`              |
| `POST`   | `/organization-invitations/{token}/accept`           | `acceptOrganizationInvitation`    |
| `GET`    | `/admin/provider-verifications`                      | `listProviderVerificationReviews` |
| `POST`   | `/admin/provider-verifications/{reviewId}/decision`  | `decideProviderVerification`      |
| `GET`    | `/organizations/{organizationId}`                    | `getOrganization`                 |
| `PATCH`  | `/organizations/{organizationId}`                    | `updateOrganization`              |
| `GET`    | `/organizations/{organizationId}/members`            | `listOrganizationMembers`         |
| `POST`   | `/organizations/{organizationId}/invitations`        | `inviteOrganizationMember`        |
| `PATCH`  | `/organizations/{organizationId}/members/{userId}`   | `updateOrganizationMember`        |
| `DELETE` | `/organizations/{organizationId}/members/{userId}`   | `removeOrganizationMember`        |
| `POST`   | `/organizations/{organizationId}/verification`       | `submitProviderVerification`      |
| `GET`    | `/admin/audit-events`                                | `listAuthorityAuditEvents`        |
| `GET`    | `/admin/users`                                       | `listAuthorityUsers`              |
| `PATCH`  | `/admin/users/{userId}/platform-role`                | `changePlatformRole`              |
| `PATCH`  | `/admin/users/{userId}/status`                       | `changeAccountStatus`             |
| `POST`   | `/organizations/{organizationId}/ownership-transfer` | `transferOrganizationOwnership`   |
| `POST`   | `/files/upload-intents`                              | `createFileUploadIntent`          |
| `GET`    | `/files/{fileId}`                                    | `getFileMetadata`                 |
| `DELETE` | `/files/{fileId}`                                    | `deleteFile`                      |
| `POST`   | `/files/{fileId}/complete`                           | `completeFileUpload`              |
| `POST`   | `/files/{fileId}/download`                           | `createFileDownload`              |
| `PATCH`  | `/files/{fileId}/visibility`                         | `setFileVisibility`               |
| `GET`    | `/challenges`                                        | `listChallenges`                  |
| `GET`    | `/challenges/{challengeId}`                          | `getChallenge`                    |
| `POST`   | `/challenges`                                        | `createChallenge`                 |
| `POST`   | `/challenges/{challengeId}/publish`                  | `publishChallenge`                |
| `POST`   | `/challenges/{challengeId}/run`                      | `runChallengeCode`                |
| `POST`   | `/challenges/{challengeId}/submit`                   | `submitChallengeCode`             |
| `GET`    | `/challenges/{challengeId}/submissions`              | `listChallengeSubmissions`        |
| `GET`    | `/challenges/{challengeId}/submissions/{submissionId}` | `getChallengeSubmission`          |
| `GET`    | `/courses`                                           | `listCourses`                     |
| `GET`    | `/courses/{courseId}`                                | `getCourse`                       |
| `POST`   | `/courses/{courseId}/enroll`                         | `enrollInCourse`                  |
| `GET`    | `/courses/{courseId}/progress`                       | `getCourseProgress`               |
| `GET`    | `/courses/{courseId}/lessons/{contentId}/progress`   | `getLessonProgress`               |
| `PATCH`  | `/courses/{courseId}/lessons/{contentId}/progress`   | `updateLessonProgress`            |
| `GET`    | `/lms/provider/organizations/{organizationId}/dashboard` | `getProviderDashboard`         |
| `GET`    | `/lms/provider/organizations/{organizationId}/courses/{courseId}/staff` | `listCourseStaff`       |
| `PUT`    | `/lms/provider/organizations/{organizationId}/courses/{courseId}/staff/{userId}` | `setCourseStaffRole` |
| `GET`    | `/lms/provider/organizations/{organizationId}/courses/{courseId}/structure` | `getCourseStructure`   |
| `PUT`    | `/lms/provider/organizations/{organizationId}/courses/{courseId}/structure` | `replaceCourseStructure` |
| `GET`    | `/lms/provider/organizations/{organizationId}/courses/{courseId}/roster` | `getCourseRoster`       |
| `PATCH`  | `/lms/provider/organizations/{organizationId}/courses/{courseId}/enrollments/{enrollmentId}` | `updateCourseEnrollment` |
| `POST`   | `/lms/provider/organizations/{organizationId}/courses/{courseId}/invitations` | `inviteCourseLearner` |
| `GET`    | `/lms/provider/organizations/{organizationId}/courses/{courseId}/grading` | `listAssignmentGrading` |
| `GET`    | `/lms/provider/organizations/{organizationId}/courses/{courseId}/quiz-grading` | `listQuizGrading` |
| `PUT`    | `/lms/provider/organizations/{organizationId}/courses/{courseId}/quiz-attempts/{attemptId}/grade` | `gradeQuizAttempt` |
| `PUT`    | `/lms/provider/organizations/{organizationId}/courses/{courseId}/submissions/{submissionId}/grade` | `gradeAssignmentSubmission` |
| `GET`    | `/lms/provider/organizations/{organizationId}/payments` | `listPaymentReviews`             |
| `GET`    | `/lms/provider/organizations/{organizationId}/payment-settings` | `getPaymentSettings`        |
| `PUT`    | `/lms/provider/organizations/{organizationId}/payment-settings` | `setPaymentSettings`        |
| `PUT`    | `/lms/provider/organizations/{organizationId}/payments/{orderId}/review` | `reviewManualPayment`  |
| `GET`    | `/lms/provider/organizations/{organizationId}/courses/{courseId}/analytics` | `getProviderCourseAnalytics` |
| `GET`    | `/lms/provider/organizations/{organizationId}/courses/{courseId}/analytics.csv` | `exportProviderCourseAnalytics` |
| `POST`   | `/lms/invitations/{token}/accept`                    | `acceptCourseInvitation`         |
| `POST`   | `/lms/courses/{courseId}/quizzes/{quizId}/attempts`  | `submitCourseQuiz`               |
| `POST`   | `/lms/courses/{courseId}/assignments/{assignmentId}/submissions` | `submitCourseAssignment` |
| `POST`   | `/lms/courses/{courseId}/payment-orders`             | `createCoursePaymentOrder`       |
| `PUT`    | `/lms/payment-orders/{orderId}/proof`                | `attachCoursePaymentProof`       |
| `GET`    | `/lms/courses/{courseId}/results`                    | `getLearnerCourseResults`        |

## Legacy endpoint-family disposition

| Mount             | State                                          | Replacement                  | Final owner                       |
| ----------------- | ---------------------------------------------- | ---------------------------- | --------------------------------- |
| `/api/auth`       | Tombstone                                      | `/api/v1/auth`               | `P0D-S6`                          |
| `/api/code`       | Retired (HTTP 410 after PostgreSQL cutover)    | `/api/v1/execution`          | `P1B`                             |
| `/api/ai`         | Compatibility                                  | `/api/v1/learning-assistant` | `P1B`                             |
| `/api/youtube`    | Compatibility                                  | `/api/v1/videos`             | `P1C`                             |
| `/api/roadmap`    | Compatibility                                  | `/api/v1/learning-paths`     | `P1C`                             |
| `/api/user`       | Compatibility                                  | `/api/v1/me`                 | `P1C`                             |
| `/api/challenges` | Compatibility                                  | `/api/v1/challenges`         | `P1B`                             |
| `/api/courses`    | Compatibility, with company subtree tombstoned | `/api/v1/courses`            | `P1C`; provider replacement is P2 |
| `/api/admin`      | Tombstone                                      | `/api/v1/admin`              | `P0B-S6`                          |
| `/api/space`      | Retired (HTTP 410 after PostgreSQL cutover)    | `/api/v1/space`              | `P3`                              |

## Exact legacy verb inventory

`/api/auth/*` is one catch-all `410` tombstone. The other static handlers are:

| File            | Method   | Route under family mount                   |
| --------------- | -------- | ------------------------------------------ |
| `admin.js`      | `GET`    | `/companies/pending`                       |
| `admin.js`      | `PUT`    | `/companies/:id/approve`                   |
| `admin.js`      | `DELETE` | `/companies/:id/reject`                    |
| `admin.js`      | `GET`    | `/companies/approved`                      |
| `admin.js`      | `PUT`    | `/companies/:id/revoke`                    |
| `admin.js`      | `DELETE` | `/users/:id`                               |
| `admin.js`      | `PUT`    | `/users/:id/ban`                           |
| `admin.js`      | `GET`    | `/users`                                   |
| `admin.js`      | `PUT`    | `/users/:id/role`                          |
| `ai.js`         | `POST`   | `/chat`                                    |
| `ai.js`         | `GET`    | `/sandbox-history`                         |
| `ai.js`         | `GET`    | `/chat-history`                            |
| `ai.js`         | `DELETE` | `/sandbox-history`                         |
| `ai.js`         | `POST`   | `/debug`                                   |
| `challenges.js` | `POST`   | `/`                                        |
| `challenges.js` | `POST`   | `/:id/submit`                              |
| `challenges.js` | `GET`    | `/`                                        |
| `challenges.js` | `GET`    | `/leaderboard`                             |
| `challenges.js` | `GET`    | `/:id`                                     |
| `challenges.js` | `POST`   | `/:id/like`                                |
| `challenges.js` | `POST`   | `/:id/dislike`                             |
| `challenges.js` | `POST`   | `/:id/comments`                            |
| `challenges.js` | `POST`   | `/:id/comments/:commentId/reply`           |
| `challenges.js` | `POST`   | `/:id/comments/:commentId/like`            |
| `challenges.js` | `POST`   | `/:id/comments/:commentId/dislike`         |
| `challenges.js` | `POST`   | `/:id/comments/:commentId/award`           |
| `challenges.js` | `DELETE` | `/:id/comments/:commentId`                 |
| `challenges.js` | `DELETE` | `/:id`                                     |
| `code.js`       | `POST`   | `/run`                                     |
| `courses.js`    | `GET`    | `/company/mine`                            |
| `courses.js`    | `GET`    | `/company/enrollments`                     |
| `courses.js`    | `POST`   | `/company/create`                          |
| `courses.js`    | `PUT`    | `/company/:courseId`                       |
| `courses.js`    | `DELETE` | `/company/:courseId`                       |
| `courses.js`    | `GET`    | `/learner/enrolled`                        |
| `courses.js`    | `GET`    | `/`                                        |
| `courses.js`    | `GET`    | `/:id`                                     |
| `courses.js`    | `POST`   | `/:id/enroll`                              |
| `courses.js`    | `PUT`    | `/:id/progress`                            |
| `roadmap.js`    | `POST`   | `/generate`                                |
| `roadmap.js`    | `GET`    | `/my-roadmaps`                             |
| `roadmap.js`    | `PUT`    | `/progress`                                |
| `roadmap.js`    | `DELETE` | `/:roadmapId`                              |
| `space.js`      | `GET`    | `/leaderboard`                             |
| `space.js`      | `GET`    | `/posts`                                   |
| `space.js`      | `POST`   | `/posts`                                   |
| `space.js`      | `DELETE` | `/posts/:id`                               |
| `space.js`      | `PUT`    | `/posts/:id/:action`                       |
| `space.js`      | `POST`   | `/posts/:id/award`                         |
| `space.js`      | `POST`   | `/posts/:id/comment`                       |
| `space.js`      | `POST`   | `/posts/:id/comment/:commentId/reply`      |
| `space.js`      | `POST`   | `/posts/:id/comment/:commentId/like`       |
| `space.js`      | `POST`   | `/posts/:id/comment/:commentId/dislike`    |
| `space.js`      | `POST`   | `/posts/:id/comment/:commentId/save`       |
| `space.js`      | `POST`   | `/posts/:id/comment/:commentId/award`      |
| `space.js`      | `DELETE` | `/posts/:id/comment/:commentId`            |
| `space.js`      | `GET`    | `/projects`                                |
| `space.js`      | `GET`    | `/projects/mine`                           |
| `space.js`      | `POST`   | `/projects`                                |
| `space.js`      | `PUT`    | `/projects/:id/milestone/:milestoneId`     |
| `space.js`      | `PUT`    | `/projects/:id/like`                       |
| `space.js`      | `DELETE` | `/projects/:id`                            |
| `space.js`      | `GET`    | `/profile/me`                              |
| `space.js`      | `GET`    | `/profile/:id`                             |
| `space.js`      | `POST`   | `/network/follow/:id`                      |
| `space.js`      | `POST`   | `/network/follow-request/:id/:status`      |
| `space.js`      | `POST`   | `/network/block/:id`                       |
| `space.js`      | `POST`   | `/network/remove-follower/:id`             |
| `user.js`       | `GET`    | `/me`                                      |
| `user.js`       | `PUT`    | `/me`                                      |
| `user.js`       | `POST`   | `/upload-picture`                          |
| `user.js`       | `PUT`    | `/save-challenge/:id`                      |
| `user.js`       | `GET`    | `/theme`                                   |
| `user.js`       | `PUT`    | `/theme`                                   |
| `user.js`       | `PUT`    | `/video-progress`                          |
| `user.js`       | `GET`    | `/video-progress/:videoId`                 |
| `user.js`       | `GET`    | `/notes`                                   |
| `user.js`       | `POST`   | `/notes`                                   |
| `user.js`       | `PUT`    | `/notes/:noteId`                           |
| `user.js`       | `DELETE` | `/notes/:noteId`                           |
| `user.js`       | `POST`   | `/notes/:noteId/upload`                    |
| `user.js`       | `DELETE` | `/notes/:noteId/attachments/:attachmentId` |
| `youtube.js`    | `GET`    | `/search`                                  |

## Non-route transport surface

- `/uploads` is development-only compatibility static delivery; production returns `410` and new file flows use authorized `/api/v1/files` operations.
- Unknown `/api/v1` and application routes use centralized not-found/problem handling.
- Compatibility families can be globally changed to their retirement response by the guarded persistence cutover setting; no family is deleted before its final owner verifies the replacement.

## Acceptance and fallback

- All shipped client modules/assets are entrypoint-reachable.
- There is no visible “Coming Soon” action, fake next-update action, remote placeholder image, or link to nonexistent `/notes` or `/simulations` routes.
- Provider preview code is removed while its redirect tombstone and source data remain.
- If an incomplete future feature must be shown before its owning phase, expose a truthful noninteractive preview behind a reviewed capability contract; do not revive deleted compatibility UI or silently enable a retired endpoint.
