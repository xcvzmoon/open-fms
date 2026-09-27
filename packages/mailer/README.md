# @open-fms/mailer

Typed mail dispatch for auth and setup flows.

## Events

- `auth.verify`
- `auth.password-reset`
- `auth.setup-code`

Call sites send a `MailEvent`. The package renders text/HTML and delivers through `unemail` (mock or SMTP).

Use `createMailDispatch({ from, mode, smtpHost, smtpPort })`.
