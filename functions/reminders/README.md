# OneDose reminder function

This Appwrite Function runs once per hour. It creates missing occurrences for
daily, selected-weekday, and one-time schedules, sends the due reminder to the
first available contact, and escalates to every
available caregiver after the circle's configured grace period.
`notification_deliveries` prevents duplicate messages when the function is retried.

## Appwrite settings

- Root directory: `functions/reminders`
- Entrypoint: `src/main.js`
- Build command: `npm install`
- Schedule: interval of `60` minutes
- Scopes: `rows.read`, `rows.write`, `messages.write`, and `teams.read`
- Variables:
  - `DATABASE_ID=6ad61f7e003988501658`
  - `APP_URL=https://onedose.appwrite.network`
  - `OVERDUE_MINUTES=60` (fallback for circles without saved settings)
  - `REMINDER_DRY_RUN=false`

Configure an email provider under Appwrite **Messaging → Providers** before
turning off dry-run mode. Execute once with `REMINDER_DRY_RUN=true` to verify
the schedule and delivery ledger without sending email.
