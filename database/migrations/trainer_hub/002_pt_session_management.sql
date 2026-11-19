-- ==============================================================================
-- Trainer Hub 002: PT session management                         STATUS: PROPOSED
-- ------------------------------------------------------------------------------
-- No PT package / session tables exist (finance "packages" = membership_plans).
-- Adds:
--   * pt_packages                 sellable PT products
--   * personal_trainer_assignments.package_id (nullable FK -> pt_packages)
--   * pt_package_purchases        per-member session balance (generated remaining)
--   * pt_sessions                 booking -> completed / cancelled / no_show
--   * pt_session_balance_ledger   append-only balance history
--   * fn_pt_complete_session / fn_pt_reverse_session  transaction-safe balance changes
-- Depends on: 001 (no hard dependency), existing workout_session_logs.
-- Rollback: 002_pt_session_management_down.sql
-- ==============================================================================

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.personal_trainer_assignments') IS NULL
       OR to_regclass('public.workout_session_logs') IS NULL
       OR to_regprocedure('public.fn_update_timestamp()') IS NULL THEN
        RAISE EXCEPTION 'Trainer Hub 002: required base objects are missing';
    END IF;
END $$;

-- ---------------------------------------------------------------- PT packages
CREATE TABLE IF NOT EXISTS pt_packages (
    id                     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id              UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    package_code           VARCHAR(32)  NOT NULL UNIQUE,
    name                   VARCHAR(120) NOT NULL,
    description            TEXT,
    sessions_count         INTEGER      NOT NULL CHECK (sessions_count > 0),
    validity_days          INTEGER      NOT NULL CHECK (validity_days > 0),
    session_duration_mins  SMALLINT     NOT NULL DEFAULT 60 CHECK (session_duration_mins BETWEEN 15 AND 240),
    price_inr              NUMERIC(10,2) NOT NULL CHECK (price_inr >= 0),
    is_active              BOOLEAN      NOT NULL DEFAULT TRUE,
    archived_at            TIMESTAMPTZ,
    created_by_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_pt_packages_archived_inactive CHECK (archived_at IS NULL OR is_active = FALSE)
);
CREATE INDEX IF NOT EXISTS idx_pt_packages_active ON pt_packages(is_active) WHERE archived_at IS NULL;
CREATE OR REPLACE TRIGGER trg_pt_packages_updated BEFORE UPDATE ON pt_packages
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

ALTER TABLE personal_trainer_assignments
    ADD COLUMN IF NOT EXISTS package_id BIGINT REFERENCES pt_packages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pt_assign_package ON personal_trainer_assignments(package_id);

