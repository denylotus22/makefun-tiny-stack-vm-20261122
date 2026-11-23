// Tiny stack VM for make.fun's tiny stack ISA v1: for every /input/<id>/ it
// writes stdout.bin + exit.txt to /output/<id>/. Run with node main.ts.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const OPS = {
  0x00: [0, 0, 0], 0x01: [1, 0, 1], 0x02: [4, 0, 1], 0x03: [0, 1, 0], 0x04: [0, 1, 2], 0x05: [0, 2, 2], 0x06: [0, 2, 3], 0x07: [0, 3, 3],
  0x10: [0, 2, 1], 0x11: [0, 2, 1], 0x12: [0, 2, 1], 0x13: [0, 2, 1], 0x14: [0, 2, 1], 0x15: [0, 2, 1], 0x16: [0, 2, 1], 0x17: [0, 1, 1],
  0x18: [0, 2, 1], 0x19: [0, 2, 1], 0x1a: [0, 2, 1], 0x1b: [0, 1, 1], 0x1c: [0, 2, 1], 0x1d: [0, 2, 1], 0x1e: [0, 2, 1], 0x20: [0, 2, 1],
  0x21: [0, 2, 1], 0x22: [0, 2, 1], 0x30: [2, 0, 0], 0x31: [2, 1, 0], 0x32: [2, 1, 0], 0x33: [2, 0, 0], 0x34: [0, 0, 0], 0x40: [0, 1, 1],
  0x41: [0, 2, 0], 0x50: [0, 1, 0], 0x51: [0, 1, 0], 0x52: [0, 0, 1], 0x53: [0, 1, 0],
};

function run(p: Buffer, input: Buffer): { stdout: Uint8Array; exit: number } {
  const n = p.length, s = new Int32Array(256), c = new Int32Array(64), m = new Int32Array(256);
  let sp = 0, cp = 0;
  const out: number[] = [];
  let ip = 0, pc = 0, steps = 0;
  const done = (e: number) => ({ stdout: Uint8Array.from(out), exit: e });
  for (;;) {
    // Trap order is the ISA's: steps, pc, opcode, immediate, then stack.
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const t = OPS[p[pc]];
    if (!t) return done(5);
    const [imm, pops, pushes] = t;
    if (pc + imm >= n) return done(9);
    steps++;
    const nx = pc + 1 + imm;
    if (sp < pops) return done(2);
    if (sp - pops + pushes > 256) return done(3);
    pc = nx;
    const op = p[pc - 1 - imm];
    switch (op) {
      case 0x00: return done(0);
      case 0x01: s[sp++] = (p[nx - 1] << 24) >> 24; break; // PUSH8, sign-extended
      case 0x02: s[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: s[sp] = s[sp - 1]; sp++; break;
      case 0x05: { const v = s[sp - 1]; s[sp - 1] = s[sp - 2]; s[sp - 2] = v; break; }
      case 0x06: s[sp] = s[sp - 2]; sp++; break;
      case 0x07: { const v = s[sp - 3]; s[sp - 3] = s[sp - 2]; s[sp - 2] = s[sp - 1]; s[sp - 1] = v; break; }
      case 0x17: s[sp - 1] = -s[sp - 1] | 0; break;
      case 0x1b: s[sp - 1] = ~s[sp - 1]; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = s[sp - 1], a = s[sp - 2];
        let r = 0;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) { // DIV truncates toward zero; INT_MIN / -1 is INT_MIN
          if (b === 0) return done(4);
          r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
        } else if (op === 0x14) { // MOD takes the dividend's sign; x % -1 is 0
          if (b === 0) return done(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 0x15) {
          if (b === 0) return done(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) {
          if (b === 0) return done(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31); // only the low 5 bits of the count
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2;
        s[sp++] = r;
        break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) { const v = s[--sp]; take = op === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = nx + rel;
        break;
      }
      case 0x33:
        if (cp === 64) return done(7);
        c[cp++] = nx;
        pc = p[nx - 2] | (p[nx - 1] << 8);
        break;
      case 0x34:
        if (cp === 0) return done(8);
        pc = c[--cp];
        break;
      case 0x40: {
        const addr = s[sp - 1];
        if (addr < 0 || addr >= 256) return done(6);
        s[sp - 1] = m[addr];
        break;
      }
      case 0x41: { // STORE (v addr --): top of stack is the address
        const addr = s[sp - 1], v = s[sp - 2];
        if (addr < 0 || addr >= 256) return done(6);
        sp -= 2;
        m[addr] = v;
        break;
      }
      case 0x50: {
        const text = String(s[sp - 1]);
        if (out.length + text.length > 65536) return done(11);
        sp--;
        for (let i = 0; i < text.length; i++) out.push(text.charCodeAt(i));
        break;
      }
      case 0x51:
        if (out.length + 1 > 65536) return done(11);
        out.push(s[--sp] & 255);
        break;
      case 0x52: s[sp++] = ip < input.length ? input[ip++] : -1; break;
      case 0x53: return done(s[--sp] & 255);
    }
  }
}

for (const id of readdirSync(I).sort()) {
  const d = join(I, id);
  const prog = join(d, 'program.bin');
  if (!existsSync(prog)) continue;
  const { stdout, exit } = run(
    readFileSync(prog),
    existsSync(join(d, 'input.bin')) ? readFileSync(join(d, 'input.bin')) : Buffer.alloc(0),
  );
  const o = join(O, id);
  mkdirSync(o, { recursive: true });
  writeFileSync(join(o, 'stdout.bin'), stdout);
  writeFileSync(join(o, 'exit.txt'), exit + '\n');
}
