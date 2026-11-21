class TrieNode {
  constructor() {
    this.children = new Map();
    this.users = new Map(); // userId -> safe user object
  }
}

export class Trie {
  constructor() {
    this.root = new TrieNode();
  }

  insert(key, user) {
    if (!key || typeof key !== "string" || !user) {
      return;
    }

    const normalizedKey = key.trim().toLowerCase();
    if (!normalizedKey) {
      return;
    }

    const safeUser = {
      id: user.id || (user._id ? user._id.toString() : String(user)),
      name: user.name || "",
      email: (user.email || "").toLowerCase(),
      timezone: user.timezone || "UTC",
    };

    let current = this.root;
    for (const char of normalizedKey) {
      if (!current.children.has(char)) {
        current.children.set(char, new TrieNode());
      }
      current = current.children.get(char);
    }

    current.users.set(safeUser.id, safeUser);
  }

  indexUser(user) {
    if (!user) {
      return;
    }

    const safeUser = {
      id: user.id || (user._id ? user._id.toString() : String(user)),
      name: user.name || "",
      email: (user.email || "").toLowerCase(),
      timezone: user.timezone || "UTC",
    };

    // 1. Index full name
    if (safeUser.name) {
      this.insert(safeUser.name, safeUser);

      // Index individual name words (e.g. "Raj", "Patel")
      const words = safeUser.name.split(/\s+/).filter(Boolean);
      for (const word of words) {
        this.insert(word, safeUser);
      }
    }

    // 2. Index full email
    if (safeUser.email) {
      this.insert(safeUser.email, safeUser);

      // Index username portion before '@' (e.g. "raj" in "raj@example.com")
      const atIndex = safeUser.email.indexOf("@");
      if (atIndex > 0) {
        const username = safeUser.email.slice(0, atIndex);
        this.insert(username, safeUser);

        // Also index parts separated by dot, hyphen, or underscore
        const parts = username.split(/[._-]+/).filter(Boolean);
        for (const part of parts) {
          this.insert(part, safeUser);
        }
      }
    }
  }

  searchPrefix(prefix, limit = 10) {
    if (!prefix || typeof prefix !== "string") {
      return [];
    }

    const normalizedPrefix = prefix.trim().toLowerCase();
    if (!normalizedPrefix) {
      return [];
    }

    const parsedLimit = Number(limit);
    const effectiveLimit = Math.min(
      Math.max(1, Number.isInteger(parsedLimit) ? parsedLimit : 10),
      20,
    );

    let current = this.root;
    for (const char of normalizedPrefix) {
      if (!current.children.has(char)) {
        return [];
      }
      current = current.children.get(char);
    }

    // Breadth-First Search (BFS) to prioritize closer/shorter matches
    const results = [];
    const seenUserIds = new Set();
    const queue = [current];

    while (queue.length > 0 && results.length < effectiveLimit) {
      const node = queue.shift();

      for (const [userId, user] of node.users.entries()) {
        if (!seenUserIds.has(userId)) {
          seenUserIds.add(userId);
          results.push(user);
          if (results.length >= effectiveLimit) {
            break;
          }
        }
      }

      for (const child of node.children.values()) {
        queue.push(child);
      }
    }

    return results;
  }
}

