ALTER TABLE "learning_conversations"
ADD COLUMN "response_format" VARCHAR(32) NOT NULL DEFAULT 'restricted_markdown_v1';

ALTER TABLE "learning_conversations"
ADD CONSTRAINT "learning_conversations_response_format_check"
CHECK ("response_format" = 'restricted_markdown_v1');

ALTER TABLE "learning_notes"
ADD COLUMN "content_format" VARCHAR(32) NOT NULL DEFAULT 'legacy_html_v0';

ALTER TABLE "learning_notes"
ALTER COLUMN "content_format" SET DEFAULT 'plain_text_v1';

ALTER TABLE "learning_notes"
ADD CONSTRAINT "learning_notes_content_format_check"
CHECK ("content_format" IN ('legacy_html_v0', 'plain_text_v1'));
