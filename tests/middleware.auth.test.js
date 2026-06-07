const jwt = require('jsonwebtoken');

const SECRET = 'nexus_secret_change_in_production';

// We test the middleware in isolation
const authMiddleware = require('../middleware/auth');

describe('Auth Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it('should return 401 when no Authorization header is provided', () => {
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'No token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when Authorization header has no Bearer token', () => {
    req.headers.authorization = 'Bearer';
    authMiddleware(req, res, next);
    // 'Bearer'.split(' ')[1] is undefined
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 for an invalid/expired token', () => {
    req.headers.authorization = 'Bearer invalidtoken123';
    authMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should call next() and attach user to req for a valid token', () => {
    const payload = { id: 'user-123', username: 'testuser' };
    const token = jwt.sign(payload, SECRET, { expiresIn: '1h' });
    req.headers.authorization = `Bearer ${token}`;

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe('user-123');
    expect(req.user.username).toBe('testuser');
  });

  it('should return 401 for a token signed with the wrong secret', () => {
    const payload = { id: 'user-123', username: 'testuser' };
    const token = jwt.sign(payload, 'wrong_secret');
    req.headers.authorization = `Bearer ${token}`;

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 for an expired token', () => {
    const payload = { id: 'user-123', username: 'testuser' };
    const token = jwt.sign(payload, SECRET, { expiresIn: '-1s' });
    req.headers.authorization = `Bearer ${token}`;

    authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token' });
    expect(next).not.toHaveBeenCalled();
  });
});
