# Staff guide

For KR Surveys employees. Where a task needs KR Admin or an administrator it says so.

## Signing in and out

1. Open the tracker address KR Surveys gave you. You land on the sign-in page.
2. Choose **Sign in with Microsoft** and use your KR Surveys account. If you are already signed in to Microsoft 365 it
   is one click.
3. You arrive on the **dashboard**. Your name, a theme control (System, Light, Dark) and **Sign out** are at the top
   right; **Admin** appears if you may use it.

You are signed out after 2 hours without activity, or 12 hours after signing in. Close the tab and use **Sign out** on
shared computers.

| If you see                                                                                              | Do this                                                  |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| "That account isn't part of the KR Surveys organisation – sign in with the account KR Surveys invited." | Sign in with your KR Surveys account, not a personal one |
| "Your account has been disabled – contact KR Surveys."                                                  | Ask an administrator                                     |
| "That sign-in attempt expired or was started in another browser – please try again."                    | Press Try again and finish in the same browser           |
| "Sign-in didn't work – please try again."                                                               | Try again; if it repeats, tell KR IT with the time       |

The first eligible KR employee to sign in on a new system becomes the administrator.

## What your role can do

| Role     | Typical person                  | Can                                                                            |
| -------- | ------------------------------- | ------------------------------------------------------------------------------ |
| Staff    | KR Surveys employee             | See and edit every job, upload, manage access. Cannot see fee proposals        |
| KR Admin | KR Admin (for example accounts) | Everything staff can, plus fee proposals, the audit trail, and archiving a job |
| Admin    | System administrator            | Everything KR Admin can, plus user management                                  |

## Dashboard

- **In progress / Complete / All** switch the list; the number in brackets is how many jobs each holds.
- **Search job, address or client** finds by job number, address or client name. **TYPE** chips narrow by subdivision type;
  click the active chip again to clear it.
- Each card shows the job number, progress, address, client and type, and a **NEXT TO ACTION** box: alerts (red is bad,
  amber a warning) and up to four next actions, each tagged KR Surveys, Client or Unassigned. **Open job →** opens it.
- **NEW JOB** (staff) asks for the job number, address, client (optional) and subdivision type, then **CREATE JOB**.
  "S-0001 is already in use." means that number belongs to a current job.

## The tracker page

- The job picker at the top switches jobs; **DASHBOARD** goes back; **Save as PDF** expands every stage and opens the
  print dialog; **EDIT JOB** changes the number, address, client and type.
- **SUBDIVISION PROGRESS** shows the percentage, the counts, and two dates: **WAPC APPROVAL DATE** and **APPROVAL EXPIRY**
  (with days left to lodge Form 1C). They fill in by themselves when the Decision Letter is read.
- **Stages**: click a bar to open it; **Expand all** and **Collapse all** do all ten. A grey bar reading "Not required –
  no conditions in the Decision Letter" is an agency stage that is switched off.
- Each **checkpoint card** has three status buttons (Completed, Not completed, Not required) and a responsibility menu
  (Unassigned, KR Surveys, Client, Architect). A change saves at once. If someone else changed it first you see "Someone
  else changed this — the latest version has been loaded." and nothing is lost: look and repeat your change.
- A banner appears for problems: "A change couldn't be saved. Reload the page and try again." (note the request id).

## Uploading and viewing files

- Drag files onto a dashed box or click it to choose. Each box accepts only certain kinds (for example the survey box
  takes a PDF and a DWG); the kind is checked from the file's content, not its name, and the limit is 50 MB.
- A file says **Scanning…** for a few seconds while it is checked for viruses. **Blocked – failed the virus scan**
  means it was rejected and removed; do not try again with the same file. **Couldn't be checked for viruses – remove it
  and upload it again** means the check could not finish: remove it with the × (then **Yes**) and upload it again.
- Click a file name to open the viewer (arrows move between files, **Open in new tab**, **Close**). DWG drawings cannot
  be previewed: use the download button.
- The × next to a file, then **Yes**, removes it. Removal is recorded, and the file is purged after 30 days.

## WAPC steps

- **4.2 WAPC Application Conformed**: drop the Conformance Notification PDF. The date is taken from the file name, the
  stamp, or the text, and the message under the box says which. Check it. **Read conformed date again** retries, or
  enter the date by hand. The **WAPC outcome date** is 90 days later unless you change it; the countdown follows.
- **4.3 Queries from WAPC**: drop an Outlook `.msg` or a `.eml`, or paste the email text. Click a subject to read it.
- **5.0 WAPC conditional approval received**: drop the Decision Letter (its file name must contain "Decision Letter"),
  then **Extract conditions from Decision Letter**. Check any condition marked "Agency guessed – please check". Each
  condition has a checkbox, responsibility, KR and client comments (they save by themselves) and an evidence box.
  Extracting again replaces the conditions, their ticks and comments after you confirm.
- **1.0 Fee proposal** is visible to KR Admin and the client only; everyone else sees "Fee proposal details are visible to
  KR Admin and the client only."
- Client decisions (Approve or Decline, with a comment when declining) and payment buttons such as **INVOICE PAID** may be
  recorded for the client by staff; they do not change the checkpoint status by themselves.

## Notes, files and PDF

**JOB NOTES**: write a note, choose who it is for (a label only; everyone on the job can read every note), **ADD NOTE**.
You can delete any note on a job. (Clients and architects can delete only their own.) **DOWNLOAD ALL FILES (.ZIP)** gives the job's clean files in stage folders plus a job
summary. **Save as PDF** expands every stage and opens your browser's print dialog; choose "Save as PDF" there.

## Giving a client or architect access

On the dashboard, **ACCESS MANAGER**: enter their email, a name if you like, choose **Client** or **Architect**, choose the
job, **GRANT ACCESS**. The entry shows **PENDING** until they sign in with that same email, then **ACTIVE**. Remove with ×
then **Yes**: it stops on their next click. KR IT invites the person to Microsoft first, unless invitations are switched
on, in which case the tracker sends one.

## KR Admin and administrators

- **Archive job…** (in EDIT JOB): hides the job from everyone and stops client access; files and history are kept. To bring
  one back ask the operations team ([unarchive-job](../runbooks/unarchive-job.md)).
- **Admin, Users** (administrator): search people, change a role (admin, KR Admin, staff, external), disable or enable. You
  cannot change your own role, and there must always be one active admin. Changing a role signs that person out.
- **Admin, Audit** (administrator, KR Admin): newest first, filter by job, person or action, with what changed.
