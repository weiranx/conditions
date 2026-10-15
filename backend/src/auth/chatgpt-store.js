'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

// Dedicated, local storage only. Never put these records in PostgreSQL or a browser.
class ChatGPTStore {
  constructor(directory = process.env.CHATGPT_AUTH_DIR || path.resolve(__dirname, '../../data/chatgpt')) {
    this.directory = path.resolve(directory);
    this.file = path.join(this.directory, 'credentials.json');
  }

  read() {
    let fd;
    try {
      const directory = fs.lstatSync(this.directory);
      if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077)) {
        throw new Error('ChatGPT credential directory must have owner-only permissions (0700).');
      }
      fd = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || (stat.mode & 0o077)) {
        throw new Error('ChatGPT credential file must have owner-only permissions (0600).');
      }
      const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
      if (!/^urn:uuid:[0-9a-f-]{36}$/i.test(value.hostId || '') || !Array.isArray(value.registrations)) {
        throw new Error('Invalid ChatGPT credential store.');
      }
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return { hostId: null, activeClientId: null, registrations: [] };
      // Parsing errors can contain file contents; never forward them to logs or clients.
      if (error instanceof SyntaxError) throw new Error('Invalid ChatGPT credential store.');
      throw error;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }

  async update(change) {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    // Validate existing permissions before any write.
    this.read();
    const lockPath = path.join(this.directory, '.lock');
    const deadline = Date.now() + 12000;
    while (true) {
      try {
        fs.mkdirSync(lockPath, { mode: 0o700 });
        break;
      } catch (error) {
        if (error.code !== 'EEXIST' || Date.now() >= deadline) {
          throw new Error('ChatGPT credentials are busy. Try again; only one runtime may refresh this session.');
        }
        await delay(50);
      }
    }
    const temporary = path.join(this.directory, `.credentials-${randomUUID()}.tmp`);
    try {
      const value = this.read();
      value.hostId ||= `urn:uuid:${randomUUID()}`;
      const result = await change(value);
      fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.file);
      return result;
    } finally {
      fs.rmSync(temporary, { force: true });
      fs.rmdirSync(lockPath);
    }
  }
}

const normalizeAccountId = (value) => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ? value.toLowerCase() : null;

// All profiles share the host ID and mutation lock, but callers can read/change only one profile.
// A null account ID preserves the original single-owner store without exposing named profiles.
class ChatGPTProfileStore {
  constructor(store, accountId = null) {
    if (accountId !== null && !normalizeAccountId(accountId)) throw new Error('Invalid Conditions account ID.');
    this.store = store;
    this.accountId = accountId === null ? null : normalizeAccountId(accountId);
    this.directory = store.directory;
    this.file = store.file;
  }

  belongs(record) { return (record.conditionsUserId || null) === this.accountId; }

  scope(value) {
    return {
      hostId: value.hostId,
      activeClientId: this.accountId === null ? value.activeClientId : value.activeByUser?.[this.accountId] || null,
      registrations: value.registrations.filter((record) => this.belongs(record)),
    };
  }

  read() { return this.scope(this.store.read()); }

  update(change) {
    return this.store.update(async (value) => {
      const scoped = this.scope(value);
      const result = await change(scoped);
      // One renewable session must never be copied between Conditions profiles.
      const others = value.registrations.filter((record) => !this.belongs(record));
      if (scoped.registrations.some((record) => record.refresh_token
        && others.some((other) => other.refresh_token === record.refresh_token))) {
        throw new Error('This ChatGPT session belongs to another Conditions account. Complete a separate login.');
      }
      value.registrations = [...others, ...scoped.registrations.map((record) => {
        const copy = { ...record };
        if (this.accountId === null) delete copy.conditionsUserId;
        else copy.conditionsUserId = this.accountId;
        return copy;
      })];
      if (this.accountId === null) value.activeClientId = scoped.activeClientId;
      else {
        value.activeByUser ||= {};
        value.activeByUser[this.accountId] = scoped.activeClientId;
      }
      return result;
    });
  }
}

module.exports = { ChatGPTStore, ChatGPTProfileStore, normalizeAccountId };
