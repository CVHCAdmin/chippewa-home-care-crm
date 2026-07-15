// helpers/clientIp.js
// The real client IP, for rate-limiter keying behind a proxy.
//
// Render terminates the connection at its edge and forwards the request, so every
// request's socket address (Express's `req.ip`) is the SAME upstream proxy address for all
// clients. A limiter keyed on that counts the whole company as one device and locks
// everyone out together once the shared bucket fills. The left-most X-Forwarded-For entry
// is the original caller, so keying on it gives each device its own bucket.
//
// This is the single source of truth — every rateLimit() in the app should pass it as
// `keyGenerator`. See project_rate_limiter_shared_bucket in memory for the incident.
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  return req.ip;
}

module.exports = { clientIp };
