import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(crypto.scrypt);
const publicUser = ({id, username, role, disabled}) => ({id, username, role, disabled: Boolean(disabled)});
export class UserStore {
  constructor(file) { this.file = file; this.users = []; this.queue = Promise.resolve(); }
  async init(username, password) {
    try { this.users = JSON.parse(await fs.readFile(this.file, 'utf8')).users; }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (password) {
        this.users = [{id:crypto.randomUUID(), username, role:'admin', ...(await this.hash(password))}];
        await this.save();
      }
    }
    if (!Array.isArray(this.users)) throw new Error('Invalid user store');
  }
  get enabled() { return this.users.length > 0; }
  async hash(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return {salt, hash:(await scrypt(password, salt, 64)).toString('hex')};
  }
  async verify(user, password) {
    if (!user || user.disabled || typeof password !== 'string' || password.length > 1024) return false;
    const hash = await scrypt(password, user.salt, 64);
    const expected = Buffer.from(user.hash, 'hex');
    return expected.length === hash.length && crypto.timingSafeEqual(expected, hash);
  }
  async authenticate(header = '') {
    if (!header.startsWith('Basic ')) return null;
    const value = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const i = value.indexOf(':');
    if (i < 0) return null;
    const user = this.users.find(u => u.username.toLowerCase() === value.slice(0,i).toLowerCase());
    return await this.verify(user,value.slice(i+1)) ? publicUser(user) : null;
  }
  list() { return this.users.map(publicUser); }
  async save() {
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({users:this.users}), {mode:0o600});
    await fs.rename(tmp,this.file);
  }
  mutate(action) {
    const next = this.queue.then(async () => {
      const previous = structuredClone(this.users);
      try { const result = await action(); await this.save(); return result; }
      catch (e) { this.users = previous; throw e; }
    });
    this.queue = next.catch(() => {}); return next;
  }
  async update(actor, id, data) {
    return this.mutate(async () => {
      const currentActor = this.users.find(u=>u.id===actor.id && !u.disabled);
      if (!currentActor || (id !== actor.id && currentActor.role !== 'admin')) throw new Error('Administrator access required');
      let user = id ? this.users.find(u=>u.id===id) : null;
      if (id && !user) throw new Error('User not found');
      if (id === actor.id && !(await this.verify(currentActor, data.currentPassword))) throw new Error('Current password is incorrect');
      const username = String(data.username ?? user?.username ?? '').trim();
      if (!/^[a-zA-Z0-9_.@-]{2,80}$/.test(username)) throw new Error('Login ID must be 2–80 letters, numbers, dots, underscores, @ or hyphens');
      if (this.users.some(u=>u.id!==id && u.username.toLowerCase()===username.toLowerCase())) throw new Error('Login ID is already in use');
      const password = data.password;
      if ((!user || password) && (typeof password !== 'string' || password.length < 12 || password.length > 128)) throw new Error('Use a password of 12–128 characters');
      const role = currentActor.role === 'admin' ? (data.role ?? user?.role ?? 'user') : user.role;
      if (!['admin','user'].includes(role)) throw new Error('Invalid role');
      const disabled = currentActor.role === 'admin' ? (data.disabled ?? user?.disabled ?? false) : user.disabled;
      if (typeof disabled !== 'boolean') throw new Error('Invalid account status');
      if (id===actor.id && (disabled || role!=='admin') && currentActor.role==='admin') throw new Error('You cannot disable or demote your own administrator account');
      if (!user) { user = {id:crypto.randomUUID()}; this.users.push(user); }
      Object.assign(user,{username,role,disabled});
      if (password) Object.assign(user,await this.hash(password));
      return publicUser(user);
    });
  }
}
