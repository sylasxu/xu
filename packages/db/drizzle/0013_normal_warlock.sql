ALTER TYPE "public"."notification_type" ADD VALUE 'new_participant';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'post_activity';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'activity_reminder';--> statement-breakpoint
CREATE TABLE "ai_config_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_key" varchar(100) NOT NULL,
	"config_value" jsonb NOT NULL,
	"version" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_key" varchar(100) NOT NULL,
	"config_value" jsonb NOT NULL,
	"category" varchar(50) NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_configs_config_key_unique" UNIQUE("config_key")
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "theme" varchar(20) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "theme_config" jsonb;--> statement-breakpoint
CREATE INDEX "ai_config_history_key_idx" ON "ai_config_history" USING btree ("config_key");--> statement-breakpoint
CREATE INDEX "ai_config_history_key_version_idx" ON "ai_config_history" USING btree ("config_key","version");--> statement-breakpoint
CREATE INDEX "ai_configs_category_idx" ON "ai_configs" USING btree ("category");--> statement-breakpoint
CREATE INDEX "ai_configs_config_key_idx" ON "ai_configs" USING btree ("config_key");--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "group_open_id";--> statement-breakpoint
ALTER TABLE "activities" DROP COLUMN "dynamic_message_id";--> statement-breakpoint
ALTER TABLE "participants" DROP COLUMN "group_openid";--> statement-breakpoint
ALTER TABLE "notifications" DROP COLUMN "notification_method";--> statement-breakpoint
DROP TYPE "public"."notification_method";