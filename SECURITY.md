# Security

## Token handling

- The Gitee personal access token (`giteeToken`) is marked `secret` in the plugin
  configuration schema. The status/config HTTP APIs never echo it — they only expose a
  `tokenConfigured` boolean.
- User configuration is persisted to the **user's own profile patch layer**, not inside this
  package. The shipped `cordis.patch.yml` contains only an empty default and never carries a
  token, so the package is safe to publish and reinstall.
- Token values are sent only to `gitee.com` (Gitee API) and — when used for cloning — to the
  Gitee git endpoint (`https://<user>:<token>@gitee.com/...`).

## Reporting a vulnerability

Please report security issues privately via GitHub:
https://github.com/wangbobo-coder/gitee-ai-employee/security/advisories/new

Do not put tokens or real credentials in issues.
