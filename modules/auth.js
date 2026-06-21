const crypto = require('crypto');

const FALLBACK_SITE_PASSWORD = '';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
let sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[Auth] 使用临时 session secret，重启后需要重新登录');
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(data) {
  return crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');
}

function createSessionToken(user) {
  const now = Date.now();
  const payload = {
    studentId: String(user.studentId || '').trim(),
    name: String(user.name || '').trim(),
    role: String(user.role || '').trim(),
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  const encoded = base64url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function verifySessionToken(token) {
  const raw = String(token || '').trim();
  const [encoded, signature] = raw.split('.');
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!payload?.studentId || !payload?.name || !['teacher', 'student'].includes(payload?.role)) return null;
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

function getBearerToken(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String(req.query.token || '').trim();
}

function requireSession(req, res, next) {
  // First try Bearer token
  let token = getBearerToken(req);
  
  // If no Bearer token, try cookie
  if (!token && req.cookies && req.cookies.session_token) {
    token = req.cookies.session_token;
  }
  
  const user = verifySessionToken(token);
  if (!user) return res.status(401).json({ ok: false, message: '登录已过期，请重新登录' });
  req.user = user;
  return next();
}

function requireTeacher(req, res, next) {
  if (!req.user || req.user.role !== 'teacher') return res.status(403).json({ ok: false, message: '仅教师可访问' });
  return next();
}

function validateLogin({ password, studentId, name, role }) {
  const expectedPassword = process.env.SITE_ACCESS_PASSWORD || process.env.TEACHER_PASSWORD || FALLBACK_SITE_PASSWORD;
  if (!expectedPassword) return { ok: false, status: 500, message: 'Server password is not configured. Please set SITE_ACCESS_PASSWORD or TEACHER_PASSWORD in .env' };
  if (String(password || '') !== expectedPassword) return { ok: false, status: 401, message: '密码错误' };
  if (!String(studentId || '').trim() || !String(name || '').trim() || !String(role || '').trim()) {
    return { ok: false, status: 400, message: '学号、姓名和角色不能为空' };
  }
  if (!['teacher', 'student'].includes(role)) return { ok: false, status: 400, message: '角色无效' };
  return { ok: true };
}

module.exports = { createSessionToken, verifySessionToken, requireSession, requireTeacher, validateLogin, getBearerToken };
