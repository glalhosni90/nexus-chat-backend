/**
 * Emit a socket event to a specific user if they are online.
 * Returns true if the user was online and the event was emitted.
 */
function emitToUser(toUserId, event, data) {
  const io = global.io;
  const onlineUsers = global.onlineUsers;
  if (!io || !onlineUsers) return false;

  const recipientSocket = onlineUsers.get(toUserId);
  if (recipientSocket) {
    io.to(recipientSocket).emit(event, data);
    return true;
  }
  return false;
}

module.exports = { emitToUser };
