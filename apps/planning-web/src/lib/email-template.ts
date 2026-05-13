export function buildLoginEmail({
  greetingLine,
  subtitleLine,
  userEmail,
  loginLink,
}: {
  greetingLine: string;
  subtitleLine: string;
  userEmail: string;
  loginLink: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0ede8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ede8;padding:40px 16px">
    <tr><td align="center">

      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin-bottom:24px">
        <tr><td align="center" style="padding-bottom:8px">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="width:56px;height:56px;background:#b91c1c;border-radius:14px;text-align:center;vertical-align:middle">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:12px auto"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
            </td>
          </tr></table>
          <div style="margin-top:12px;font-size:20px;font-weight:700;color:#1c1917;letter-spacing:-0.3px">German Butchery</div>
          <div style="font-size:13px;color:#78716c;margin-top:2px">Production Planning</div>
        </td></tr>
      </table>

      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,0.08);overflow:hidden">

        <tr><td style="background:#b91c1c;padding:32px 40px">
          <div style="font-size:22px;font-weight:700;color:#ffffff;margin-bottom:8px">${greetingLine}</div>
          <div style="font-size:15px;color:#fecaca;line-height:1.5">${subtitleLine}</div>
        </td></tr>

        <tr><td style="padding:36px 40px">
          <div style="font-size:12px;font-weight:600;color:#a8a29e;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:20px">Your account</div>

          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
            <tr><td style="font-size:12px;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:0.06em;padding-bottom:6px">Email address</td></tr>
            <tr><td style="font-size:16px;color:#1c1917;font-weight:500;background:#fafaf9;border:1px solid #e7e5e4;border-radius:8px;padding:12px 16px">${userEmail}</td></tr>
          </table>

          <div style="font-size:14px;color:#57534e;margin-bottom:32px;line-height:1.7">
            Click the button below to sign in. You will be asked to set your own password right away — it only takes a moment.
          </div>

          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <a href="${loginLink}" style="display:inline-block;background:#b91c1c;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:18px 52px;border-radius:10px;letter-spacing:0.01em;box-shadow:0 4px 14px rgba(185,28,28,0.4)">
                Log in to German Butchery &rarr;
              </a>
            </td></tr>
          </table>

          <div style="margin-top:28px;padding-top:24px;border-top:1px solid #f5f5f4;font-size:12px;color:#a8a29e;text-align:center;line-height:1.7">
            This link signs you in to your account.<br>If you did not expect this email, you can safely ignore it.
          </div>
        </td></tr>

        <tr><td style="background:#fafaf9;border-top:1px solid #e7e5e4;padding:18px 40px">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-size:12px;color:#a8a29e">German Butchery Pty Ltd &nbsp;&middot;&nbsp; Internal use only</td>
            <td align="right" style="font-size:12px;color:#a8a29e">Production Planning</td>
          </tr></table>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