-- ------------------------------------------------- Package purchases (balances)
CREATE TABLE IF NOT EXISTS pt_package_purchases (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    member_id            INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    package_id           BIGINT  NOT NULL REFERENCES pt_packages(id) ON DELETE RESTRICT,
    assignment_id        INTEGER REFERENCES personal_trainer_assignments(id) ON DELETE SET NULL,
    trainer_id           INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    sessions_total       INTEGER NOT NULL CHECK (sessions_total > 0),
    sessions_used        INTEGER NOT NULL DEFAULT 0 CHECK (sessions_used >= 0),
    sessions_remaining   INTEGER GENERATED ALWAYS AS (sessions_total - sessions_used) STORED,
    price_paid_inr       NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price_paid_inr >= 0),
    payment_status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                         CHECK (payment_status IN ('paid', 'pending', 'partial', 'waived', 'refunded')),
    valid_from           DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until          DATE NOT NULL,
    status               VARCHAR(20) NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'exhausted', 'expired', 'cancelled', 'refunded')),
    notes                TEXT,
    created_by_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_ptpp_used_le_total CHECK (sessions_used <= sessions_total),
    CONSTRAINT chk_ptpp_valid_range   CHECK (valid_until >= valid_from)
);
CREATE INDEX IF NOT EXISTS idx_ptpp_member   ON pt_package_purchases(member_id, status);
CREATE INDEX IF NOT EXISTS idx_ptpp_trainer  ON pt_package_purchases(trainer_id, status);
CREATE INDEX IF NOT EXISTS idx_ptpp_package  ON pt_package_purchases(package_id);
CREATE INDEX IF NOT EXISTS idx_ptpp_expiry   ON pt_package_purchases(valid_until) WHERE status = 'active';
CREATE OR REPLACE TRIGGER trg_ptpp_updated BEFORE UPDATE ON pt_package_purchases
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- --------------------------------------------------------------- PT sessions
CREATE TABLE IF NOT EXISTS pt_sessions (
    id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    public_id               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    member_id               INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    trainer_id              INTEGER REFERENCES trainers(id) ON DELETE SET NULL,
    assignment_id           INTEGER REFERENCES personal_trainer_assignments(id) ON DELETE SET NULL,
    purchase_id             BIGINT  REFERENCES pt_package_purchases(id) ON DELETE SET NULL,
    scheduled_start         TIMESTAMPTZ NOT NULL,
    scheduled_end           TIMESTAMPTZ NOT NULL,
    location                VARCHAR(120),
    status                  VARCHAR(20) NOT NULL DEFAULT 'booked'
                            CHECK (status IN ('booked', 'confirmed', 'completed', 'cancelled', 'no_show')),
    booked_by_user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    completed_at            TIMESTAMPTZ,
    cancelled_at            TIMESTAMPTZ,
    cancellation_reason     VARCHAR(255),
    balance_deducted        BOOLEAN NOT NULL DEFAULT FALSE,
    workout_session_log_id  INTEGER UNIQUE REFERENCES workout_session_logs(id) ON DELETE SET NULL,
    trainer_notes           TEXT,
    member_feedback         TEXT,
    member_rating           SMALLINT CHECK (member_rating BETWEEN 1 AND 5),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_pts_time_range   CHECK (scheduled_end > scheduled_start),
    CONSTRAINT chk_pts_completed_at CHECK (status <> 'completed' OR completed_at IS NOT NULL),
    CONSTRAINT chk_pts_cancelled_at CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_pts_trainer_start ON pt_sessions(trainer_id, scheduled_start);
CREATE INDEX IF NOT EXISTS idx_pts_member_start  ON pt_sessions(member_id, scheduled_start);
CREATE INDEX IF NOT EXISTS idx_pts_purchase      ON pt_sessions(purchase_id);
CREATE INDEX IF NOT EXISTS idx_pts_assignment    ON pt_sessions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_pts_status        ON pt_sessions(status, scheduled_start);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pts_trainer_slot
    ON pt_sessions(trainer_id, scheduled_start)
    WHERE status IN ('booked', 'confirmed', 'completed') AND trainer_id IS NOT NULL;
CREATE OR REPLACE TRIGGER trg_pts_updated BEFORE UPDATE ON pt_sessions
FOR EACH ROW EXECUTE FUNCTION fn_update_timestamp();

-- -------------------------------------------------------------- Balance ledger
CREATE TABLE IF NOT EXISTS pt_session_balance_ledger (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    purchase_id         BIGINT NOT NULL REFERENCES pt_package_purchases(id) ON DELETE CASCADE,
    session_id          BIGINT REFERENCES pt_sessions(id) ON DELETE SET NULL,
    delta               INTEGER NOT NULL CHECK (delta <> 0),
    reason              VARCHAR(30) NOT NULL
                        CHECK (reason IN ('purchase', 'session_completed', 'no_show_charged',
                                          'session_reversed', 'manual_adjustment', 'expired', 'refund')),
    balance_after       INTEGER NOT NULL CHECK (balance_after >= 0),
    created_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ptl_purchase ON pt_session_balance_ledger(purchase_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ptl_one_deduction_per_session
    ON pt_session_balance_ledger(session_id)
    WHERE reason IN ('session_completed', 'no_show_charged') AND session_id IS NOT NULL;

-- ------------------------------------------------ Transaction-safe balance ops
-- Complete / no-show a session and deduct one session. Locks session + purchase.
CREATE OR REPLACE FUNCTION fn_pt_complete_session(
    p_session_id      BIGINT,
    p_outcome         VARCHAR DEFAULT 'completed',
    p_user_id         INTEGER DEFAULT NULL,
    p_charge_no_show  BOOLEAN DEFAULT TRUE
)
RETURNS pt_sessions AS $$
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
$$ LANGUAGE plpgsql;

-- Reverse a deducted session (gives the session back, reopens an exhausted package).
CREATE OR REPLACE FUNCTION fn_pt_reverse_session(
    p_session_id  BIGINT,
    p_user_id     INTEGER DEFAULT NULL,
    p_reason      VARCHAR DEFAULT 'Reversed by staff'
)
RETURNS pt_sessions AS $$
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
$$ LANGUAGE plpgsql;

COMMIT;
