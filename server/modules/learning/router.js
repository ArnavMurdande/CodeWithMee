'use strict';

const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');
const { createDocument, readDocument, CONTENT_FORMAT, normalizeText } = require('../content/restricted-content');
const { isUuid } = require('./postgres-roadmap-repository');

function noteDto(row) {
  return { _id: row.id, id: row.id, title: row.title, content: row.content,
    contentFormat: row.content_format, canvasData: row.canvas_data || '',
    formatting: row.formatting || {}, attachments: row.attachments || [],
    createdAt: row.created_at, updatedAt: row.updated_at };
}

function createLearningRouter(pool) {
  if (!pool) throw new Error('PostgreSQL pool is required.');
  const router = express.Router();
  router.use(authMiddleware);

  router.get('/notes', async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT n.*,COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'fileId',a.file_id,'kind',a.kind,'url',a.legacy_url,'name',a.original_name)) FILTER (WHERE a.id IS NOT NULL),'[]') AS attachments
         FROM learning_notes n LEFT JOIN learning_note_attachments a ON a.note_id=n.id
         WHERE n.user_id=$1 GROUP BY n.id ORDER BY n.updated_at DESC`, [req.user.id]);
      res.json(result.rows.map(noteDto));
    } catch (error) { next(error); }
  });
  router.post('/notes', async (req, res, next) => {
    try {
      const title = normalizeText(req.body?.title || 'Untitled Note', { allowEmpty: false, field: 'title', maximumLength: 255 });
      const result = await pool.query(
        `INSERT INTO learning_notes (user_id,title,content,content_format,created_at,updated_at)
         VALUES ($1,$2,'','plain_text_v1',NOW(),NOW()) RETURNING *`, [req.user.id, title]);
      res.status(201).json(noteDto(result.rows[0]));
    } catch (error) { next(error); }
  });
  router.put('/notes/:noteId', async (req, res, next) => {
    try {
      if (!isUuid(req.params.noteId)) return res.status(404).json({ error: { code: 'note_not_found' } });
      const hasContent = req.body?.contentDocument !== undefined || req.body?.content !== undefined;
      const document = !hasContent ? null : req.body?.contentDocument
        ? readDocument(req.body.contentDocument, { maximumLength: 100000 })
        : createDocument(req.body.content || '', { format: CONTENT_FORMAT.PLAIN_TEXT, legacyHtml: true, maximumLength: 100000 });
      const formattingJson = req.body?.formatting === undefined ? null : JSON.stringify(req.body.formatting);
      if (formattingJson && formattingJson.length > 500000) {
        return res.status(413).json({ error: { code: 'note_formatting_too_large' } });
      }
      const result = await pool.query(
        `UPDATE learning_notes SET title=COALESCE($3,title),content=COALESCE($4,content),content_format=COALESCE($5,content_format),
         formatting=COALESCE($6::jsonb,formatting),canvas_data=COALESCE($7,canvas_data),updated_at=NOW()
         WHERE id=$1 AND user_id=$2 RETURNING *`,
        [req.params.noteId, req.user.id, req.body?.title || null, document?.text ?? null, document?.format ?? null,
          formattingJson, req.body?.canvasData ?? null]);
      if (!result.rowCount) return res.status(404).json({ error: { code: 'note_not_found' } });
      res.json(noteDto(result.rows[0]));
    } catch (error) { next(error); }
  });
  router.delete('/notes/:noteId', async (req, res, next) => {
    try {
      const result = await pool.query('DELETE FROM learning_notes WHERE id=$1 AND user_id=$2', [req.params.noteId, req.user.id]);
      if (!result.rowCount) return res.status(404).json({ error: { code: 'note_not_found' } });
      res.status(204).end();
    } catch (error) { next(error); }
  });
  router.post('/notes/:noteId/attachments', async (req, res, next) => {
    try {
      if (!isUuid(req.params.noteId) || !isUuid(req.body?.fileId)) {
        return res.status(400).json({ error: { code: 'invalid_note_attachment' } });
      }
      const file = await pool.query(
        `SELECT id,original_name,detected_mime,declared_mime FROM files
         WHERE id=$1 AND owner_user_id=$2 AND purpose='note_attachment'
           AND state='ready'::"file_state" AND scan_status='clean'::"file_scan_status" AND deleted_at IS NULL`,
        [req.body.fileId, req.user.id],
      );
      if (!file.rowCount) return res.status(404).json({ error: { code: 'note_attachment_not_found' } });
      const note = await pool.query('SELECT id FROM learning_notes WHERE id=$1 AND user_id=$2', [req.params.noteId, req.user.id]);
      if (!note.rowCount) return res.status(404).json({ error: { code: 'note_not_found' } });
      const mime = file.rows[0].detected_mime || file.rows[0].declared_mime || '';
      const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio' : mime.startsWith('video/') ? 'video' : 'file';
      const result = await pool.query(
        `INSERT INTO learning_note_attachments (note_id,file_id,kind,original_name,created_at)
         VALUES ($1,$2,$3,$4,NOW()) RETURNING id,file_id,kind,original_name`,
        [req.params.noteId, req.body.fileId, kind, file.rows[0].original_name],
      );
      const row = result.rows[0];
      res.status(201).json({ _id: row.id, id: row.id, fileId: row.file_id, fileType: row.kind, kind: row.kind, name: row.original_name });
    } catch (error) { next(error); }
  });
  router.delete('/notes/:noteId/attachments/:attachmentId', async (req, res, next) => {
    try {
      if (!isUuid(req.params.noteId) || !isUuid(req.params.attachmentId)) {
        return res.status(404).json({ error: { code: 'note_attachment_not_found' } });
      }
      const result = await pool.query(
        `DELETE FROM learning_note_attachments a USING learning_notes n
         WHERE a.id=$1 AND a.note_id=$2 AND n.id=a.note_id AND n.user_id=$3`,
        [req.params.attachmentId, req.params.noteId, req.user.id],
      );
      if (!result.rowCount) return res.status(404).json({ error: { code: 'note_attachment_not_found' } });
      res.status(204).end();
    } catch (error) { next(error); }
  });
  router.put('/video-progress', async (req, res, next) => {
    try {
      const { videoId, timestamp, duration, topic, pathway } = req.body || {};
      if (!String(videoId || '').trim() || !Number.isFinite(Number(timestamp))) return res.status(400).json({ error: { code: 'invalid_video_progress' } });
      const position = Math.max(0, Math.round(Number(timestamp)));
      const total = Math.max(0, Math.round(Number(duration) || 0));
      await pool.query(
        `INSERT INTO video_progress (user_id,video_source_key,position_seconds,duration_seconds,topic,pathway,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW()) ON CONFLICT (user_id,video_source_key) DO UPDATE
         SET position_seconds=EXCLUDED.position_seconds,duration_seconds=GREATEST(video_progress.duration_seconds,EXCLUDED.duration_seconds),topic=EXCLUDED.topic,pathway=EXCLUDED.pathway,updated_at=NOW()`,
        [req.user.id, String(videoId).slice(0,500), position, total, String(topic || '').slice(0,200), String(pathway || '').slice(0,200)]);
      res.json({ success: true, progress: { videoId, timestamp: position, duration: total, topic, pathway } });
    } catch (error) { next(error); }
  });
  router.get('/video-progress/:videoId', async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT video_source_key AS "videoId",position_seconds AS timestamp,duration_seconds AS duration,topic,pathway,updated_at AS "updatedAt"
         FROM video_progress WHERE user_id=$1 AND video_source_key=$2`, [req.user.id, req.params.videoId]);
      res.json(result.rows[0] || { videoId: req.params.videoId, timestamp: 0, duration: 0 });
    } catch (error) { next(error); }
  });
  return router;
}

module.exports = { createLearningRouter };
