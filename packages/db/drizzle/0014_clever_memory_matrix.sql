ALTER TABLE "conversation_messages" ALTER COLUMN "embedding" TYPE vector(1536);--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."user_memory_type" AS ENUM('profile_fact', 'preference', 'social_context', 'activity_outcome', 'summary');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE "user_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_message_id" uuid,
	"memory_type" "user_memory_type" DEFAULT 'profile_fact' NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"importance" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "activity_messages" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_memories" ADD CONSTRAINT "user_memories_source_message_id_conversation_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."conversation_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_messages" ADD CONSTRAINT "activity_messages_parent_id_activity_messages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."activity_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_memories_user_idx" ON "user_memories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_memories_type_idx" ON "user_memories" USING btree ("memory_type");--> statement-breakpoint
CREATE INDEX "user_memories_source_message_idx" ON "user_memories" USING btree ("source_message_id");--> statement-breakpoint
CREATE INDEX "user_memories_expires_idx" ON "user_memories" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_memories_created_idx" ON "user_memories" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "activity_messages_parent_idx" ON "activity_messages" USING btree ("parent_id");
