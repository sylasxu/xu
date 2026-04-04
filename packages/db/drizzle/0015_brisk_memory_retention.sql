ALTER TABLE "conversation_messages" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
CREATE INDEX "conversation_messages_expires_idx" ON "conversation_messages" USING btree ("expires_at");--> statement-breakpoint
UPDATE "conversation_messages"
SET "expires_at" = NOW() + INTERVAL '7 days'
WHERE "expires_at" IS NULL;--> statement-breakpoint
