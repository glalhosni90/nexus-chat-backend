const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');

function generateId() {
  return uuidv4();
}

function now() {
  return new Date().toISOString();
}

/**
 * Insert a message record and return { id, fromUserId, toUserId, content, type, createdAt }.
 */
function insertMessage(fromUserId, toUserId, content, type = 'text') {
  const id = generateId();
  const createdAt = now();
  db.prepare(`
    INSERT INTO messages (id, from_user_id, to_user_id, content, type, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, fromUserId, toUserId, content, type, createdAt);
  return { id, fromUserId, toUserId, content, type, createdAt };
}

/**
 * Look up a user row by username (case-insensitive via lowercasing).
 * @param {string} username
 * @param {string} columns - SQL column list, defaults to all columns
 */
function findUserByUsername(username, columns = '*') {
  return db.prepare(
    `SELECT ${columns} FROM users WHERE username = ?`
  ).get(username.toLowerCase());
}

/**
 * Check for a row where a pair of columns matches (id1, id2) in either order.
 * Useful for friendships, friend_requests, and message queries.
 */
function findBidirectionalMatch(table, col1, col2, id1, id2, extraWhere = '', extraParams = []) {
  const where = `(${col1} = ? AND ${col2} = ?) OR (${col1} = ? AND ${col2} = ?)`;
  const fullWhere = extraWhere ? `(${where}) AND ${extraWhere}` : where;
  return db.prepare(
    `SELECT * FROM ${table} WHERE ${fullWhere}`
  ).get(id1, id2, id2, id1, ...extraParams);
}

module.exports = { generateId, now, insertMessage, findUserByUsername, findBidirectionalMatch };
