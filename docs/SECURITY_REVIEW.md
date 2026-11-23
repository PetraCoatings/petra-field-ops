# Security review — Phase 9c (November 2026)

What was checked, what was found, what was fixed, and what is left on purpose.
Written for the owner; technical details are in pull request "Security review
fixes" and migration `20261129000100_security_hardening.sql`.

## What was checked

- **Database access rules** for every table: who can see, add, change and
  delete each kind of record, tested as each role (installer, crew lead, PM,
  office admin, signed-out).
- **Live check** on the real Supabase project with a throwaway account (deleted
  afterwards): a signed-in user could not change notification types, write time
  directly, or read anything while signed out.
- **Server code**: sign-in links, the phone's "send when there's signal" routes,
  payroll export, calendar feed, photo and pay-rate screens.
- **Phone side**: what is left on a phone after signing out, and the app's
  third-party packages (`npm audit`: 0 known vulnerabilities).

## Found and fixed

| # | What could have happened | Fix |
|---|---|---|
| 1 | A crafted sign-in link could bounce someone to another website after they signed in. | Only this site's own pages are accepted. |
| 2 | Someone on a job could make a photo record point at another photo's file; removing their photo would then delete the other file. | Photo files must be named after the photo itself, and removing a photo only removes its own files. |
| 3 | A phone (or someone tampering with one) could send a clock-in dated days in the past. | Presses that arrive more than 15 minutes late are flagged on the timesheet ("sent late — check it"). Presses more than 3 days old are refused; the person asks for a fix. |
| 4 | A crew lead who once group-clocked an office admin or PM could see and fix that person's time for 35 days. | Crew leads and PMs never "lead" office staff. Crew leads can only fix this week and last week; older fixes go to the office. |
| 5 | A time fix could put hours on a job the person fixing it can't see. | Refused. |
| 6 | Office staff could move a work order to another job or swap which revision is current, outside the publish step. | Work orders can only be renamed or voided; publishing still goes through Publish. |
| 7 | "Approved by / when" on a product could be typed in. | Set only by the system when an admin approves. |
| 8 | An admin could delete an employee (and with them their time records) or a job with submitted daily reports. | Refused. Turn the account off or close the job instead. Payroll lines are now in the change log too. |
| 9 | The automatic test cleanup removed anything named "E2E…", so a real job named that way would have been deleted. | Test data is now marked by the test runner (which only the server key can do), and only marked rows are removed. |
| 10 | Another website could have sent a Time Clock press using a signed-in person's phone. | The send-queue only accepts requests from the app's own pages. |
| 11 | A payroll CSV cell starting with "=" could run as a formula when opened in Excel. | Such cells are made plain text. |
| 12 | A job name with special characters could break the calendar feed. | Escaped properly. |
| 13 | "My pay rates" showed office admins everyone's rates on that page. | Shows only your own; admins still see everyone's on Pay rates. |

## Left as is (low risk), and why

- **Data sheet files of inactive products** can still be opened by a signed-in
  user who has the exact link. No customer or pay data in them.
- **Links in emails/sign-in links use the site address of the request.** Fixed
  for good by setting the site address in Vercel (go-live checklist).
- **Calendar links never expire.** Each person can make a new link at any time,
  which turns the old one off.
- **Two-step sign-in (MFA) for office admins** is in the plan but not built yet
  — it's on the go-live checklist; Supabase supports it with an authenticator app.
- **"Secure password change"** (asks for a recent sign-in before changing a
  password) should be turned on in Supabase → Authentication → Providers →
  Email — on the go-live checklist.
- **Signing out** clears saved pages, calculator and data sheet copies from the
  phone. Unsent time and photos are kept so they aren't lost, and are only
  sent (and only shown) for the person who made them.
