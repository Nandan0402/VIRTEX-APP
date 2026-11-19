# Trainer Hub migrations

Status: **PROPOSED — not applied.** Design: `documentation/trainer-hub-data-model.md`.

Same conventions as `database/migrations/`: `NNN_name.sql` + `NNN_name_down.sql`,
each wrapped in `BEGIN … COMMIT`, applied explicitly (nothing runs automatically —
`scripts/migrate.js` only runs 001–004 of the main folder by name).

## Order

| # | File | Creates | Changes existing tables |
|---|---|---|---|
| 001 | `001_trainer_assignment_extensions.sql` | `pt_assignment_history`, `fn_pt_assignment_history()`, trigger | `personal_trainer_assignments` + `updated_by_user_id`; unique index (one active assignment per member+trainer) |
| 002 | `002_pt_session_management.sql` | `pt_packages`, `pt_package_purchases`, `pt_sessions`, `pt_session_balance_ledger`, `fn_pt_complete_session()`, `fn_pt_reverse_session()` | `personal_trainer_assignments` + `package_id` |
| 003 | `003_workout_management.sql` | — | `workout_programs`, `exercises` + `archived_at` |
| 004 | `004_workout_logs.sql` | — | `workout_session_logs` + `trainer_id` |
| 005 | `005_diet_nutrition.sql` | — | `diet_plans`, `food_items` + `archived_at` |
| 006 | `006_member_performance.sql` | `member_cardio_benchmarks`, `member_progress_snapshots` | — |
| 007 | *(not needed)* | — | — |
| 008 | `008_trainer_communication.sql` | `message_threads`, `messages`, `fn_message_touch_thread()`, trigger | — |
| 009 | `009_trainer_notifications.sql` | `notifications` | — |
| 010 | `010_trainer_hub_indexes.sql` | — | 6 indexes on existing trainer FK columns |

**007 recovery & wellness is intentionally absent:** `member_recovery_logs`
(sleep hours/quality, rest days, readiness), `member_muscle_soreness_details` and
`trainer_recovery_reviews` already cover every requirement and are indexed.

Files 003–010 are independent of each other; 002 is the only file other objects
depend on (none of the later files reference its tables). Run in numeric order.

## Safety properties

* Only `CREATE … IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`
  (functions / triggers on new objects). No `DROP`, `TRUNCATE`, `RENAME`,
  `ALTER COLUMN … TYPE` or data rewrite in any up-migration.
* Every added column on an existing table is nullable with no default rewrite.
* Each file checks its prerequisites first and aborts without changes if missing.
* Each file is one transaction: a failure leaves the database unchanged.
* Re-running a file is harmless (idempotent).

## Apply (after approval)

```powershell
# 1. Backup
.\scripts\backup_db.ps1
# 2. Dry run each file (DDL is transactional in PostgreSQL)
#    psql: \set ON_ERROR_STOP on  then  BEGIN; \i <file>; ROLLBACK;
# 3. Apply 001 → 010 in order, then re-run the read-only schema audit.
```

## Rollback

Run the `_down.sql` files in **reverse** order (010 → 001). Down scripts remove
only objects their up-script created. Down scripts for 001, 002, 006, 008, 009
delete the data stored in the new tables; 003, 004, 005 drop the added columns
(their values are lost); 010 drops indexes only.
