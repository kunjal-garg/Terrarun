/**
 * Require a valid session (signed tr_session cookie) and load user into req.user.
 * Returns 401 if cookie missing or user not found.
 */
import { prisma } from '../lib/prisma.js';

const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true';

export async function requireUser(req, res, next) {
  const userId = req.signedCookies?.tr_session;
  if (!userId) {
    if (DEBUG) console.log('[api/me] origin=%s cookie=no 401=session not established', req.get('origin') || '-');
    return res.status(401).json({ error: 'Unauthorized', message: 'Session required. Set a nickname first.' });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { stravaAccount: true },
    });
    if (!user) {
      if (DEBUG) console.log('[api/me] origin=%s cookie=yes 401=session invalid (user not found)', req.get('origin') || '-');
      res.clearCookie('tr_session', { path: '/', httpOnly: true });
      return res.status(401).json({ error: 'Unauthorized', message: 'Session invalid.' });
    }
    req.user = user;
    if (DEBUG) console.log('[req] path=%s user=%s', req.path, user.id);
    next();
  } catch (e) {
    console.error('requireUser', e);
    res.status(500).json({ error: 'Server error' });
  }
}
