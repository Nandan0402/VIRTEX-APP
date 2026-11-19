-- ==============================================================================
-- Virtex - full database STRUCTURE (112 tables, no data), generated 2026-11-19 from the
-- working local database (schema.sql + all migrations through 035, incl. 028 Google sign-in).
--
-- Used ONLY by backend/src/config/bootstrapSchema.js, and ONLY when the connected database has
-- no tables at all (e.g. a fresh hosted database). It never runs on a database that has tables.
-- Contains no members, users, passwords or other personal data.
-- ==============================================================================
--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

DO $ext$ BEGIN CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'extension skipped: %', SQLERRM; END $ext$;


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

DO $ext$ BEGIN CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'extension skipped: %', SQLERRM; END $ext$;


--
-- Name: fn_check_in_duplicate_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_check_in_duplicate_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_cooldown_minutes INT := 5;
    v_recent_count INT;
BEGIN
    SELECT COALESCE(checkin_cooldown_minutes, 5) INTO v_cooldown_minutes
    FROM gym_settings WHERE id = 1;

    SELECT COUNT(*) INTO v_recent_count
    FROM check_ins
    WHERE member_id = NEW.member_id
      AND id <> COALESCE(NEW.id, 0)
      AND (
            check_in_time::date = NEW.check_in_time::date
         OR (v_cooldown_minutes > 0
             AND check_in_time > (NEW.check_in_time - (v_cooldown_minutes || ' minutes')::interval))
      );

    IF v_recent_count > 0 THEN
        RAISE EXCEPTION 'DUPLICATE_CHECK_IN: Member % has already checked in today.', NEW.member_id
            USING ERRCODE = '23505';
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: fn_message_touch_thread(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_message_touch_thread() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE message_threads SET last_message_at = NEW.created_at WHERE id = NEW.thread_id;
    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: pt_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pt_sessions (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id integer NOT NULL,
    trainer_id integer,
    assignment_id integer,
    purchase_id bigint,
    scheduled_start timestamp with time zone NOT NULL,
    scheduled_end timestamp with time zone NOT NULL,
    location character varying(120),
    status character varying(20) DEFAULT 'booked'::character varying NOT NULL,
    booked_by_user_id integer,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancellation_reason character varying(255),
    balance_deducted boolean DEFAULT false NOT NULL,
    workout_session_log_id integer,
    trainer_notes text,
    member_feedback text,
    member_rating smallint,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_pts_cancelled_at CHECK ((((status)::text <> 'cancelled'::text) OR (cancelled_at IS NOT NULL))),
    CONSTRAINT chk_pts_completed_at CHECK ((((status)::text <> 'completed'::text) OR (completed_at IS NOT NULL))),
    CONSTRAINT chk_pts_time_range CHECK ((scheduled_end > scheduled_start)),
    CONSTRAINT pt_sessions_member_rating_check CHECK (((member_rating >= 1) AND (member_rating <= 5))),
    CONSTRAINT pt_sessions_status_check CHECK (((status)::text = ANY (ARRAY[('booked'::character varying)::text, ('confirmed'::character varying)::text, ('completed'::character varying)::text, ('cancelled'::character varying)::text, ('no_show'::character varying)::text])))
);


--
-- Name: fn_pt_complete_session(bigint, character varying, integer, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_pt_complete_session(p_session_id bigint, p_outcome character varying DEFAULT 'completed'::character varying, p_user_id integer DEFAULT NULL::integer, p_charge_no_show boolean DEFAULT true) RETURNS public.pt_sessions
    LANGUAGE plpgsql
    AS $$
DECLARE
    s        pt_sessions;
    p        pt_package_purchases;
    v_charge BOOLEAN;
BEGIN
    IF p_outcome NOT IN ('completed', 'no_show') THEN
        RAISE EXCEPTION 'PT_INVALID_OUTCOME: %', p_outcome USING ERRCODE = '22023';
    END IF;

    SELECT * INTO s FROM pt_sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PT_SESSION_NOT_FOUND: %', p_session_id USING ERRCODE = 'P0002';
    END IF;
    IF s.status IN ('completed', 'no_show', 'cancelled') THEN
        RAISE EXCEPTION 'PT_SESSION_ALREADY_CLOSED: session % is %', s.id, s.status USING ERRCODE = '55000';
    END IF;

    v_charge := s.purchase_id IS NOT NULL AND (p_outcome = 'completed' OR p_charge_no_show);

    IF v_charge THEN
        SELECT * INTO p FROM pt_package_purchases WHERE id = s.purchase_id FOR UPDATE;
        IF p.status <> 'active' THEN
            RAISE EXCEPTION 'PT_PACKAGE_NOT_ACTIVE: purchase % is %', p.id, p.status USING ERRCODE = '55000';
        END IF;
        IF p.valid_until < CURRENT_DATE THEN
            RAISE EXCEPTION 'PT_PACKAGE_EXPIRED: purchase % expired on %', p.id, p.valid_until USING ERRCODE = '55000';
        END IF;
        IF p.sessions_remaining <= 0 THEN
            RAISE EXCEPTION 'PT_NO_SESSIONS_REMAINING: purchase %', p.id USING ERRCODE = '55000';
        END IF;

        UPDATE pt_package_purchases
           SET sessions_used = sessions_used + 1,
               status = CASE WHEN sessions_used + 1 >= sessions_total THEN 'exhausted' ELSE status END
         WHERE id = p.id
        RETURNING * INTO p;

        INSERT INTO pt_session_balance_ledger (purchase_id, session_id, delta, reason, balance_after, created_by_user_id)
        VALUES (p.id, s.id, -1,
                CASE WHEN p_outcome = 'completed' THEN 'session_completed' ELSE 'no_show_charged' END,
                p.sessions_remaining, p_user_id);
    END IF;

    UPDATE pt_sessions
       SET status = p_outcome,
           completed_at = CASE WHEN p_outcome = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END,
           balance_deducted = v_charge
     WHERE id = s.id
    RETURNING * INTO s;

    RETURN s;
END;
$$;


--
-- Name: fn_pt_reverse_session(bigint, integer, character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_pt_reverse_session(p_session_id bigint, p_user_id integer DEFAULT NULL::integer, p_reason character varying DEFAULT 'Reversed by staff'::character varying) RETURNS public.pt_sessions
    LANGUAGE plpgsql
    AS $$
DECLARE
    s pt_sessions;
    p pt_package_purchases;
BEGIN
    SELECT * INTO s FROM pt_sessions WHERE id = p_session_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'PT_SESSION_NOT_FOUND: %', p_session_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT s.balance_deducted OR s.purchase_id IS NULL THEN
        RAISE EXCEPTION 'PT_NOTHING_TO_REVERSE: session %', s.id USING ERRCODE = '55000';
    END IF;

    SELECT * INTO p FROM pt_package_purchases WHERE id = s.purchase_id FOR UPDATE;

    UPDATE pt_package_purchases
       SET sessions_used = sessions_used - 1,
           status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END
     WHERE id = p.id
    RETURNING * INTO p;

    INSERT INTO pt_session_balance_ledger (purchase_id, session_id, delta, reason, balance_after, created_by_user_id, notes)
    VALUES (p.id, s.id, 1, 'session_reversed', p.sessions_remaining, p_user_id, p_reason);

    UPDATE pt_sessions
       SET status = 'cancelled',
           cancelled_at = CURRENT_TIMESTAMP,
           cancellation_reason = p_reason,
           balance_deducted = FALSE
     WHERE id = s.id
    RETURNING * INTO s;

    RETURN s;
END;
$$;


--
-- Name: fn_update_timestamp(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_update_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(120) NOT NULL,
    password_hash character varying(255) NOT NULL,
    full_name character varying(100) NOT NULL,
    role character varying(20) DEFAULT 'trainer'::character varying NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT admin_users_role_check CHECK (((role)::text = ANY (ARRAY[('superadmin'::character varying)::text, ('manager'::character varying)::text, ('trainer'::character varying)::text])))
);


--
-- Name: admin_users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_users_id_seq OWNED BY public.admin_users.id;


--
-- Name: admission_fees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admission_fees (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    amount numeric(8,2) DEFAULT 1000.00 NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: admission_fees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admission_fees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admission_fees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admission_fees_id_seq OWNED BY public.admission_fees.id;


--
-- Name: announcement_poll_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcement_poll_options (
    id integer NOT NULL,
    announcement_id integer NOT NULL,
    label character varying(80) NOT NULL,
    "position" smallint NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT announcement_poll_options_label_check CHECK (((char_length(btrim((label)::text)) >= 1) AND (char_length(btrim((label)::text)) <= 80))),
    CONSTRAINT announcement_poll_options_position_check CHECK ((("position" >= 1) AND ("position" <= 10)))
);


--
-- Name: announcement_poll_options_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.announcement_poll_options_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: announcement_poll_options_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.announcement_poll_options_id_seq OWNED BY public.announcement_poll_options.id;


--
-- Name: announcement_poll_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcement_poll_votes (
    option_id integer NOT NULL,
    announcement_id integer NOT NULL,
    member_id integer,
    voted_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    trainer_id integer,
    id bigint NOT NULL,
    CONSTRAINT chk_poll_vote_voter CHECK (((member_id IS NULL) <> (trainer_id IS NULL)))
);


--
-- Name: announcement_poll_votes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.announcement_poll_votes ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.announcement_poll_votes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id integer NOT NULL,
    title character varying(160) NOT NULL,
    message text NOT NULL,
    priority character varying(20) DEFAULT 'normal'::character varying NOT NULL,
    target_language character varying(10) DEFAULT 'all'::character varying NOT NULL,
    start_date date DEFAULT CURRENT_DATE NOT NULL,
    end_date date DEFAULT (CURRENT_DATE + '14 days'::interval) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by integer,
    poll_multiple boolean DEFAULT false NOT NULL,
    audience character varying(10) DEFAULT 'all'::character varying NOT NULL,
    category character varying(20) DEFAULT 'general'::character varying NOT NULL,
    CONSTRAINT announcements_priority_check CHECK (((priority)::text = ANY (ARRAY[('normal'::character varying)::text, ('urgent'::character varying)::text, ('event'::character varying)::text, ('maintenance'::character varying)::text]))),
    CONSTRAINT chk_announcement_audience CHECK (((audience)::text = ANY (ARRAY[('all'::character varying)::text, ('members'::character varying)::text, ('trainers'::character varying)::text]))),
    CONSTRAINT chk_announcement_category CHECK (((category)::text = ANY (ARRAY[('general'::character varying)::text, ('indoor_sport'::character varying)::text, ('outdoor_sport'::character varying)::text, ('event'::character varying)::text, ('fitness'::character varying)::text]))),
    CONSTRAINT chk_announcement_dates CHECK ((end_date >= start_date))
);


--
-- Name: announcements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.announcements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: announcements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.announcements_id_seq OWNED BY public.announcements.id;


--
-- Name: auth_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_audit_logs (
    id integer NOT NULL,
    user_id integer,
    username character varying(50) NOT NULL,
    event_type character varying(50) NOT NULL,
    role character varying(32),
    ip_address character varying(45),
    user_agent text,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: auth_audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.auth_audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: auth_audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.auth_audit_logs_id_seq OWNED BY public.auth_audit_logs.id;


--
-- Name: book_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.book_purchases (
    id integer NOT NULL,
    book_id integer NOT NULL,
    member_id integer NOT NULL,
    amount_paid numeric(8,2) DEFAULT 0.00 NOT NULL,
    currency character varying(10) DEFAULT 'INR'::character varying NOT NULL,
    payment_method character varying(50) DEFAULT 'Wallet / Online Payment'::character varying NOT NULL,
    invoice_code character varying(100) NOT NULL,
    purchased_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: book_purchases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.book_purchases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: book_purchases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.book_purchases_id_seq OWNED BY public.book_purchases.id;


--
-- Name: book_reading_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.book_reading_progress (
    id integer NOT NULL,
    book_id integer NOT NULL,
    member_id integer NOT NULL,
    current_page integer DEFAULT 1 NOT NULL,
    total_pages integer DEFAULT 100 NOT NULL,
    progress_pct integer DEFAULT 0 NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    last_read_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    notes text
);


--
-- Name: book_reading_progress_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.book_reading_progress_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: book_reading_progress_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.book_reading_progress_id_seq OWNED BY public.book_reading_progress.id;


--
-- Name: check_ins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.check_ins (
    id bigint NOT NULL,
    member_id integer NOT NULL,
    check_in_time timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    check_in_method character varying(30) DEFAULT 'kiosk_voice'::character varying NOT NULL,
    device_id integer,
    notes character varying(200),
    check_out_time timestamp with time zone,
    CONSTRAINT check_ins_check_in_method_check CHECK (((check_in_method)::text = ANY ((ARRAY['kiosk_voice'::character varying, 'kiosk_manual'::character varying, 'rfid_card'::character varying, 'mobile_qr'::character varying, 'member_portal'::character varying])::text[])))
);


--
-- Name: check_ins_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.check_ins_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: check_ins_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.check_ins_id_seq OWNED BY public.check_ins.id;


--
-- Name: class_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.class_registrations (
    id integer NOT NULL,
    class_id integer NOT NULL,
    member_id integer NOT NULL,
    registered_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    attended boolean DEFAULT false,
    attended_at timestamp with time zone,
    watch_time_mins integer DEFAULT 0,
    status character varying(20) DEFAULT 'registered'::character varying
);


--
-- Name: class_registrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.class_registrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: class_registrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.class_registrations_id_seq OWNED BY public.class_registrations.id;


--
-- Name: competition_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competition_certificates (
    id integer NOT NULL,
    competition_id integer NOT NULL,
    member_id integer NOT NULL,
    certificate_code character varying(50) NOT NULL,
    award_title character varying(100) NOT NULL,
    rank_awarded smallint,
    issued_at timestamp with time zone DEFAULT now(),
    issued_by character varying(50) DEFAULT 'PulseCore Athletics'::character varying
);


--
-- Name: competition_certificates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.competition_certificates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: competition_certificates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.competition_certificates_id_seq OWNED BY public.competition_certificates.id;


--
-- Name: competition_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competition_participants (
    id integer NOT NULL,
    competition_id integer NOT NULL,
    member_id integer NOT NULL,
    registration_date timestamp with time zone DEFAULT now(),
    status character varying(30) DEFAULT 'registered'::character varying NOT NULL,
    division character varying(50) DEFAULT 'Open'::character varying,
    score numeric(8,2),
    score_unit character varying(30) DEFAULT 'reps'::character varying,
    rank_position smallint,
    is_winner boolean DEFAULT false,
    verified_by_trainer_id integer,
    trainer_notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT competition_participants_status_check CHECK (((status)::text = ANY (ARRAY[('registered'::character varying)::text, ('checked_in'::character varying)::text, ('completed'::character varying)::text, ('withdrawn'::character varying)::text])))
);


--
-- Name: competition_participants_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.competition_participants_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: competition_participants_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.competition_participants_id_seq OWNED BY public.competition_participants.id;


--
-- Name: course_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_certificates (
    id integer NOT NULL,
    certificate_code character varying(100) NOT NULL,
    course_id integer NOT NULL,
    member_id integer NOT NULL,
    issued_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    issued_by character varying(100) DEFAULT 'PulseCore Academy of Exercise Science'::character varying,
    grade_score character varying(50),
    certificate_url text
);


--
-- Name: course_certificates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.course_certificates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: course_certificates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.course_certificates_id_seq OWNED BY public.course_certificates.id;


--
-- Name: course_enrolments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_enrolments (
    id integer NOT NULL,
    course_id integer NOT NULL,
    member_id integer NOT NULL,
    enrolled_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    progress_pct integer DEFAULT 0,
    lessons_completed integer DEFAULT 0,
    total_lessons integer DEFAULT 0,
    quiz_score_pct integer,
    quiz_passed boolean DEFAULT false,
    status character varying(20) DEFAULT 'in_progress'::character varying,
    completed_at timestamp with time zone
);


--
-- Name: course_enrolments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.course_enrolments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: course_enrolments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.course_enrolments_id_seq OWNED BY public.course_enrolments.id;


--
-- Name: course_lessons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_lessons (
    id integer NOT NULL,
    course_id integer NOT NULL,
    title character varying(255) NOT NULL,
    lesson_order integer DEFAULT 1 NOT NULL,
    duration_mins integer DEFAULT 15 NOT NULL,
    video_url text NOT NULL,
    content_notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: course_lessons_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.course_lessons_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: course_lessons_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.course_lessons_id_seq OWNED BY public.course_lessons.id;


--
-- Name: course_quizzes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.course_quizzes (
    id integer NOT NULL,
    course_id integer NOT NULL,
    title character varying(255) NOT NULL,
    pass_percentage integer DEFAULT 80 NOT NULL,
    quiz_data jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: course_quizzes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.course_quizzes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: course_quizzes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.course_quizzes_id_seq OWNED BY public.course_quizzes.id;


--
-- Name: courses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.courses (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    slug character varying(255),
    instructor_trainer_id integer,
    category character varying(50) NOT NULL,
    description text,
    level character varying(20) DEFAULT 'Beginner'::character varying,
    estimated_hours numeric(4,1) DEFAULT 4.0,
    thumbnail_url text,
    status character varying(20) DEFAULT 'published'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: courses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.courses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: courses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.courses_id_seq OWNED BY public.courses.id;


--
-- Name: diet_plan_meal_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diet_plan_meal_items (
    id integer NOT NULL,
    meal_id integer NOT NULL,
    food_item_id integer NOT NULL,
    servings numeric(4,2) DEFAULT 1.0 NOT NULL,
    custom_portion character varying(50),
    calories numeric(6,1) NOT NULL,
    protein_g numeric(5,1) NOT NULL,
    carbs_g numeric(5,1) NOT NULL,
    fats_g numeric(5,1) NOT NULL
);


--
-- Name: diet_plan_meal_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.diet_plan_meal_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: diet_plan_meal_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.diet_plan_meal_items_id_seq OWNED BY public.diet_plan_meal_items.id;


--
-- Name: diet_plan_meals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diet_plan_meals (
    id integer NOT NULL,
    plan_id integer NOT NULL,
    meal_type character varying(30) NOT NULL,
    scheduled_time time without time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: diet_plan_meals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.diet_plan_meals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: diet_plan_meals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.diet_plan_meals_id_seq OWNED BY public.diet_plan_meals.id;


--
-- Name: diet_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.diet_plans (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    trainer_id integer,
    goal character varying(50) NOT NULL,
    target_calories integer NOT NULL,
    target_protein_g integer NOT NULL,
    target_carbs_g integer NOT NULL,
    target_fats_g integer NOT NULL,
    target_water_ml integer DEFAULT 3500 NOT NULL,
    description text,
    is_template boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: diet_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.diet_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: diet_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.diet_plans_id_seq OWNED BY public.diet_plans.id;


--
-- Name: digital_app_fees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.digital_app_fees (
    id integer NOT NULL,
    title character varying(100) NOT NULL,
    billing_cycle character varying(20) DEFAULT 'annual'::character varying NOT NULL,
    amount numeric(8,2) DEFAULT 499.00 NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: digital_app_fees_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.digital_app_fees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: digital_app_fees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.digital_app_fees_id_seq OWNED BY public.digital_app_fees.id;


--
-- Name: equipment_service_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_service_logs (
    id integer NOT NULL,
    equipment_id integer NOT NULL,
    service_date date NOT NULL,
    service_type character varying(50) NOT NULL,
    technician_name character varying(100) NOT NULL,
    vendor_name character varying(100),
    cost numeric(10,2) DEFAULT 0.00 NOT NULL,
    parts_replaced text,
    work_summary text NOT NULL,
    condition_after character varying(30) DEFAULT 'operational'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: equipment_service_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipment_service_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipment_service_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipment_service_logs_id_seq OWNED BY public.equipment_service_logs.id;


--
-- Name: equipment_suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_suppliers (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    contact_person character varying(100),
    phone character varying(50),
    email character varying(100),
    category character varying(50) DEFAULT 'Gym Equipment'::character varying,
    address text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: equipment_suppliers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.equipment_suppliers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: equipment_suppliers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.equipment_suppliers_id_seq OWNED BY public.equipment_suppliers.id;


--
-- Name: exercises; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exercises (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    muscle_group character varying(50) NOT NULL,
    equipment character varying(50) NOT NULL,
    difficulty character varying(30) DEFAULT 'Intermediate'::character varying,
    instructions text NOT NULL,
    target_muscles character varying(200),
    video_url character varying(255),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: exercises_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exercises_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exercises_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exercises_id_seq OWNED BY public.exercises.id;


--
-- Name: facility_maintenance_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facility_maintenance_logs (
    id integer NOT NULL,
    facility_id integer NOT NULL,
    branch_id integer NOT NULL,
    maintenance_type character varying(100) NOT NULL,
    scheduled_date date NOT NULL,
    completed_date date,
    technician_name character varying(100) NOT NULL,
    cost numeric(10,2) DEFAULT 0.00 NOT NULL,
    status character varying(30) DEFAULT 'scheduled'::character varying NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: facility_maintenance_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.facility_maintenance_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: facility_maintenance_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.facility_maintenance_logs_id_seq OWNED BY public.facility_maintenance_logs.id;


--
-- Name: faqs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faqs (
    id integer NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    language character varying(10) DEFAULT 'en-IN'::character varying NOT NULL,
    category character varying(50) DEFAULT 'general'::character varying NOT NULL,
    suggested_gesture character varying(50) DEFAULT 'NOD_YES'::character varying NOT NULL,
    keywords text[] DEFAULT '{}'::text[] NOT NULL,
    display_order smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT faqs_category_check CHECK (((category)::text = ANY (ARRAY[('general'::character varying)::text, ('timings'::character varying)::text, ('pricing'::character varying)::text, ('facilities'::character varying)::text, ('trainers'::character varying)::text, ('rules'::character varying)::text]))),
    CONSTRAINT faqs_language_check CHECK (((language)::text = ANY (ARRAY[('en-IN'::character varying)::text, ('kn-IN'::character varying)::text, ('hi-IN'::character varying)::text])))
);


--
-- Name: faqs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.faqs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: faqs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.faqs_id_seq OWNED BY public.faqs.id;


--
-- Name: financial_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_transactions (
    id integer NOT NULL,
    member_id integer,
    transaction_type character varying(50) NOT NULL,
    reference_id integer,
    amount numeric(10,2) NOT NULL,
    tax_amount numeric(8,2) DEFAULT 0.00 NOT NULL,
    discount_amount numeric(8,2) DEFAULT 0.00 NOT NULL,
    net_amount numeric(10,2) NOT NULL,
    payment_method character varying(50) DEFAULT 'UPI / QR'::character varying NOT NULL,
    payment_status character varying(20) DEFAULT 'completed'::character varying NOT NULL,
    invoice_number character varying(100) NOT NULL,
    receipt_number character varying(100) NOT NULL,
    transaction_date timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: financial_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.financial_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: financial_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.financial_transactions_id_seq OWNED BY public.financial_transactions.id;


--
-- Name: fitness_competitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fitness_competitions (
    id integer NOT NULL,
    title character varying(150) NOT NULL,
    type character varying(50) NOT NULL,
    description text NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    registration_deadline date,
    status character varying(30) DEFAULT 'upcoming'::character varying NOT NULL,
    organizer_trainer_id integer,
    metric_type character varying(30) NOT NULL,
    prize_pool character varying(150),
    rules text,
    banner_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_outdoor boolean DEFAULT false,
    outdoor_details jsonb DEFAULT '{}'::jsonb,
    icon character varying(16),
    CONSTRAINT fitness_competitions_status_check CHECK (((status)::text = ANY (ARRAY[('upcoming'::character varying)::text, ('in_progress'::character varying)::text, ('completed'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: fitness_competitions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.fitness_competitions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: fitness_competitions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.fitness_competitions_id_seq OWNED BY public.fitness_competitions.id;


--
-- Name: food_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.food_items (
    id integer NOT NULL,
    name character varying(120) NOT NULL,
    category character varying(50) NOT NULL,
    serving_size character varying(50) DEFAULT '100g'::character varying NOT NULL,
    calories numeric(6,1) NOT NULL,
    protein_g numeric(5,1) NOT NULL,
    carbs_g numeric(5,1) NOT NULL,
    fats_g numeric(5,1) NOT NULL,
    fiber_g numeric(5,1) DEFAULT 0.0,
    is_vegan boolean DEFAULT false,
    is_vegetarian boolean DEFAULT true,
    is_gluten_free boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: food_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.food_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: food_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.food_items_id_seq OWNED BY public.food_items.id;


--
-- Name: general_training_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.general_training_assignments (
    id integer NOT NULL,
    member_id integer NOT NULL,
    trainer_id integer,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    notes character varying(300),
    assigned_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ended_at timestamp with time zone,
    CONSTRAINT chk_gta_times CHECK ((end_time > start_time)),
    CONSTRAINT general_training_assignments_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('ended'::character varying)::text])))
);


--
-- Name: general_training_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.general_training_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: general_training_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.general_training_assignments_id_seq OWNED BY public.general_training_assignments.id;


--
-- Name: gym_branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_branches (
    id integer NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(150) NOT NULL,
    address text NOT NULL,
    city character varying(100) DEFAULT 'Bengaluru'::character varying NOT NULL,
    phone character varying(50),
    manager_id integer,
    operating_hours character varying(100) DEFAULT '06:00 - 22:00'::character varying NOT NULL,
    max_capacity integer DEFAULT 150 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: gym_branches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gym_branches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gym_branches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gym_branches_id_seq OWNED BY public.gym_branches.id;


--
-- Name: gym_equipment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_equipment (
    id integer NOT NULL,
    asset_tag character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    category character varying(50) NOT NULL,
    brand character varying(100),
    model_number character varying(100),
    serial_number character varying(100),
    floor_zone character varying(100) DEFAULT 'Main Arena'::character varying,
    purchase_date date,
    purchase_cost numeric(10,2) DEFAULT 0.00 NOT NULL,
    warranty_until date,
    condition_status character varying(30) DEFAULT 'operational'::character varying NOT NULL,
    maintenance_interval_days integer DEFAULT 30 NOT NULL,
    last_serviced_date date,
    next_service_due date,
    supplier_id integer,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: gym_equipment_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gym_equipment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gym_equipment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gym_equipment_id_seq OWNED BY public.gym_equipment.id;


--
-- Name: gym_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_expenses (
    id integer NOT NULL,
    category character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    vendor_name character varying(255) NOT NULL,
    amount numeric(10,2) NOT NULL,
    expense_date date NOT NULL,
    payment_method character varying(50) DEFAULT 'Bank Transfer'::character varying NOT NULL,
    invoice_ref character varying(100),
    status character varying(20) DEFAULT 'paid'::character varying NOT NULL,
    notes text,
    created_by_user_id integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: gym_expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gym_expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gym_expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gym_expenses_id_seq OWNED BY public.gym_expenses.id;


--
-- Name: gym_facilities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_facilities (
    id integer NOT NULL,
    branch_id integer NOT NULL,
    zone_name character varying(100) NOT NULL,
    facility_type character varying(50) NOT NULL,
    capacity integer DEFAULT 30 NOT NULL,
    floor_number character varying(20) DEFAULT 'Ground Floor'::character varying NOT NULL,
    status character varying(30) DEFAULT 'open'::character varying NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: gym_facilities_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gym_facilities_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gym_facilities_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gym_facilities_id_seq OWNED BY public.gym_facilities.id;


--
-- Name: gym_faqs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_faqs (
    id integer NOT NULL,
    question text NOT NULL,
    answer text NOT NULL,
    language character varying(10) DEFAULT 'en-IN'::character varying NOT NULL,
    category character varying(50) DEFAULT 'general'::character varying NOT NULL,
    suggested_gesture character varying(50) DEFAULT 'NOD_YES'::character varying NOT NULL,
    keywords text[] DEFAULT '{}'::text[] NOT NULL,
    display_order smallint DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT gym_faqs_category_check CHECK (((category)::text = ANY (ARRAY[('general'::character varying)::text, ('timings'::character varying)::text, ('pricing'::character varying)::text, ('facilities'::character varying)::text, ('trainers'::character varying)::text, ('rules'::character varying)::text]))),
    CONSTRAINT gym_faqs_language_check CHECK (((language)::text = ANY (ARRAY[('en-IN'::character varying)::text, ('kn-IN'::character varying)::text, ('hi-IN'::character varying)::text])))
);


--
-- Name: gym_faqs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gym_faqs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gym_faqs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gym_faqs_id_seq OWNED BY public.gym_faqs.id;


--
-- Name: gym_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_profile (
    id integer NOT NULL,
    gym_name character varying(120) DEFAULT 'PulseCore Fitness'::character varying NOT NULL,
    tagline character varying(200) DEFAULT 'AI-Powered Smart Fitness Reception'::character varying,
    phone character varying(30) DEFAULT '+91 98765 43210'::character varying NOT NULL,
    email character varying(120) DEFAULT 'reception@pulsecorefitness.in'::character varying NOT NULL,
    address text DEFAULT '42, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038'::text NOT NULL,
    operating_hours jsonb DEFAULT '[{"days": "Monday â€“ Friday", "open": "06:00", "close": "22:00", "status": "Open"}, {"days": "Saturday", "open": "06:00", "close": "21:00", "status": "Open"}, {"days": "Sunday", "open": "07:00", "close": "13:00", "status": "Half Day"}]'::jsonb NOT NULL,
    default_language character varying(10) DEFAULT 'en-IN'::character varying,
    speech_rate numeric(3,2) DEFAULT 1.00,
    speech_pitch numeric(3,2) DEFAULT 1.00,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: gym_profile_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gym_profile_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gym_profile_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gym_profile_id_seq OWNED BY public.gym_profile.id;


--
-- Name: gym_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gym_settings (
    id smallint DEFAULT 1 NOT NULL,
    gym_name character varying(120) DEFAULT 'PulseCore Fitness'::character varying NOT NULL,
    tagline character varying(200) DEFAULT 'AI-Powered Smart Fitness Reception'::character varying,
    phone character varying(20) DEFAULT '+91 98765 43210'::character varying NOT NULL,
    email character varying(120) DEFAULT 'reception@pulsecorefitness.in'::character varying NOT NULL,
    address text DEFAULT '42, 100 Feet Road, Indiranagar, Bengaluru, Karnataka 560038'::text NOT NULL,
    operating_hours jsonb DEFAULT '[{"day": "Monday", "open": "06:00", "close": "22:00", "is_closed": false}, {"day": "Tuesday", "open": "06:00", "close": "22:00", "is_closed": false}, {"day": "Wednesday", "open": "06:00", "close": "22:00", "is_closed": false}, {"day": "Thursday", "open": "06:00", "close": "22:00", "is_closed": false}, {"day": "Friday", "open": "06:00", "close": "22:00", "is_closed": false}, {"day": "Saturday", "open": "06:00", "close": "21:00", "is_closed": false}, {"day": "Sunday", "open": "07:00", "close": "13:00", "is_closed": false}]'::jsonb NOT NULL,
    default_language character varying(10) DEFAULT 'en-IN'::character varying NOT NULL,
    supported_languages text[] DEFAULT '{en-IN,kn-IN,hi-IN}'::text[] NOT NULL,
    speech_rate numeric(3,2) DEFAULT 1.00 NOT NULL,
    speech_pitch numeric(3,2) DEFAULT 1.00 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    checkin_cooldown_minutes smallint DEFAULT 5 NOT NULL,
    wifi_ssid character varying(64) DEFAULT 'PulseCore-Gym-Guest'::character varying,
    updated_by integer,
    member_menu jsonb,
    CONSTRAINT gym_settings_checkin_cooldown_minutes_check CHECK ((checkin_cooldown_minutes >= 0)),
    CONSTRAINT gym_settings_default_language_check CHECK (((default_language)::text = ANY (ARRAY[('en-IN'::character varying)::text, ('kn-IN'::character varying)::text, ('hi-IN'::character varying)::text]))),
    CONSTRAINT gym_settings_id_check CHECK ((id = 1)),
    CONSTRAINT gym_settings_speech_pitch_check CHECK (((speech_pitch >= 0.50) AND (speech_pitch <= 2.00))),
    CONSTRAINT gym_settings_speech_rate_check CHECK (((speech_rate >= 0.50) AND (speech_rate <= 2.00)))
);


--
-- Name: interaction_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interaction_logs (
    id bigint NOT NULL,
    member_id integer,
    device_id integer,
    user_query text NOT NULL,
    robot_response text NOT NULL,
    language character varying(10) DEFAULT 'en-IN'::character varying NOT NULL,
    input_method character varying(20) DEFAULT 'voice'::character varying NOT NULL,
    intent_detected character varying(50),
    gesture_command_id bigint,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    session_id character varying(64),
    sentiment character varying(20) DEFAULT 'neutral'::character varying,
    audio_duration_ms integer,
    CONSTRAINT interaction_logs_input_method_check CHECK (((input_method)::text = ANY (ARRAY[('voice'::character varying)::text, ('text_kiosk'::character varying)::text, ('rfid_scan'::character varying)::text]))),
    CONSTRAINT interaction_logs_language_check CHECK (((language)::text = ANY (ARRAY[('en-IN'::character varying)::text, ('kn-IN'::character varying)::text, ('hi-IN'::character varying)::text])))
);


--
-- Name: interaction_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.interaction_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: interaction_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.interaction_logs_id_seq OWNED BY public.interaction_logs.id;


--
-- Name: inventory_purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_purchase_orders (
    id integer NOT NULL,
    po_code character varying(50) NOT NULL,
    supplier_id integer NOT NULL,
    order_date date NOT NULL,
    expected_delivery date,
    total_cost numeric(10,2) DEFAULT 0.00 NOT NULL,
    status character varying(20) DEFAULT 'ordered'::character varying NOT NULL,
    items_summary jsonb DEFAULT '[]'::jsonb,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: inventory_purchase_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inventory_purchase_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inventory_purchase_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inventory_purchase_orders_id_seq OWNED BY public.inventory_purchase_orders.id;


--
-- Name: library_books; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.library_books (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    slug character varying(255),
    author character varying(255) NOT NULL,
    category character varying(50) NOT NULL,
    description text,
    cover_url text,
    secure_file_path text NOT NULL,
    file_format character varying(10) DEFAULT 'PDF'::character varying NOT NULL,
    file_size_mb numeric(5,2) DEFAULT 8.50 NOT NULL,
    page_count integer DEFAULT 200 NOT NULL,
    is_paid boolean DEFAULT false NOT NULL,
    price_amount numeric(8,2) DEFAULT 0.00 NOT NULL,
    currency character varying(10) DEFAULT 'INR'::character varying NOT NULL,
    access_tier character varying(30) DEFAULT 'all_members'::character varying NOT NULL,
    status character varying(20) DEFAULT 'published'::character varying NOT NULL,
    downloads_count integer DEFAULT 0 NOT NULL,
    created_by_user_id integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: library_books_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.library_books_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: library_books_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.library_books_id_seq OWNED BY public.library_books.id;


--
-- Name: member_admission_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_admission_records (
    id integer NOT NULL,
    member_id integer NOT NULL,
    admission_fee_id integer,
    amount numeric(8,2) DEFAULT 1000.00 NOT NULL,
    status character varying(20) DEFAULT 'paid'::character varying NOT NULL,
    waiver_reason text,
    receipt_code character varying(100),
    paid_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: member_admission_records_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_admission_records_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_admission_records_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_admission_records_id_seq OWNED BY public.member_admission_records.id;


--
-- Name: member_app_fee_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_app_fee_subscriptions (
    id integer NOT NULL,
    member_id integer NOT NULL,
    app_fee_id integer,
    amount_paid numeric(8,2) DEFAULT 499.00 NOT NULL,
    valid_from date NOT NULL,
    valid_until date NOT NULL,
    payment_status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: member_app_fee_subscriptions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_app_fee_subscriptions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_app_fee_subscriptions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_app_fee_subscriptions_id_seq OWNED BY public.member_app_fee_subscriptions.id;


--
-- Name: member_body_measurements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_body_measurements (
    id integer NOT NULL,
    member_id integer NOT NULL,
    weight_kg numeric(5,2) NOT NULL,
    body_fat_pct numeric(4,1),
    muscle_mass_kg numeric(5,2),
    chest_cm numeric(5,1),
    waist_cm numeric(5,1),
    arms_cm numeric(5,1),
    thighs_cm numeric(5,1),
    notes text,
    logged_at timestamp with time zone DEFAULT now(),
    height_cm numeric(5,1) DEFAULT 175.0,
    bmi numeric(4,1),
    hips_cm numeric(5,1),
    calves_cm numeric(5,1),
    shoulders_cm numeric(5,1),
    neck_cm numeric(5,1),
    measured_by character varying(50) DEFAULT 'Trainer'::character varying
);


--
-- Name: member_body_measurements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_body_measurements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_body_measurements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_body_measurements_id_seq OWNED BY public.member_body_measurements.id;


--
-- Name: member_communication_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_communication_logs (
    id integer NOT NULL,
    member_id integer NOT NULL,
    campaign_id integer,
    channel character varying(30) NOT NULL,
    direction character varying(10) DEFAULT 'outbound'::character varying NOT NULL,
    subject character varying(255),
    message text NOT NULL,
    delivery_status character varying(20) DEFAULT 'delivered'::character varying NOT NULL,
    opened_at timestamp with time zone,
    clicked_at timestamp with time zone,
    sent_by character varying(100) DEFAULT 'PulseCore Retention Engine'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: member_communication_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_communication_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_communication_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_communication_logs_id_seq OWNED BY public.member_communication_logs.id;


--
-- Name: member_complaints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_complaints (
    id integer NOT NULL,
    ticket_number character varying(50) NOT NULL,
    member_id integer NOT NULL,
    category character varying(50) NOT NULL,
    priority character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    subject character varying(200) NOT NULL,
    description text NOT NULL,
    resolution_notes text,
    assigned_to character varying(100) DEFAULT 'Duty Manager'::character varying,
    status character varying(30) DEFAULT 'open'::character varying NOT NULL,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: member_complaints_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_complaints_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_complaints_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_complaints_id_seq OWNED BY public.member_complaints.id;


--
-- Name: member_diet_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_diet_assignments (
    id integer NOT NULL,
    member_id integer NOT NULL,
    plan_id integer NOT NULL,
    assigned_by_trainer_id integer,
    start_date date DEFAULT CURRENT_DATE NOT NULL,
    end_date date,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT member_diet_assignments_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('completed'::character varying)::text, ('paused'::character varying)::text])))
);


--
-- Name: member_diet_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_diet_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_diet_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_diet_assignments_id_seq OWNED BY public.member_diet_assignments.id;


--
-- Name: member_enquiries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_enquiries (
    id integer NOT NULL,
    full_name character varying(120) NOT NULL,
    phone character varying(20) NOT NULL,
    email character varying(120),
    plan_name character varying(100),
    preferred_timing character varying(50),
    notes text,
    status character varying(20) DEFAULT 'new'::character varying NOT NULL,
    assigned_trainer_id integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    customization_type character varying(100) DEFAULT 'Standard Gym Access'::character varying,
    CONSTRAINT member_enquiries_status_check CHECK (((status)::text = ANY (ARRAY[('new'::character varying)::text, ('contacted'::character varying)::text, ('converted'::character varying)::text, ('closed'::character varying)::text])))
);


--
-- Name: member_enquiries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_enquiries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_enquiries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_enquiries_id_seq OWNED BY public.member_enquiries.id;


--
-- Name: member_feedbacks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_feedbacks (
    id integer NOT NULL,
    member_id integer NOT NULL,
    nps_score integer NOT NULL,
    category character varying(50) DEFAULT 'General'::character varying NOT NULL,
    sentiment character varying(20) DEFAULT 'neutral'::character varying NOT NULL,
    feedback_text text NOT NULL,
    status character varying(20) DEFAULT 'reviewed'::character varying NOT NULL,
    admin_response text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT member_feedbacks_nps_score_check CHECK (((nps_score >= 0) AND (nps_score <= 10)))
);


--
-- Name: member_feedbacks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_feedbacks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_feedbacks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_feedbacks_id_seq OWNED BY public.member_feedbacks.id;


--
-- Name: member_muscle_soreness_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_muscle_soreness_details (
    id integer NOT NULL,
    recovery_log_id integer NOT NULL,
    muscle_group character varying(50) NOT NULL,
    soreness_level smallint NOT NULL,
    notes text,
    CONSTRAINT member_muscle_soreness_details_soreness_level_check CHECK (((soreness_level >= 0) AND (soreness_level <= 10)))
);


--
-- Name: member_muscle_soreness_details_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_muscle_soreness_details_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_muscle_soreness_details_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_muscle_soreness_details_id_seq OWNED BY public.member_muscle_soreness_details.id;


--
-- Name: member_nutrition_daily_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_nutrition_daily_logs (
    id integer NOT NULL,
    member_id integer NOT NULL,
    log_date date DEFAULT CURRENT_DATE NOT NULL,
    total_calories numeric(6,1) DEFAULT 0 NOT NULL,
    total_protein_g numeric(5,1) DEFAULT 0 NOT NULL,
    total_carbs_g numeric(5,1) DEFAULT 0 NOT NULL,
    total_fats_g numeric(5,1) DEFAULT 0 NOT NULL,
    water_intake_ml integer DEFAULT 0 NOT NULL,
    adherence_score smallint DEFAULT 100,
    notes text,
    logged_by character varying(50) DEFAULT 'Member'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT member_nutrition_daily_logs_adherence_score_check CHECK (((adherence_score >= 0) AND (adherence_score <= 100)))
);


--
-- Name: member_nutrition_daily_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_nutrition_daily_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_nutrition_daily_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_nutrition_daily_logs_id_seq OWNED BY public.member_nutrition_daily_logs.id;


--
-- Name: member_nutrition_meal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_nutrition_meal_entries (
    id integer NOT NULL,
    daily_log_id integer NOT NULL,
    meal_type character varying(30) NOT NULL,
    food_item_id integer,
    food_name character varying(120) NOT NULL,
    portion_size character varying(50) NOT NULL,
    calories numeric(6,1) NOT NULL,
    protein_g numeric(5,1) NOT NULL,
    carbs_g numeric(5,1) NOT NULL,
    fats_g numeric(5,1) NOT NULL,
    logged_at timestamp with time zone DEFAULT now()
);


--
-- Name: member_nutrition_meal_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_nutrition_meal_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_nutrition_meal_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_nutrition_meal_entries_id_seq OWNED BY public.member_nutrition_meal_entries.id;


--
-- Name: member_performance_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_performance_profiles (
    id integer NOT NULL,
    member_id integer NOT NULL,
    assigned_trainer_id integer,
    fitness_goal character varying(100) DEFAULT 'General Fitness'::character varying,
    overall_progress_pct numeric(5,2),
    workout_completion_pct numeric(5,2),
    attendance_pct numeric(5,2),
    diet_adherence_pct numeric(5,2),
    recovery_status character varying(50),
    progress_status character varying(50) DEFAULT 'insufficient_data'::character varying,
    trainer_notes text,
    consent_photos boolean DEFAULT false,
    last_updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: member_performance_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_performance_profiles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_performance_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_performance_profiles_id_seq OWNED BY public.member_performance_profiles.id;


--
-- Name: member_recovery_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_recovery_logs (
    id integer NOT NULL,
    member_id integer NOT NULL,
    log_date date DEFAULT CURRENT_DATE NOT NULL,
    sleep_hours numeric(3,1) NOT NULL,
    sleep_quality smallint NOT NULL,
    energy_level smallint NOT NULL,
    stress_level smallint NOT NULL,
    hydration_liters numeric(3,1) DEFAULT 3.0,
    overall_soreness_rating smallint NOT NULL,
    user_notes text,
    is_rest_day boolean DEFAULT false,
    rest_day_activity character varying(100),
    readiness_score smallint NOT NULL,
    fatigue_index smallint NOT NULL,
    readiness_status character varying(50) NOT NULL,
    recommended_action character varying(255),
    logged_by character varying(50) DEFAULT 'Member'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT member_recovery_logs_energy_level_check CHECK (((energy_level >= 1) AND (energy_level <= 10))),
    CONSTRAINT member_recovery_logs_fatigue_index_check CHECK (((fatigue_index >= 0) AND (fatigue_index <= 100))),
    CONSTRAINT member_recovery_logs_overall_soreness_rating_check CHECK (((overall_soreness_rating >= 0) AND (overall_soreness_rating <= 10))),
    CONSTRAINT member_recovery_logs_readiness_score_check CHECK (((readiness_score >= 0) AND (readiness_score <= 100))),
    CONSTRAINT member_recovery_logs_sleep_quality_check CHECK (((sleep_quality >= 1) AND (sleep_quality <= 10))),
    CONSTRAINT member_recovery_logs_stress_level_check CHECK (((stress_level >= 1) AND (stress_level <= 10)))
);


--
-- Name: member_recovery_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_recovery_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_recovery_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_recovery_logs_id_seq OWNED BY public.member_recovery_logs.id;


--
-- Name: member_strength_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_strength_logs (
    id integer NOT NULL,
    member_id integer NOT NULL,
    exercise_name character varying(100) NOT NULL,
    weight_kg numeric(6,2) NOT NULL,
    reps integer DEFAULT 1 NOT NULL,
    estimated_one_rep_max numeric(6,2) NOT NULL,
    logged_at timestamp with time zone DEFAULT now()
);


--
-- Name: member_strength_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_strength_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_strength_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_strength_logs_id_seq OWNED BY public.member_strength_logs.id;


--
-- Name: member_trainer_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_trainer_comments (
    id integer NOT NULL,
    member_id integer NOT NULL,
    trainer_id integer,
    comment_type character varying(50) DEFAULT 'weekly_checkin'::character varying,
    comment_text text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: member_trainer_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_trainer_comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_trainer_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_trainer_comments_id_seq OWNED BY public.member_trainer_comments.id;


--
-- Name: member_transformation_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_transformation_photos (
    id integer NOT NULL,
    member_id integer NOT NULL,
    photo_url text NOT NULL,
    photo_type character varying(20) DEFAULT 'front'::character varying,
    consent_given boolean DEFAULT true,
    caption text,
    logged_at timestamp with time zone DEFAULT now(),
    pose character varying(30) DEFAULT 'Front'::character varying,
    phase character varying(50) DEFAULT 'Baseline'::character varying,
    weight_at_photo numeric(5,2),
    body_fat_at_photo numeric(4,1),
    consent_signature character varying(100)
);


--
-- Name: member_transformation_photos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_transformation_photos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_transformation_photos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_transformation_photos_id_seq OWNED BY public.member_transformation_photos.id;


--
-- Name: member_workout_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_workout_assignments (
    id integer NOT NULL,
    member_id integer NOT NULL,
    program_id integer NOT NULL,
    assigned_by_trainer_id integer,
    start_date date DEFAULT CURRENT_DATE NOT NULL,
    end_date date,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    trainer_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT member_workout_assignments_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('completed'::character varying)::text, ('paused'::character varying)::text])))
);


--
-- Name: member_workout_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.member_workout_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: member_workout_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.member_workout_assignments_id_seq OWNED BY public.member_workout_assignments.id;


--
-- Name: members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.members (
    id integer NOT NULL,
    member_code character varying(32) NOT NULL,
    full_name character varying(120) NOT NULL,
    phone character varying(20) NOT NULL,
    email character varying(120),
    plan_id integer,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    preferred_language character varying(10) DEFAULT 'en-IN'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    emergency_contact_name character varying(100),
    emergency_contact_phone character varying(20),
    notes text,
    created_by integer,
    updated_by integer,
    plan_name character varying(100),
    date_of_birth date,
    fee_amount numeric(10,2) DEFAULT 0.00,
    fee_paid numeric(10,2) DEFAULT 0.00,
    fee_due numeric(10,2) DEFAULT 0.00,
    fee_due_date date,
    payment_method character varying(50) DEFAULT 'Cash'::character varying,
    payment_status character varying(50) DEFAULT 'paid'::character varying,
    fee_alert_sent_at timestamp with time zone,
    birthday_wish_sent_at timestamp with time zone,
    gender character varying(6),
    CONSTRAINT chk_members_gender CHECK (((gender IS NULL) OR ((gender)::text = ANY (ARRAY[('female'::character varying)::text, ('male'::character varying)::text])))),
    CONSTRAINT members_preferred_language_check CHECK (((preferred_language)::text = ANY (ARRAY[('en-IN'::character varying)::text, ('kn-IN'::character varying)::text, ('hi-IN'::character varying)::text]))),
    CONSTRAINT members_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('inactive'::character varying)::text, ('expired'::character varying)::text, ('frozen'::character varying)::text])))
);


--
-- Name: members_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.members_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: members_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.members_id_seq OWNED BY public.members.id;


--
-- Name: membership_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_plans (
    id integer NOT NULL,
    plan_code character varying(32) NOT NULL,
    name character varying(100) NOT NULL,
    duration_months smallint NOT NULL,
    price_inr numeric(10,2) NOT NULL,
    badge_label character varying(30),
    is_featured boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    perks text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by integer,
    updated_by integer,
    audience character varying(8) DEFAULT 'all'::character varying NOT NULL,
    weekly_schedule jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT chk_membership_plans_audience CHECK (((audience)::text = ANY (ARRAY[('all'::character varying)::text, ('girls'::character varying)::text, ('boys'::character varying)::text]))),
    CONSTRAINT chk_membership_plans_schedule_object CHECK ((jsonb_typeof(weekly_schedule) = 'object'::text)),
    CONSTRAINT membership_plans_duration_months_check CHECK ((duration_months > 0)),
    CONSTRAINT membership_plans_price_inr_check CHECK ((price_inr >= (0)::numeric))
);


--
-- Name: membership_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.membership_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: membership_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.membership_plans_id_seq OWNED BY public.membership_plans.id;


--
-- Name: memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memberships (
    id integer NOT NULL,
    member_id integer NOT NULL,
    plan_id integer NOT NULL,
    start_date date DEFAULT CURRENT_DATE NOT NULL,
    end_date date NOT NULL,
    price_paid numeric(10,2) NOT NULL,
    payment_status character varying(20) DEFAULT 'paid'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    auto_renew boolean DEFAULT false NOT NULL,
    notes text,
    created_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_membership_dates CHECK ((end_date >= start_date)),
    CONSTRAINT memberships_payment_status_check CHECK (((payment_status)::text = ANY (ARRAY[('paid'::character varying)::text, ('pending'::character varying)::text, ('waived'::character varying)::text, ('refunded'::character varying)::text]))),
    CONSTRAINT memberships_price_paid_check CHECK ((price_paid >= (0)::numeric)),
    CONSTRAINT memberships_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('expired'::character varying)::text, ('cancelled'::character varying)::text, ('frozen'::character varying)::text])))
);


--
-- Name: memberships_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.memberships_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: memberships_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.memberships_id_seq OWNED BY public.memberships.id;


--
-- Name: message_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_attachments (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id bigint NOT NULL,
    file_name character varying(160) NOT NULL,
    mime_type character varying(120) NOT NULL,
    size_bytes integer NOT NULL,
    storage_name character varying(80) NOT NULL,
    uploaded_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT message_attachments_size_bytes_check CHECK (((size_bytes > 0) AND (size_bytes <= 5242880)))
);


--
-- Name: message_attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_attachments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_attachments_id_seq OWNED BY public.message_attachments.id;


--
-- Name: message_poll_options; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_poll_options (
    id bigint NOT NULL,
    poll_id bigint NOT NULL,
    label character varying(100) NOT NULL,
    "position" smallint DEFAULT 0 NOT NULL
);


--
-- Name: message_poll_options_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_poll_options_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_poll_options_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_poll_options_id_seq OWNED BY public.message_poll_options.id;


--
-- Name: message_poll_votes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_poll_votes (
    id bigint NOT NULL,
    poll_id bigint NOT NULL,
    option_id bigint NOT NULL,
    user_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: message_poll_votes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_poll_votes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_poll_votes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_poll_votes_id_seq OWNED BY public.message_poll_votes.id;


--
-- Name: message_polls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_polls (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id bigint NOT NULL,
    question character varying(200) NOT NULL,
    allow_multiple boolean DEFAULT false NOT NULL,
    closed_at timestamp with time zone,
    created_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: message_polls_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.message_polls_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: message_polls_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.message_polls_id_seq OWNED BY public.message_polls.id;


--
-- Name: message_thread_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_thread_members (
    thread_id bigint NOT NULL,
    member_id integer NOT NULL,
    added_by_user_id integer,
    added_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    removed_at timestamp with time zone,
    last_read_at timestamp with time zone
);


--
-- Name: message_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_threads (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    trainer_id integer,
    member_id integer,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    last_message_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    thread_type character varying(20) DEFAULT 'trainer'::character varying NOT NULL,
    title character varying(80),
    description character varying(300),
    created_by_user_id integer,
    CONSTRAINT chk_thread_archived CHECK ((((status)::text <> 'archived'::text) OR (archived_at IS NOT NULL))),
    CONSTRAINT chk_thread_party CHECK (((((thread_type)::text = 'trainer'::text) AND (trainer_id IS NOT NULL) AND (member_id IS NOT NULL)) OR (((thread_type)::text = 'gym'::text) AND (trainer_id IS NULL) AND (member_id IS NOT NULL)) OR (((thread_type)::text = 'group'::text) AND (trainer_id IS NULL) AND (member_id IS NULL) AND (title IS NOT NULL)) OR (((thread_type)::text = 'trainer_gym'::text) AND (trainer_id IS NOT NULL) AND (member_id IS NULL)))),
    CONSTRAINT chk_thread_type CHECK (((thread_type)::text = ANY (ARRAY[('trainer'::character varying)::text, ('gym'::character varying)::text, ('group'::character varying)::text, ('trainer_gym'::character varying)::text]))),
    CONSTRAINT message_threads_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('archived'::character varying)::text])))
);


--
-- Name: message_threads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.message_threads ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.message_threads_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    thread_id bigint NOT NULL,
    sender_user_id integer,
    sender_role character varying(20) NOT NULL,
    body text NOT NULL,
    read_at timestamp with time zone,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT messages_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000))),
    CONSTRAINT messages_sender_role_check CHECK (((sender_role)::text = ANY (ARRAY[('trainer'::character varying)::text, ('member'::character varying)::text, ('staff'::character varying)::text, ('system'::character varying)::text])))
);


--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.messages ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_user_id integer NOT NULL,
    type character varying(30) NOT NULL,
    title character varying(160) NOT NULL,
    body text,
    link_url character varying(255),
    entity_type character varying(40),
    entity_id bigint,
    read_at timestamp with time zone,
    archived_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT notifications_type_check CHECK (((type)::text = ANY (ARRAY[('session_booked'::character varying)::text, ('session_cancelled'::character varying)::text, ('session_reminder'::character varying)::text, ('session_completed'::character varying)::text, ('assignment_created'::character varying)::text, ('assignment_updated'::character varying)::text, ('package_low_balance'::character varying)::text, ('package_expiring'::character varying)::text, ('new_message'::character varying)::text, ('workout_assigned'::character varying)::text, ('diet_assigned'::character varying)::text, ('feedback'::character varying)::text, ('system'::character varying)::text])))
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.notifications ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.notifications_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: online_classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.online_classes (
    id integer NOT NULL,
    title character varying(255) NOT NULL,
    category character varying(50) NOT NULL,
    class_type character varying(20) DEFAULT 'live'::character varying NOT NULL,
    instructor_trainer_id integer,
    description text,
    scheduled_at timestamp with time zone NOT NULL,
    duration_mins integer DEFAULT 45 NOT NULL,
    stream_url text,
    thumbnail_url text,
    max_participants integer DEFAULT 50,
    difficulty character varying(20) DEFAULT 'All Levels'::character varying,
    status character varying(20) DEFAULT 'scheduled'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: online_classes_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.online_classes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: online_classes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.online_classes_id_seq OWNED BY public.online_classes.id;


--
-- Name: personal_trainer_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personal_trainer_assignments (
    id integer NOT NULL,
    member_id integer NOT NULL,
    trainer_id integer NOT NULL,
    monthly_fee numeric(10,2) DEFAULT 5000.00 NOT NULL,
    fee_paid numeric(10,2) DEFAULT 5000.00 NOT NULL,
    fee_due numeric(10,2) DEFAULT 0.00 NOT NULL,
    start_date date DEFAULT CURRENT_DATE NOT NULL,
    end_date date DEFAULT (CURRENT_DATE + '30 days'::interval) NOT NULL,
    sessions_per_week smallint DEFAULT 3 NOT NULL,
    preferred_slot character varying(80) DEFAULT 'Morning (07:00 AM - 08:00 AM)'::character varying,
    training_goal character varying(150) DEFAULT 'Hypertrophy & Strength Training'::character varying,
    payment_status character varying(20) DEFAULT 'paid'::character varying NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    package_id bigint,
    CONSTRAINT personal_trainer_assignments_fee_due_check CHECK ((fee_due >= (0)::numeric)),
    CONSTRAINT personal_trainer_assignments_fee_paid_check CHECK ((fee_paid >= (0)::numeric)),
    CONSTRAINT personal_trainer_assignments_monthly_fee_check CHECK ((monthly_fee >= (0)::numeric)),
    CONSTRAINT personal_trainer_assignments_payment_status_check CHECK (((payment_status)::text = ANY (ARRAY[('paid'::character varying)::text, ('pending'::character varying)::text, ('partial'::character varying)::text, ('waived'::character varying)::text]))),
    CONSTRAINT personal_trainer_assignments_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('paused'::character varying)::text, ('completed'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: personal_trainer_assignments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.personal_trainer_assignments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: personal_trainer_assignments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.personal_trainer_assignments_id_seq OWNED BY public.personal_trainer_assignments.id;


--
-- Name: promotional_discounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotional_discounts (
    id integer NOT NULL,
    code character varying(50) NOT NULL,
    description text,
    discount_type character varying(20) DEFAULT 'percentage'::character varying NOT NULL,
    discount_value numeric(8,2) DEFAULT 10.00 NOT NULL,
    min_purchase_amount numeric(8,2) DEFAULT 0.00 NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    max_uses integer DEFAULT 100,
    times_used integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: promotional_discounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.promotional_discounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: promotional_discounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.promotional_discounts_id_seq OWNED BY public.promotional_discounts.id;


--
-- Name: pt_package_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pt_package_purchases (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id integer NOT NULL,
    package_id bigint NOT NULL,
    assignment_id integer,
    trainer_id integer,
    sessions_total integer NOT NULL,
    sessions_used integer DEFAULT 0 NOT NULL,
    sessions_remaining integer GENERATED ALWAYS AS ((sessions_total - sessions_used)) STORED,
    price_paid_inr numeric(10,2) DEFAULT 0 NOT NULL,
    payment_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    valid_from date DEFAULT CURRENT_DATE NOT NULL,
    valid_until date NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    notes text,
    created_by_user_id integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_ptpp_used_le_total CHECK ((sessions_used <= sessions_total)),
    CONSTRAINT chk_ptpp_valid_range CHECK ((valid_until >= valid_from)),
    CONSTRAINT pt_package_purchases_payment_status_check CHECK (((payment_status)::text = ANY (ARRAY[('paid'::character varying)::text, ('pending'::character varying)::text, ('partial'::character varying)::text, ('waived'::character varying)::text, ('refunded'::character varying)::text]))),
    CONSTRAINT pt_package_purchases_price_paid_inr_check CHECK ((price_paid_inr >= (0)::numeric)),
    CONSTRAINT pt_package_purchases_sessions_total_check CHECK ((sessions_total > 0)),
    CONSTRAINT pt_package_purchases_sessions_used_check CHECK ((sessions_used >= 0)),
    CONSTRAINT pt_package_purchases_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('exhausted'::character varying)::text, ('expired'::character varying)::text, ('cancelled'::character varying)::text, ('refunded'::character varying)::text])))
);


--
-- Name: pt_package_purchases_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pt_package_purchases ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pt_package_purchases_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pt_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pt_packages (
    id bigint NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    package_code character varying(32) NOT NULL,
    name character varying(120) NOT NULL,
    description text,
    sessions_count integer NOT NULL,
    validity_days integer NOT NULL,
    session_duration_mins smallint DEFAULT 60 NOT NULL,
    price_inr numeric(10,2) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    archived_at timestamp with time zone,
    created_by_user_id integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_pt_packages_archived_inactive CHECK (((archived_at IS NULL) OR (is_active = false))),
    CONSTRAINT pt_packages_price_inr_check CHECK ((price_inr >= (0)::numeric)),
    CONSTRAINT pt_packages_session_duration_mins_check CHECK (((session_duration_mins >= 15) AND (session_duration_mins <= 240))),
    CONSTRAINT pt_packages_sessions_count_check CHECK ((sessions_count > 0)),
    CONSTRAINT pt_packages_validity_days_check CHECK ((validity_days > 0))
);


--
-- Name: pt_packages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pt_packages ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pt_packages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pt_session_balance_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pt_session_balance_ledger (
    id bigint NOT NULL,
    purchase_id bigint NOT NULL,
    session_id bigint,
    delta integer NOT NULL,
    reason character varying(30) NOT NULL,
    balance_after integer NOT NULL,
    created_by_user_id integer,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT pt_session_balance_ledger_balance_after_check CHECK ((balance_after >= 0)),
    CONSTRAINT pt_session_balance_ledger_delta_check CHECK ((delta <> 0)),
    CONSTRAINT pt_session_balance_ledger_reason_check CHECK (((reason)::text = ANY (ARRAY[('purchase'::character varying)::text, ('session_completed'::character varying)::text, ('no_show_charged'::character varying)::text, ('session_reversed'::character varying)::text, ('manual_adjustment'::character varying)::text, ('expired'::character varying)::text, ('refund'::character varying)::text])))
);


--
-- Name: pt_session_balance_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pt_session_balance_ledger ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pt_session_balance_ledger_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: pt_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.pt_sessions ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.pt_sessions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: refund_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refund_requests (
    id integer NOT NULL,
    transaction_id integer,
    member_id integer NOT NULL,
    amount numeric(10,2) NOT NULL,
    reason text NOT NULL,
    status character varying(20) DEFAULT 'requested'::character varying NOT NULL,
    approved_by_user_id integer,
    requested_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    processed_at timestamp with time zone,
    notes text
);


--
-- Name: refund_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.refund_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refund_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.refund_requests_id_seq OWNED BY public.refund_requests.id;


--
-- Name: retail_inventory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retail_inventory (
    id integer NOT NULL,
    sku character varying(50) NOT NULL,
    name character varying(255) NOT NULL,
    category character varying(50) NOT NULL,
    brand character varying(100),
    unit_price numeric(10,2) DEFAULT 0.00 NOT NULL,
    cost_price numeric(10,2) DEFAULT 0.00 NOT NULL,
    stock_quantity integer DEFAULT 0 NOT NULL,
    reorder_threshold integer DEFAULT 5 NOT NULL,
    unit_measure character varying(20) DEFAULT 'Units'::character varying,
    expiry_date date,
    supplier_id integer,
    status character varying(20) DEFAULT 'in_stock'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: retail_inventory_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.retail_inventory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: retail_inventory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.retail_inventory_id_seq OWNED BY public.retail_inventory.id;


--
-- Name: retention_audience_segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retention_audience_segments (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    code character varying(50) NOT NULL,
    description text,
    filter_criteria jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: retention_audience_segments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.retention_audience_segments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: retention_audience_segments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.retention_audience_segments_id_seq OWNED BY public.retention_audience_segments.id;


--
-- Name: retention_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retention_campaigns (
    id integer NOT NULL,
    title character varying(200) NOT NULL,
    campaign_type character varying(50) NOT NULL,
    target_segment_code character varying(50) DEFAULT 'all_active'::character varying NOT NULL,
    template_id integer,
    message_title character varying(255),
    message_body text NOT NULL,
    action_url character varying(255),
    status character varying(30) DEFAULT 'draft'::character varying NOT NULL,
    scheduled_at timestamp with time zone,
    sent_count integer DEFAULT 0 NOT NULL,
    delivered_count integer DEFAULT 0 NOT NULL,
    opened_count integer DEFAULT 0 NOT NULL,
    clicked_count integer DEFAULT 0 NOT NULL,
    converted_count integer DEFAULT 0 NOT NULL,
    created_by character varying(100) DEFAULT 'Admin'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: retention_campaigns_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.retention_campaigns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: retention_campaigns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.retention_campaigns_id_seq OWNED BY public.retention_campaigns.id;


--
-- Name: retention_email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retention_email_templates (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    category character varying(50) DEFAULT 'renewal'::character varying NOT NULL,
    subject character varying(255) NOT NULL,
    body_html text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: retention_email_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.retention_email_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: retention_email_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.retention_email_templates_id_seq OWNED BY public.retention_email_templates.id;


--
-- Name: robot_command_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.robot_command_logs (
    id bigint NOT NULL,
    device_id integer NOT NULL,
    command_type character varying(30) NOT NULL,
    gesture_name character varying(50),
    servo_payload jsonb NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    triggered_by character varying(50) DEFAULT 'system'::character varying NOT NULL,
    execution_time_ms integer,
    error_message text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT robot_command_logs_command_type_check CHECK (((command_type)::text = ANY (ARRAY[('GESTURE'::character varying)::text, ('DIRECT_ANGLES'::character varying)::text, ('CALIBRATE'::character varying)::text, ('EMERGENCY_STOP'::character varying)::text]))),
    CONSTRAINT robot_command_logs_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('delivered'::character varying)::text, ('executed'::character varying)::text, ('failed'::character varying)::text])))
);


--
-- Name: robot_command_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.robot_command_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: robot_command_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.robot_command_logs_id_seq OWNED BY public.robot_command_logs.id;


--
-- Name: robot_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.robot_commands (
    id bigint NOT NULL,
    device_id integer NOT NULL,
    command_type character varying(30) NOT NULL,
    gesture_name character varying(50),
    servo_payload jsonb NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    priority smallint DEFAULT 1 NOT NULL,
    triggered_by character varying(50) DEFAULT 'system'::character varying NOT NULL,
    execution_time_ms integer,
    error_message text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT robot_commands_command_type_check CHECK (((command_type)::text = ANY (ARRAY[('GESTURE'::character varying)::text, ('DIRECT_ANGLES'::character varying)::text, ('CALIBRATE'::character varying)::text, ('EMERGENCY_STOP'::character varying)::text]))),
    CONSTRAINT robot_commands_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('delivered'::character varying)::text, ('executed'::character varying)::text, ('failed'::character varying)::text])))
);


--
-- Name: robot_commands_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.robot_commands_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: robot_commands_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.robot_commands_id_seq OWNED BY public.robot_commands.id;


--
-- Name: robot_device_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.robot_device_alerts (
    id integer NOT NULL,
    device_id integer NOT NULL,
    alert_type character varying(50) NOT NULL,
    severity character varying(20) DEFAULT 'medium'::character varying NOT NULL,
    message text NOT NULL,
    is_resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: robot_device_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.robot_device_alerts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: robot_device_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.robot_device_alerts_id_seq OWNED BY public.robot_device_alerts.id;


--
-- Name: robot_device_maintenance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.robot_device_maintenance (
    id integer NOT NULL,
    device_id integer NOT NULL,
    maintenance_type character varying(100) NOT NULL,
    scheduled_date date NOT NULL,
    completed_date date,
    technician_name character varying(100) NOT NULL,
    cost numeric(10,2) DEFAULT 0.00 NOT NULL,
    status character varying(30) DEFAULT 'scheduled'::character varying NOT NULL,
    work_summary text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: robot_device_maintenance_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.robot_device_maintenance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: robot_device_maintenance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.robot_device_maintenance_id_seq OWNED BY public.robot_device_maintenance.id;


--
-- Name: robot_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.robot_devices (
    id integer NOT NULL,
    device_uuid character varying(64) NOT NULL,
    device_name character varying(100) DEFAULT 'FitBot Front Desk Station'::character varying NOT NULL,
    mac_address character varying(17),
    ip_address character varying(45),
    api_key_hash character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'offline'::character varying NOT NULL,
    firmware_version character varying(20) DEFAULT '1.0.0'::character varying NOT NULL,
    head_pan_pin smallint DEFAULT 18 NOT NULL,
    head_tilt_pin smallint DEFAULT 19 NOT NULL,
    arm_wave_pin smallint DEFAULT 21 NOT NULL,
    last_heartbeat timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    battery_level smallint,
    wifi_rssi smallint,
    is_enabled boolean DEFAULT true NOT NULL,
    battery_voltage numeric(4,2) DEFAULT 8.40,
    charging_status character varying(30) DEFAULT 'discharging'::character varying,
    location_zone character varying(100) DEFAULT 'Front Desk Kiosk'::character varying,
    device_model character varying(100) DEFAULT 'FitBot Receptionist MK-II'::character varying,
    serial_number character varying(100) DEFAULT 'FB-ESP32-8821'::character varying,
    CONSTRAINT robot_devices_battery_level_check CHECK (((battery_level >= 0) AND (battery_level <= 100))),
    CONSTRAINT robot_devices_status_check CHECK (((status)::text = ANY (ARRAY[('online'::character varying)::text, ('offline'::character varying)::text, ('error'::character varying)::text, ('calibrating'::character varying)::text])))
);


--
-- Name: robot_devices_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.robot_devices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: robot_devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.robot_devices_id_seq OWNED BY public.robot_devices.id;


--
-- Name: robot_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.robot_logs (
    id bigint NOT NULL,
    device_id integer NOT NULL,
    log_level character varying(10) DEFAULT 'INFO'::character varying NOT NULL,
    event_type character varying(50) DEFAULT 'telemetry'::character varying NOT NULL,
    message text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT robot_logs_log_level_check CHECK (((log_level)::text = ANY (ARRAY[('DEBUG'::character varying)::text, ('INFO'::character varying)::text, ('WARN'::character varying)::text, ('ERROR'::character varying)::text, ('FATAL'::character varying)::text])))
);


--
-- Name: robot_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.robot_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: robot_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.robot_logs_id_seq OWNED BY public.robot_logs.id;


--
-- Name: robot_safety_monitoring; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.robot_safety_monitoring (
    id integer NOT NULL,
    device_id integer NOT NULL,
    safety_event_type character varying(100) NOT NULL,
    severity character varying(20) DEFAULT 'warning'::character varying NOT NULL,
    safety_action_taken character varying(100) NOT NULL,
    zone_location character varying(100) DEFAULT 'Reception Kiosk Zone'::character varying,
    notes text,
    occurred_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: robot_safety_monitoring_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.robot_safety_monitoring_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: robot_safety_monitoring_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.robot_safety_monitoring_id_seq OWNED BY public.robot_safety_monitoring.id;


--
-- Name: robot_sensor_telemetry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.robot_sensor_telemetry (
    id bigint NOT NULL,
    device_id integer NOT NULL,
    sensor_type character varying(50) NOT NULL,
    sensor_name character varying(100) NOT NULL,
    reading_value numeric(10,2) NOT NULL,
    unit character varying(20) NOT NULL,
    threshold_min numeric(10,2),
    threshold_max numeric(10,2),
    status character varying(20) DEFAULT 'normal'::character varying NOT NULL,
    recorded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: robot_sensor_telemetry_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.robot_sensor_telemetry_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: robot_sensor_telemetry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.robot_sensor_telemetry_id_seq OWNED BY public.robot_sensor_telemetry.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    role_code character varying(32) NOT NULL,
    name character varying(64) NOT NULL,
    description text,
    permissions text[] DEFAULT '{}'::text[] NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: routine_punch_breaks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routine_punch_breaks (
    id integer NOT NULL,
    punch_id integer NOT NULL,
    break_start timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    break_end timestamp with time zone,
    duration_seconds integer DEFAULT 0,
    break_reason character varying(100) DEFAULT 'Routine Break'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: routine_punch_breaks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routine_punch_breaks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routine_punch_breaks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routine_punch_breaks_id_seq OWNED BY public.routine_punch_breaks.id;


--
-- Name: routine_punches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routine_punches (
    id integer NOT NULL,
    user_id integer,
    user_name character varying(120) DEFAULT 'Nandan.B'::character varying NOT NULL,
    user_role character varying(50) DEFAULT 'owner'::character varying NOT NULL,
    punch_date date DEFAULT CURRENT_DATE NOT NULL,
    punch_in timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    punch_out timestamp with time zone,
    status character varying(20) DEFAULT 'punched_in'::character varying NOT NULL,
    total_break_seconds integer DEFAULT 0 NOT NULL,
    total_work_seconds integer DEFAULT 0 NOT NULL,
    routine_notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT routine_punches_status_check CHECK (((status)::text = ANY (ARRAY[('punched_in'::character varying)::text, ('on_break'::character varying)::text, ('punched_out'::character varying)::text])))
);


--
-- Name: routine_punches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routine_punches_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routine_punches_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routine_punches_id_seq OWNED BY public.routine_punches.id;


--
-- Name: staff_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_profiles (
    user_id integer NOT NULL,
    branch_id integer,
    employee_id character varying(50) NOT NULL,
    department character varying(50) DEFAULT 'Operations'::character varying NOT NULL,
    designation character varying(100) NOT NULL,
    employment_type character varying(30) DEFAULT 'Full-Time'::character varying NOT NULL,
    date_of_joining date DEFAULT CURRENT_DATE NOT NULL,
    base_salary numeric(10,2) DEFAULT 0.00 NOT NULL,
    emergency_contact_name character varying(100),
    emergency_contact_phone character varying(50),
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: staff_shifts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.staff_shifts (
    id integer NOT NULL,
    user_id integer NOT NULL,
    branch_id integer NOT NULL,
    shift_date date NOT NULL,
    shift_type character varying(50) NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    status character varying(30) DEFAULT 'scheduled'::character varying NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: staff_shifts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.staff_shifts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: staff_shifts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.staff_shifts_id_seq OWNED BY public.staff_shifts.id;


--
-- Name: sync_event_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_event_logs (
    id bigint NOT NULL,
    event_id uuid NOT NULL,
    event_type character varying(64) NOT NULL,
    channel character varying(32) DEFAULT 'all'::character varying NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    triggered_by character varying(64) DEFAULT 'system'::character varying,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: sync_event_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sync_event_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sync_event_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sync_event_logs_id_seq OWNED BY public.sync_event_logs.id;


--
-- Name: system_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_backups (
    id integer NOT NULL,
    backup_name character varying(120) NOT NULL,
    backup_type character varying(30) DEFAULT 'daily_automated'::character varying NOT NULL,
    file_path character varying(255) NOT NULL,
    file_size_bytes bigint DEFAULT 0 NOT NULL,
    status character varying(20) DEFAULT 'completed'::character varying NOT NULL,
    checksum character varying(64),
    tables_included text[] DEFAULT '{all}'::text[] NOT NULL,
    created_by character varying(50) DEFAULT 'system_cron'::character varying,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT system_backups_backup_type_check CHECK (((backup_type)::text = ANY (ARRAY[('manual'::character varying)::text, ('daily_automated'::character varying)::text, ('weekly_archive'::character varying)::text, ('pre_migration'::character varying)::text]))),
    CONSTRAINT system_backups_status_check CHECK (((status)::text = ANY (ARRAY[('completed'::character varying)::text, ('in_progress'::character varying)::text, ('failed'::character varying)::text, ('verified'::character varying)::text])))
);


--
-- Name: system_backups_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_backups_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_backups_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_backups_id_seq OWNED BY public.system_backups.id;


--
-- Name: system_error_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_error_logs (
    id bigint NOT NULL,
    error_code character varying(64),
    error_type character varying(50) DEFAULT 'HTTP_500'::character varying NOT NULL,
    message text NOT NULL,
    endpoint character varying(255),
    http_method character varying(10),
    stack_trace text,
    status character varying(20) DEFAULT 'unresolved'::character varying NOT NULL,
    occurrence_count integer DEFAULT 1 NOT NULL,
    resolved_by character varying(50),
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT system_error_logs_error_type_check CHECK (((error_type)::text = ANY (ARRAY[('HTTP_500'::character varying)::text, ('DB_CONNECTION_ERROR'::character varying)::text, ('API_TIMEOUT'::character varying)::text, ('AUTH_ERROR'::character varying)::text, ('HARDWARE_TIMEOUT'::character varying)::text, ('UNHANDLED_EXCEPTION'::character varying)::text]))),
    CONSTRAINT system_error_logs_status_check CHECK (((status)::text = ANY (ARRAY[('unresolved'::character varying)::text, ('investigating'::character varying)::text, ('resolved'::character varying)::text, ('ignored'::character varying)::text])))
);


--
-- Name: system_error_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_error_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_error_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_error_logs_id_seq OWNED BY public.system_error_logs.id;


--
-- Name: system_export_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_export_logs (
    id integer NOT NULL,
    export_name character varying(120) NOT NULL,
    entity_type character varying(50) NOT NULL,
    export_format character varying(10) DEFAULT 'json'::character varying NOT NULL,
    record_count integer DEFAULT 0 NOT NULL,
    file_size_bytes bigint DEFAULT 0 NOT NULL,
    exported_by character varying(50) NOT NULL,
    sanitized_fields text[] DEFAULT '{password_hash,api_key_hash,jwt_tokens,sensitive_member_pii}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT system_export_logs_entity_type_check CHECK (((entity_type)::text = ANY (ARRAY[('members'::character varying)::text, ('check_ins'::character varying)::text, ('finances'::character varying)::text, ('audit_logs'::character varying)::text, ('equipment'::character varying)::text, ('staff'::character varying)::text, ('telemetry'::character varying)::text]))),
    CONSTRAINT system_export_logs_export_format_check CHECK (((export_format)::text = ANY (ARRAY[('csv'::character varying)::text, ('json'::character varying)::text])))
);


--
-- Name: system_export_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_export_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_export_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_export_logs_id_seq OWNED BY public.system_export_logs.id;


--
-- Name: time_shift_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_shift_requests (
    id integer NOT NULL,
    public_id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id integer NOT NULL,
    kind character varying(10) NOT NULL,
    pt_assignment_id integer,
    general_assignment_id integer,
    current_label character varying(120),
    requested_start time without time zone NOT NULL,
    requested_end time without time zone NOT NULL,
    reason character varying(300),
    status character varying(10) DEFAULT 'pending'::character varying NOT NULL,
    approved_start time without time zone,
    approved_end time without time zone,
    admin_note character varying(300),
    decided_by integer,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_tsr_target CHECK (((((kind)::text = 'personal'::text) AND (pt_assignment_id IS NOT NULL)) OR (((kind)::text = 'general'::text) AND (general_assignment_id IS NOT NULL)))),
    CONSTRAINT chk_tsr_times CHECK ((requested_end > requested_start)),
    CONSTRAINT time_shift_requests_kind_check CHECK (((kind)::text = ANY (ARRAY[('personal'::character varying)::text, ('general'::character varying)::text]))),
    CONSTRAINT time_shift_requests_status_check CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('approved'::character varying)::text, ('rejected'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: time_shift_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.time_shift_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: time_shift_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.time_shift_requests_id_seq OWNED BY public.time_shift_requests.id;


--
-- Name: token_blacklist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.token_blacklist (
    id integer NOT NULL,
    jti character varying(64) NOT NULL,
    user_id integer,
    revoked_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: token_blacklist_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.token_blacklist_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: token_blacklist_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.token_blacklist_id_seq OWNED BY public.token_blacklist.id;


--
-- Name: trainer_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer_availability (
    id integer NOT NULL,
    trainer_id integer NOT NULL,
    specific_date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    reason character varying(150),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_avail_time CHECK ((end_time > start_time))
);


--
-- Name: trainer_availability_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trainer_availability_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trainer_availability_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trainer_availability_id_seq OWNED BY public.trainer_availability.id;


--
-- Name: trainer_commissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer_commissions (
    id integer NOT NULL,
    trainer_id integer NOT NULL,
    assignment_id integer,
    period_month character varying(7) NOT NULL,
    gross_revenue numeric(10,2) DEFAULT 0.00 NOT NULL,
    commission_rate_pct numeric(5,2) DEFAULT 25.00 NOT NULL,
    commission_amount numeric(10,2) DEFAULT 0.00 NOT NULL,
    payout_status character varying(20) DEFAULT 'calculated'::character varying NOT NULL,
    paid_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: trainer_commissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trainer_commissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trainer_commissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trainer_commissions_id_seq OWNED BY public.trainer_commissions.id;


--
-- Name: trainer_exercise_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer_exercise_checks (
    id integer NOT NULL,
    plan_exercise_id integer NOT NULL,
    member_id integer NOT NULL,
    trainer_id integer,
    check_date date DEFAULT CURRENT_DATE NOT NULL,
    completed boolean NOT NULL,
    marked_by integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: trainer_exercise_checks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trainer_exercise_checks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trainer_exercise_checks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trainer_exercise_checks_id_seq OWNED BY public.trainer_exercise_checks.id;


--
-- Name: trainer_recovery_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer_recovery_reviews (
    id integer NOT NULL,
    member_id integer NOT NULL,
    trainer_id integer,
    review_date date DEFAULT CURRENT_DATE NOT NULL,
    fatigue_risk_level character varying(30) DEFAULT 'Low'::character varying,
    trainer_advice text NOT NULL,
    suggested_rest_days smallint DEFAULT 1,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: trainer_recovery_reviews_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trainer_recovery_reviews_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trainer_recovery_reviews_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trainer_recovery_reviews_id_seq OWNED BY public.trainer_recovery_reviews.id;


--
-- Name: trainer_schedules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer_schedules (
    id integer NOT NULL,
    trainer_id integer NOT NULL,
    day_of_week smallint NOT NULL,
    shift_start time without time zone NOT NULL,
    shift_end time without time zone NOT NULL,
    is_available boolean DEFAULT true NOT NULL,
    notes character varying(100),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT chk_shift_time CHECK ((shift_end > shift_start)),
    CONSTRAINT trainer_schedules_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)))
);


--
-- Name: trainer_schedules_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trainer_schedules_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trainer_schedules_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trainer_schedules_id_seq OWNED BY public.trainer_schedules.id;


--
-- Name: trainer_welfare_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer_welfare_payments (
    id integer NOT NULL,
    trainer_id integer,
    trainer_name character varying(120) NOT NULL,
    period_month date NOT NULL,
    base_amount numeric(12,2) DEFAULT 0 NOT NULL,
    percent numeric(5,2) NOT NULL,
    amount numeric(12,2) NOT NULL,
    payment_method character varying(30) DEFAULT 'Cash'::character varying NOT NULL,
    notes text,
    recorded_by integer,
    paid_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT trainer_welfare_payments_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT trainer_welfare_payments_base_amount_check CHECK ((base_amount >= (0)::numeric)),
    CONSTRAINT trainer_welfare_payments_percent_check CHECK (((percent >= (0)::numeric) AND (percent <= (100)::numeric))),
    CONSTRAINT trainer_welfare_payments_period_month_check CHECK ((period_month = (date_trunc('month'::text, (period_month)::timestamp with time zone))::date))
);


--
-- Name: trainer_welfare_payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trainer_welfare_payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trainer_welfare_payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trainer_welfare_payments_id_seq OWNED BY public.trainer_welfare_payments.id;


--
-- Name: trainers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainers (
    id integer NOT NULL,
    trainer_code character varying(32) NOT NULL,
    user_id integer,
    full_name character varying(120) NOT NULL,
    specialty character varying(100) NOT NULL,
    phone character varying(20) NOT NULL,
    email character varying(120),
    bio text,
    certifications text[] DEFAULT '{}'::text[] NOT NULL,
    status character varying(20) DEFAULT 'on_floor'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    created_by integer,
    updated_by integer,
    date_of_birth date,
    birthday_wish_sent_at timestamp with time zone,
    welfare_percent numeric(5,2) DEFAULT 20.00 NOT NULL,
    CONSTRAINT chk_trainers_welfare_percent CHECK (((welfare_percent >= (0)::numeric) AND (welfare_percent <= (100)::numeric))),
    CONSTRAINT trainers_status_check CHECK (((status)::text = ANY (ARRAY[('on_floor'::character varying)::text, ('in_session'::character varying)::text, ('off_duty'::character varying)::text])))
);


--
-- Name: trainers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trainers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trainers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trainers_id_seq OWNED BY public.trainers.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(120) NOT NULL,
    password_hash character varying(255),
    full_name character varying(100) NOT NULL,
    role_id integer,
    role character varying(32) DEFAULT 'trainer'::character varying NOT NULL,
    phone character varying(20),
    is_active boolean DEFAULT true NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    member_id integer,
    trainer_id integer,
    avatar_url text,
    google_id character varying(255),
    auth_provider character varying(50) DEFAULT 'local'::character varying
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: v_faqs_unified; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_faqs_unified AS
 SELECT id,
    question,
    answer,
    language,
    category,
    suggested_gesture,
    keywords,
    display_order,
    is_active,
    created_at,
    updated_at
   FROM public.gym_faqs;


--
-- Name: v_member_details; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_member_details AS
 SELECT m.id,
    m.member_code,
    m.full_name,
    m.phone,
    m.email,
    m.plan_id,
    p.name AS plan_name,
    p.plan_code,
    p.price_inr AS plan_price,
    m.status,
    m.preferred_language,
    m.created_at,
    m.updated_at
   FROM (public.members m
     LEFT JOIN public.membership_plans p ON ((p.id = m.plan_id)));


--
-- Name: workout_program_days; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workout_program_days (
    id integer NOT NULL,
    program_id integer NOT NULL,
    day_number smallint NOT NULL,
    day_name character varying(100) NOT NULL,
    focus character varying(100),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: workout_program_days_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workout_program_days_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workout_program_days_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workout_program_days_id_seq OWNED BY public.workout_program_days.id;


--
-- Name: workout_program_exercises; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workout_program_exercises (
    id integer NOT NULL,
    day_id integer NOT NULL,
    exercise_id integer NOT NULL,
    sets smallint DEFAULT 3 NOT NULL,
    reps character varying(30) DEFAULT '8-12'::character varying NOT NULL,
    target_weight_kg numeric(6,2),
    rest_seconds integer DEFAULT 90 NOT NULL,
    order_index smallint DEFAULT 1 NOT NULL,
    notes text
);


--
-- Name: workout_program_exercises_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workout_program_exercises_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workout_program_exercises_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workout_program_exercises_id_seq OWNED BY public.workout_program_exercises.id;


--
-- Name: workout_programs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workout_programs (
    id integer NOT NULL,
    name character varying(150) NOT NULL,
    trainer_id integer,
    difficulty_level character varying(30) DEFAULT 'Intermediate'::character varying,
    goal character varying(50) NOT NULL,
    split_type character varying(50) NOT NULL,
    description text,
    is_template boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: workout_programs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workout_programs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workout_programs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workout_programs_id_seq OWNED BY public.workout_programs.id;


--
-- Name: workout_session_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workout_session_items (
    id integer NOT NULL,
    session_log_id integer NOT NULL,
    exercise_id integer NOT NULL,
    set_number smallint NOT NULL,
    reps_completed smallint NOT NULL,
    weight_kg numeric(6,2) NOT NULL,
    is_pr boolean DEFAULT false
);


--
-- Name: workout_session_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workout_session_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workout_session_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workout_session_items_id_seq OWNED BY public.workout_session_items.id;


--
-- Name: workout_session_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workout_session_logs (
    id integer NOT NULL,
    member_id integer NOT NULL,
    program_id integer,
    day_id integer,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    duration_minutes smallint DEFAULT 60,
    total_volume_kg numeric(10,2) DEFAULT 0.00,
    rpe_rating smallint,
    notes text,
    logged_by character varying(50) DEFAULT 'Admin'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT workout_session_logs_rpe_rating_check CHECK (((rpe_rating >= 1) AND (rpe_rating <= 10)))
);


--
-- Name: workout_session_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workout_session_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workout_session_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workout_session_logs_id_seq OWNED BY public.workout_session_logs.id;


--
-- Name: admin_users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users ALTER COLUMN id SET DEFAULT nextval('public.admin_users_id_seq'::regclass);


--
-- Name: admission_fees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_fees ALTER COLUMN id SET DEFAULT nextval('public.admission_fees_id_seq'::regclass);


--
-- Name: announcement_poll_options id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_poll_options ALTER COLUMN id SET DEFAULT nextval('public.announcement_poll_options_id_seq'::regclass);


--
-- Name: announcements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements ALTER COLUMN id SET DEFAULT nextval('public.announcements_id_seq'::regclass);


--
-- Name: auth_audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_audit_logs ALTER COLUMN id SET DEFAULT nextval('public.auth_audit_logs_id_seq'::regclass);


--
-- Name: book_purchases id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_purchases ALTER COLUMN id SET DEFAULT nextval('public.book_purchases_id_seq'::regclass);


--
-- Name: book_reading_progress id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_reading_progress ALTER COLUMN id SET DEFAULT nextval('public.book_reading_progress_id_seq'::regclass);


--
-- Name: check_ins id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins ALTER COLUMN id SET DEFAULT nextval('public.check_ins_id_seq'::regclass);


--
-- Name: class_registrations id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_registrations ALTER COLUMN id SET DEFAULT nextval('public.class_registrations_id_seq'::regclass);


--
-- Name: competition_certificates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_certificates ALTER COLUMN id SET DEFAULT nextval('public.competition_certificates_id_seq'::regclass);


--
-- Name: competition_participants id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participants ALTER COLUMN id SET DEFAULT nextval('public.competition_participants_id_seq'::regclass);


--
-- Name: course_certificates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_certificates ALTER COLUMN id SET DEFAULT nextval('public.course_certificates_id_seq'::regclass);


--
-- Name: course_enrolments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrolments ALTER COLUMN id SET DEFAULT nextval('public.course_enrolments_id_seq'::regclass);


--
-- Name: course_lessons id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_lessons ALTER COLUMN id SET DEFAULT nextval('public.course_lessons_id_seq'::regclass);


--
-- Name: course_quizzes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_quizzes ALTER COLUMN id SET DEFAULT nextval('public.course_quizzes_id_seq'::regclass);


--
-- Name: courses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses ALTER COLUMN id SET DEFAULT nextval('public.courses_id_seq'::regclass);


--
-- Name: diet_plan_meal_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diet_plan_meal_items ALTER COLUMN id SET DEFAULT nextval('public.diet_plan_meal_items_id_seq'::regclass);


--
-- Name: diet_plan_meals id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diet_plan_meals ALTER COLUMN id SET DEFAULT nextval('public.diet_plan_meals_id_seq'::regclass);


--
-- Name: diet_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diet_plans ALTER COLUMN id SET DEFAULT nextval('public.diet_plans_id_seq'::regclass);


--
-- Name: digital_app_fees id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digital_app_fees ALTER COLUMN id SET DEFAULT nextval('public.digital_app_fees_id_seq'::regclass);


--
-- Name: equipment_service_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_service_logs ALTER COLUMN id SET DEFAULT nextval('public.equipment_service_logs_id_seq'::regclass);


--
-- Name: equipment_suppliers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_suppliers ALTER COLUMN id SET DEFAULT nextval('public.equipment_suppliers_id_seq'::regclass);


--
-- Name: exercises id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exercises ALTER COLUMN id SET DEFAULT nextval('public.exercises_id_seq'::regclass);


--
-- Name: facility_maintenance_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_maintenance_logs ALTER COLUMN id SET DEFAULT nextval('public.facility_maintenance_logs_id_seq'::regclass);


--
-- Name: faqs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faqs ALTER COLUMN id SET DEFAULT nextval('public.faqs_id_seq'::regclass);


--
-- Name: financial_transactions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions ALTER COLUMN id SET DEFAULT nextval('public.financial_transactions_id_seq'::regclass);


--
-- Name: fitness_competitions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_competitions ALTER COLUMN id SET DEFAULT nextval('public.fitness_competitions_id_seq'::regclass);


--
-- Name: food_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_items ALTER COLUMN id SET DEFAULT nextval('public.food_items_id_seq'::regclass);


--
-- Name: general_training_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.general_training_assignments ALTER COLUMN id SET DEFAULT nextval('public.general_training_assignments_id_seq'::regclass);


--
-- Name: gym_branches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_branches ALTER COLUMN id SET DEFAULT nextval('public.gym_branches_id_seq'::regclass);


--
-- Name: gym_equipment id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_equipment ALTER COLUMN id SET DEFAULT nextval('public.gym_equipment_id_seq'::regclass);


--
-- Name: gym_expenses id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_expenses ALTER COLUMN id SET DEFAULT nextval('public.gym_expenses_id_seq'::regclass);


--
-- Name: gym_facilities id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_facilities ALTER COLUMN id SET DEFAULT nextval('public.gym_facilities_id_seq'::regclass);


--
-- Name: gym_faqs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_faqs ALTER COLUMN id SET DEFAULT nextval('public.gym_faqs_id_seq'::regclass);


--
-- Name: gym_profile id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_profile ALTER COLUMN id SET DEFAULT nextval('public.gym_profile_id_seq'::regclass);


--
-- Name: interaction_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_logs ALTER COLUMN id SET DEFAULT nextval('public.interaction_logs_id_seq'::regclass);


--
-- Name: inventory_purchase_orders id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_purchase_orders ALTER COLUMN id SET DEFAULT nextval('public.inventory_purchase_orders_id_seq'::regclass);


--
-- Name: library_books id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_books ALTER COLUMN id SET DEFAULT nextval('public.library_books_id_seq'::regclass);


--
-- Name: member_admission_records id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_admission_records ALTER COLUMN id SET DEFAULT nextval('public.member_admission_records_id_seq'::regclass);


--
-- Name: member_app_fee_subscriptions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_app_fee_subscriptions ALTER COLUMN id SET DEFAULT nextval('public.member_app_fee_subscriptions_id_seq'::regclass);


--
-- Name: member_body_measurements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_body_measurements ALTER COLUMN id SET DEFAULT nextval('public.member_body_measurements_id_seq'::regclass);


--
-- Name: member_communication_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_communication_logs ALTER COLUMN id SET DEFAULT nextval('public.member_communication_logs_id_seq'::regclass);


--
-- Name: member_complaints id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_complaints ALTER COLUMN id SET DEFAULT nextval('public.member_complaints_id_seq'::regclass);


--
-- Name: member_diet_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_diet_assignments ALTER COLUMN id SET DEFAULT nextval('public.member_diet_assignments_id_seq'::regclass);


--
-- Name: member_enquiries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_enquiries ALTER COLUMN id SET DEFAULT nextval('public.member_enquiries_id_seq'::regclass);


--
-- Name: member_feedbacks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_feedbacks ALTER COLUMN id SET DEFAULT nextval('public.member_feedbacks_id_seq'::regclass);


--
-- Name: member_muscle_soreness_details id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_muscle_soreness_details ALTER COLUMN id SET DEFAULT nextval('public.member_muscle_soreness_details_id_seq'::regclass);


--
-- Name: member_nutrition_daily_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_nutrition_daily_logs ALTER COLUMN id SET DEFAULT nextval('public.member_nutrition_daily_logs_id_seq'::regclass);


--
-- Name: member_nutrition_meal_entries id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_nutrition_meal_entries ALTER COLUMN id SET DEFAULT nextval('public.member_nutrition_meal_entries_id_seq'::regclass);


--
-- Name: member_performance_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_performance_profiles ALTER COLUMN id SET DEFAULT nextval('public.member_performance_profiles_id_seq'::regclass);


--
-- Name: member_recovery_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_recovery_logs ALTER COLUMN id SET DEFAULT nextval('public.member_recovery_logs_id_seq'::regclass);


--
-- Name: member_strength_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_strength_logs ALTER COLUMN id SET DEFAULT nextval('public.member_strength_logs_id_seq'::regclass);


--
-- Name: member_trainer_comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_trainer_comments ALTER COLUMN id SET DEFAULT nextval('public.member_trainer_comments_id_seq'::regclass);


--
-- Name: member_transformation_photos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_transformation_photos ALTER COLUMN id SET DEFAULT nextval('public.member_transformation_photos_id_seq'::regclass);


--
-- Name: member_workout_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_workout_assignments ALTER COLUMN id SET DEFAULT nextval('public.member_workout_assignments_id_seq'::regclass);


--
-- Name: members id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members ALTER COLUMN id SET DEFAULT nextval('public.members_id_seq'::regclass);


--
-- Name: membership_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_plans ALTER COLUMN id SET DEFAULT nextval('public.membership_plans_id_seq'::regclass);


--
-- Name: memberships id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships ALTER COLUMN id SET DEFAULT nextval('public.memberships_id_seq'::regclass);


--
-- Name: message_attachments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments ALTER COLUMN id SET DEFAULT nextval('public.message_attachments_id_seq'::regclass);


--
-- Name: message_poll_options id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_poll_options ALTER COLUMN id SET DEFAULT nextval('public.message_poll_options_id_seq'::regclass);


--
-- Name: message_poll_votes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_poll_votes ALTER COLUMN id SET DEFAULT nextval('public.message_poll_votes_id_seq'::regclass);


--
-- Name: message_polls id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_polls ALTER COLUMN id SET DEFAULT nextval('public.message_polls_id_seq'::regclass);


--
-- Name: online_classes id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.online_classes ALTER COLUMN id SET DEFAULT nextval('public.online_classes_id_seq'::regclass);


--
-- Name: personal_trainer_assignments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_trainer_assignments ALTER COLUMN id SET DEFAULT nextval('public.personal_trainer_assignments_id_seq'::regclass);


--
-- Name: promotional_discounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotional_discounts ALTER COLUMN id SET DEFAULT nextval('public.promotional_discounts_id_seq'::regclass);


--
-- Name: refund_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests ALTER COLUMN id SET DEFAULT nextval('public.refund_requests_id_seq'::regclass);


--
-- Name: retail_inventory id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_inventory ALTER COLUMN id SET DEFAULT nextval('public.retail_inventory_id_seq'::regclass);


--
-- Name: retention_audience_segments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_audience_segments ALTER COLUMN id SET DEFAULT nextval('public.retention_audience_segments_id_seq'::regclass);


--
-- Name: retention_campaigns id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_campaigns ALTER COLUMN id SET DEFAULT nextval('public.retention_campaigns_id_seq'::regclass);


--
-- Name: retention_email_templates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_email_templates ALTER COLUMN id SET DEFAULT nextval('public.retention_email_templates_id_seq'::regclass);


--
-- Name: robot_command_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_command_logs ALTER COLUMN id SET DEFAULT nextval('public.robot_command_logs_id_seq'::regclass);


--
-- Name: robot_commands id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_commands ALTER COLUMN id SET DEFAULT nextval('public.robot_commands_id_seq'::regclass);


--
-- Name: robot_device_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_device_alerts ALTER COLUMN id SET DEFAULT nextval('public.robot_device_alerts_id_seq'::regclass);


--
-- Name: robot_device_maintenance id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_device_maintenance ALTER COLUMN id SET DEFAULT nextval('public.robot_device_maintenance_id_seq'::regclass);


--
-- Name: robot_devices id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_devices ALTER COLUMN id SET DEFAULT nextval('public.robot_devices_id_seq'::regclass);


--
-- Name: robot_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_logs ALTER COLUMN id SET DEFAULT nextval('public.robot_logs_id_seq'::regclass);


--
-- Name: robot_safety_monitoring id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_safety_monitoring ALTER COLUMN id SET DEFAULT nextval('public.robot_safety_monitoring_id_seq'::regclass);


--
-- Name: robot_sensor_telemetry id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_sensor_telemetry ALTER COLUMN id SET DEFAULT nextval('public.robot_sensor_telemetry_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: routine_punch_breaks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routine_punch_breaks ALTER COLUMN id SET DEFAULT nextval('public.routine_punch_breaks_id_seq'::regclass);


--
-- Name: routine_punches id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routine_punches ALTER COLUMN id SET DEFAULT nextval('public.routine_punches_id_seq'::regclass);


--
-- Name: staff_shifts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_shifts ALTER COLUMN id SET DEFAULT nextval('public.staff_shifts_id_seq'::regclass);


--
-- Name: sync_event_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_event_logs ALTER COLUMN id SET DEFAULT nextval('public.sync_event_logs_id_seq'::regclass);


--
-- Name: system_backups id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_backups ALTER COLUMN id SET DEFAULT nextval('public.system_backups_id_seq'::regclass);


--
-- Name: system_error_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_error_logs ALTER COLUMN id SET DEFAULT nextval('public.system_error_logs_id_seq'::regclass);


--
-- Name: system_export_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_export_logs ALTER COLUMN id SET DEFAULT nextval('public.system_export_logs_id_seq'::regclass);


--
-- Name: time_shift_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_shift_requests ALTER COLUMN id SET DEFAULT nextval('public.time_shift_requests_id_seq'::regclass);


--
-- Name: token_blacklist id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_blacklist ALTER COLUMN id SET DEFAULT nextval('public.token_blacklist_id_seq'::regclass);


--
-- Name: trainer_availability id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_availability ALTER COLUMN id SET DEFAULT nextval('public.trainer_availability_id_seq'::regclass);


--
-- Name: trainer_commissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_commissions ALTER COLUMN id SET DEFAULT nextval('public.trainer_commissions_id_seq'::regclass);


--
-- Name: trainer_exercise_checks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_exercise_checks ALTER COLUMN id SET DEFAULT nextval('public.trainer_exercise_checks_id_seq'::regclass);


--
-- Name: trainer_recovery_reviews id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_recovery_reviews ALTER COLUMN id SET DEFAULT nextval('public.trainer_recovery_reviews_id_seq'::regclass);


--
-- Name: trainer_schedules id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_schedules ALTER COLUMN id SET DEFAULT nextval('public.trainer_schedules_id_seq'::regclass);


--
-- Name: trainer_welfare_payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_welfare_payments ALTER COLUMN id SET DEFAULT nextval('public.trainer_welfare_payments_id_seq'::regclass);


--
-- Name: trainers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainers ALTER COLUMN id SET DEFAULT nextval('public.trainers_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: workout_program_days id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_program_days ALTER COLUMN id SET DEFAULT nextval('public.workout_program_days_id_seq'::regclass);


--
-- Name: workout_program_exercises id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_program_exercises ALTER COLUMN id SET DEFAULT nextval('public.workout_program_exercises_id_seq'::regclass);


--
-- Name: workout_programs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_programs ALTER COLUMN id SET DEFAULT nextval('public.workout_programs_id_seq'::regclass);


--
-- Name: workout_session_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_session_items ALTER COLUMN id SET DEFAULT nextval('public.workout_session_items_id_seq'::regclass);


--
-- Name: workout_session_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_session_logs ALTER COLUMN id SET DEFAULT nextval('public.workout_session_logs_id_seq'::regclass);


--
-- Name: admin_users admin_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_email_key UNIQUE (email);


--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (id);


--
-- Name: admin_users admin_users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_username_key UNIQUE (username);


--
-- Name: admission_fees admission_fees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admission_fees
    ADD CONSTRAINT admission_fees_pkey PRIMARY KEY (id);


--
-- Name: announcement_poll_options announcement_poll_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_poll_options
    ADD CONSTRAINT announcement_poll_options_pkey PRIMARY KEY (id);


--
-- Name: announcement_poll_votes announcement_poll_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_poll_votes
    ADD CONSTRAINT announcement_poll_votes_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: auth_audit_logs auth_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_audit_logs
    ADD CONSTRAINT auth_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: book_purchases book_purchases_invoice_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_purchases
    ADD CONSTRAINT book_purchases_invoice_code_key UNIQUE (invoice_code);


--
-- Name: book_purchases book_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_purchases
    ADD CONSTRAINT book_purchases_pkey PRIMARY KEY (id);


--
-- Name: book_reading_progress book_reading_progress_book_id_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_reading_progress
    ADD CONSTRAINT book_reading_progress_book_id_member_id_key UNIQUE (book_id, member_id);


--
-- Name: book_reading_progress book_reading_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_reading_progress
    ADD CONSTRAINT book_reading_progress_pkey PRIMARY KEY (id);


--
-- Name: check_ins check_ins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_pkey PRIMARY KEY (id);


--
-- Name: class_registrations class_registrations_class_id_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_registrations
    ADD CONSTRAINT class_registrations_class_id_member_id_key UNIQUE (class_id, member_id);


--
-- Name: class_registrations class_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_registrations
    ADD CONSTRAINT class_registrations_pkey PRIMARY KEY (id);


--
-- Name: competition_certificates competition_certificates_certificate_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_certificates
    ADD CONSTRAINT competition_certificates_certificate_code_key UNIQUE (certificate_code);


--
-- Name: competition_certificates competition_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_certificates
    ADD CONSTRAINT competition_certificates_pkey PRIMARY KEY (id);


--
-- Name: competition_participants competition_participants_competition_id_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participants
    ADD CONSTRAINT competition_participants_competition_id_member_id_key UNIQUE (competition_id, member_id);


--
-- Name: competition_participants competition_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participants
    ADD CONSTRAINT competition_participants_pkey PRIMARY KEY (id);


--
-- Name: course_certificates course_certificates_certificate_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_certificates
    ADD CONSTRAINT course_certificates_certificate_code_key UNIQUE (certificate_code);


--
-- Name: course_certificates course_certificates_course_id_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_certificates
    ADD CONSTRAINT course_certificates_course_id_member_id_key UNIQUE (course_id, member_id);


--
-- Name: course_certificates course_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_certificates
    ADD CONSTRAINT course_certificates_pkey PRIMARY KEY (id);


--
-- Name: course_enrolments course_enrolments_course_id_member_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrolments
    ADD CONSTRAINT course_enrolments_course_id_member_id_key UNIQUE (course_id, member_id);


--
-- Name: course_enrolments course_enrolments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrolments
    ADD CONSTRAINT course_enrolments_pkey PRIMARY KEY (id);


--
-- Name: course_lessons course_lessons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_lessons
    ADD CONSTRAINT course_lessons_pkey PRIMARY KEY (id);


--
-- Name: course_quizzes course_quizzes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_quizzes
    ADD CONSTRAINT course_quizzes_pkey PRIMARY KEY (id);


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_pkey PRIMARY KEY (id);


--
-- Name: courses courses_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_slug_key UNIQUE (slug);


--
-- Name: diet_plan_meal_items diet_plan_meal_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diet_plan_meal_items
    ADD CONSTRAINT diet_plan_meal_items_pkey PRIMARY KEY (id);


--
-- Name: diet_plan_meals diet_plan_meals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diet_plan_meals
    ADD CONSTRAINT diet_plan_meals_pkey PRIMARY KEY (id);


--
-- Name: diet_plans diet_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diet_plans
    ADD CONSTRAINT diet_plans_pkey PRIMARY KEY (id);


--
-- Name: digital_app_fees digital_app_fees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.digital_app_fees
    ADD CONSTRAINT digital_app_fees_pkey PRIMARY KEY (id);


--
-- Name: equipment_service_logs equipment_service_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_service_logs
    ADD CONSTRAINT equipment_service_logs_pkey PRIMARY KEY (id);


--
-- Name: equipment_suppliers equipment_suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_suppliers
    ADD CONSTRAINT equipment_suppliers_pkey PRIMARY KEY (id);


--
-- Name: exercises exercises_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exercises
    ADD CONSTRAINT exercises_name_key UNIQUE (name);


--
-- Name: exercises exercises_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exercises
    ADD CONSTRAINT exercises_pkey PRIMARY KEY (id);


--
-- Name: facility_maintenance_logs facility_maintenance_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_maintenance_logs
    ADD CONSTRAINT facility_maintenance_logs_pkey PRIMARY KEY (id);


--
-- Name: faqs faqs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faqs
    ADD CONSTRAINT faqs_pkey PRIMARY KEY (id);


--
-- Name: financial_transactions financial_transactions_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT financial_transactions_invoice_number_key UNIQUE (invoice_number);


--
-- Name: financial_transactions financial_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT financial_transactions_pkey PRIMARY KEY (id);


--
-- Name: financial_transactions financial_transactions_receipt_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT financial_transactions_receipt_number_key UNIQUE (receipt_number);


--
-- Name: fitness_competitions fitness_competitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_competitions
    ADD CONSTRAINT fitness_competitions_pkey PRIMARY KEY (id);


--
-- Name: food_items food_items_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_items
    ADD CONSTRAINT food_items_name_key UNIQUE (name);


--
-- Name: food_items food_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.food_items
    ADD CONSTRAINT food_items_pkey PRIMARY KEY (id);


--
-- Name: general_training_assignments general_training_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.general_training_assignments
    ADD CONSTRAINT general_training_assignments_pkey PRIMARY KEY (id);


--
-- Name: gym_branches gym_branches_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_branches
    ADD CONSTRAINT gym_branches_code_key UNIQUE (code);


--
-- Name: gym_branches gym_branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_branches
    ADD CONSTRAINT gym_branches_pkey PRIMARY KEY (id);


--
-- Name: gym_equipment gym_equipment_asset_tag_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_equipment
    ADD CONSTRAINT gym_equipment_asset_tag_key UNIQUE (asset_tag);


--
-- Name: gym_equipment gym_equipment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_equipment
    ADD CONSTRAINT gym_equipment_pkey PRIMARY KEY (id);


--
-- Name: gym_expenses gym_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_expenses
    ADD CONSTRAINT gym_expenses_pkey PRIMARY KEY (id);


--
-- Name: gym_facilities gym_facilities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_facilities
    ADD CONSTRAINT gym_facilities_pkey PRIMARY KEY (id);


--
-- Name: gym_faqs gym_faqs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_faqs
    ADD CONSTRAINT gym_faqs_pkey PRIMARY KEY (id);


--
-- Name: gym_profile gym_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_profile
    ADD CONSTRAINT gym_profile_pkey PRIMARY KEY (id);


--
-- Name: gym_settings gym_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_settings
    ADD CONSTRAINT gym_settings_pkey PRIMARY KEY (id);


--
-- Name: interaction_logs interaction_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_logs
    ADD CONSTRAINT interaction_logs_pkey PRIMARY KEY (id);


--
-- Name: inventory_purchase_orders inventory_purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_purchase_orders
    ADD CONSTRAINT inventory_purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: inventory_purchase_orders inventory_purchase_orders_po_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_purchase_orders
    ADD CONSTRAINT inventory_purchase_orders_po_code_key UNIQUE (po_code);


--
-- Name: library_books library_books_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_books
    ADD CONSTRAINT library_books_pkey PRIMARY KEY (id);


--
-- Name: library_books library_books_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_books
    ADD CONSTRAINT library_books_slug_key UNIQUE (slug);


--
-- Name: member_admission_records member_admission_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_admission_records
    ADD CONSTRAINT member_admission_records_pkey PRIMARY KEY (id);


--
-- Name: member_admission_records member_admission_records_receipt_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_admission_records
    ADD CONSTRAINT member_admission_records_receipt_code_key UNIQUE (receipt_code);


--
-- Name: member_app_fee_subscriptions member_app_fee_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_app_fee_subscriptions
    ADD CONSTRAINT member_app_fee_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: member_body_measurements member_body_measurements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_body_measurements
    ADD CONSTRAINT member_body_measurements_pkey PRIMARY KEY (id);


--
-- Name: member_communication_logs member_communication_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_communication_logs
    ADD CONSTRAINT member_communication_logs_pkey PRIMARY KEY (id);


--
-- Name: member_complaints member_complaints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_complaints
    ADD CONSTRAINT member_complaints_pkey PRIMARY KEY (id);


--
-- Name: member_complaints member_complaints_ticket_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_complaints
    ADD CONSTRAINT member_complaints_ticket_number_key UNIQUE (ticket_number);


--
-- Name: member_diet_assignments member_diet_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_diet_assignments
    ADD CONSTRAINT member_diet_assignments_pkey PRIMARY KEY (id);


--
-- Name: member_enquiries member_enquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_enquiries
    ADD CONSTRAINT member_enquiries_pkey PRIMARY KEY (id);


--
-- Name: member_feedbacks member_feedbacks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_feedbacks
    ADD CONSTRAINT member_feedbacks_pkey PRIMARY KEY (id);


--
-- Name: member_muscle_soreness_details member_muscle_soreness_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_muscle_soreness_details
    ADD CONSTRAINT member_muscle_soreness_details_pkey PRIMARY KEY (id);


--
-- Name: member_nutrition_daily_logs member_nutrition_daily_logs_member_id_log_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_nutrition_daily_logs
    ADD CONSTRAINT member_nutrition_daily_logs_member_id_log_date_key UNIQUE (member_id, log_date);


--
-- Name: member_nutrition_daily_logs member_nutrition_daily_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_nutrition_daily_logs
    ADD CONSTRAINT member_nutrition_daily_logs_pkey PRIMARY KEY (id);


--
-- Name: member_nutrition_meal_entries member_nutrition_meal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_nutrition_meal_entries
    ADD CONSTRAINT member_nutrition_meal_entries_pkey PRIMARY KEY (id);


--
-- Name: member_performance_profiles member_performance_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_performance_profiles
    ADD CONSTRAINT member_performance_profiles_pkey PRIMARY KEY (id);


--
-- Name: member_recovery_logs member_recovery_logs_member_id_log_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_recovery_logs
    ADD CONSTRAINT member_recovery_logs_member_id_log_date_key UNIQUE (member_id, log_date);


--
-- Name: member_recovery_logs member_recovery_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_recovery_logs
    ADD CONSTRAINT member_recovery_logs_pkey PRIMARY KEY (id);


--
-- Name: member_strength_logs member_strength_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_strength_logs
    ADD CONSTRAINT member_strength_logs_pkey PRIMARY KEY (id);


--
-- Name: member_trainer_comments member_trainer_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_trainer_comments
    ADD CONSTRAINT member_trainer_comments_pkey PRIMARY KEY (id);


--
-- Name: member_transformation_photos member_transformation_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_transformation_photos
    ADD CONSTRAINT member_transformation_photos_pkey PRIMARY KEY (id);


--
-- Name: member_workout_assignments member_workout_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_workout_assignments
    ADD CONSTRAINT member_workout_assignments_pkey PRIMARY KEY (id);


--
-- Name: members members_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_email_key UNIQUE (email);


--
-- Name: members members_member_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_member_code_key UNIQUE (member_code);


--
-- Name: members members_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_phone_key UNIQUE (phone);


--
-- Name: members members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_pkey PRIMARY KEY (id);


--
-- Name: membership_plans membership_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_plans
    ADD CONSTRAINT membership_plans_pkey PRIMARY KEY (id);


--
-- Name: membership_plans membership_plans_plan_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_plans
    ADD CONSTRAINT membership_plans_plan_code_key UNIQUE (plan_code);


--
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_pkey PRIMARY KEY (id);


--
-- Name: message_attachments message_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_pkey PRIMARY KEY (id);


--
-- Name: message_attachments message_attachments_public_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_public_id_key UNIQUE (public_id);


--
-- Name: message_attachments message_attachments_storage_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_storage_name_key UNIQUE (storage_name);


--
-- Name: message_poll_options message_poll_options_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_poll_options
    ADD CONSTRAINT message_poll_options_pkey PRIMARY KEY (id);


--
-- Name: message_poll_votes message_poll_votes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_poll_votes
    ADD CONSTRAINT message_poll_votes_pkey PRIMARY KEY (id);


--
-- Name: message_polls message_polls_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_polls
    ADD CONSTRAINT message_polls_message_id_key UNIQUE (message_id);


--
-- Name: message_polls message_polls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_polls
    ADD CONSTRAINT message_polls_pkey PRIMARY KEY (id);


--
-- Name: message_polls message_polls_public_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_polls
    ADD CONSTRAINT message_polls_public_id_key UNIQUE (public_id);


--
-- Name: message_thread_members message_thread_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_thread_members
    ADD CONSTRAINT message_thread_members_pkey PRIMARY KEY (thread_id, member_id);


--
-- Name: message_threads message_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_threads
    ADD CONSTRAINT message_threads_pkey PRIMARY KEY (id);


--
-- Name: message_threads message_threads_public_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_threads
    ADD CONSTRAINT message_threads_public_id_key UNIQUE (public_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: messages messages_public_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_public_id_key UNIQUE (public_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_public_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_public_id_key UNIQUE (public_id);


--
-- Name: online_classes online_classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.online_classes
    ADD CONSTRAINT online_classes_pkey PRIMARY KEY (id);


--
-- Name: personal_trainer_assignments personal_trainer_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_trainer_assignments
    ADD CONSTRAINT personal_trainer_assignments_pkey PRIMARY KEY (id);


--
-- Name: promotional_discounts promotional_discounts_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotional_discounts
    ADD CONSTRAINT promotional_discounts_code_key UNIQUE (code);


--
-- Name: promotional_discounts promotional_discounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotional_discounts
    ADD CONSTRAINT promotional_discounts_pkey PRIMARY KEY (id);


--
-- Name: pt_package_purchases pt_package_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_package_purchases
    ADD CONSTRAINT pt_package_purchases_pkey PRIMARY KEY (id);


--
-- Name: pt_package_purchases pt_package_purchases_public_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_package_purchases
    ADD CONSTRAINT pt_package_purchases_public_id_key UNIQUE (public_id);


--
-- Name: pt_packages pt_packages_package_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_packages
    ADD CONSTRAINT pt_packages_package_code_key UNIQUE (package_code);


--
-- Name: pt_packages pt_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_packages
    ADD CONSTRAINT pt_packages_pkey PRIMARY KEY (id);


--
-- Name: pt_packages pt_packages_public_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_packages
    ADD CONSTRAINT pt_packages_public_id_key UNIQUE (public_id);


--
-- Name: pt_session_balance_ledger pt_session_balance_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_session_balance_ledger
    ADD CONSTRAINT pt_session_balance_ledger_pkey PRIMARY KEY (id);


--
-- Name: pt_sessions pt_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_sessions
    ADD CONSTRAINT pt_sessions_pkey PRIMARY KEY (id);


--
-- Name: pt_sessions pt_sessions_public_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_sessions
    ADD CONSTRAINT pt_sessions_public_id_key UNIQUE (public_id);


--
-- Name: pt_sessions pt_sessions_workout_session_log_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_sessions
    ADD CONSTRAINT pt_sessions_workout_session_log_id_key UNIQUE (workout_session_log_id);


--
-- Name: refund_requests refund_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_pkey PRIMARY KEY (id);


--
-- Name: retail_inventory retail_inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_inventory
    ADD CONSTRAINT retail_inventory_pkey PRIMARY KEY (id);


--
-- Name: retail_inventory retail_inventory_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_inventory
    ADD CONSTRAINT retail_inventory_sku_key UNIQUE (sku);


--
-- Name: retention_audience_segments retention_audience_segments_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_audience_segments
    ADD CONSTRAINT retention_audience_segments_code_key UNIQUE (code);


--
-- Name: retention_audience_segments retention_audience_segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_audience_segments
    ADD CONSTRAINT retention_audience_segments_pkey PRIMARY KEY (id);


--
-- Name: retention_campaigns retention_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_campaigns
    ADD CONSTRAINT retention_campaigns_pkey PRIMARY KEY (id);


--
-- Name: retention_email_templates retention_email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_email_templates
    ADD CONSTRAINT retention_email_templates_pkey PRIMARY KEY (id);


--
-- Name: robot_command_logs robot_command_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_command_logs
    ADD CONSTRAINT robot_command_logs_pkey PRIMARY KEY (id);


--
-- Name: robot_commands robot_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_commands
    ADD CONSTRAINT robot_commands_pkey PRIMARY KEY (id);


--
-- Name: robot_device_alerts robot_device_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_device_alerts
    ADD CONSTRAINT robot_device_alerts_pkey PRIMARY KEY (id);


--
-- Name: robot_device_maintenance robot_device_maintenance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_device_maintenance
    ADD CONSTRAINT robot_device_maintenance_pkey PRIMARY KEY (id);


--
-- Name: robot_devices robot_devices_device_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_devices
    ADD CONSTRAINT robot_devices_device_uuid_key UNIQUE (device_uuid);


--
-- Name: robot_devices robot_devices_mac_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_devices
    ADD CONSTRAINT robot_devices_mac_address_key UNIQUE (mac_address);


--
-- Name: robot_devices robot_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_devices
    ADD CONSTRAINT robot_devices_pkey PRIMARY KEY (id);


--
-- Name: robot_logs robot_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_logs
    ADD CONSTRAINT robot_logs_pkey PRIMARY KEY (id);


--
-- Name: robot_safety_monitoring robot_safety_monitoring_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_safety_monitoring
    ADD CONSTRAINT robot_safety_monitoring_pkey PRIMARY KEY (id);


--
-- Name: robot_sensor_telemetry robot_sensor_telemetry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_sensor_telemetry
    ADD CONSTRAINT robot_sensor_telemetry_pkey PRIMARY KEY (id);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: roles roles_role_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_role_code_key UNIQUE (role_code);


--
-- Name: routine_punch_breaks routine_punch_breaks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routine_punch_breaks
    ADD CONSTRAINT routine_punch_breaks_pkey PRIMARY KEY (id);


--
-- Name: routine_punches routine_punches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routine_punches
    ADD CONSTRAINT routine_punches_pkey PRIMARY KEY (id);


--
-- Name: staff_profiles staff_profiles_employee_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_employee_id_key UNIQUE (employee_id);


--
-- Name: staff_profiles staff_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: staff_shifts staff_shifts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_shifts
    ADD CONSTRAINT staff_shifts_pkey PRIMARY KEY (id);


--
-- Name: sync_event_logs sync_event_logs_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_event_logs
    ADD CONSTRAINT sync_event_logs_event_id_key UNIQUE (event_id);


--
-- Name: sync_event_logs sync_event_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_event_logs
    ADD CONSTRAINT sync_event_logs_pkey PRIMARY KEY (id);


--
-- Name: system_backups system_backups_backup_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_backups
    ADD CONSTRAINT system_backups_backup_name_key UNIQUE (backup_name);


--
-- Name: system_backups system_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_backups
    ADD CONSTRAINT system_backups_pkey PRIMARY KEY (id);


--
-- Name: system_error_logs system_error_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_error_logs
    ADD CONSTRAINT system_error_logs_pkey PRIMARY KEY (id);


--
-- Name: system_export_logs system_export_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_export_logs
    ADD CONSTRAINT system_export_logs_pkey PRIMARY KEY (id);


--
-- Name: time_shift_requests time_shift_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_shift_requests
    ADD CONSTRAINT time_shift_requests_pkey PRIMARY KEY (id);


--
-- Name: time_shift_requests time_shift_requests_public_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_shift_requests
    ADD CONSTRAINT time_shift_requests_public_id_key UNIQUE (public_id);


--
-- Name: token_blacklist token_blacklist_jti_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_blacklist
    ADD CONSTRAINT token_blacklist_jti_key UNIQUE (jti);


--
-- Name: token_blacklist token_blacklist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_blacklist
    ADD CONSTRAINT token_blacklist_pkey PRIMARY KEY (id);


--
-- Name: trainer_availability trainer_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_availability
    ADD CONSTRAINT trainer_availability_pkey PRIMARY KEY (id);


--
-- Name: trainer_commissions trainer_commissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_commissions
    ADD CONSTRAINT trainer_commissions_pkey PRIMARY KEY (id);


--
-- Name: trainer_exercise_checks trainer_exercise_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_exercise_checks
    ADD CONSTRAINT trainer_exercise_checks_pkey PRIMARY KEY (id);


--
-- Name: trainer_recovery_reviews trainer_recovery_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_recovery_reviews
    ADD CONSTRAINT trainer_recovery_reviews_pkey PRIMARY KEY (id);


--
-- Name: trainer_schedules trainer_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_schedules
    ADD CONSTRAINT trainer_schedules_pkey PRIMARY KEY (id);


--
-- Name: trainer_welfare_payments trainer_welfare_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_welfare_payments
    ADD CONSTRAINT trainer_welfare_payments_pkey PRIMARY KEY (id);


--
-- Name: trainers trainers_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainers
    ADD CONSTRAINT trainers_email_key UNIQUE (email);


--
-- Name: trainers trainers_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainers
    ADD CONSTRAINT trainers_phone_key UNIQUE (phone);


--
-- Name: trainers trainers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainers
    ADD CONSTRAINT trainers_pkey PRIMARY KEY (id);


--
-- Name: trainers trainers_trainer_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainers
    ADD CONSTRAINT trainers_trainer_code_key UNIQUE (trainer_code);


--
-- Name: message_poll_votes uq_message_poll_vote; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_poll_votes
    ADD CONSTRAINT uq_message_poll_vote UNIQUE (option_id, user_id);


--
-- Name: member_performance_profiles uq_perf_member; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_performance_profiles
    ADD CONSTRAINT uq_perf_member UNIQUE (member_id);


--
-- Name: announcement_poll_options uq_poll_option_position; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_poll_options
    ADD CONSTRAINT uq_poll_option_position UNIQUE (announcement_id, "position");


--
-- Name: message_threads uq_thread_pair; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_threads
    ADD CONSTRAINT uq_thread_pair UNIQUE (trainer_id, member_id);


--
-- Name: trainer_schedules uq_trainer_day_shift; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_schedules
    ADD CONSTRAINT uq_trainer_day_shift UNIQUE (trainer_id, day_of_week, shift_start);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_google_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_google_id_key UNIQUE (google_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: workout_program_days workout_program_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_program_days
    ADD CONSTRAINT workout_program_days_pkey PRIMARY KEY (id);


--
-- Name: workout_program_exercises workout_program_exercises_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_program_exercises
    ADD CONSTRAINT workout_program_exercises_pkey PRIMARY KEY (id);


--
-- Name: workout_programs workout_programs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_programs
    ADD CONSTRAINT workout_programs_pkey PRIMARY KEY (id);


--
-- Name: workout_session_items workout_session_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_session_items
    ADD CONSTRAINT workout_session_items_pkey PRIMARY KEY (id);


--
-- Name: workout_session_logs workout_session_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_session_logs
    ADD CONSTRAINT workout_session_logs_pkey PRIMARY KEY (id);


--
-- Name: idx_admin_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_users_role ON public.admin_users USING btree (role);


--
-- Name: idx_admin_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_users_username ON public.admin_users USING btree (username);


--
-- Name: idx_announcements_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_active ON public.announcements USING btree (is_active);


--
-- Name: idx_announcements_active_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_active_dates ON public.announcements USING btree (is_active, start_date, end_date);


--
-- Name: idx_auth_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_audit_created ON public.auth_audit_logs USING btree (created_at DESC);


--
-- Name: idx_auth_audit_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_audit_event ON public.auth_audit_logs USING btree (event_type);


--
-- Name: idx_auth_audit_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auth_audit_user ON public.auth_audit_logs USING btree (user_id);


--
-- Name: idx_body_meas_member_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_body_meas_member_date ON public.member_body_measurements USING btree (member_id, logged_at DESC);


--
-- Name: idx_body_member_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_body_member_time ON public.member_body_measurements USING btree (member_id, logged_at);


--
-- Name: idx_book_purchases_book; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_book_purchases_book ON public.book_purchases USING btree (book_id);


--
-- Name: idx_book_purchases_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_book_purchases_member ON public.book_purchases USING btree (member_id);


--
-- Name: idx_book_reading_progress_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_book_reading_progress_member ON public.book_reading_progress USING btree (member_id);


--
-- Name: idx_cert_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cert_code ON public.competition_certificates USING btree (certificate_code);


--
-- Name: idx_cert_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cert_member ON public.competition_certificates USING btree (member_id);


--
-- Name: idx_check_ins_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_ins_member ON public.check_ins USING btree (member_id);


--
-- Name: idx_check_ins_member_open; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_ins_member_open ON public.check_ins USING btree (member_id, check_in_time DESC) WHERE (check_out_time IS NULL);


--
-- Name: idx_check_ins_member_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_ins_member_time ON public.check_ins USING btree (member_id, check_in_time DESC);


--
-- Name: idx_check_ins_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_check_ins_time ON public.check_ins USING btree (check_in_time DESC);


--
-- Name: idx_class_registrations_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_class_registrations_class ON public.class_registrations USING btree (class_id);


--
-- Name: idx_class_registrations_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_class_registrations_member ON public.class_registrations USING btree (member_id);


--
-- Name: idx_comm_logs_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comm_logs_channel ON public.member_communication_logs USING btree (channel);


--
-- Name: idx_comm_logs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comm_logs_date ON public.member_communication_logs USING btree (created_at);


--
-- Name: idx_comm_logs_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comm_logs_member ON public.member_communication_logs USING btree (member_id);


--
-- Name: idx_comments_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comments_member ON public.member_trainer_comments USING btree (member_id);


--
-- Name: idx_competitions_is_outdoor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitions_is_outdoor ON public.fitness_competitions USING btree (is_outdoor);


--
-- Name: idx_competitions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitions_status ON public.fitness_competitions USING btree (status);


--
-- Name: idx_competitions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitions_type ON public.fitness_competitions USING btree (type);


--
-- Name: idx_complaints_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_priority ON public.member_complaints USING btree (priority);


--
-- Name: idx_complaints_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_complaints_status ON public.member_complaints USING btree (status);


--
-- Name: idx_course_enrolments_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_enrolments_member ON public.course_enrolments USING btree (member_id);


--
-- Name: idx_course_lessons_course; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_course_lessons_course ON public.course_lessons USING btree (course_id, lesson_order);


--
-- Name: idx_courses_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_courses_category ON public.courses USING btree (category);


--
-- Name: idx_diet_plan_meals_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_diet_plan_meals_plan ON public.diet_plan_meals USING btree (plan_id);


--
-- Name: idx_diet_plans_goal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_diet_plans_goal ON public.diet_plans USING btree (goal);


--
-- Name: idx_diet_plans_trainer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_diet_plans_trainer ON public.diet_plans USING btree (trainer_id);


--
-- Name: idx_eq_service_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eq_service_date ON public.equipment_service_logs USING btree (service_date);


--
-- Name: idx_exercises_equipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exercises_equipment ON public.exercises USING btree (equipment);


--
-- Name: idx_exercises_muscle_group; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_exercises_muscle_group ON public.exercises USING btree (muscle_group);


--
-- Name: idx_facility_maint_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_facility_maint_branch ON public.facility_maintenance_logs USING btree (branch_id);


--
-- Name: idx_faqs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_faqs_active ON public.faqs USING btree (is_active);


--
-- Name: idx_faqs_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_faqs_category ON public.faqs USING btree (category);


--
-- Name: idx_faqs_lang; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_faqs_lang ON public.faqs USING btree (language);


--
-- Name: idx_feedback_sentiment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feedback_sentiment ON public.member_feedbacks USING btree (sentiment);


--
-- Name: idx_fin_tx_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fin_tx_date ON public.financial_transactions USING btree (transaction_date);


--
-- Name: idx_fin_tx_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fin_tx_member ON public.financial_transactions USING btree (member_id);


--
-- Name: idx_fin_tx_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_fin_tx_type ON public.financial_transactions USING btree (transaction_type);


--
-- Name: idx_food_items_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_food_items_category ON public.food_items USING btree (category);


--
-- Name: idx_food_items_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_food_items_name ON public.food_items USING btree (name);


--
-- Name: idx_gta_trainer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gta_trainer ON public.general_training_assignments USING btree (trainer_id, status);


--
-- Name: idx_gym_equipment_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gym_equipment_category ON public.gym_equipment USING btree (category);


--
-- Name: idx_gym_equipment_condition; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gym_equipment_condition ON public.gym_equipment USING btree (condition_status);


--
-- Name: idx_gym_expenses_cat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gym_expenses_cat ON public.gym_expenses USING btree (category);


--
-- Name: idx_gym_expenses_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gym_expenses_date ON public.gym_expenses USING btree (expense_date);


--
-- Name: idx_gym_facilities_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gym_facilities_branch ON public.gym_facilities USING btree (branch_id);


--
-- Name: idx_gym_faqs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gym_faqs_active ON public.gym_faqs USING btree (is_active);


--
-- Name: idx_gym_faqs_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gym_faqs_category ON public.gym_faqs USING btree (category);


--
-- Name: idx_gym_faqs_lang; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gym_faqs_lang ON public.gym_faqs USING btree (language);


--
-- Name: idx_interaction_logs_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interaction_logs_session ON public.interaction_logs USING btree (session_id);


--
-- Name: idx_interactions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interactions_created ON public.interaction_logs USING btree (created_at DESC);


--
-- Name: idx_interactions_language; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interactions_language ON public.interaction_logs USING btree (language);


--
-- Name: idx_interactions_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interactions_member ON public.interaction_logs USING btree (member_id);


--
-- Name: idx_library_books_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_books_category ON public.library_books USING btree (category);


--
-- Name: idx_library_books_is_paid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_books_is_paid ON public.library_books USING btree (is_paid);


--
-- Name: idx_library_books_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_library_books_status ON public.library_books USING btree (status);


--
-- Name: idx_member_diet_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_diet_member ON public.member_diet_assignments USING btree (member_id);


--
-- Name: idx_member_diet_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_diet_status ON public.member_diet_assignments USING btree (status);


--
-- Name: idx_member_enquiries_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_enquiries_created ON public.member_enquiries USING btree (created_at DESC);


--
-- Name: idx_member_enquiries_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_enquiries_phone ON public.member_enquiries USING btree (phone);


--
-- Name: idx_member_enquiries_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_enquiries_status ON public.member_enquiries USING btree (status);


--
-- Name: idx_member_workout_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_workout_member ON public.member_workout_assignments USING btree (member_id);


--
-- Name: idx_member_workout_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_member_workout_status ON public.member_workout_assignments USING btree (status);


--
-- Name: idx_members_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_code ON public.members USING btree (member_code);


--
-- Name: idx_members_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_phone ON public.members USING btree (phone);


--
-- Name: idx_members_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_members_status ON public.members USING btree (status);


--
-- Name: idx_membership_plans_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_membership_plans_active ON public.membership_plans USING btree (is_active);


--
-- Name: idx_membership_plans_price; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_membership_plans_price ON public.membership_plans USING btree (price_inr);


--
-- Name: idx_memberships_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memberships_dates ON public.memberships USING btree (start_date, end_date);


--
-- Name: idx_memberships_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memberships_member ON public.memberships USING btree (member_id);


--
-- Name: idx_memberships_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memberships_plan ON public.memberships USING btree (plan_id);


--
-- Name: idx_memberships_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memberships_status ON public.memberships USING btree (status);


--
-- Name: idx_message_attachments_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_attachments_message ON public.message_attachments USING btree (message_id);


--
-- Name: idx_message_poll_options_poll; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_poll_options_poll ON public.message_poll_options USING btree (poll_id, "position");


--
-- Name: idx_message_poll_votes_poll; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_message_poll_votes_poll ON public.message_poll_votes USING btree (poll_id, user_id);


--
-- Name: idx_messages_sender; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_sender ON public.messages USING btree (sender_user_id);


--
-- Name: idx_messages_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_thread ON public.messages USING btree (thread_id, created_at);


--
-- Name: idx_messages_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_unread ON public.messages USING btree (thread_id) WHERE ((read_at IS NULL) AND (deleted_at IS NULL));


--
-- Name: idx_notifications_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_recipient ON public.notifications USING btree (recipient_user_id, created_at DESC);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (recipient_user_id) WHERE ((read_at IS NULL) AND (archived_at IS NULL));


--
-- Name: idx_nutrition_entries_daily; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nutrition_entries_daily ON public.member_nutrition_meal_entries USING btree (daily_log_id);


--
-- Name: idx_nutrition_logs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nutrition_logs_date ON public.member_nutrition_daily_logs USING btree (log_date);


--
-- Name: idx_nutrition_logs_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nutrition_logs_member ON public.member_nutrition_daily_logs USING btree (member_id);


--
-- Name: idx_online_classes_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_online_classes_category ON public.online_classes USING btree (category);


--
-- Name: idx_online_classes_scheduled_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_online_classes_scheduled_at ON public.online_classes USING btree (scheduled_at);


--
-- Name: idx_online_classes_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_online_classes_status ON public.online_classes USING btree (status);


--
-- Name: idx_participants_comp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participants_comp ON public.competition_participants USING btree (competition_id);


--
-- Name: idx_participants_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participants_member ON public.competition_participants USING btree (member_id);


--
-- Name: idx_participants_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_participants_rank ON public.competition_participants USING btree (rank_position);


--
-- Name: idx_perf_member_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_perf_member_id ON public.member_performance_profiles USING btree (member_id);


--
-- Name: idx_perf_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_perf_status ON public.member_performance_profiles USING btree (progress_status);


--
-- Name: idx_perf_trainer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_perf_trainer_id ON public.member_performance_profiles USING btree (assigned_trainer_id);


--
-- Name: idx_plan_meal_items_food; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_meal_items_food ON public.diet_plan_meal_items USING btree (food_item_id);


--
-- Name: idx_plan_meal_items_meal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_plan_meal_items_meal ON public.diet_plan_meal_items USING btree (meal_id);


--
-- Name: idx_poll_options_announcement; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poll_options_announcement ON public.announcement_poll_options USING btree (announcement_id);


--
-- Name: idx_poll_votes_announcement_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poll_votes_announcement_member ON public.announcement_poll_votes USING btree (announcement_id, member_id);


--
-- Name: idx_poll_votes_announcement_trainer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_poll_votes_announcement_trainer ON public.announcement_poll_votes USING btree (announcement_id, trainer_id) WHERE (trainer_id IS NOT NULL);


--
-- Name: idx_program_days_program; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_program_days_program ON public.workout_program_days USING btree (program_id);


--
-- Name: idx_program_exercises_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_program_exercises_day ON public.workout_program_exercises USING btree (day_id);


--
-- Name: idx_pt_assign_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt_assign_dates ON public.personal_trainer_assignments USING btree (start_date, end_date);


--
-- Name: idx_pt_assign_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt_assign_member ON public.personal_trainer_assignments USING btree (member_id);


--
-- Name: idx_pt_assign_package; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt_assign_package ON public.personal_trainer_assignments USING btree (package_id);


--
-- Name: idx_pt_assign_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt_assign_status ON public.personal_trainer_assignments USING btree (status);


--
-- Name: idx_pt_assign_trainer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt_assign_trainer ON public.personal_trainer_assignments USING btree (trainer_id);


--
-- Name: idx_pt_packages_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pt_packages_active ON public.pt_packages USING btree (is_active) WHERE (archived_at IS NULL);


--
-- Name: idx_ptl_purchase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ptl_purchase ON public.pt_session_balance_ledger USING btree (purchase_id, created_at);


--
-- Name: idx_ptpp_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ptpp_expiry ON public.pt_package_purchases USING btree (valid_until) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_ptpp_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ptpp_member ON public.pt_package_purchases USING btree (member_id, status);


--
-- Name: idx_ptpp_package; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ptpp_package ON public.pt_package_purchases USING btree (package_id);


--
-- Name: idx_ptpp_trainer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ptpp_trainer ON public.pt_package_purchases USING btree (trainer_id, status);


--
-- Name: idx_pts_assignment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pts_assignment ON public.pt_sessions USING btree (assignment_id);


--
-- Name: idx_pts_member_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pts_member_start ON public.pt_sessions USING btree (member_id, scheduled_start);


--
-- Name: idx_pts_purchase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pts_purchase ON public.pt_sessions USING btree (purchase_id);


--
-- Name: idx_pts_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pts_status ON public.pt_sessions USING btree (status, scheduled_start);


--
-- Name: idx_pts_trainer_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pts_trainer_start ON public.pt_sessions USING btree (trainer_id, scheduled_start);


--
-- Name: idx_recovery_logs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recovery_logs_date ON public.member_recovery_logs USING btree (log_date);


--
-- Name: idx_recovery_logs_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recovery_logs_member ON public.member_recovery_logs USING btree (member_id);


--
-- Name: idx_recovery_logs_readiness; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recovery_logs_readiness ON public.member_recovery_logs USING btree (readiness_score);


--
-- Name: idx_retail_inv_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retail_inv_category ON public.retail_inventory USING btree (category);


--
-- Name: idx_retail_inv_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retail_inv_status ON public.retail_inventory USING btree (status);


--
-- Name: idx_retention_camp_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retention_camp_status ON public.retention_campaigns USING btree (status);


--
-- Name: idx_robot_alerts_dev; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_robot_alerts_dev ON public.robot_device_alerts USING btree (device_id);


--
-- Name: idx_robot_alerts_resolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_robot_alerts_resolved ON public.robot_device_alerts USING btree (is_resolved);


--
-- Name: idx_robot_alerts_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_robot_alerts_severity ON public.robot_device_alerts USING btree (severity);


--
-- Name: idx_robot_commands_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_robot_commands_created ON public.robot_command_logs USING btree (created_at DESC);


--
-- Name: idx_robot_commands_device_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_robot_commands_device_status ON public.robot_command_logs USING btree (device_id, status);


--
-- Name: idx_robot_devices_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_robot_devices_status ON public.robot_devices USING btree (status);


--
-- Name: idx_robot_devices_uuid; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_robot_devices_uuid ON public.robot_devices USING btree (device_uuid);


--
-- Name: idx_robot_logs_device; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_robot_logs_device ON public.robot_logs USING btree (device_id, created_at DESC);


--
-- Name: idx_robot_logs_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_robot_logs_event ON public.robot_logs USING btree (event_type);


--
-- Name: idx_robot_logs_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_robot_logs_level ON public.robot_logs USING btree (log_level);


--
-- Name: idx_robot_maint_dev; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_robot_maint_dev ON public.robot_device_maintenance USING btree (device_id);


--
-- Name: idx_robot_safety_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_robot_safety_date ON public.robot_safety_monitoring USING btree (occurred_at);


--
-- Name: idx_robot_safety_dev; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_robot_safety_dev ON public.robot_safety_monitoring USING btree (device_id);


--
-- Name: idx_roles_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_code ON public.roles USING btree (role_code);


--
-- Name: idx_routine_breaks_punch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routine_breaks_punch ON public.routine_punch_breaks USING btree (punch_id);


--
-- Name: idx_routine_punches_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routine_punches_date ON public.routine_punches USING btree (punch_date DESC);


--
-- Name: idx_routine_punches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routine_punches_status ON public.routine_punches USING btree (status);


--
-- Name: idx_routine_punches_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_routine_punches_user ON public.routine_punches USING btree (user_id);


--
-- Name: idx_sensor_telemetry_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sensor_telemetry_date ON public.robot_sensor_telemetry USING btree (recorded_at);


--
-- Name: idx_sensor_telemetry_dev; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sensor_telemetry_dev ON public.robot_sensor_telemetry USING btree (device_id);


--
-- Name: idx_sensor_telemetry_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sensor_telemetry_type ON public.robot_sensor_telemetry USING btree (sensor_type);


--
-- Name: idx_session_items_exercise; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_items_exercise ON public.workout_session_items USING btree (exercise_id);


--
-- Name: idx_session_items_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_items_session ON public.workout_session_items USING btree (session_log_id);


--
-- Name: idx_session_logs_completed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_logs_completed_at ON public.workout_session_logs USING btree (completed_at);


--
-- Name: idx_session_logs_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_logs_member ON public.workout_session_logs USING btree (member_id);


--
-- Name: idx_soreness_log_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_soreness_log_id ON public.member_muscle_soreness_details USING btree (recovery_log_id);


--
-- Name: idx_soreness_muscle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_soreness_muscle ON public.member_muscle_soreness_details USING btree (muscle_group);


--
-- Name: idx_staff_shifts_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_shifts_branch ON public.staff_shifts USING btree (branch_id);


--
-- Name: idx_staff_shifts_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_shifts_date ON public.staff_shifts USING btree (shift_date);


--
-- Name: idx_staff_shifts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_staff_shifts_user ON public.staff_shifts USING btree (user_id);


--
-- Name: idx_strength_member_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_strength_member_time ON public.member_strength_logs USING btree (member_id, logged_at);


--
-- Name: idx_sync_events_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_events_channel ON public.sync_event_logs USING btree (channel);


--
-- Name: idx_sync_events_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_events_created_at ON public.sync_event_logs USING btree (created_at DESC);


--
-- Name: idx_sync_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sync_events_type ON public.sync_event_logs USING btree (event_type);


--
-- Name: idx_system_backups_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_backups_created ON public.system_backups USING btree (created_at DESC);


--
-- Name: idx_system_backups_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_backups_status ON public.system_backups USING btree (status);


--
-- Name: idx_system_error_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_error_logs_created ON public.system_error_logs USING btree (created_at DESC);


--
-- Name: idx_system_error_logs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_error_logs_status ON public.system_error_logs USING btree (status);


--
-- Name: idx_system_error_logs_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_error_logs_type ON public.system_error_logs USING btree (error_type);


--
-- Name: idx_system_export_logs_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_export_logs_created ON public.system_export_logs USING btree (created_at DESC);


--
-- Name: idx_thread_members_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_thread_members_member ON public.message_thread_members USING btree (member_id) WHERE (removed_at IS NULL);


--
-- Name: idx_threads_group_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_threads_group_recent ON public.message_threads USING btree (last_message_at DESC) WHERE ((thread_type)::text = 'group'::text);


--
-- Name: idx_threads_gym_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_threads_gym_recent ON public.message_threads USING btree (last_message_at DESC) WHERE ((thread_type)::text = 'gym'::text);


--
-- Name: idx_threads_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_threads_member ON public.message_threads USING btree (member_id, last_message_at DESC);


--
-- Name: idx_threads_trainer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_threads_trainer ON public.message_threads USING btree (trainer_id, last_message_at DESC);


--
-- Name: idx_threads_trainer_gym_recent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_threads_trainer_gym_recent ON public.message_threads USING btree (last_message_at DESC) WHERE ((thread_type)::text = 'trainer_gym'::text);


--
-- Name: idx_token_blacklist_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_token_blacklist_expires ON public.token_blacklist USING btree (expires_at);


--
-- Name: idx_token_blacklist_jti; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_token_blacklist_jti ON public.token_blacklist USING btree (jti);


--
-- Name: idx_trainer_avail_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trainer_avail_date ON public.trainer_availability USING btree (trainer_id, specific_date);


--
-- Name: idx_trainer_avail_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trainer_avail_lookup ON public.trainer_availability USING btree (specific_date, is_available);


--
-- Name: idx_trainer_comm_trainer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trainer_comm_trainer ON public.trainer_commissions USING btree (trainer_id, period_month);


--
-- Name: idx_trainer_exercise_checks_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trainer_exercise_checks_member ON public.trainer_exercise_checks USING btree (member_id, check_date);


--
-- Name: idx_trainer_reviews_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trainer_reviews_member ON public.trainer_recovery_reviews USING btree (member_id);


--
-- Name: idx_trainer_reviews_trainer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trainer_reviews_trainer ON public.trainer_recovery_reviews USING btree (trainer_id);


--
-- Name: idx_trainer_schedules_day; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trainer_schedules_day ON public.trainer_schedules USING btree (day_of_week, is_available);


--
-- Name: idx_trainer_schedules_trainer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trainer_schedules_trainer ON public.trainer_schedules USING btree (trainer_id);


--
-- Name: idx_trainer_welfare_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trainer_welfare_period ON public.trainer_welfare_payments USING btree (period_month);


--
-- Name: idx_trainers_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trainers_code ON public.trainers USING btree (trainer_code);


--
-- Name: idx_trainers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trainers_status ON public.trainers USING btree (status);


--
-- Name: idx_trans_photo_member; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trans_photo_member ON public.member_transformation_photos USING btree (member_id);


--
-- Name: idx_trans_photos_member_phase; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_trans_photos_member_phase ON public.member_transformation_photos USING btree (member_id, phase);


--
-- Name: idx_tsr_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tsr_status ON public.time_shift_requests USING btree (status, created_at);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_google_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_google_id ON public.users USING btree (google_id);


--
-- Name: idx_users_member_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_member_id ON public.users USING btree (member_id);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_users_role_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role_id ON public.users USING btree (role_id);


--
-- Name: idx_users_trainer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_trainer_id ON public.users USING btree (trainer_id);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_username ON public.users USING btree (username);


--
-- Name: idx_workout_programs_trainer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_workout_programs_trainer ON public.workout_programs USING btree (trainer_id);


--
-- Name: uq_gta_one_active_per_member; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_gta_one_active_per_member ON public.general_training_assignments USING btree (member_id) WHERE ((status)::text = 'active'::text);


--
-- Name: uq_gym_thread_member; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_gym_thread_member ON public.message_threads USING btree (member_id) WHERE ((thread_type)::text = 'gym'::text);


--
-- Name: uq_member_enquiries_open_phone; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_member_enquiries_open_phone ON public.member_enquiries USING btree (regexp_replace((phone)::text, '\D'::text, ''::text, 'g'::text)) WHERE ((status)::text = ANY (ARRAY[('new'::character varying)::text, ('contacted'::character varying)::text]));


--
-- Name: uq_poll_vote_member; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_poll_vote_member ON public.announcement_poll_votes USING btree (option_id, member_id) WHERE (member_id IS NOT NULL);


--
-- Name: uq_poll_vote_trainer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_poll_vote_trainer ON public.announcement_poll_votes USING btree (option_id, trainer_id) WHERE (trainer_id IS NOT NULL);


--
-- Name: uq_ptl_one_deduction_per_session; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_ptl_one_deduction_per_session ON public.pt_session_balance_ledger USING btree (session_id) WHERE (((reason)::text = ANY (ARRAY[('session_completed'::character varying)::text, ('no_show_charged'::character varying)::text])) AND (session_id IS NOT NULL));


--
-- Name: uq_pts_trainer_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pts_trainer_slot ON public.pt_sessions USING btree (trainer_id, scheduled_start) WHERE (((status)::text = ANY (ARRAY[('booked'::character varying)::text, ('confirmed'::character varying)::text, ('completed'::character varying)::text])) AND (trainer_id IS NOT NULL));


--
-- Name: uq_trainer_exercise_check_day; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_trainer_exercise_check_day ON public.trainer_exercise_checks USING btree (plan_exercise_id, check_date);


--
-- Name: uq_trainer_gym_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_trainer_gym_thread ON public.message_threads USING btree (trainer_id) WHERE ((thread_type)::text = 'trainer_gym'::text);


--
-- Name: uq_trainer_welfare_month; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_trainer_welfare_month ON public.trainer_welfare_payments USING btree (trainer_id, period_month);


--
-- Name: uq_tsr_one_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_tsr_one_pending ON public.time_shift_requests USING btree (member_id, kind) WHERE ((status)::text = 'pending'::text);


--
-- Name: announcements trg_announcements_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_announcements_updated BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: check_ins trg_check_in_duplicate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_check_in_duplicate_guard BEFORE INSERT ON public.check_ins FOR EACH ROW EXECUTE FUNCTION public.fn_check_in_duplicate_guard();


--
-- Name: gym_faqs trg_gym_faqs_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gym_faqs_updated BEFORE UPDATE ON public.gym_faqs FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: gym_settings trg_gym_settings_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_gym_settings_updated BEFORE UPDATE ON public.gym_settings FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: member_enquiries trg_member_enquiries_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_member_enquiries_updated BEFORE UPDATE ON public.member_enquiries FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: members trg_members_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_members_updated BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: membership_plans trg_membership_plans_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_membership_plans_updated BEFORE UPDATE ON public.membership_plans FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: memberships trg_memberships_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_memberships_updated BEFORE UPDATE ON public.memberships FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: messages trg_message_touch_thread; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_message_touch_thread AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION public.fn_message_touch_thread();


--
-- Name: pt_packages trg_pt_packages_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pt_packages_updated BEFORE UPDATE ON public.pt_packages FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: pt_package_purchases trg_ptpp_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_ptpp_updated BEFORE UPDATE ON public.pt_package_purchases FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: pt_sessions trg_pts_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_pts_updated BEFORE UPDATE ON public.pt_sessions FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: robot_commands trg_robot_commands_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_robot_commands_updated BEFORE UPDATE ON public.robot_commands FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: robot_devices trg_robot_devices_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_robot_devices_updated BEFORE UPDATE ON public.robot_devices FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: message_threads trg_threads_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_threads_updated BEFORE UPDATE ON public.message_threads FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: trainer_availability trg_trainer_avail_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trainer_avail_updated BEFORE UPDATE ON public.trainer_availability FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: trainers trg_trainers_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_trainers_updated BEFORE UPDATE ON public.trainers FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: users trg_users_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.fn_update_timestamp();


--
-- Name: announcement_poll_options announcement_poll_options_announcement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_poll_options
    ADD CONSTRAINT announcement_poll_options_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE;


--
-- Name: announcement_poll_votes announcement_poll_votes_announcement_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_poll_votes
    ADD CONSTRAINT announcement_poll_votes_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES public.announcements(id) ON DELETE CASCADE;


--
-- Name: announcement_poll_votes announcement_poll_votes_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_poll_votes
    ADD CONSTRAINT announcement_poll_votes_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: announcement_poll_votes announcement_poll_votes_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_poll_votes
    ADD CONSTRAINT announcement_poll_votes_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.announcement_poll_options(id) ON DELETE CASCADE;


--
-- Name: announcement_poll_votes announcement_poll_votes_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcement_poll_votes
    ADD CONSTRAINT announcement_poll_votes_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE CASCADE;


--
-- Name: auth_audit_logs auth_audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_audit_logs
    ADD CONSTRAINT auth_audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: book_purchases book_purchases_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_purchases
    ADD CONSTRAINT book_purchases_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.library_books(id) ON DELETE CASCADE;


--
-- Name: book_purchases book_purchases_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_purchases
    ADD CONSTRAINT book_purchases_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: book_reading_progress book_reading_progress_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_reading_progress
    ADD CONSTRAINT book_reading_progress_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.library_books(id) ON DELETE CASCADE;


--
-- Name: book_reading_progress book_reading_progress_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.book_reading_progress
    ADD CONSTRAINT book_reading_progress_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: check_ins check_ins_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.robot_devices(id) ON DELETE SET NULL;


--
-- Name: check_ins check_ins_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.check_ins
    ADD CONSTRAINT check_ins_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: class_registrations class_registrations_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_registrations
    ADD CONSTRAINT class_registrations_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.online_classes(id) ON DELETE CASCADE;


--
-- Name: class_registrations class_registrations_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.class_registrations
    ADD CONSTRAINT class_registrations_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: competition_certificates competition_certificates_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_certificates
    ADD CONSTRAINT competition_certificates_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.fitness_competitions(id) ON DELETE CASCADE;


--
-- Name: competition_certificates competition_certificates_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_certificates
    ADD CONSTRAINT competition_certificates_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: competition_participants competition_participants_competition_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participants
    ADD CONSTRAINT competition_participants_competition_id_fkey FOREIGN KEY (competition_id) REFERENCES public.fitness_competitions(id) ON DELETE CASCADE;


--
-- Name: competition_participants competition_participants_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participants
    ADD CONSTRAINT competition_participants_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: competition_participants competition_participants_verified_by_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competition_participants
    ADD CONSTRAINT competition_participants_verified_by_trainer_id_fkey FOREIGN KEY (verified_by_trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: course_certificates course_certificates_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_certificates
    ADD CONSTRAINT course_certificates_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: course_certificates course_certificates_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_certificates
    ADD CONSTRAINT course_certificates_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: course_enrolments course_enrolments_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrolments
    ADD CONSTRAINT course_enrolments_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: course_enrolments course_enrolments_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_enrolments
    ADD CONSTRAINT course_enrolments_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: course_lessons course_lessons_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_lessons
    ADD CONSTRAINT course_lessons_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: course_quizzes course_quizzes_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.course_quizzes
    ADD CONSTRAINT course_quizzes_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE;


--
-- Name: courses courses_instructor_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.courses
    ADD CONSTRAINT courses_instructor_trainer_id_fkey FOREIGN KEY (instructor_trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: diet_plan_meal_items diet_plan_meal_items_food_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diet_plan_meal_items
    ADD CONSTRAINT diet_plan_meal_items_food_item_id_fkey FOREIGN KEY (food_item_id) REFERENCES public.food_items(id) ON DELETE CASCADE;


--
-- Name: diet_plan_meal_items diet_plan_meal_items_meal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diet_plan_meal_items
    ADD CONSTRAINT diet_plan_meal_items_meal_id_fkey FOREIGN KEY (meal_id) REFERENCES public.diet_plan_meals(id) ON DELETE CASCADE;


--
-- Name: diet_plan_meals diet_plan_meals_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diet_plan_meals
    ADD CONSTRAINT diet_plan_meals_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.diet_plans(id) ON DELETE CASCADE;


--
-- Name: diet_plans diet_plans_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.diet_plans
    ADD CONSTRAINT diet_plans_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: equipment_service_logs equipment_service_logs_equipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_service_logs
    ADD CONSTRAINT equipment_service_logs_equipment_id_fkey FOREIGN KEY (equipment_id) REFERENCES public.gym_equipment(id) ON DELETE CASCADE;


--
-- Name: facility_maintenance_logs facility_maintenance_logs_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_maintenance_logs
    ADD CONSTRAINT facility_maintenance_logs_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.gym_branches(id) ON DELETE CASCADE;


--
-- Name: facility_maintenance_logs facility_maintenance_logs_facility_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facility_maintenance_logs
    ADD CONSTRAINT facility_maintenance_logs_facility_id_fkey FOREIGN KEY (facility_id) REFERENCES public.gym_facilities(id) ON DELETE CASCADE;


--
-- Name: financial_transactions financial_transactions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_transactions
    ADD CONSTRAINT financial_transactions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: fitness_competitions fitness_competitions_organizer_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fitness_competitions
    ADD CONSTRAINT fitness_competitions_organizer_trainer_id_fkey FOREIGN KEY (organizer_trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: general_training_assignments general_training_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.general_training_assignments
    ADD CONSTRAINT general_training_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: general_training_assignments general_training_assignments_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.general_training_assignments
    ADD CONSTRAINT general_training_assignments_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: general_training_assignments general_training_assignments_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.general_training_assignments
    ADD CONSTRAINT general_training_assignments_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: gym_branches gym_branches_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_branches
    ADD CONSTRAINT gym_branches_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: gym_equipment gym_equipment_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_equipment
    ADD CONSTRAINT gym_equipment_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.equipment_suppliers(id) ON DELETE SET NULL;


--
-- Name: gym_expenses gym_expenses_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_expenses
    ADD CONSTRAINT gym_expenses_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: gym_facilities gym_facilities_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_facilities
    ADD CONSTRAINT gym_facilities_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.gym_branches(id) ON DELETE CASCADE;


--
-- Name: gym_faqs gym_faqs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gym_faqs
    ADD CONSTRAINT gym_faqs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: interaction_logs interaction_logs_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_logs
    ADD CONSTRAINT interaction_logs_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.robot_devices(id) ON DELETE SET NULL;


--
-- Name: interaction_logs interaction_logs_gesture_command_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_logs
    ADD CONSTRAINT interaction_logs_gesture_command_id_fkey FOREIGN KEY (gesture_command_id) REFERENCES public.robot_command_logs(id) ON DELETE SET NULL;


--
-- Name: interaction_logs interaction_logs_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interaction_logs
    ADD CONSTRAINT interaction_logs_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: inventory_purchase_orders inventory_purchase_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_purchase_orders
    ADD CONSTRAINT inventory_purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.equipment_suppliers(id) ON DELETE CASCADE;


--
-- Name: library_books library_books_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.library_books
    ADD CONSTRAINT library_books_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: member_admission_records member_admission_records_admission_fee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_admission_records
    ADD CONSTRAINT member_admission_records_admission_fee_id_fkey FOREIGN KEY (admission_fee_id) REFERENCES public.admission_fees(id) ON DELETE SET NULL;


--
-- Name: member_admission_records member_admission_records_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_admission_records
    ADD CONSTRAINT member_admission_records_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_app_fee_subscriptions member_app_fee_subscriptions_app_fee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_app_fee_subscriptions
    ADD CONSTRAINT member_app_fee_subscriptions_app_fee_id_fkey FOREIGN KEY (app_fee_id) REFERENCES public.digital_app_fees(id) ON DELETE SET NULL;


--
-- Name: member_app_fee_subscriptions member_app_fee_subscriptions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_app_fee_subscriptions
    ADD CONSTRAINT member_app_fee_subscriptions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_body_measurements member_body_measurements_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_body_measurements
    ADD CONSTRAINT member_body_measurements_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_communication_logs member_communication_logs_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_communication_logs
    ADD CONSTRAINT member_communication_logs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.retention_campaigns(id) ON DELETE SET NULL;


--
-- Name: member_communication_logs member_communication_logs_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_communication_logs
    ADD CONSTRAINT member_communication_logs_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_complaints member_complaints_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_complaints
    ADD CONSTRAINT member_complaints_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_diet_assignments member_diet_assignments_assigned_by_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_diet_assignments
    ADD CONSTRAINT member_diet_assignments_assigned_by_trainer_id_fkey FOREIGN KEY (assigned_by_trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: member_diet_assignments member_diet_assignments_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_diet_assignments
    ADD CONSTRAINT member_diet_assignments_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_diet_assignments member_diet_assignments_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_diet_assignments
    ADD CONSTRAINT member_diet_assignments_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.diet_plans(id) ON DELETE RESTRICT;


--
-- Name: member_enquiries member_enquiries_assigned_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_enquiries
    ADD CONSTRAINT member_enquiries_assigned_trainer_id_fkey FOREIGN KEY (assigned_trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: member_feedbacks member_feedbacks_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_feedbacks
    ADD CONSTRAINT member_feedbacks_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_muscle_soreness_details member_muscle_soreness_details_recovery_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_muscle_soreness_details
    ADD CONSTRAINT member_muscle_soreness_details_recovery_log_id_fkey FOREIGN KEY (recovery_log_id) REFERENCES public.member_recovery_logs(id) ON DELETE CASCADE;


--
-- Name: member_nutrition_daily_logs member_nutrition_daily_logs_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_nutrition_daily_logs
    ADD CONSTRAINT member_nutrition_daily_logs_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_nutrition_meal_entries member_nutrition_meal_entries_daily_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_nutrition_meal_entries
    ADD CONSTRAINT member_nutrition_meal_entries_daily_log_id_fkey FOREIGN KEY (daily_log_id) REFERENCES public.member_nutrition_daily_logs(id) ON DELETE CASCADE;


--
-- Name: member_nutrition_meal_entries member_nutrition_meal_entries_food_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_nutrition_meal_entries
    ADD CONSTRAINT member_nutrition_meal_entries_food_item_id_fkey FOREIGN KEY (food_item_id) REFERENCES public.food_items(id) ON DELETE SET NULL;


--
-- Name: member_performance_profiles member_performance_profiles_assigned_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_performance_profiles
    ADD CONSTRAINT member_performance_profiles_assigned_trainer_id_fkey FOREIGN KEY (assigned_trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: member_performance_profiles member_performance_profiles_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_performance_profiles
    ADD CONSTRAINT member_performance_profiles_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_recovery_logs member_recovery_logs_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_recovery_logs
    ADD CONSTRAINT member_recovery_logs_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_strength_logs member_strength_logs_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_strength_logs
    ADD CONSTRAINT member_strength_logs_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_trainer_comments member_trainer_comments_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_trainer_comments
    ADD CONSTRAINT member_trainer_comments_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_trainer_comments member_trainer_comments_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_trainer_comments
    ADD CONSTRAINT member_trainer_comments_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: member_transformation_photos member_transformation_photos_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_transformation_photos
    ADD CONSTRAINT member_transformation_photos_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_workout_assignments member_workout_assignments_assigned_by_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_workout_assignments
    ADD CONSTRAINT member_workout_assignments_assigned_by_trainer_id_fkey FOREIGN KEY (assigned_by_trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: member_workout_assignments member_workout_assignments_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_workout_assignments
    ADD CONSTRAINT member_workout_assignments_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: member_workout_assignments member_workout_assignments_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_workout_assignments
    ADD CONSTRAINT member_workout_assignments_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.workout_programs(id) ON DELETE RESTRICT;


--
-- Name: members members_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.members
    ADD CONSTRAINT members_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.membership_plans(id) ON DELETE SET NULL;


--
-- Name: memberships memberships_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: memberships memberships_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: memberships memberships_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memberships
    ADD CONSTRAINT memberships_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.membership_plans(id) ON DELETE RESTRICT;


--
-- Name: message_attachments message_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_attachments message_attachments_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: message_poll_options message_poll_options_poll_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_poll_options
    ADD CONSTRAINT message_poll_options_poll_id_fkey FOREIGN KEY (poll_id) REFERENCES public.message_polls(id) ON DELETE CASCADE;


--
-- Name: message_poll_votes message_poll_votes_option_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_poll_votes
    ADD CONSTRAINT message_poll_votes_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.message_poll_options(id) ON DELETE CASCADE;


--
-- Name: message_poll_votes message_poll_votes_poll_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_poll_votes
    ADD CONSTRAINT message_poll_votes_poll_id_fkey FOREIGN KEY (poll_id) REFERENCES public.message_polls(id) ON DELETE CASCADE;


--
-- Name: message_poll_votes message_poll_votes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_poll_votes
    ADD CONSTRAINT message_poll_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: message_polls message_polls_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_polls
    ADD CONSTRAINT message_polls_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: message_polls message_polls_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_polls
    ADD CONSTRAINT message_polls_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: message_thread_members message_thread_members_added_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_thread_members
    ADD CONSTRAINT message_thread_members_added_by_user_id_fkey FOREIGN KEY (added_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: message_thread_members message_thread_members_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_thread_members
    ADD CONSTRAINT message_thread_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: message_thread_members message_thread_members_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_thread_members
    ADD CONSTRAINT message_thread_members_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.message_threads(id) ON DELETE CASCADE;


--
-- Name: message_threads message_threads_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_threads
    ADD CONSTRAINT message_threads_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: message_threads message_threads_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_threads
    ADD CONSTRAINT message_threads_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: message_threads message_threads_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_threads
    ADD CONSTRAINT message_threads_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE CASCADE;


--
-- Name: messages messages_sender_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_user_id_fkey FOREIGN KEY (sender_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: messages messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.message_threads(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_recipient_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_recipient_user_id_fkey FOREIGN KEY (recipient_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: online_classes online_classes_instructor_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.online_classes
    ADD CONSTRAINT online_classes_instructor_trainer_id_fkey FOREIGN KEY (instructor_trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: personal_trainer_assignments personal_trainer_assignments_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_trainer_assignments
    ADD CONSTRAINT personal_trainer_assignments_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: personal_trainer_assignments personal_trainer_assignments_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_trainer_assignments
    ADD CONSTRAINT personal_trainer_assignments_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.pt_packages(id) ON DELETE SET NULL;


--
-- Name: personal_trainer_assignments personal_trainer_assignments_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_trainer_assignments
    ADD CONSTRAINT personal_trainer_assignments_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE CASCADE;


--
-- Name: pt_package_purchases pt_package_purchases_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_package_purchases
    ADD CONSTRAINT pt_package_purchases_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.personal_trainer_assignments(id) ON DELETE SET NULL;


--
-- Name: pt_package_purchases pt_package_purchases_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_package_purchases
    ADD CONSTRAINT pt_package_purchases_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pt_package_purchases pt_package_purchases_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_package_purchases
    ADD CONSTRAINT pt_package_purchases_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: pt_package_purchases pt_package_purchases_package_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_package_purchases
    ADD CONSTRAINT pt_package_purchases_package_id_fkey FOREIGN KEY (package_id) REFERENCES public.pt_packages(id) ON DELETE RESTRICT;


--
-- Name: pt_package_purchases pt_package_purchases_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_package_purchases
    ADD CONSTRAINT pt_package_purchases_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: pt_packages pt_packages_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_packages
    ADD CONSTRAINT pt_packages_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pt_session_balance_ledger pt_session_balance_ledger_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_session_balance_ledger
    ADD CONSTRAINT pt_session_balance_ledger_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pt_session_balance_ledger pt_session_balance_ledger_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_session_balance_ledger
    ADD CONSTRAINT pt_session_balance_ledger_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.pt_package_purchases(id) ON DELETE CASCADE;


--
-- Name: pt_session_balance_ledger pt_session_balance_ledger_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_session_balance_ledger
    ADD CONSTRAINT pt_session_balance_ledger_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.pt_sessions(id) ON DELETE SET NULL;


--
-- Name: pt_sessions pt_sessions_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_sessions
    ADD CONSTRAINT pt_sessions_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.personal_trainer_assignments(id) ON DELETE SET NULL;


--
-- Name: pt_sessions pt_sessions_booked_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_sessions
    ADD CONSTRAINT pt_sessions_booked_by_user_id_fkey FOREIGN KEY (booked_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: pt_sessions pt_sessions_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_sessions
    ADD CONSTRAINT pt_sessions_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: pt_sessions pt_sessions_purchase_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_sessions
    ADD CONSTRAINT pt_sessions_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES public.pt_package_purchases(id) ON DELETE SET NULL;


--
-- Name: pt_sessions pt_sessions_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_sessions
    ADD CONSTRAINT pt_sessions_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: pt_sessions pt_sessions_workout_session_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pt_sessions
    ADD CONSTRAINT pt_sessions_workout_session_log_id_fkey FOREIGN KEY (workout_session_log_id) REFERENCES public.workout_session_logs(id) ON DELETE SET NULL;


--
-- Name: refund_requests refund_requests_approved_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: refund_requests refund_requests_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: refund_requests refund_requests_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.financial_transactions(id) ON DELETE SET NULL;


--
-- Name: retail_inventory retail_inventory_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retail_inventory
    ADD CONSTRAINT retail_inventory_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.equipment_suppliers(id) ON DELETE SET NULL;


--
-- Name: retention_campaigns retention_campaigns_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_campaigns
    ADD CONSTRAINT retention_campaigns_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.retention_email_templates(id) ON DELETE SET NULL;


--
-- Name: robot_command_logs robot_command_logs_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_command_logs
    ADD CONSTRAINT robot_command_logs_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.robot_devices(id) ON DELETE CASCADE;


--
-- Name: robot_commands robot_commands_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_commands
    ADD CONSTRAINT robot_commands_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.robot_devices(id) ON DELETE CASCADE;


--
-- Name: robot_device_alerts robot_device_alerts_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_device_alerts
    ADD CONSTRAINT robot_device_alerts_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.robot_devices(id) ON DELETE CASCADE;


--
-- Name: robot_device_maintenance robot_device_maintenance_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_device_maintenance
    ADD CONSTRAINT robot_device_maintenance_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.robot_devices(id) ON DELETE CASCADE;


--
-- Name: robot_logs robot_logs_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_logs
    ADD CONSTRAINT robot_logs_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.robot_devices(id) ON DELETE CASCADE;


--
-- Name: robot_safety_monitoring robot_safety_monitoring_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_safety_monitoring
    ADD CONSTRAINT robot_safety_monitoring_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.robot_devices(id) ON DELETE CASCADE;


--
-- Name: robot_sensor_telemetry robot_sensor_telemetry_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.robot_sensor_telemetry
    ADD CONSTRAINT robot_sensor_telemetry_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.robot_devices(id) ON DELETE CASCADE;


--
-- Name: routine_punch_breaks routine_punch_breaks_punch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routine_punch_breaks
    ADD CONSTRAINT routine_punch_breaks_punch_id_fkey FOREIGN KEY (punch_id) REFERENCES public.routine_punches(id) ON DELETE CASCADE;


--
-- Name: routine_punches routine_punches_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routine_punches
    ADD CONSTRAINT routine_punches_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: staff_profiles staff_profiles_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.gym_branches(id) ON DELETE SET NULL;


--
-- Name: staff_profiles staff_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_profiles
    ADD CONSTRAINT staff_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: staff_shifts staff_shifts_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_shifts
    ADD CONSTRAINT staff_shifts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.gym_branches(id) ON DELETE CASCADE;


--
-- Name: staff_shifts staff_shifts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.staff_shifts
    ADD CONSTRAINT staff_shifts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: time_shift_requests time_shift_requests_decided_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_shift_requests
    ADD CONSTRAINT time_shift_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: time_shift_requests time_shift_requests_general_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_shift_requests
    ADD CONSTRAINT time_shift_requests_general_assignment_id_fkey FOREIGN KEY (general_assignment_id) REFERENCES public.general_training_assignments(id) ON DELETE CASCADE;


--
-- Name: time_shift_requests time_shift_requests_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_shift_requests
    ADD CONSTRAINT time_shift_requests_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: time_shift_requests time_shift_requests_pt_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_shift_requests
    ADD CONSTRAINT time_shift_requests_pt_assignment_id_fkey FOREIGN KEY (pt_assignment_id) REFERENCES public.personal_trainer_assignments(id) ON DELETE CASCADE;


--
-- Name: token_blacklist token_blacklist_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.token_blacklist
    ADD CONSTRAINT token_blacklist_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: trainer_availability trainer_availability_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_availability
    ADD CONSTRAINT trainer_availability_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE CASCADE;


--
-- Name: trainer_commissions trainer_commissions_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_commissions
    ADD CONSTRAINT trainer_commissions_assignment_id_fkey FOREIGN KEY (assignment_id) REFERENCES public.personal_trainer_assignments(id) ON DELETE SET NULL;


--
-- Name: trainer_commissions trainer_commissions_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_commissions
    ADD CONSTRAINT trainer_commissions_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE CASCADE;


--
-- Name: trainer_exercise_checks trainer_exercise_checks_marked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_exercise_checks
    ADD CONSTRAINT trainer_exercise_checks_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: trainer_exercise_checks trainer_exercise_checks_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_exercise_checks
    ADD CONSTRAINT trainer_exercise_checks_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: trainer_exercise_checks trainer_exercise_checks_plan_exercise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_exercise_checks
    ADD CONSTRAINT trainer_exercise_checks_plan_exercise_id_fkey FOREIGN KEY (plan_exercise_id) REFERENCES public.workout_program_exercises(id) ON DELETE CASCADE;


--
-- Name: trainer_exercise_checks trainer_exercise_checks_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_exercise_checks
    ADD CONSTRAINT trainer_exercise_checks_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: trainer_recovery_reviews trainer_recovery_reviews_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_recovery_reviews
    ADD CONSTRAINT trainer_recovery_reviews_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: trainer_recovery_reviews trainer_recovery_reviews_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_recovery_reviews
    ADD CONSTRAINT trainer_recovery_reviews_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: trainer_schedules trainer_schedules_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_schedules
    ADD CONSTRAINT trainer_schedules_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE CASCADE;


--
-- Name: trainer_welfare_payments trainer_welfare_payments_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_welfare_payments
    ADD CONSTRAINT trainer_welfare_payments_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: trainer_welfare_payments trainer_welfare_payments_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_welfare_payments
    ADD CONSTRAINT trainer_welfare_payments_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: trainers trainers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainers
    ADD CONSTRAINT trainers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: users users_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE SET NULL;


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE SET NULL;


--
-- Name: users users_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: workout_program_days workout_program_days_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_program_days
    ADD CONSTRAINT workout_program_days_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.workout_programs(id) ON DELETE CASCADE;


--
-- Name: workout_program_exercises workout_program_exercises_day_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_program_exercises
    ADD CONSTRAINT workout_program_exercises_day_id_fkey FOREIGN KEY (day_id) REFERENCES public.workout_program_days(id) ON DELETE CASCADE;


--
-- Name: workout_program_exercises workout_program_exercises_exercise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_program_exercises
    ADD CONSTRAINT workout_program_exercises_exercise_id_fkey FOREIGN KEY (exercise_id) REFERENCES public.exercises(id) ON DELETE CASCADE;


--
-- Name: workout_programs workout_programs_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_programs
    ADD CONSTRAINT workout_programs_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id) ON DELETE SET NULL;


--
-- Name: workout_session_items workout_session_items_exercise_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_session_items
    ADD CONSTRAINT workout_session_items_exercise_id_fkey FOREIGN KEY (exercise_id) REFERENCES public.exercises(id) ON DELETE CASCADE;


--
-- Name: workout_session_items workout_session_items_session_log_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_session_items
    ADD CONSTRAINT workout_session_items_session_log_id_fkey FOREIGN KEY (session_log_id) REFERENCES public.workout_session_logs(id) ON DELETE CASCADE;


--
-- Name: workout_session_logs workout_session_logs_day_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_session_logs
    ADD CONSTRAINT workout_session_logs_day_id_fkey FOREIGN KEY (day_id) REFERENCES public.workout_program_days(id) ON DELETE SET NULL;


--
-- Name: workout_session_logs workout_session_logs_member_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_session_logs
    ADD CONSTRAINT workout_session_logs_member_id_fkey FOREIGN KEY (member_id) REFERENCES public.members(id) ON DELETE CASCADE;


--
-- Name: workout_session_logs workout_session_logs_program_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workout_session_logs
    ADD CONSTRAINT workout_session_logs_program_id_fkey FOREIGN KEY (program_id) REFERENCES public.workout_programs(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--



-- Default gym settings row (the app reads gym_settings id = 1). Edit it in Admin -> Settings.
INSERT INTO public.gym_settings (id, gym_name) VALUES (1, 'Virtex Fitness') ON CONFLICT (id) DO NOTHING;
