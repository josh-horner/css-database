CREATE TYPE "public"."service_day_type" AS ENUM('pickup', 'delivery');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('submitted', 'reviewing', 'resolved', 'denied');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('signed_up', 'rewarded', 'void');--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"submitted_by_person_id" uuid,
	"kind" text NOT NULL,
	"item_ids" uuid[] DEFAULT '{}' NOT NULL,
	"description" text NOT NULL,
	"customer_photo_keys" text[] DEFAULT '{}' NOT NULL,
	"status" "claim_status" DEFAULT 'submitted' NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"resolution" text,
	"amount_cents" integer,
	"resolution_note" text,
	"resolved_by_staff_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"kind" "contact_kind" NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "field_answers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_service_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"value" jsonb,
	"ref_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funnel_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"step" text NOT NULL,
	"event" text NOT NULL,
	"meta" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kb_articles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"public" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"staff_user_id" uuid,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "person_links" (
	"guardian_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_links_guardian_id_student_id_pk" PRIMARY KEY("guardian_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"season_id" uuid,
	"valid_until" timestamp with time zone,
	"max_uses" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"referrer_booking_id" uuid NOT NULL,
	"referee_booking_id" uuid NOT NULL,
	"code" text NOT NULL,
	"via" text,
	"kind" text NOT NULL,
	"referee_reward_cents" integer NOT NULL,
	"referrer_reward_cents" integer NOT NULL,
	"referrer_reward_kind" text NOT NULL,
	"status" "referral_status" DEFAULT 'signed_up' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_referee_booking_id_unique" UNIQUE("referee_booking_id")
);
--> statement-breakpoint
CREATE TABLE "service_days" (
	"id" uuid PRIMARY KEY NOT NULL,
	"season_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"date" date NOT NULL,
	"type" "service_day_type" NOT NULL,
	"campus_scope" text DEFAULT 'both' NOT NULL,
	"window_id" text,
	"capacity" integer NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_fields" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"help" text,
	"required" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"show_if" jsonb,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_schools" (
	"service_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"availability" text DEFAULT 'both' NOT NULL,
	CONSTRAINT "service_schools_service_id_school_id_pk" PRIMARY KEY("service_id","school_id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "contact_kind" NOT NULL,
	"value" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "bookings_season_confirmation";--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "booking_service_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "service_day_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "overbooked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_services" ADD COLUMN "added_by_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_services" ADD COLUMN "acceptance_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_services" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "step_reached" text DEFAULT 'contact' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "abandoned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "heard_from" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "referral_code" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "entered_code" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "created_by_staff_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "outreach_outcome" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "outreach_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "residences" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "schools" ADD COLUMN "allows_special_pickup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "lead_days" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "family" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "season_id" uuid;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "charges_deposit" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "base_rate_card_code" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "staff_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_submitted_by_person_id_persons_id_fk" FOREIGN KEY ("submitted_by_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_answers" ADD CONSTRAINT "field_answers_booking_service_id_booking_services_id_fk" FOREIGN KEY ("booking_service_id") REFERENCES "public"."booking_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funnel_events" ADD CONSTRAINT "funnel_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_links" ADD CONSTRAINT "person_links_guardian_id_persons_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_links" ADD CONSTRAINT "person_links_student_id_persons_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_booking_id_bookings_id_fk" FOREIGN KEY ("referrer_booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_booking_id_bookings_id_fk" FOREIGN KEY ("referee_booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_days" ADD CONSTRAINT "service_days_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_days" ADD CONSTRAINT "service_days_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_fields" ADD CONSTRAINT "service_fields_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_schools" ADD CONSTRAINT "service_schools_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_schools" ADD CONSTRAINT "service_schools_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "field_answers_service_key" ON "field_answers" USING btree ("booking_service_id","field_key");--> statement-breakpoint
CREATE INDEX "funnel_events_booking" ON "funnel_events" USING btree ("booking_id","at");--> statement-breakpoint
CREATE INDEX "funnel_events_at" ON "funnel_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "service_days_school_date" ON "service_days" USING btree ("school_id","date");--> statement-breakpoint
CREATE INDEX "service_fields_service" ON "service_fields" USING btree ("service_id","sort_order");--> statement-breakpoint
CREATE INDEX "verification_codes_value" ON "verification_codes" USING btree ("value","created_at");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_booking_service_id_booking_services_id_fk" FOREIGN KEY ("booking_service_id") REFERENCES "public"."booking_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_day_id_service_days_id_fk" FOREIGN KEY ("service_day_id") REFERENCES "public"."service_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_lifecycle" ON "bookings" USING btree ("lifecycle","last_activity_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_season_confirmation" ON "bookings" USING btree ("season_id","confirmation_number") WHERE lifecycle <> 'cancelled';--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_referral_code_unique" UNIQUE("referral_code");