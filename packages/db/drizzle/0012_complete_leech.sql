CREATE TYPE "public"."notification_method" AS ENUM('system_message', 'service_notification');--> statement-breakpoint
CREATE TABLE "ai_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"model_id" varchar(100) NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"processor_log" jsonb,
	"p0_match_keyword" uuid,
	"input" text,
	"output" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"tool_name" varchar(100) NOT NULL,
	"duration_ms" integer NOT NULL,
	"success" boolean NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "group_openid" varchar(128);--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "notification_method" "notification_method" DEFAULT 'service_notification' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_requests" ADD CONSTRAINT "ai_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_tool_calls" ADD CONSTRAINT "ai_tool_calls_request_id_ai_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."ai_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_requests_user_idx" ON "ai_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_requests_model_idx" ON "ai_requests" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "ai_requests_created_at_idx" ON "ai_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_requests_p0_keyword_idx" ON "ai_requests" USING btree ("p0_match_keyword");--> statement-breakpoint
CREATE INDEX "ai_tool_calls_request_idx" ON "ai_tool_calls" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "ai_tool_calls_tool_name_idx" ON "ai_tool_calls" USING btree ("tool_name");--> statement-breakpoint
CREATE INDEX "ai_tool_calls_success_idx" ON "ai_tool_calls" USING btree ("success");