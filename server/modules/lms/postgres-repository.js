'use strict';

const { randomBytes, createHash } = require('node:crypto');

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function createPostgresLmsRepository(pool) {
  if (!pool) throw new Error('PostgreSQL pool is required.');

  async function markContentCompleted(database, enrollmentId, contentId) {
    await database.query(
      `INSERT INTO lesson_progress
       (enrollment_id,content_id,status,last_position_sec,watched_intervals,completed_at,updated_at)
       VALUES ($1,$2,'COMPLETED',0,'[]'::jsonb,NOW(),NOW())
       ON CONFLICT (enrollment_id,content_id) DO UPDATE SET
         status='COMPLETED',completed_at=COALESCE(lesson_progress.completed_at,NOW()),updated_at=NOW()`,
      [enrollmentId, contentId],
    );
  }

  async function replaceStructure(organizationId, courseId, modules, expectedVersion = null) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const course = await client.query(
        `SELECT id FROM courses WHERE id=$1 AND organization_id=$2 AND active=true
         AND publication_status<>'retired' FOR UPDATE`,
        [courseId, organizationId],
      );
      if (!course.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }
      if (expectedVersion !== null) {
        const latest = await client.query(
          `SELECT version FROM course_versions WHERE course_id=$1 AND status IN ('draft','published')
           ORDER BY (status='draft') DESC,version DESC LIMIT 1`,
          [courseId],
        );
        if (!latest.rowCount || latest.rows[0].version !== expectedVersion) {
          throw Object.assign(new Error('structure_version_conflict'), { code: 'structure_version_conflict', status: 409 });
        }
      }
      await client.query("UPDATE course_versions SET status='retired' WHERE course_id=$1 AND status='draft'", [courseId]);
      const version = await client.query(
        `INSERT INTO course_versions (course_id, version, status, created_at)
         SELECT $1, COALESCE(MAX(version),0)+1, 'draft', NOW() FROM course_versions WHERE course_id=$1
         RETURNING id, version, status`,
        [courseId],
      );
      for (let moduleIndex = 0; moduleIndex < modules.length; moduleIndex++) {
        const moduleInput = modules[moduleIndex];
        const moduleResult = await client.query(
          `INSERT INTO course_modules (version_id,title,description,position)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [version.rows[0].id, moduleInput.title, moduleInput.description || null, moduleIndex],
        );
        for (let contentIndex = 0; contentIndex < (moduleInput.contents || []).length; contentIndex++) {
          const item = moduleInput.contents[contentIndex];
          if (item.mediaFileId) {
            const allowedMedia = await client.query(
              `SELECT 1 FROM files WHERE id=$1 AND owner_organization_id=$2
               AND purpose='course_video' AND state='ready' AND scan_status='clean'`,
              [item.mediaFileId, organizationId],
            );
            if (!allowedMedia.rowCount) {
              throw Object.assign(new Error('invalid_course_video_file'), { code: 'invalid_course_video_file' });
            }
          }
          const content = await client.query(
            `INSERT INTO course_contents
             (module_id,kind,title,legacy_url,body,allow_download,position,duration_seconds,challenge_id,media_file_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [moduleResult.rows[0].id, item.kind, item.title, item.url || null, item.body || null,
              Boolean(item.allowDownload), contentIndex, item.durationSeconds || null, item.challengeId || null,
              item.mediaFileId || null],
          );
          if (item.mediaFileId) {
            await client.query(
              `UPDATE files SET visibility='enrolled',updated_at=NOW()
               WHERE id=$1 AND owner_organization_id=$2 AND purpose='course_video'`,
              [item.mediaFileId, organizationId],
            );
          }
          if (item.resource) {
            if (item.resource.fileId) {
              const allowedFile = await client.query(
                `SELECT 1 FROM files WHERE id=$1 AND owner_organization_id=$2
                 AND purpose='course_resource' AND state='ready' AND scan_status='clean'`,
                [item.resource.fileId, organizationId],
              );
              if (!allowedFile.rowCount) {
                throw Object.assign(new Error('invalid_course_resource_file'), { code: 'invalid_course_resource_file' });
              }
            }
            await client.query(
              `INSERT INTO course_resources (content_id,file_id,external_url,notes,allow_download)
               VALUES ($1,$2,$3,$4,$5)`,
              [content.rows[0].id, item.resource.fileId || null, item.resource.externalUrl || null,
                item.resource.notes || null, Boolean(item.resource.allowDownload)],
            );
            if (item.resource.fileId && item.resource.allowDownload) {
              await client.query(
                `UPDATE files SET visibility='enrolled',updated_at=NOW()
                 WHERE id=$1 AND owner_organization_id=$2 AND purpose='course_resource'`,
                [item.resource.fileId, organizationId],
              );
            }
          }
          if (item.quiz) {
            const quiz = await client.query(
              `INSERT INTO course_quizzes (content_id,title,instructions,attempts_allowed,passing_score)
               VALUES ($1,$2,$3,$4,$5) RETURNING id`,
              [content.rows[0].id, item.quiz.title || item.title, item.quiz.instructions || null,
                item.quiz.attemptsAllowed || 1, item.quiz.passingScore ?? 70],
            );
            for (let questionIndex = 0; questionIndex < (item.quiz.questions || []).length; questionIndex++) {
              const question = item.quiz.questions[questionIndex];
              await client.query(
                `INSERT INTO course_quiz_questions
                 (quiz_id,position,kind,prompt,options,answer_key,points)
                 VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
                [quiz.rows[0].id, questionIndex, question.kind, question.prompt,
                  JSON.stringify(question.options || []), JSON.stringify(question.answerKey ?? null), question.points || 1],
              );
            }
          }
          if (item.assignment) {
            await client.query(
              `INSERT INTO course_assignments
               (content_id,title,instructions,due_at,max_attempts,max_score,rubric)
               VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
              [content.rows[0].id, item.assignment.title || item.title, item.assignment.instructions,
                item.assignment.dueAt || null, item.assignment.maxAttempts || 1,
                item.assignment.maxScore || 100, JSON.stringify(item.assignment.rubric || [])],
            );
          }
        }
      }
      await client.query('UPDATE courses SET updated_at=NOW() WHERE id=$1', [courseId]);
      await client.query('COMMIT');
      return version.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function getStructure(organizationId, courseId) {
    const version = await pool.query(
      `SELECT cv.id,cv.version,cv.status FROM course_versions cv JOIN courses c ON c.id=cv.course_id
       WHERE c.organization_id=$1 AND c.id=$2 AND cv.status IN ('draft','published')
       ORDER BY (cv.status='draft') DESC,cv.version DESC LIMIT 1`,
      [organizationId, courseId],
    );
    if (!version.rowCount) return null;
    const modules = await pool.query(
      'SELECT id,title,description,position FROM course_modules WHERE version_id=$1 ORDER BY position',
      [version.rows[0].id],
    );
    for (const moduleRow of modules.rows) {
      const contents = await pool.query(
        `SELECT id,kind,title,legacy_url,body,allow_download,position,duration_seconds,challenge_id,media_file_id
         FROM course_contents WHERE module_id=$1 ORDER BY position`,
        [moduleRow.id],
      );
      moduleRow.contents = [];
      for (const row of contents.rows) {
        const content = {
          id: row.id, kind: row.kind, title: row.title, url: row.legacy_url, body: row.body,
          allowDownload: row.allow_download, position: row.position, durationSeconds: row.duration_seconds,
          challengeId: row.challenge_id, mediaFileId: row.media_file_id,
        };
        if (row.kind === 'RESOURCE') {
          const resource = await pool.query(
            'SELECT file_id,external_url,notes,allow_download FROM course_resources WHERE content_id=$1',
            [row.id],
          );
          if (resource.rows[0]) content.resource = {
            fileId: resource.rows[0].file_id, externalUrl: resource.rows[0].external_url,
            notes: resource.rows[0].notes, allowDownload: resource.rows[0].allow_download,
          };
        }
        if (row.kind === 'QUIZ') {
          const quiz = await pool.query(
            'SELECT id,title,instructions,attempts_allowed,passing_score FROM course_quizzes WHERE content_id=$1',
            [row.id],
          );
          if (quiz.rows[0]) {
            const questions = await pool.query(
              `SELECT kind,prompt,options,answer_key,points FROM course_quiz_questions
               WHERE quiz_id=$1 ORDER BY position`,
              [quiz.rows[0].id],
            );
            content.quiz = {
              title: quiz.rows[0].title, instructions: quiz.rows[0].instructions,
              attemptsAllowed: quiz.rows[0].attempts_allowed, passingScore: quiz.rows[0].passing_score,
              questions: questions.rows.map((question) => ({
                kind: question.kind, prompt: question.prompt, options: question.options,
                answerKey: question.answer_key, points: question.points,
              })),
            };
          }
        }
        if (row.kind === 'ASSIGNMENT') {
          const assignment = await pool.query(
            `SELECT title,instructions,due_at,max_attempts,max_score,rubric
             FROM course_assignments WHERE content_id=$1`,
            [row.id],
          );
          if (assignment.rows[0]) content.assignment = {
            title: assignment.rows[0].title, instructions: assignment.rows[0].instructions,
            dueAt: assignment.rows[0].due_at, maxAttempts: assignment.rows[0].max_attempts,
            maxScore: assignment.rows[0].max_score, rubric: assignment.rows[0].rubric,
          };
        }
        moduleRow.contents.push(content);
      }
    }
    return { version: version.rows[0].version, modules: modules.rows.map((entry) => ({
      title: entry.title, description: entry.description, position: entry.position, contents: entry.contents,
    })) };
  }

  async function dashboard(organizationId) {
    const result = await pool.query(
      `SELECT
        (SELECT COUNT(*)::int FROM courses WHERE organization_id=$1 AND active=true) AS courses,
        (SELECT COUNT(*)::int FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE c.organization_id=$1) AS learners,
        (SELECT COUNT(*)::int FROM course_assignment_submissions s JOIN course_assignments a ON a.id=s.assignment_id JOIN course_contents cc ON cc.id=a.content_id JOIN course_modules cm ON cm.id=cc.module_id JOIN course_versions cv ON cv.id=cm.version_id JOIN courses c ON c.id=cv.course_id WHERE c.organization_id=$1 AND s.status='submitted') AS pending_grading,
        (SELECT COUNT(*)::int FROM course_payment_orders p JOIN courses c ON c.id=p.course_id WHERE c.organization_id=$1 AND p.status='pending_review') AS pending_payments`,
      [organizationId],
    );
    return result.rows[0];
  }

  async function listStaff(organizationId, courseId) {
    const result = await pool.query(
      `SELECT csa.user_id,csa.role,u.display_name,u.email_display FROM course_staff_assignments csa
       JOIN courses c ON c.id=csa.course_id JOIN users u ON u.id=csa.user_id
       WHERE c.organization_id=$1 AND c.id=$2 ORDER BY u.display_name`, [organizationId, courseId]);
    return result.rows;
  }

  async function setStaffRole(organizationId, courseId, userId, role) {
    const result = await pool.query(
      `INSERT INTO course_staff_assignments (course_id,user_id,role)
       SELECT c.id,$3,$4 FROM courses c JOIN organization_memberships om ON om.organization_id=c.organization_id AND om.user_id=$3 AND om.status='active'
       WHERE c.organization_id=$1 AND c.id=$2
       ON CONFLICT (course_id,user_id) DO UPDATE SET role=EXCLUDED.role RETURNING *`,
      [organizationId, courseId, userId, role],
    );
    return result.rows[0] || null;
  }

  async function roster(organizationId, courseId) {
    const result = await pool.query(
      `SELECT e.id,e.user_id,e.status,e.enrolled_at,e.completed_at,u.display_name,u.email_display
       FROM enrollments e JOIN users u ON u.id=e.user_id JOIN courses c ON c.id=e.course_id
       WHERE c.organization_id=$1 AND c.id=$2 ORDER BY e.enrolled_at DESC`,
      [organizationId, courseId],
    );
    return result.rows;
  }

  async function setEnrollmentStatus(organizationId, courseId, enrollmentId, status) {
    const result = await pool.query(
      `UPDATE enrollments e SET status=$4::"enrollment_status",updated_at=NOW()
       FROM courses c WHERE e.id=$3 AND e.course_id=c.id AND c.id=$2 AND c.organization_id=$1
       RETURNING e.*`,
      [organizationId, courseId, enrollmentId, status],
    );
    return result.rows[0] || null;
  }

  async function createInvitation(organizationId, courseId, email, invitedByUserId) {
    const token = randomBytes(32).toString('base64url');
    const result = await pool.query(
      `INSERT INTO course_invitations
       (course_id,email_normalized,token_hash,status,invited_by_user_id,expires_at)
       SELECT c.id,$3,$4,'pending',$5,NOW()+INTERVAL '7 days' FROM courses c
       WHERE c.id=$2 AND c.organization_id=$1 AND c.publication_status='published' AND c.active=true
       RETURNING id,course_id,email_normalized,status,expires_at`,
      [organizationId, courseId, email, hashToken(token), invitedByUserId],
    );
    return result.rowCount ? { invitation: result.rows[0], token } : null;
  }

  async function acceptInvitation(token, userId, email) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const invitation = await client.query(
        `UPDATE course_invitations SET status='accepted',accepted_at=NOW()
         WHERE token_hash=$1 AND email_normalized=$2 AND status='pending' AND expires_at>NOW()
         RETURNING course_id`,
        [hashToken(token), email],
      );
      if (!invitation.rowCount) { await client.query('ROLLBACK'); return null; }
      const enrollment = await client.query(
        `INSERT INTO enrollments (user_id,course_id,course_version_id,status,enrolled_at,created_at,updated_at)
         SELECT $1,$2,cv.id,'enrolled',NOW(),NOW(),NOW() FROM course_versions cv
         WHERE cv.course_id=$2 AND cv.status='published' ORDER BY cv.version DESC LIMIT 1
         ON CONFLICT (user_id,course_id) DO UPDATE SET status='enrolled',updated_at=NOW() RETURNING *`,
        [userId, invitation.rows[0].course_id],
      );
      await client.query('COMMIT');
      return enrollment.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async function submitQuiz(userId, courseId, quizId, answers) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const access = await client.query(
        `SELECT e.id AS enrollment_id,q.attempts_allowed,q.passing_score,cc.id AS content_id
         FROM enrollments e JOIN course_versions cv ON cv.id=e.course_version_id
         JOIN course_modules cm ON cm.version_id=cv.id JOIN course_contents cc ON cc.module_id=cm.id
         JOIN course_quizzes q ON q.content_id=cc.id WHERE e.user_id=$1 AND e.course_id=$2 AND q.id=$3 AND e.status IN ('enrolled','completed')`,
        [userId, courseId, quizId],
      );
      if (!access.rowCount) { await client.query('ROLLBACK'); return null; }
      const questions = await client.query('SELECT id,kind,answer_key,points FROM course_quiz_questions WHERE quiz_id=$1 ORDER BY position', [quizId]);
      let earned = 0; let total = 0; let written = false;
      for (const question of questions.rows) {
        total += question.points;
        if (question.kind === 'written') { written = true; continue; }
        const submittedAnswer = question.kind === 'multiple_choice' && Array.isArray(answers[question.id])
          ? [...answers[question.id]].sort()
          : answers[question.id];
        const expectedAnswer = question.kind === 'multiple_choice' && Array.isArray(question.answer_key)
          ? [...question.answer_key].sort()
          : question.answer_key;
        if (JSON.stringify(submittedAnswer) === JSON.stringify(expectedAnswer)) earned += question.points;
      }
      const count = await client.query('SELECT COUNT(*)::int AS count FROM course_quiz_attempts WHERE quiz_id=$1 AND enrollment_id=$2', [quizId, access.rows[0].enrollment_id]);
      const attemptNumber = count.rows[0].count + 1;
      if (attemptNumber > access.rows[0].attempts_allowed) { await client.query('ROLLBACK'); return null; }
      const score = total ? Math.round((earned / total) * 10000) / 100 : 0;
      const attempt = await client.query(
        `INSERT INTO course_quiz_attempts (quiz_id,enrollment_id,user_id,attempt_number,answers,score,status,submitted_at,graded_at,released_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,NOW(),CASE WHEN $7='graded' THEN NOW() END,CASE WHEN $7='graded' THEN NOW() END) RETURNING *`,
        [quizId, access.rows[0].enrollment_id, userId, attemptNumber, JSON.stringify(answers), score, written ? 'pending_grading' : 'graded'],
      );
      if (!written && score >= Number(access.rows[0].passing_score)) {
        await markContentCompleted(client, access.rows[0].enrollment_id, access.rows[0].content_id);
      }
      await client.query(
        `INSERT INTO course_learning_events (organization_id,course_id,user_id,event_type,source_id,event_data)
         SELECT c.organization_id,c.id,$1,'quiz_submitted',$3,jsonb_build_object('score',$4,'status',$5)
         FROM courses c WHERE c.id=$2`, [userId, courseId, quizId, score, written ? 'pending_grading' : 'graded']);
      await client.query('COMMIT'); return attempt.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async function submitAssignment(userId, courseId, assignmentId, writtenAnswer, fileIds) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const access = await client.query(
        `SELECT e.id AS enrollment_id,a.max_attempts,a.due_at FROM enrollments e
         JOIN course_versions cv ON cv.id=e.course_version_id JOIN course_modules cm ON cm.version_id=cv.id
         JOIN course_contents cc ON cc.module_id=cm.id JOIN course_assignments a ON a.content_id=cc.id
         WHERE e.user_id=$1 AND e.course_id=$2 AND a.id=$3 AND e.status IN ('enrolled','completed')`,
        [userId, courseId, assignmentId],
      );
      if (!access.rowCount) { await client.query('ROLLBACK'); return null; }
      if (access.rows[0].due_at && new Date(access.rows[0].due_at).getTime() < Date.now()) {
        throw Object.assign(new Error('assignment_due_date_passed'), { code: 'assignment_due_date_passed', status: 409 });
      }
      const count = await client.query('SELECT COUNT(*)::int AS count FROM course_assignment_submissions WHERE assignment_id=$1 AND enrollment_id=$2', [assignmentId, access.rows[0].enrollment_id]);
      const attemptNumber = count.rows[0].count + 1;
      if (attemptNumber > access.rows[0].max_attempts) { await client.query('ROLLBACK'); return null; }
      if (fileIds.length) {
        const validFiles = await client.query(
          `SELECT COUNT(*)::int AS count FROM files WHERE id=ANY($1::uuid[]) AND owner_user_id=$2
           AND state='ready' AND scan_status='clean' AND purpose='assignment_submission'`,
          [fileIds, userId],
        );
        if (validFiles.rows[0].count !== new Set(fileIds).size) {
          throw Object.assign(new Error('assignment_files_not_ready'), { code: 'assignment_files_not_ready', status: 409 });
        }
      }
      const submission = await client.query(
        `INSERT INTO course_assignment_submissions (assignment_id,enrollment_id,user_id,attempt_number,written_answer,status)
         VALUES ($1,$2,$3,$4,$5,'submitted') RETURNING *`,
        [assignmentId, access.rows[0].enrollment_id, userId, attemptNumber, writtenAnswer || null],
      );
      for (const fileId of fileIds) {
        await client.query(
          `INSERT INTO course_assignment_submission_files (submission_id,file_id)
           SELECT $1,id FROM files WHERE id=$2 AND owner_user_id=$3 AND state='ready'
           AND scan_status='clean' AND purpose='assignment_submission'`,
          [submission.rows[0].id, fileId, userId],
        );
      }
      await client.query(
        `INSERT INTO course_learning_events (organization_id,course_id,user_id,event_type,source_id,event_data)
         SELECT c.organization_id,c.id,$1,'assignment_submitted',$3,jsonb_build_object('attempt',$4)
         FROM courses c WHERE c.id=$2`, [userId, courseId, assignmentId, attemptNumber]);
      await client.query('COMMIT'); return submission.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async function gradingQueue(organizationId, courseId) {
    const result = await pool.query(
      `SELECT s.*,a.title,a.max_score,u.display_name,g.score,g.feedback,g.released_at,
       COALESCE((SELECT jsonb_agg(sf.file_id) FROM course_assignment_submission_files sf
         WHERE sf.submission_id=s.id),'[]'::jsonb) AS file_ids
       FROM course_assignment_submissions s JOIN course_assignments a ON a.id=s.assignment_id
       JOIN course_contents cc ON cc.id=a.content_id JOIN course_modules cm ON cm.id=cc.module_id
       JOIN course_versions cv ON cv.id=cm.version_id JOIN courses c ON c.id=cv.course_id JOIN users u ON u.id=s.user_id
       LEFT JOIN course_grades g ON g.submission_id=s.id
       WHERE c.organization_id=$1 AND c.id=$2 ORDER BY s.submitted_at DESC`,
      [organizationId, courseId],
    );
    return result.rows;
  }

  async function quizGradingQueue(organizationId, courseId) {
    const result = await pool.query(
      `SELECT qa.id,qa.answers,qa.score,qa.status,qa.submitted_at,q.title,u.display_name,u.email_display,
        COALESCE(jsonb_agg(jsonb_build_object('id',qq.id,'prompt',qq.prompt,'kind',qq.kind,'points',qq.points)
          ORDER BY qq.position) FILTER (WHERE qq.id IS NOT NULL),'[]'::jsonb) AS questions
       FROM course_quiz_attempts qa JOIN course_quizzes q ON q.id=qa.quiz_id
       JOIN course_contents cc ON cc.id=q.content_id JOIN course_modules cm ON cm.id=cc.module_id
       JOIN course_versions cv ON cv.id=cm.version_id JOIN courses c ON c.id=cv.course_id
       JOIN users u ON u.id=qa.user_id LEFT JOIN course_quiz_questions qq ON qq.quiz_id=q.id
       WHERE c.organization_id=$1 AND c.id=$2 AND qa.status='pending_grading'
       GROUP BY qa.id,q.title,u.display_name,u.email_display ORDER BY qa.submitted_at`,
      [organizationId, courseId],
    );
    return result.rows;
  }

  async function gradeQuizAttempt(organizationId, courseId, attemptId, graderUserId, score, feedback, release) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE course_quiz_attempts qa SET score=$5,status='graded',grader_user_id=$4,
          feedback=$6,graded_at=NOW(),released_at=CASE WHEN $7 THEN NOW() END
         FROM course_quizzes q,course_contents cc,course_modules cm,course_versions cv,courses c
         WHERE qa.id=$3 AND qa.quiz_id=q.id AND q.content_id=cc.id AND cc.module_id=cm.id
           AND cm.version_id=cv.id AND cv.course_id=c.id AND c.organization_id=$1 AND c.id=$2
           AND qa.status='pending_grading' AND $5 BETWEEN 0 AND 100
         RETURNING qa.*,q.content_id,q.passing_score`,
        [organizationId, courseId, attemptId, graderUserId, score, feedback || null, Boolean(release)],
      );
      const attempt = result.rows[0] || null;
      if (attempt && Boolean(release) && score >= Number(attempt.passing_score)) {
        await markContentCompleted(client, attempt.enrollment_id, attempt.content_id);
      }
      await client.query('COMMIT');
      return attempt;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function learnerResults(userId, courseId) {
    const [quizzes, assignments] = await Promise.all([
      pool.query(
        `SELECT qa.id,q.title,CASE WHEN qa.released_at IS NOT NULL THEN qa.score END AS score,qa.status,
          CASE WHEN qa.released_at IS NOT NULL THEN qa.feedback END AS feedback,qa.submitted_at,qa.released_at
         FROM course_quiz_attempts qa JOIN course_quizzes q ON q.id=qa.quiz_id
         JOIN enrollments e ON e.id=qa.enrollment_id
         WHERE qa.user_id=$1 AND e.course_id=$2 ORDER BY qa.submitted_at DESC`,
        [userId, courseId],
      ),
      pool.query(
        `SELECT s.id,a.title,s.status,s.submitted_at,
          CASE WHEN g.released_at IS NOT NULL THEN g.score END AS score,
          CASE WHEN g.released_at IS NOT NULL THEN g.feedback END AS feedback,g.released_at
         FROM course_assignment_submissions s JOIN course_assignments a ON a.id=s.assignment_id
         JOIN enrollments e ON e.id=s.enrollment_id LEFT JOIN course_grades g ON g.submission_id=s.id
         WHERE s.user_id=$1 AND e.course_id=$2 ORDER BY s.submitted_at DESC`,
        [userId, courseId],
      ),
    ]);
    return { quizzes: quizzes.rows, assignments: assignments.rows };
  }

  async function gradeSubmission(organizationId, courseId, submissionId, graderUserId, score, rubricScores, feedback, release) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const submission = await client.query(
        `SELECT s.id,s.enrollment_id,a.content_id,a.max_score
         FROM course_assignment_submissions s JOIN course_assignments a ON a.id=s.assignment_id
         JOIN course_contents cc ON cc.id=a.content_id JOIN course_modules cm ON cm.id=cc.module_id
         JOIN course_versions cv ON cv.id=cm.version_id JOIN courses c ON c.id=cv.course_id
         WHERE c.organization_id=$1 AND c.id=$2 AND s.id=$3 FOR UPDATE OF s`,
        [organizationId, courseId, submissionId],
      );
      if (!submission.rowCount || score > Number(submission.rows[0].max_score)) {
        await client.query('ROLLBACK');
        return null;
      }
      const result = await client.query(
        `INSERT INTO course_grades (submission_id,grader_user_id,score,rubric_scores,feedback,released_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,CASE WHEN $6 THEN NOW() END)
         ON CONFLICT (submission_id) DO UPDATE SET grader_user_id=EXCLUDED.grader_user_id,score=EXCLUDED.score,
         rubric_scores=EXCLUDED.rubric_scores,feedback=EXCLUDED.feedback,released_at=EXCLUDED.released_at,updated_at=NOW()
         RETURNING *`,
        [submissionId, graderUserId, score, JSON.stringify(rubricScores || {}), feedback || null, Boolean(release)],
      );
      await client.query(
        "UPDATE course_assignment_submissions SET status=CASE WHEN $2 THEN 'graded' ELSE 'returned' END WHERE id=$1",
        [submissionId, Boolean(release)],
      );
      if (release) {
        await markContentCompleted(client, submission.rows[0].enrollment_id, submission.rows[0].content_id);
      }
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function createPaymentOrder(userId, courseId) {
    const result = await pool.query(
      `INSERT INTO course_payment_orders (course_id,user_id,amount_minor,currency,qr_instructions,qr_file_id,status)
       SELECT c.id,$1,c.price_minor,c.currency,settings.instructions,settings.qr_file_id,'pending_payment'
       FROM courses c
       JOIN organization_payment_settings settings ON settings.organization_id=c.organization_id
       JOIN files qr ON qr.id=settings.qr_file_id AND qr.owner_organization_id=c.organization_id
         AND qr.purpose='payment_qr' AND qr.state='ready' AND qr.scan_status='clean'
       WHERE c.id=$2 AND c.pricing='paid' AND c.publication_status='published' AND c.active=true
       ON CONFLICT DO NOTHING RETURNING *`,
      [userId, courseId],
    );
    if (result.rows[0]) return result.rows[0];
    const existing = await pool.query(
      `SELECT * FROM course_payment_orders WHERE user_id=$1 AND course_id=$2 AND status<>'rejected'
       ORDER BY created_at DESC LIMIT 1`,
      [userId, courseId],
    );
    return existing.rows[0] || null;
  }

  async function getPaymentSettings(organizationId) {
    const result = await pool.query(
      `SELECT organization_id,qr_file_id,instructions,updated_at
       FROM organization_payment_settings WHERE organization_id=$1`,
      [organizationId],
    );
    return result.rows[0] || null;
  }

  async function setPaymentSettings(organizationId, userId, qrFileId, instructions) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const file = await client.query(
        `SELECT id FROM files WHERE id=$1 AND owner_organization_id=$2
         AND purpose='payment_qr' AND state='ready' AND scan_status='clean' FOR UPDATE`,
        [qrFileId, organizationId],
      );
      if (!file.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }
      const result = await client.query(
        `INSERT INTO organization_payment_settings
         (organization_id,qr_file_id,instructions,updated_by_user_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,NOW(),NOW())
         ON CONFLICT (organization_id) DO UPDATE SET
           qr_file_id=EXCLUDED.qr_file_id,instructions=EXCLUDED.instructions,
           updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW()
         RETURNING organization_id,qr_file_id,instructions,updated_at`,
        [organizationId, qrFileId, instructions, userId],
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function attachPaymentProof(userId, orderId, fileId) {
    const result = await pool.query(
      `UPDATE course_payment_orders p SET proof_file_id=f.id,status='pending_review',updated_at=NOW()
       FROM files f WHERE p.id=$1 AND p.user_id=$2 AND f.id=$3 AND f.owner_user_id=$2 AND f.state='ready'
       AND f.scan_status='clean' AND f.purpose='payment_proof'
       AND p.status IN ('pending_payment','more_information') RETURNING p.*`,
      [orderId, userId, fileId],
    );
    return result.rows[0] || null;
  }

  async function paymentQueue(organizationId) {
    const result = await pool.query(
      `SELECT p.*,c.title,u.display_name,u.email_display FROM course_payment_orders p
       JOIN courses c ON c.id=p.course_id JOIN users u ON u.id=p.user_id
       WHERE c.organization_id=$1 AND p.status IN ('pending_review','more_information') ORDER BY p.created_at`,
      [organizationId],
    );
    return result.rows;
  }

  async function reviewPayment(organizationId, orderId, reviewerUserId, decision, note) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const order = await client.query(
        `UPDATE course_payment_orders p SET status=$4,reviewer_user_id=$3,review_note=$5,reviewed_at=NOW(),updated_at=NOW()
         FROM courses c WHERE p.id=$2 AND p.course_id=c.id AND c.organization_id=$1 AND p.status='pending_review'
         RETURNING p.*`,
        [organizationId, orderId, reviewerUserId, decision, note || null],
      );
      if (!order.rowCount) { await client.query('ROLLBACK'); return null; }
      if (decision === 'approved') {
        await client.query(
          `INSERT INTO enrollments (user_id,course_id,course_version_id,status,enrolled_at,created_at,updated_at)
           SELECT $1,$2,cv.id,'enrolled',NOW(),NOW(),NOW() FROM course_versions cv WHERE cv.course_id=$2 AND cv.status='published' ORDER BY version DESC LIMIT 1
           ON CONFLICT (user_id,course_id) DO UPDATE SET status='enrolled',updated_at=NOW()`,
          [order.rows[0].user_id, order.rows[0].course_id],
        );
      }
      await client.query(
        `INSERT INTO course_learning_events (organization_id,course_id,user_id,event_type,source_id,event_data)
         SELECT c.organization_id,c.id,p.user_id,'payment_reviewed',p.id,jsonb_build_object('decision',$3)
         FROM course_payment_orders p JOIN courses c ON c.id=p.course_id WHERE p.id=$1 AND c.organization_id=$2`,
        [orderId, organizationId, decision]);
      await client.query('COMMIT'); return order.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async function analytics(organizationId, courseId) {
    const result = await pool.query(
      `SELECT COUNT(DISTINCT e.user_id)::int AS learners,
       COUNT(DISTINCT e.user_id) FILTER (WHERE e.status='completed')::int AS completed,
       COALESCE(ROUND(AVG(progress.percent)),0)::int AS average_progress,
       (SELECT COUNT(*)::int FROM course_assignment_submissions s
         JOIN enrollments se ON se.id=s.enrollment_id WHERE se.course_id=$2) AS assignment_submissions,
       (SELECT COUNT(*)::int FROM course_grades g JOIN course_assignment_submissions s ON s.id=g.submission_id
         JOIN enrollments se ON se.id=s.enrollment_id WHERE se.course_id=$2 AND g.released_at IS NOT NULL) AS released_assignment_grades,
       (SELECT COUNT(*)::int FROM course_quiz_attempts qa JOIN enrollments qe ON qe.id=qa.enrollment_id
         WHERE qe.course_id=$2) AS quiz_attempts,
       (SELECT COALESCE(ROUND(AVG(qa.score)),0) FROM course_quiz_attempts qa JOIN enrollments qe ON qe.id=qa.enrollment_id
         WHERE qe.course_id=$2 AND qa.released_at IS NOT NULL) AS average_quiz_score,
       (SELECT MAX(occurred_at) FROM course_learning_events WHERE organization_id=$1 AND course_id=$2) AS updated_at
       FROM enrollments e JOIN courses c ON c.id=e.course_id
       LEFT JOIN LATERAL (
         SELECT CASE WHEN COUNT(cc.id)=0 THEN 0 ELSE 100.0*COUNT(lp.id) FILTER (WHERE lp.status='COMPLETED')/COUNT(cc.id) END AS percent
         FROM course_versions cv JOIN course_modules cm ON cm.version_id=cv.id JOIN course_contents cc ON cc.module_id=cm.id
         LEFT JOIN lesson_progress lp ON lp.content_id=cc.id AND lp.enrollment_id=e.id WHERE cv.id=e.course_version_id
       ) progress ON true WHERE c.organization_id=$1 AND c.id=$2`,
      [organizationId, courseId],
    );
    return result.rows[0];
  }

  async function analyticsExport(organizationId, courseId, actorUserId) {
    const result = await pool.query(
      `SELECT e.id AS enrollment_id,u.display_name,u.email_display,e.status,e.enrolled_at,e.completed_at,
       progress.total_lessons,progress.completed_lessons,progress.percent,
       (SELECT COUNT(*)::int FROM course_quiz_attempts qa WHERE qa.enrollment_id=e.id) AS quiz_attempts,
       (SELECT COUNT(*)::int FROM course_assignment_submissions s WHERE s.enrollment_id=e.id) AS assignment_submissions
       FROM enrollments e JOIN courses c ON c.id=e.course_id JOIN users u ON u.id=e.user_id
       LEFT JOIN LATERAL (
         SELECT COUNT(cc.id)::int AS total_lessons,
           COUNT(lp.id) FILTER (WHERE lp.status='COMPLETED')::int AS completed_lessons,
           CASE WHEN COUNT(cc.id)=0 THEN 0 ELSE FLOOR(100.0*COUNT(lp.id) FILTER (WHERE lp.status='COMPLETED')/COUNT(cc.id))::int END AS percent
         FROM course_modules cm JOIN course_contents cc ON cc.module_id=cm.id
         LEFT JOIN lesson_progress lp ON lp.content_id=cc.id AND lp.enrollment_id=e.id
         WHERE cm.version_id=e.course_version_id
       ) progress ON true
       WHERE c.organization_id=$1 AND c.id=$2 ORDER BY e.enrolled_at,e.id LIMIT 10001`,
      [organizationId, courseId],
    );
    if (result.rows.length > 10000) throw Object.assign(new Error('analytics_export_too_large'), { code: 'analytics_export_too_large', status: 413 });
    await pool.query(
      `INSERT INTO audit_events (actor_user_id,organization_id,action,target_type,target_id,source,after_state)
       VALUES ($1,$2,'course.analytics.exported','course',$3,'provider_lms',jsonb_build_object('rows',$4))`,
      [actorUserId, organizationId, courseId, result.rows.length],
    );
    return result.rows;
  }

  return { replaceStructure, getStructure, dashboard, listStaff, setStaffRole, roster, setEnrollmentStatus, createInvitation, acceptInvitation,
    submitQuiz, submitAssignment, gradingQueue, gradeSubmission, quizGradingQueue, gradeQuizAttempt, learnerResults, createPaymentOrder, attachPaymentProof,
    paymentQueue, reviewPayment, getPaymentSettings, setPaymentSettings, analytics, analyticsExport };
}

module.exports = { createPostgresLmsRepository };
