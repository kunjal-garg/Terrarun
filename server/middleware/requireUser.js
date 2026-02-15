/**
 * Require a valid session (signed tr_session cookie) and load user into req.user.
 * Returns 401 if cookie missing or user not found.
 */
import { prisma } from '../lib/prisma.js';

export async function requireUser(req, res, next) {
  const userId = req.signedCookies?.tr_session;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Session required. Set a nickname first.' });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { stravaAccount: true },
    });
    if (!user) {
      res.clearCookie('tr_session', { path: '/', httpOnly: true });
      return res.status(401).json({ error: 'Unauthorized', message: 'Session invalid.' });
    }
    req.user = user;
    next();
  } catch (e) {
    console.error('requireUser', e);
    res.status(500).json({ error: 'Server error' });
  }
}
