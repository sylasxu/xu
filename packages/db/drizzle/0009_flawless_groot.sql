CREATE TYPE "public"."evaluation_status" AS ENUM('unreviewed', 'good', 'bad');--> statement-breakpoint
CREATE TABLE "ai_conversation_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"user_id" uuid,
	"intent" varchar(50),
	"intent_confidence" real,
	"intent_recognized" boolean DEFAULT true,
	"tools_called" jsonb DEFAULT '[]'::jsonb,
	"tools_succeeded" integer DEFAULT 0,
	"tools_failed" integer DEFAULT 0,
	"quality_score" real,
	"input_tokens" integer DEFAULT 0,
	"output_tokens" integer DEFAULT 0,
	"total_tokens" integer DEFAULT 0,
	"latency_ms" integer,
	"activity_created" boolean DEFAULT false,
	"activity_joined" boolean DEFAULT false,
	"activity_id" uuid,
	"source" varchar(20) DEFAULT 'miniprogram',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_security_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event_type" varchar(50) NOT NULL,
	"trigger_word" varchar(100),
	"input_text" text,
	"severity" varchar(20) DEFAULT 'medium',
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_sensitive_words" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"word" varchar(100) NOT NULL,
	"category" varchar(50) DEFAULT 'general',
	"severity" varchar(20) DEFAULT 'medium',
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_sensitive_words_word_unique" UNIQUE("word")
);
--> statement-breakpoint
CREATE TABLE "match_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"sender_id" uuid,
	"message_type" varchar(20) DEFAULT 'text' NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intent_match_members" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lite_chat_messages" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lite_chats" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "intent_match_members" CASCADE;--> statement-breakpoint
DROP TABLE "lite_chat_messages" CASCADE;--> statement-breakpoint
DROP TABLE "lite_chats" CASCADE;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "evaluation_status" "evaluation_status" DEFAULT 'unreviewed' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "evaluation_tags" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "evaluation_note" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "has_error" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "intent_matches" ADD COLUMN "intent_ids" uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "intent_matches" ADD COLUMN "user_ids" uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_conversation_metrics" ADD CONSTRAINT "ai_conversation_metrics_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_metrics" ADD CONSTRAINT "ai_conversation_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_metrics" ADD CONSTRAINT "ai_conversation_metrics_activity_id_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_security_events" ADD CONSTRAINT "ai_security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_messages" ADD CONSTRAINT "match_messages_match_id_intent_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."intent_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_messages" ADD CONSTRAINT "match_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversation_metrics_created_at_idx" ON "ai_conversation_metrics" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_conversation_metrics_user_id_idx" ON "ai_conversation_metrics" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_conversation_metrics_intent_idx" ON "ai_conversation_metrics" USING btree ("intent");--> statement-breakpoint
CREATE INDEX "ai_security_events_user_id_idx" ON "ai_security_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_security_events_created_at_idx" ON "ai_security_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_security_events_event_type_idx" ON "ai_security_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "ai_sensitive_words_category_idx" ON "ai_sensitive_words" USING btree ("category");--> statement-breakpoint
CREATE INDEX "ai_sensitive_words_is_active_idx" ON "ai_sensitive_words" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "match_messages_match_idx" ON "match_messages" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "match_messages_created_idx" ON "match_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "conversations_evaluation_status_idx" ON "conversations" USING btree ("evaluation_status");--> statement-breakpoint
CREATE INDEX "conversations_has_error_idx" ON "conversations" USING btree ("has_error");--> statement-breakpoint
ALTER TABLE "intent_matches" DROP COLUMN "lite_chat_id";
