function nero(message) {
  const text = message.trim().toLowerCase();

  if (text === "hello" || text === "hello nero") {
    return "Umu! Nero Claudius has arrived. Speak, Master.";
  }

  if (text === "ping") {
    return "Pong! Nero's systems are alive.";
  }

  return `Nero has heard you: "${message}"`;
}

module.exports = nero;
