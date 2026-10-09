# Incident response

How to run an incident: how bad it is, who does what, what to say, what to keep, and the privacy-law clock. It is the
place every alert runbook escalates to. The kill switches are in the table below (security checklist SC-D5). The
contact list is **not** in this repository: it holds names and phone numbers, so KR keeps it in the password manager
and the operations log ([operations/README.md](../operations/README.md)). Targets marked "KR to confirm" are proposals.

## Severity

| Level | Means                                                                                                        | Examples                                                                                            | Respond (KR to confirm)                             |
| ----- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1     | Personal data exposed or suspected exposed; data lost; the site is down for everyone; an attacker is active. | Unauthorised sign-in to staff or admin; a bucket or database reachable from outside; failed restore | Acknowledge in 15 min, any hour; lead named at once |
| 2     | A core function is unusable for many people, or one job's data is wrong, or protection is off.               | ClamAV down so no file opens; sustained 5xx; backups failing 48 h; compromised guest account        | Acknowledge in 30 min in business hours (Perth)     |
| 3     | Degraded with a workaround, or one user affected.                                                            | Slow pages; one failing upload; stamp reading failing                                               | Same business day                                   |
| 4     | No user impact; follow-up work.                                                                              | A ticket from api-latency or malware-scan-errors                                                    | Plan it                                             |

When unsure between two levels take the higher one and lower it later. Alerts start at: page alerts level 2 (level 1
once data exposure or loss is possible), ticket alerts level 3 or 4.

## Roles

| Role                | Does                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| Incident lead       | Owns the response, decides severity and mitigations, keeps the timeline. One person, named in the thread. |
| Technical lead      | Diagnoses with the runbooks and makes the changes (a second person confirms production changes).          |
| Communications lead | Writes every update; the only voice to staff and clients. Usually KR, not the engineer.                   |
| KR owner            | Approves risky choices (restore, take the site down, tell clients) and the privacy decision below.        |

## The first hour

1. **Declare.** Open one thread or call, post the time (Perth and UTC), the severity and who leads. Everything goes there.
2. **Contain** before you understand. Use the smallest switch that stops the harm:

   | Switch                | How                                                                                                                                                      |
   | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Stop deploys          | `DEPLOYS_FROZEN=true` ([deploy-and-rollback](deploy-and-rollback.md); roll back first, a freeze blocks rollbacks)                                        |
   | Switch a feature off  | Flags: [deploy-and-rollback](deploy-and-rollback.md), "Kill a flag"                                                                                      |
   | Cut one person off    | `/admin/users`, disable (revokes their sessions); reset them in Entra                                                                                    |
   | Cut everyone off      | [secrets-rotation](secrets-rotation.md), "Invalidate every session"                                                                                      |
   | Take the site offline | Last resort, with KR owner approval: stop the active deployment of `web` in the dashboard. `api`, `worker` and the database are private and keep running |
   | Close a leak          | Rotate the secret: [secrets-rotation](secrets-rotation.md)                                                                                               |

3. **Preserve evidence.** Do not restart or redeploy a suspect service before saving its logs: Railway keeps logs for a
   limited time, so export the relevant window (request ids, event names, times; no personal data copied into chat).
   `audit_events` is append-only and kept 7 years. Write down every command you run, with the time.
4. **Diagnose** with the alert's runbook; do not expand the blast radius with experiments in production.
5. **Communicate** on a schedule (below) even when there is nothing new.

## Communication

- Internal updates every 30 minutes for level 1 and every 60 minutes for level 2, and on every change of state.
- Clients and architects are told by KR through its normal contact, never by engineers and never from the application.
- Say what is known, what users should do, and when the next update is. Do not guess a cause, a count, or a person.
  Use job numbers and ids, never client names, addresses or emails, in any channel.

```text
Initial: "We are investigating <what users see> since <time Perth>. <Impact>. Next update by <time>."
Update:  "<What changed>. <What users should do>. Next update by <time>."
Resolved: "<What happened in one sentence>. Service restored at <time>. A review will follow by <date>."
```

## Personal information: Australian Privacy Act

The tracker holds names, emails, client names and addresses, grants, and job documents (PRODUCT_SPEC 14). If it is
possible that personal information was accessed or disclosed without authority, or lost, **stop and start this clock
as well as the technical response.** This section flags the obligations for **KR legal review**; it is not legal advice
and does not decide whether KR is bound.

- The Notifiable Data Breaches scheme (Part IIIC of the Privacy Act 1988) applies to entities the Act covers. Whether KR
  Surveys is covered (for example a small business exemption and its exceptions) is a legal question for KR.
- If covered, a breach is notifiable when personal information is subject to unauthorised access, disclosure or loss and
  a reasonable person would conclude serious harm to an individual is likely and remedial action has not prevented it.
- On a **suspected** breach the entity must make a reasonable, quick assessment, completed within 30 days. If it is an
  eligible data breach it must notify the Office of the Australian Information Commissioner (OAIC) and affected people
  as soon as practicable, with the prescribed content (who KR is, what happened, what kinds of information, the
  recommended steps).
- Record the time the suspicion arose, the assessment, who decided, and the decision, even when the answer is "not notifiable".
- Other parties may have duties to tell or be told: Microsoft (Entra), Railway, Anthropic when stamp reading was on
  (page 1 of notices leaves Australia, ADR-0010), and clients under their contracts. KR owner and legal decide.
- The engineer's part: establish **what** was exposed (which jobs, which data kinds, how many people, which window)
  from logs and `audit_events`, and keep the evidence.

## After it ends

Within 5 working days hold a blameless review and file it with the operations log: timeline, impact (minutes of
downtime against the SLO-1 budget, people and jobs affected), cause, what worked, what did not, and actions with an
owner and a date (a test, an alert, a runbook change). Update the alert and the runbook that failed you. If a human
corrected an agent's work during the incident, add the entry to `LESSONS.md` (rule A10).
